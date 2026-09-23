// Wallet Court → ShoutIt creator-attribution sender. Pure, unit-testable logic
// for referral validation, event-ID generation, payload construction, HMAC
// signing, receiver-response classification, and retry backoff.
//
// No SDK, no network, no side effects beyond the injected `signFn` (for testing).
// Imported by backend functions and unit-tested in isolation.

// ---- Constants ----

export const RECEIVER_URL = "https://shout-it-signal.base44.app/functions/walletCourtAttribution";

export const EVENT_TYPES = [
  "trial_started",
  "trial_completed",
  "receipt_created",
  "receipt_shared",
  "wallet_claimed",
] as const;

export const OUTBOX_STATUS = {
  PENDING: "pending",
  SENDING: "sending",
  DELIVERED: "delivered",
  RETRY_SCHEDULED: "retry_scheduled",
  PERMANENTLY_FAILED: "permanently_failed",
} as const;

// Referral cookie names (first-party, SameSite=Lax, 30-day expiry).
export const REF_COOKIE = "wc_ref";
export const REF_FIRST_COOKIE = "wc_ref_first";
export const VISITOR_COOKIE = "wc_vid";
export const COOKIE_MAX_AGE_DAYS = 30;

// Ref-code validation: URL-safe slug, lowercase, 1-32 chars.
// Starts and ends with alphanumeric; middle allows dots, hyphens, underscores.
const REF_CODE_REGEX = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const REF_CODE_MAX_LEN = 32;

// Retry backoff delays in seconds: 1m, 5m, 15m, 1h, 6h.
const BACKOFF_DELAYS = [60, 300, 900, 3600, 21600];

// 24-hour maximum event-age window (receiver rejects events older than this).
const MAX_EVENT_AGE_SECONDS = 24 * 60 * 60;

// ---- Referral validation ----

export function validateRefCode(raw: string | null | undefined): { ok: boolean; value: string; reason: string } {
  if (!raw) return { ok: false, value: "", reason: "No ref code provided." };
  const trimmed = String(raw).trim().toLowerCase();
  if (trimmed.length === 0) return { ok: false, value: "", reason: "Empty ref code." };
  if (trimmed.length > REF_CODE_MAX_LEN) return { ok: false, value: "", reason: "Ref code too long." };
  if (!REF_CODE_REGEX.test(trimmed)) return { ok: false, value: "", reason: "Invalid ref code format." };
  return { ok: true, value: trimmed, reason: "" };
}

// ---- ID generation ----

export function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "attr_" + crypto.randomUUID();
  }
  return "attr_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function newVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- Payload construction ----

export interface PayloadParams {
  event_id: string;
  event_type: string;
  ref_code: string;
  visitor_id: string;
  occurred_at: string;
  external_trial_id?: string;
  external_case_id?: string;
  external_receipt_id?: string;
  wallet_address_short?: string;
  share_channel?: string;
  metadata?: Record<string, any>;
}

export function buildAttributionPayload(params: PayloadParams): Record<string, any> {
  const payload: Record<string, any> = {
    event_id: params.event_id,
    event_type: params.event_type,
    ref_code: params.ref_code,
    visitor_id: params.visitor_id,
    occurred_at: params.occurred_at,
    timestamp: Math.floor(new Date(params.occurred_at).getTime() / 1000),
  };
  if (params.external_trial_id) payload.external_trial_id = params.external_trial_id;
  if (params.external_case_id) payload.external_case_id = params.external_case_id;
  if (params.external_receipt_id) payload.external_receipt_id = params.external_receipt_id;
  if (params.wallet_address_short) payload.wallet_address_short = params.wallet_address_short;
  if (params.share_channel) payload.share_channel = params.share_channel;
  payload.metadata = params.metadata || {};
  return payload;
}

// Refresh the timestamp field to the current time. Used at delivery time so
// the timestamp is always fresh (handles replay_window_exceeded retries).
// occurred_at and event_id are never changed.
export function refreshTimestamp(payload: Record<string, any>, now: number = Date.now()): Record<string, any> {
  return { ...payload, timestamp: Math.floor(now / 1000) };
}

export function serializePayload(payload: Record<string, any>): string {
  return JSON.stringify(payload);
}

// ---- HMAC-SHA256 signing ----

// Sign the exact body string with HMAC-SHA256 using Web Crypto SubtleCrypto.
// Returns the full header value: "sha256=<lowercase hex digest>".
export async function signPayload(bodyString: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(bodyString));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "sha256=" + hex;
}

// ---- Receiver-response classification ----

export interface ReceiverClassification {
  delivered: boolean;
  retry: boolean;
  permanentFailure: boolean;
  errorCode: string;
  errorSummary: string;
}

const NO_RETRY_CODES = new Set([
  "invalid_signature",
  "missing_required_fields",
  "invalid_event_type",
  "invalid_occurred_at",
  "event_too_old",
]);

const RETRY_CODES = new Set([
  "replay_window_exceeded",
]);

export function classifyReceiverResponse(status: number, body: any): ReceiverClassification {
  // 200 accepted or 200 duplicate → delivered
  if (status === 200) {
    return { delivered: true, retry: false, permanentFailure: false, errorCode: "", errorSummary: "" };
  }

  // Network timeout / connection failure (no response received)
  if (status === 0) {
    return {
      delivered: false, retry: true, permanentFailure: false,
      errorCode: "network_error", errorSummary: "Network error or timeout.",
    };
  }

  // 401 → invalid_signature → permanent failure
  if (status === 401) {
    const code = body?.error_code || "invalid_signature";
    return {
      delivered: false, retry: false, permanentFailure: true,
      errorCode: code, errorSummary: sanitizeSummary(body?.message) || "Receiver rejected signature.",
    };
  }

  // 400 → check error code
  if (status === 400) {
    const code = body?.error_code || body?.code || "validation_error";
    if (RETRY_CODES.has(code)) {
      return {
        delivered: false, retry: true, permanentFailure: false,
        errorCode: code, errorSummary: sanitizeSummary(body?.message) || "Replay window exceeded.",
      };
    }
    return {
      delivered: false, retry: false, permanentFailure: true,
      errorCode: code, errorSummary: sanitizeSummary(body?.message) || "Validation error.",
    };
  }

  // 5xx → retry
  if (status >= 500) {
    return {
      delivered: false, retry: true, permanentFailure: false,
      errorCode: "receiver_error", errorSummary: `Receiver returned ${status}.`,
    };
  }

  // Other 4xx → permanent failure (conservative)
  if (status >= 400 && status < 500) {
    const code = body?.error_code || body?.code || "validation_error";
    return {
      delivered: false, retry: false, permanentFailure: true,
      errorCode: code, errorSummary: sanitizeSummary(body?.message) || `Receiver returned ${status}.`,
    };
  }

  // Unknown → retry conservatively
  return {
    delivered: false, retry: true, permanentFailure: false,
    errorCode: "unknown", errorSummary: `Unexpected status ${status}.`,
  };
}

// Sanitize a receiver message: strip any potential secrets, signatures, or
// full wallet addresses. Keep it short and non-identifying.
function sanitizeSummary(msg: any): string {
  if (!msg) return "";
  const s = String(msg).slice(0, 200);
  // Strip anything that looks like a hex signature, API key, or address
  return s
    .replace(/sha256=[0-9a-f]+/gi, "[signature]")
    .replace(/0x[0-9a-fA-F]{20,}/g, "[address]")
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted]");
}

// ---- Backoff ----

export function computeBackoff(attempt: number): number {
  const idx = Math.min(attempt, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[idx];
}

// ---- Event-age check ----

export function isEventTooOld(occurredAt: string, now: number = Date.now()): boolean {
  const occurred = new Date(occurredAt).getTime();
  if (!Number.isFinite(occurred)) return true;
  return (now - occurred) / 1000 > MAX_EVENT_AGE_SECONDS;
}

export function maxEventAgeSeconds(): number {
  return MAX_EVENT_AGE_SECONDS;
}

// ---- Sanitization for admin display ----

export function sanitizeOutboxForAdmin(record: any): Record<string, any> {
  return {
    event_id: record.event_id || "",
    event_type: record.event_type || "",
    ref_code: record.ref_code || "",
    visitor_id: record.visitor_id || "",
    status: record.status || OUTBOX_STATUS.PENDING,
    attempt_count: record.attempt_count ?? 0,
    next_attempt_at: record.next_attempt_at || null,
    last_attempt_at: record.last_attempt_at || null,
    delivered_at: record.delivered_at || null,
    receiver_status_code: record.receiver_status_code ?? null,
    receiver_result: record.receiver_result || null,
    last_error_code: record.last_error_code || null,
    last_error_summary: record.last_error_summary || null,
    external_trial_id: record.external_trial_id || null,
    external_case_id: record.external_case_id || null,
    external_receipt_id: record.external_receipt_id || null,
    created_date: record.created_date || null,
    updated_date: record.updated_date || null,
  };
}