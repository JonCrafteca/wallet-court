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

// ---- Enqueue (exactly-once) ----

// Enqueue one notification event. The event_key is the dedup key: any
// existing event_key is a permanent no-op. The atomic check-then-create
// pattern handles concurrent invocations — a duplicate-key error on create
// is treated as a successful duplicate (another invocation won the race).
// The recipient_email is read from settings, not from the caller.
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

  // Fast path: check if already exists (common case for duplicates)
  const existing = await base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
    { event_key }, "-created_date", 1
  );
  if (existing && existing.length > 0) {
    return { ok: true, duplicate: true, event_id: existing[0].event_id };
  }

  // Try to create — a duplicate-key error means another invocation won
  const event_id = newEventId();
  const now = new Date().toISOString();
  try {
    await base44.asServiceRole.entities.WalletCourtNotificationEvent.create({
      event_id,
      event_type: params.event_type,
      event_key,
      source_entity: params.source_entity,
      source_record_id: params.source_record_id,
      status: NOTIFICATION_STATUS.PENDING,
      recipient_email,
      metadata_json: JSON.stringify(sanitizeMetadata(params.metadata)),
      attempt_count: 0,
      max_attempts: MAX_ATTEMPTS,
      next_retry_at: now,
      processing_lock_id: null,
      processing_lock_acquired_at: null,
      created_at: now,
      updated_at: now
    });
    return { ok: true, duplicate: false, event_id };
  } catch (e) {
    const msg = (e?.message || "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("e11000")) {
      const winner = await base44.asServiceRole.entities.WalletCourtNotificationEvent.filter(
        { event_key }, "-created_date", 1
      );
      return { ok: true, duplicate: true, event_id: winner?.[0]?.event_id || null };
    }
    throw e;
  }
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

// Atomically claim an event for processing. CAS: the status must still match
// and the lock must be null. Returns true if this worker won the claim.
export async function claimEvent(base44, record: any, lockId: string): Promise<boolean> {
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