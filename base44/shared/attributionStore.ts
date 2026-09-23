// Wallet Court — server-side attribution outbox store. Uses base44.asServiceRole
// to create/update/query WalletCourtAttributionOutbox records. Imported by
// backend functions; never imported by client code.
//
// Enqueue is non-blocking: callers wrap it in waitUntil so attribution never
// delays or breaks the user journey. Delivery signs and sends one event to the
// ShoutIt receiver, classifies the response, and updates the outbox record.

import {
  validateRefCode,
  newEventId,
  buildAttributionPayload,
  refreshTimestamp,
  serializePayload,
  signPayload,
  classifyReceiverResponse,
  computeBackoff,
  isEventTooOld,
  OUTBOX_STATUS,
  RECEIVER_URL,
} from "./attribution.ts";

// ---- Enqueue ----

export async function enqueueAttributionEvent(base44, params: {
  event_type: string;
  ref_code: string;
  visitor_id: string;
  external_trial_id?: string;
  external_case_id?: string;
  external_receipt_id?: string;
  wallet_address_short?: string;
  share_channel?: string;
  metadata?: Record<string, any>;
}): Promise<{ ok: boolean; event_id?: string; reason?: string }> {
  const ref = validateRefCode(params.ref_code);
  if (!ref.ok) return { ok: false, reason: ref.reason };

  if (!params.visitor_id || String(params.visitor_id).length < 8) {
    return { ok: false, reason: "Invalid visitor_id." };
  }

  const event_id = newEventId();
  const occurred_at = new Date().toISOString();
  const payload = buildAttributionPayload({
    event_id,
    event_type: params.event_type,
    ref_code: ref.value,
    visitor_id: params.visitor_id,
    occurred_at,
    external_trial_id: params.external_trial_id,
    external_case_id: params.external_case_id,
    external_receipt_id: params.external_receipt_id,
    wallet_address_short: params.wallet_address_short,
    share_channel: params.share_channel,
    metadata: params.metadata,
  });

  await base44.asServiceRole.entities.WalletCourtAttributionOutbox.create({
    event_id,
    event_type: params.event_type,
    ref_code: ref.value,
    visitor_id: params.visitor_id,
    payload: serializePayload(payload),
    status: OUTBOX_STATUS.PENDING,
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    external_trial_id: params.external_trial_id || null,
    external_case_id: params.external_case_id || null,
    external_receipt_id: params.external_receipt_id || null,
  });

  return { ok: true, event_id };
}

// ---- Fetch with timeout ----

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<{ response: Response | null; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { response, timedOut: false };
  } catch (e) {
    return { response: null, timedOut: true };
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Deliver one event ----

export interface DeliveryResult {
  delivered: boolean;
  retry: boolean;
  permanentFailure: boolean;
  statusCode: number;
  receiverResult: string;
  errorCode: string;
  errorSummary: string;
}

export async function deliverOneEvent(base44, record: any, secret: string): Promise<DeliveryResult> {
  const now = Date.now();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(record.payload);
  } catch {
    return await markPermanentFailure(base44, record, 0, "", "malformed_payload", "Payload could not be parsed.");
  }

  // Event-age check: if older than 24h, don't send.
  if (isEventTooOld(payload.occurred_at, now)) {
    return await markPermanentFailure(base44, record, 0, "", "event_too_old", "Event exceeded the 24-hour maximum age window.");
  }

  // Refresh timestamp to current time (handles replay_window_exceeded retries).
  const freshPayload = refreshTimestamp(payload, now);
  const bodyString = serializePayload(freshPayload);
  const signature = await signPayload(bodyString, secret);
  const timestamp = Math.floor(now / 1000);

  // Send to receiver
  const { response, timedOut } = await fetchWithTimeout(
    RECEIVER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ShoutIt-Signature": signature,
        "X-ShoutIt-Timestamp": String(timestamp),
      },
      body: bodyString,
    }
  );

  const statusCode = response?.status ?? 0;
  let body: any = null;
  let receiverResult = "";
  if (response) {
    try {
      body = await response.json();
      receiverResult = body?.attribution_status || body?.status || body?.result || (response.ok ? "accepted" : "error");
      if (body?.duplicate) receiverResult += " (duplicate)";
    } catch {
      receiverResult = response.ok ? "accepted" : `http_${statusCode}`;
    }
  }

  const classification = classifyReceiverResponse(statusCode, body);
  const attemptCount = (record.attempt_count ?? 0) + 1;
  const nowIso = new Date(now).toISOString();

  if (classification.delivered) {
    await base44.asServiceRole.entities.WalletCourtAttributionOutbox.update(record.id, {
      status: OUTBOX_STATUS.DELIVERED,
      attempt_count: attemptCount,
      last_attempt_at: nowIso,
      delivered_at: nowIso,
      receiver_status_code: statusCode,
      receiver_result: receiverResult,
      last_error_code: null,
      last_error_summary: null,
    });
    return { delivered: true, retry: false, permanentFailure: false, statusCode, receiverResult, errorCode: "", errorSummary: "" };
  }

  if (classification.permanentFailure) {
    await base44.asServiceRole.entities.WalletCourtAttributionOutbox.update(record.id, {
      status: OUTBOX_STATUS.PERMANENTLY_FAILED,
      attempt_count: attemptCount,
      last_attempt_at: nowIso,
      receiver_status_code: statusCode,
      receiver_result: receiverResult,
      last_error_code: classification.errorCode,
      last_error_summary: classification.errorSummary,
    });
    return { delivered: false, retry: false, permanentFailure: true, statusCode, receiverResult, errorCode: classification.errorCode, errorSummary: classification.errorSummary };
  }

  // Retryable failure
  const backoff = computeBackoff(attemptCount - 1);
  const nextAttemptAt = new Date(now + backoff * 1000).toISOString();
  await base44.asServiceRole.entities.WalletCourtAttributionOutbox.update(record.id, {
    status: OUTBOX_STATUS.RETRY_SCHEDULED,
    attempt_count: attemptCount,
    next_attempt_at: nextAttemptAt,
    last_attempt_at: nowIso,
    receiver_status_code: statusCode,
    receiver_result: receiverResult,
    last_error_code: classification.errorCode,
    last_error_summary: classification.errorSummary,
  });
  return { delivered: false, retry: true, permanentFailure: false, statusCode, receiverResult, errorCode: classification.errorCode, errorSummary: classification.errorSummary };
}

async function markPermanentFailure(base44, record, statusCode, receiverResult, errorCode, errorSummary): Promise<DeliveryResult> {
  const attemptCount = (record.attempt_count ?? 0) + 1;
  await base44.asServiceRole.entities.WalletCourtAttributionOutbox.update(record.id, {
    status: OUTBOX_STATUS.PERMANENTLY_FAILED,
    attempt_count: attemptCount,
    last_attempt_at: new Date().toISOString(),
    receiver_status_code: statusCode,
    receiver_result: receiverResult,
    last_error_code: errorCode,
    last_error_summary: errorSummary,
  });
  return { delivered: false, retry: false, permanentFailure: true, statusCode, receiverResult, errorCode, errorSummary };
}

// ---- Query helpers ----

export async function getPendingEvents(base44, limit = 20): Promise<any[]> {
  const nowIso = new Date().toISOString();
  // Fetch pending (next_attempt_at in the past) and retry_scheduled items
  const [pending, retryable] = await Promise.all([
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter(
      { status: OUTBOX_STATUS.PENDING, next_attempt_at: { $lte: nowIso } },
      "-created_date",
      limit
    ),
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter(
      { status: OUTBOX_STATUS.RETRY_SCHEDULED, next_attempt_at: { $lte: nowIso } },
      "next_attempt_at",
      limit
    ),
  ]);
  // Deduplicate by event_id (in case both queries overlap)
  const seen = new Set<string>();
  const combined = [...(pending || []), ...(retryable || [])].filter((r) => {
    if (seen.has(r.event_id)) return false;
    seen.add(r.event_id);
    return true;
  });
  return combined.slice(0, limit);
}

export async function getOutboxStats(base44): Promise<Record<string, any>> {
  const [pending, delivered, retry, failed, all] = await Promise.all([
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter({ status: OUTBOX_STATUS.PENDING }, "-created_date", 500),
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter({ status: OUTBOX_STATUS.DELIVERED }, "-delivered_at", 500),
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter({ status: OUTBOX_STATUS.RETRY_SCHEDULED }, "next_attempt_at", 500),
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter({ status: OUTBOX_STATUS.PERMANENTLY_FAILED }, "-updated_date", 500),
    base44.asServiceRole.entities.WalletCourtAttributionOutbox.list("-created_date", 500),
  ]);
  return {
    pending: pending?.length ?? 0,
    delivered: delivered?.length ?? 0,
    retry_scheduled: retry?.length ?? 0,
    permanently_failed: failed?.length ?? 0,
    total: all?.length ?? 0,
    last_delivered: delivered && delivered.length > 0 ? delivered[0] : null,
    last_error: failed && failed.length > 0 ? failed[0] : null,
  };
}

export async function getRecentEvents(base44, limit = 50): Promise<any[]> {
  const events = await base44.asServiceRole.entities.WalletCourtAttributionOutbox.list("-created_date", limit);
  return events || [];
}

export async function findByEventId(base44, eventId: string): Promise<any | null> {
  const results = await base44.asServiceRole.entities.WalletCourtAttributionOutbox.filter(
    { event_id: eventId }, "-created_date", 1
  );
  return results && results[0] ? results[0] : null;
}