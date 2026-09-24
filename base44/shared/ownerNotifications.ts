// Wallet Court — owner notification pure logic. No SDK, no network, no side
// effects. Imported by backend functions and unit-tested in isolation.
//
// This module owns the three notification-worthy event types (signup, claim,
// verdict), the exactly-once event-key format, email content builders, retry
// backoff, metadata sanitization, and admin-safe event serialization.

export const EVENT_TYPES = {
  SIGNUP: "signup",
  CLAIM: "claim",
  VERDICT: "verdict"
} as const;

export const NOTIFICATION_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter"
} as const;

export const MAX_ATTEMPTS = 3;

// Bounded backoff in seconds: 1m, 5m, 15m.
const BACKOFF_DELAYS = [60, 300, 900];

// Stale processing lock timeout: 5 minutes. A worker that crashes mid-delivery
// leaves an event in "processing" — a new worker can reclaim it after this.
export const STALE_LOCK_TIMEOUT_MS = 300000;

// Enqueue mutex stale-lock timeout: 30 seconds. An enqueue that crashes while
// holding the enqueue lock leaves it held — a new enqueue can reclaim it after
// this. Normal enqueues (filter + create) complete in well under 1 second.
export const ENQUEUE_LOCK_STALE_TIMEOUT_MS = 30000;

// Retry delay when the enqueue lock is held by another invocation.
export const ENQUEUE_LOCK_RETRY_DELAY_MS = 150;

// Maximum enqueue-lock acquisition attempts before giving up.
export const ENQUEUE_LOCK_MAX_ATTEMPTS = 3;

export const APP_URL = "https://wallet-court-roast.base44.app";

// ---- Key + ID generation ----

export function buildEventKey(eventType: string, sourceRecordId: string): string {
  return `walletcourt:${eventType}:${sourceRecordId}`;
}

export function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "wnot_" + crypto.randomUUID();
  }
  return "wnot_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function newLockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "wnlk_" + crypto.randomUUID();
  }
  return "wnlk_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// Generate a unique enqueue-lock token. Used as the mutex value in the
// settings record's enqueue_lock_id field.
export function newEnqueueLockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "enq_" + crypto.randomUUID();
  }
  return "enq_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- Enqueue lock pure decision logic ----

// Decide whether a stale enqueue lock can be reclaimed. Pure: no DB, no side
// effects. Returns true if the lock is either free (null/missing) or stale
// (held longer than ENQUEUE_LOCK_STALE_TIMEOUT_MS).
export function canReclaimEnqueueLock(settings: any, now: number = Date.now()): boolean {
  if (!settings) return true;
  if (!settings.enqueue_lock_id) return true;
  if (!settings.enqueue_lock_acquired_at) return true;
  const acquiredAt = new Date(settings.enqueue_lock_acquired_at).getTime();
  if (isNaN(acquiredAt)) return true;
  return (now - acquiredAt) > ENQUEUE_LOCK_STALE_TIMEOUT_MS;
}

// Build the CAS filter for acquiring the enqueue lock. If the lock is free
// or stale, the filter matches; otherwise it does not. Returns null when the
// lock cannot be acquired (fresh lock held by another invocation).
//
// The version field is the primary CAS guard: every acquire and release
// increments it, so a matching version proves no other invocation has
// touched the lock since we read it. The enqueue_lock_id: null filter is
// NOT used because Base44 updateMany does not reliably filter on null values
// — it can match records where the field is set, defeating the CAS. For a
// stale lock, the specific enqueue_lock_id value IS included (it's a
// non-null string, which filters reliably) to prove we're reclaiming the
// exact stale lock we observed.
export function buildEnqueueLockCasFilter(settings: any, now: number = Date.now()): Record<string, any> | null {
  if (!settings) return null;
  if (!canReclaimEnqueueLock(settings, now)) return null;
  const filter: Record<string, any> = {
    control_key: "main",
    version: settings.version
  };
  if (settings.enqueue_lock_id) {
    // Stale lock — reclaim by matching the specific lock value (non-null,
    // filters reliably) plus the version guard.
    filter.enqueue_lock_id = settings.enqueue_lock_id;
  }
  // Free lock: version guard alone suffices — acquiring the lock increments
  // the version, so a matching version proves no one else has acquired it.
  return filter;
}

// ---- Backoff ----

export function computeBackoff(attempt: number): number {
  const idx = Math.min(attempt, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[idx];
}

// ---- Sanitization ----

// Strip any full wallet addresses from a metadata object. Keeps address_short
// (which contains an ellipsis and is safe). Defense-in-depth: the trigger
// functions should only include address_short, but this ensures no full
// address ever leaks into stored metadata or email bodies.
export function sanitizeMetadata(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (typeof value === "string") {
      // Skip values containing a full EVM address (0x + 40 hex chars)
      if (/0x[0-9a-fA-F]{40}/.test(value)) continue;
      // Skip values that look like a full Solana address (base58, 32-44 chars, no ellipsis)
      if (value.length >= 32 && value.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value) && !value.includes("…")) continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

// ---- Settings defaults ----

export function defaultSettings(): Record<string, any> {
  return {
    control_key: "main",
    version: 0,
    recipient_email: "",
    master_enabled: false,
    signup_enabled: true,
    claim_enabled: true,
    verdict_enabled: true,
    last_test_status: null,
    last_test_timestamp: null,
    last_test_error: null,
    updated_at: null
  };
}

// Check whether a notification should be enqueued given the current settings.
export function shouldEnqueue(settings: any, eventType: string): { ok: boolean; reason: string } {
  if (!settings) return { ok: false, reason: "Settings not loaded." };
  if (!settings.master_enabled) return { ok: false, reason: "Master switch is disabled." };
  if (!settings.recipient_email || !String(settings.recipient_email).trim()) {
    return { ok: false, reason: "Recipient email is not configured." };
  }
  if (eventType === EVENT_TYPES.SIGNUP && !settings.signup_enabled) {
    return { ok: false, reason: "Signup notifications are disabled." };
  }
  if (eventType === EVENT_TYPES.CLAIM && !settings.claim_enabled) {
    return { ok: false, reason: "Claim notifications are disabled." };
  }
  if (eventType === EVENT_TYPES.VERDICT && !settings.verdict_enabled) {
    return { ok: false, reason: "Verdict notifications are disabled." };
  }
  return { ok: true, reason: "" };
}

// ---- Email builders ----

export interface EmailContent {
  subject: string;
  body: string;
}

export function buildSignupEmail(meta: Record<string, any>): EmailContent {
  const email = meta.user_email || "Unknown";
  const name = meta.user_name || "Not set";
  const method = meta.auth_method || "unknown";
  const occurred = meta.occurred_at || new Date().toISOString();
  return {
    subject: "⚖️ New Wallet Court signup",
    body: [
      "A new account has been created in Wallet Court.",
      "",
      `User email: ${email}`,
      `Display name: ${name}`,
      `Signup method: ${method}`,
      `Signed up at: ${occurred}`,
      "",
      "View in Wallet Court:",
      `${APP_URL}/account`,
    ].join("\n")
  };
}

export function buildClaimEmail(meta: Record<string, any>): EmailContent {
  const courtName = meta.court_name || "Not set";
  const network = meta.network || "unknown";
  const addressShort = meta.address_short || "—";
  const verified = meta.verified_at || new Date().toISOString();
  const claimSlug = meta.claim_slug || "";
  const lines = [
    "A wallet has been claimed in Wallet Court.",
    "",
    `Court name: ${courtName}`,
    `Network: ${network}`,
    `Wallet address: ${addressShort}`,
    `Claimed at: ${verified}`,
  ];
  if (claimSlug) {
    lines.push("", "Public profile:", `${APP_URL}/wallet/${claimSlug}`);
  }
  return {
    subject: "🔐 Wallet claimed in Wallet Court",
    body: lines.join("\n")
  };
}

export function buildVerdictEmail(meta: Record<string, any>): EmailContent {
  const verdictName = meta.verdict_name || "Unknown verdict";
  const network = meta.network || "unknown";
  const addressShort = meta.address_short || "—";
  const severity = meta.severity_score != null ? `${meta.severity_score}/100` : "—";
  const confidence = meta.confidence_score != null ? `${meta.confidence_score}/100` : "—";
  const calls = meta.physical_calls != null ? String(meta.physical_calls) : "—";
  const analyzed = meta.analyzed_at || new Date().toISOString();
  const slug = meta.public_slug || "";
  const lines = [
    "A new live verdict has been issued in Wallet Court.",
    "",
    `Verdict: ${verdictName}`,
    `Network: ${network}`,
    `Wallet address: ${addressShort}`,
    `Severity: ${severity}`,
    `Confidence: ${confidence}`,
    `Nansen calls used: ${calls}`,
    `Completed at: ${analyzed}`,
  ];
  if (slug) {
    lines.push("", "Public case:", `${APP_URL}/case/${slug}`);
  }
  return {
    subject: `⚖️ New Wallet Court verdict: ${verdictName}`,
    body: lines.join("\n")
  };
}

export function buildTestEmail(): EmailContent {
  return {
    subject: "⚖️ Wallet Court notification test",
    body: [
      "This is a test email from Wallet Court owner notifications.",
      "",
      "If you received this, your notification settings are configured correctly.",
      "",
      `Sent at: ${new Date().toISOString()}`,
    ].join("\n")
  };
}

export function buildEmail(eventType: string, meta: Record<string, any>): EmailContent {
  if (eventType === EVENT_TYPES.SIGNUP) return buildSignupEmail(meta);
  if (eventType === EVENT_TYPES.CLAIM) return buildClaimEmail(meta);
  if (eventType === EVENT_TYPES.VERDICT) return buildVerdictEmail(meta);
  return { subject: "Wallet Court notification", body: "Unknown event type." };
}

// ---- Admin-safe serialization ----

// Sanitize an event record for admin display. Never includes the raw
// metadata_json (which could contain sensitive fields); only safe summary
// fields are returned. The metadata is already sanitized at enqueue time.
export function sanitizeEventForAdmin(record: any): Record<string, any> {
  if (!record) return null;
  return {
    event_id: record.event_id || "",
    event_type: record.event_type || "",
    event_key: record.event_key || "",
    source_entity: record.source_entity || "",
    source_record_id: record.source_record_id || "",
    status: record.status || NOTIFICATION_STATUS.PENDING,
    recipient_email: record.recipient_email || "",
    attempt_count: record.attempt_count ?? 0,
    max_attempts: record.max_attempts ?? MAX_ATTEMPTS,
    last_attempt_at: record.last_attempt_at || null,
    sent_at: record.sent_at || null,
    last_error: record.last_error || null,
    next_retry_at: record.next_retry_at || null,
    created_at: record.created_at || record.created_date || null,
    updated_at: record.updated_at || record.updated_date || null,
  };
}