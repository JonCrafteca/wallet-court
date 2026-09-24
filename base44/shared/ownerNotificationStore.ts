// Wallet Court — owner notification outbox store. Uses base44.asServiceRole
// to create/update/query WalletCourtNotificationEvent and
// WalletCourtOwnerNotificationSettings records. Imported by backend
// functions; never imported by client code.
//
// Enqueue is non-blocking: callers wrap it in waitUntil so notification
// enqueue never delays or breaks the user journey (signup, claiming,
// verdict creation). Delivery sends one email via the SendEmail Core
// integration and updates the outbox record.

import {
  EVENT_TYPES,
  NOTIFICATION_STATUS,
  MAX_ATTEMPTS,
  STALE_LOCK_TIMEOUT_MS,
  buildEventKey,
  newEventId,
  newLockId,
  computeBackoff,
  sanitizeMetadata,
  shouldEnqueue,
  defaultSettings,
  buildEmail,
} from "./ownerNotifications.ts";

const CONTROL_KEY = "main";

// ---- Settings ----

export async function getSettings(base44): Promise<any> {
  const records = await base44.asServiceRole.entities.WalletCourtOwnerNotificationSettings.filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Read settings or return defaults. NEVER creates the singleton — viewing
// the settings page must never mutate settings.
export async function getSettingsOrDefault(base44): Promise<any> {
  const existing = await getSettings(base44);
  if (existing) return existing;
  return defaultSettings();
}

export async function saveSettings(base44, fields: Record<string, any>): Promise<any> {
  const existing = await getSettings(base44);
  const now = new Date().toISOString();
  if (!existing) {
    return base44.asServiceRole.entities.WalletCourtOwnerNotificationSettings.create({
      control_key: CONTROL_KEY,
      version: 0,
      recipient_email: fields.recipient_email ?? "",
      master_enabled: fields.master_enabled ?? false,
      signup_enabled: fields.signup_enabled ?? true,
      claim_enabled: fields.claim_enabled ?? true,
      verdict_enabled: fields.verdict_enabled ?? true,
      last_test_status: null,
      last_test_timestamp: null,
      last_test_error: null,
      updated_at: now
    });
  }
  const newVersion = (existing.version || 0) + 1;
  return base44.asServiceRole.entities.WalletCourtOwnerNotificationSettings.update(existing.id, {
    recipient_email: fields.recipient_email ?? existing.recipient_email,
    master_enabled: fields.master_enabled ?? existing.master_enabled,
    signup_enabled: fields.signup_enabled ?? existing.signup_enabled,
    claim_enabled: fields.claim_enabled ?? existing.claim_enabled,
    verdict_enabled: fields.verdict_enabled ?? existing.verdict_enabled,
    version: newVersion,
    updated_at: now
  });
}

export async function updateTestResult(base44, status: string, error: string | null): Promise<any> {
  const existing = await getSettings(base44);
  if (!existing) return null;
  return base44.asServiceRole.entities.WalletCourtOwnerNotificationSettings.update(existing.id, {
    last_test_status: status,
    last_test_timestamp: new Date().toISOString(),
    last_test_error: error
  });
}

// ---- Enqueue (exactly-once via atomic keyed upsert) ----

// Enqueue one notification event. The event_key is the dedup key. Uses the
// SDK's atomic keyed-upsert primitive (upsert with key: ["event_key"]) which
// eliminates the check-then-create TOCTOU race: the database atomically creates
// or updates based on the key. No entity-level unique constraint is required
// and no duplicate-key exception is caught.
//
// Only the invocation that atomically CREATES the row (result.created > 0)
// proceeds as the winner. All other invocations (result.updated > 0) return
// duplicate: true and do NOT modify the existing record's mutable delivery
// state — the upsert payload contains only immutable identification fields,
// so a duplicate enqueue can never reset a sent/failed/dead-letter event back
// to pending.
//
// The winner then explicitly initializes ALL mutable lock fields via a
// follow-up update so no schema defaults are relied upon and the worker's
// CAS filter (processing_lock_id: null) matches immediately.
export async function enqueueNotification(base44, params: {
  event_type: string;
  source_entity: string;
  source_record_id: string;
  metadata: Record<string, any>;
}): Promise<{ ok: boolean; duplicate: boolean; event_id?: string; reason?: string }> {
  // Check settings — master, event toggle, and recipient
  const settings = await getSettings(base44);
  const check = shouldEnqueue(settings, params.event_type);
  if (!check.ok) return { ok: false, duplicate: false, reason: check.reason };

  const recipient_email = settings.recipient_email;
  const event_key = buildEventKey(params.event_type, params.source_record_id);
  const event_id = newEventId();
  const now = new Date().toISOString();

  // Atomic keyed upsert: immutable identification fields are in the payload.
  // event_id is required by the server on create, so it is included — a
  // duplicate enqueue (update path) will overwrite event_id with a new value,
  // but this is harmless: event_key (not event_id) is the dedup key, and the
  // admin dashboard always shows the latest event_id from getRecentEvents.
  //
  // Mutable delivery state (status, attempt_count, lock fields, sent_at,
  // etc.) is deliberately EXCLUDED from the upsert payload so a duplicate
  // enqueue never resets an existing record's delivery progress — a sent
  // event stays sent, a dead-letter event stays dead-lettered.
  const result = await base44.asServiceRole.entities.WalletCourtNotificationEvent.upsert(
    [{
      event_id,
      event_type: params.event_type,
      event_key,
      source_entity: params.source_entity,
      source_record_id: params.source_record_id,
      recipient_email,
      metadata_json: JSON.stringify(sanitizeMetadata(params.metadata)),
      max_attempts: MAX_ATTEMPTS,
      created_at: now,
      updated_at: now
    }],
    { key: ["event_key"] }
  );

  if (result.created > 0) {
    // Winner: explicitly initialize ALL mutable lock fields. This runs
    // before the enqueue returns, so the worker's CAS filter
    // (processing_lock_id: null) matches immediately after creation.
    const record = result.records[0];
    await base44.asServiceRole.entities.WalletCourtNotificationEvent.update(record.id, {
      status: NOTIFICATION_STATUS.PENDING,
      attempt_count: 0,
      next_retry_at: now,
      processing_lock_id: null,
      processing_lock_acquired_at: null,
      last_attempt_at: null,
      sent_at: null,
      last_error: null,
      updated_at: now
    });
    return { ok: true, duplicate: false, event_id };
  }

  // Duplicate: the upsert matched an existing event_key and updated only
  // immutable identification fields. All mutable delivery state (status,
  // attempt_count, lock fields, sent_at, etc.) is preserved because it was
  // not in the upsert payload. This is a permanent no-op — the event is
  // already enqueued (or already sent).
  return { ok: true, duplicate: true, event_id: result.records?.[0]?.event_id || null };
}

// ---- Delivery ----

// Fetch events due for processing: pending events (next_retry_at <= now) and
// failed events past their retry time. Deduplicates by record id.
export async function getDueEvents(base44, limit = 20): Promise<any[]> {
  const nowIso = new Date().toISOString();
  const [pending, failed] = await Promise.all([
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
      { status: NOTIFICATION_STATUS.PENDING, next_retry_at: { $lte: nowIso } },
      "-created_date",
      limit
    ),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
      { status: NOTIFICATION_STATUS.FAILED, next_retry_at: { $lte: nowIso } },
      "next_retry_at",
      limit
    ),
  ]);
  const seen = new Set<string>();
  const combined = [...(pending || []), ...(failed || [])].filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  return combined.slice(0, limit);
}

// Fetch events stuck in "processing" with a stale lock (older than
// STALE_LOCK_TIMEOUT_MS). These can be reclaimed by a new worker.
export async function getStaleProcessingEvents(base44, limit = 10): Promise<any[]> {
  const now = Date.now();
  const stuck = await base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
    { status: NOTIFICATION_STATUS.PROCESSING },
    "processing_lock_acquired_at",
    limit
  );
  return (stuck || []).filter((r) => {
    const acquired = r.processing_lock_acquired_at ? new Date(r.processing_lock_acquired_at).getTime() : 0;
    return acquired > 0 && (now - acquired) > STALE_LOCK_TIMEOUT_MS;
  });
}

// Normalize an event's lock fields before claiming. Legacy events (created
// before explicit lock-field initialization) may have missing
// processing_lock_id / processing_lock_acquired_at fields. Base44 query
// filters may not match missing fields as null, so the worker's CAS filter
// (processing_lock_id: null) would never match — the event would become
// permanently unclaimable. This function explicitly sets missing lock fields
// to null so the CAS filter matches. Only pending/failed events are
// normalized; sent/dead_letter events are never touched.
export async function normalizeEventForClaiming(base44, record: any): Promise<any> {
  if (!record) return record;
  // Never normalize terminal events.
  if (record.status === NOTIFICATION_STATUS.SENT || record.status === NOTIFICATION_STATUS.DEAD_LETTER) {
    return record;
  }
  const needsNormalize =
    record.processing_lock_id === undefined ||
    record.processing_lock_acquired_at === undefined ||
    record.attempt_count === undefined ||
    record.max_attempts === undefined ||
    record.next_retry_at === undefined;
  if (!needsNormalize) return record;
  const now = new Date().toISOString();
  await base44.asServiceRole.entities.WalletCourtNotificationEvent.update(record.id, {
    processing_lock_id: record.processing_lock_id ?? null,
    processing_lock_acquired_at: record.processing_lock_acquired_at ?? null,
    attempt_count: record.attempt_count ?? 0,
    max_attempts: record.max_attempts ?? MAX_ATTEMPTS,
    next_retry_at: record.next_retry_at ?? now,
    updated_at: now
  });
  return {
    ...record,
    processing_lock_id: record.processing_lock_id ?? null,
    processing_lock_acquired_at: record.processing_lock_acquired_at ?? null,
    attempt_count: record.attempt_count ?? 0,
    max_attempts: record.max_attempts ?? MAX_ATTEMPTS,
    next_retry_at: record.next_retry_at ?? now
  };
}

// Atomically claim an event for processing. CAS: the status must still match
// and the lock must be null. Returns true if this worker won the claim.
// Sent and dead_letter events are never claimable — the caller filters them
// out via getDueEvents, but this guard provides defense-in-depth.
export async function claimEvent(base44, record: any, lockId: string): Promise<boolean> {
  if (!record) return false;
  if (record.status === NOTIFICATION_STATUS.SENT || record.status === NOTIFICATION_STATUS.DEAD_LETTER) {
    return false;
  }
  const now = new Date().toISOString();
  const result = await base44.asServiceRole.entities.WalletCourtNotificationEvent.updateMany(
    { id: record.id, status: record.status, processing_lock_id: null },
    {
      $set: {
        status: NOTIFICATION_STATUS.PROCESSING,
        processing_lock_id: lockId,
        processing_lock_acquired_at: now,
        updated_at: now
      }
    }
  );
  return !!(result && result.updated === 1);
}

export async function markSent(base44, record: any): Promise<void> {
  const now = new Date().toISOString();
  await base44.asServiceRole.entities.WalletCourtNotificationEvent.update(record.id, {
    status: NOTIFICATION_STATUS.SENT,
    sent_at: now,
    last_attempt_at: now,
    last_error: null,
    processing_lock_id: null,
    processing_lock_acquired_at: null,
    updated_at: now
  });
}

// Mark a delivery attempt as failed. If attempt_count reaches max_attempts,
// the event is dead-lettered. Otherwise, it's scheduled for retry with
// bounded backoff. Returns whether the event was dead-lettered.
export async function markFailed(base44, record: any, error: string): Promise<{ dead_lettered: boolean }> {
  const attemptCount = (record.attempt_count || 0) + 1;
  const now = new Date().toISOString();
  if (attemptCount >= (record.max_attempts || MAX_ATTEMPTS)) {
    await base44.asServiceRole.entities.WalletCourtNotificationEvent.update(record.id, {
      status: NOTIFICATION_STATUS.DEAD_LETTER,
      attempt_count: attemptCount,
      last_attempt_at: now,
      last_error: String(error).slice(0, 500),
      processing_lock_id: null,
      processing_lock_acquired_at: null,
      updated_at: now
    });
    return { dead_lettered: true };
  }
  const backoff = computeBackoff(attemptCount - 1);
  const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
  await base44.asServiceRole.entities.WalletCourtNotificationEvent.update(record.id, {
    status: NOTIFICATION_STATUS.FAILED,
    attempt_count: attemptCount,
    last_attempt_at: now,
    last_error: String(error).slice(0, 500),
    next_retry_at: nextRetry,
    processing_lock_id: null,
    processing_lock_acquired_at: null,
    updated_at: now
  });
  return { dead_lettered: false };
}

// Send one email for the given event via the SendEmail Core integration.
// Returns { sent, error }.
export async function deliverOneEvent(base44, record: any): Promise<{ sent: boolean; error: string }> {
  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(record.metadata_json || "{}");
  } catch {
    meta = {};
  }
  const email = buildEmail(record.event_type, meta);
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: record.recipient_email,
      subject: email.subject,
      body: email.body
    });
    return { sent: true, error: "" };
  } catch (e) {
    return { sent: false, error: e?.message || "Email delivery failed." };
  }
}

// ---- Query helpers ----

export async function getOutboxStats(base44): Promise<Record<string, any>> {
  const [pending, processing, sent, failed, deadLetter, all] = await Promise.all([
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter({ status: NOTIFICATION_STATUS.PENDING }, "-created_date", 500),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter({ status: NOTIFICATION_STATUS.PROCESSING }, "-created_date", 500),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter({ status: NOTIFICATION_STATUS.SENT }, "-sent_at", 500),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter({ status: NOTIFICATION_STATUS.FAILED }, "-updated_date", 500),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.filter({ status: NOTIFICATION_STATUS.DEAD_LETTER }, "-updated_date", 500),
    base44.asServiceRole.entities.WalletCourtNotificationEvent.list("-created_date", 500),
  ]);
  return {
    pending: pending?.length ?? 0,
    processing: processing?.length ?? 0,
    sent: sent?.length ?? 0,
    failed: failed?.length ?? 0,
    dead_letter: deadLetter?.length ?? 0,
    total: all?.length ?? 0,
    last_sent: sent && sent.length > 0 ? sent[0] : null,
    last_error: deadLetter && deadLetter.length > 0 ? deadLetter[0] : (failed && failed.length > 0 ? failed[0] : null),
  };
}

export async function getRecentEvents(base44, limit = 50): Promise<any[]> {
  const events = await base44.asServiceRole.entities.WalletCourtNotificationEvent.list("-created_date", limit);
  return events || [];
}

export async function findByEventId(base44, eventId: string): Promise<any | null> {
  const results = await base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
    { event_id: eventId }, "-created_date", 1
  );
  return results && results[0] ? results[0] : null;
}