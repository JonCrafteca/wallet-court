// Wallet Court — provider circuit breaker (Phase N2.4). Pure: classification,
// timing, and sanitization. No network, no DB. Imported by the analysis pipeline
// and the admin health-check to decide when visitor requests are blocked and
// how long the court stays in recess.
//
// Operational failures (Nansen outage, auth problem, rate limit, exhausted
// credits) must NEVER become a verdict, dismissal, mistrial, severity,
// confidence, charge, sentence, case page, Hall entry, challenge, badge, award,
// or normal share card. They become a Court Recess — no WalletTrial is created.

// ---- Recess types (internal operational states) ----
export const RECESS_TYPES = {
  CREDITS: "court_recess_credits",
  AUTH: "court_recess_auth",
  RATE_LIMIT: "court_recess_rate_limit",
  PROVIDER: "court_recess_provider",
  UNKNOWN: "court_recess_unknown"
};
export const RECESS_TYPE_LIST = Object.values(RECESS_TYPES);

// ---- Circuit statuses ----
export const CIRCUIT_STATUS = {
  OPEN: "open",
  CLOSED: "closed",
  HALF_OPEN: "half_open"
};

// ---- Cooldown durations (seconds) ----
// Credits/auth are long: account-level failures do not self-heal within a
// visitor session. Provider/unknown are short: transient outages. Rate-limit
// honors the provider Retry-After when available, bounded by the cap.
export const COOLDOWN_SECONDS = {
  court_recess_credits: 900,      // 15 minutes
  court_recess_auth: 900,         // 15 minutes
  court_recess_rate_limit: 60,   // bounded default when no Retry-After
  court_recess_provider: 30,      // shorter than auth/credits
  court_recess_unknown: 20       // short, for unclassified failures
};
export const MAX_RATE_LIMIT_COOLDOWN_SECONDS = 300;  // 5-minute cap
export const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60;

// Map a Nansen error category (from nansen.ts ERR) to a recess type.
//   exhausted plan/quota/credits → court_recess_credits
//   invalid/expired credentials or unauthorized → court_recess_auth
//   HTTP 429 / provider rate-limit code → court_recess_rate_limit
//   provider 5xx, timeout, unavailable → court_recess_provider
//   malformed / unclassified → court_recess_unknown
export function classifyRecessType(errorCategory) {
  switch (errorCategory) {
    case "plan_credit": return RECESS_TYPES.CREDITS;
    case "auth":
    case "missing_key": return RECESS_TYPES.AUTH;
    case "rate_limit": return RECESS_TYPES.RATE_LIMIT;
    case "timeout":
    case "network": return RECESS_TYPES.PROVIDER;
    case "malformed":
    case "unsupported_chain":
    case "unknown":
    default: return RECESS_TYPES.UNKNOWN;
  }
}

// Compute the retry_after timestamp (ms since epoch) for a recess type. For
// rate-limit, honor a provider Retry-After (seconds) when supplied, bounded by
// MAX_RATE_LIMIT_COOLDOWN_SECONDS; otherwise use the bounded default.
export function computeRetryAfterMs(recessType, nowMs, providerRetryAfterSeconds) {
  let secs = COOLDOWN_SECONDS[recessType] ?? COOLDOWN_SECONDS.court_recess_unknown;
  if (recessType === RECESS_TYPES.RATE_LIMIT) {
    const provided = +providerRetryAfterSeconds;
    if (Number.isFinite(provided) && provided > 0) {
      secs = Math.min(provided, MAX_RATE_LIMIT_COOLDOWN_SECONDS);
    } else {
      secs = DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS;
    }
  }
  return nowMs + secs * 1000;
}

// Seconds remaining until the retry window elapses (never negative).
export function secondsUntilRetry(record, nowMs) {
  if (!record || !record.retry_after) return 0;
  const retry = new Date(record.retry_after).getTime();
  if (!Number.isFinite(retry)) return 0;
  return Math.max(0, Math.ceil((retry - nowMs) / 1000));
}

// Is the circuit currently blocking visitor requests? Visitors are blocked
// while the circuit is OPEN (within cooldown) or HALF_OPEN (a recovery probe is
// in flight). Only a CLOSED circuit, or an OPEN circuit whose cooldown has
// elapsed AND has been transitioned to a probe, allows requests — and probes are
// admin-controlled, so visitors stay blocked until the probe closes the circuit.
export function isCircuitOpen(record, nowMs) {
  if (!record) return false;
  if (record.circuit_status === CIRCUIT_STATUS.CLOSED) return false;
  if (record.circuit_status === CIRCUIT_STATUS.HALF_OPEN) return true;
  // OPEN: block until the cooldown elapses. A missing or unparseable retry_after
  // is treated as still-blocking (fail safe) — openCircuit always sets it, so this
  // only guards against corrupted state, but failing closed (blocking) ensures an
  // open circuit never silently lets paid calls through.
  const retry = record.retry_after ? new Date(record.retry_after).getTime() : NaN;
  if (!Number.isFinite(retry)) return true;
  return nowMs < retry;
}

// Has the cooldown elapsed on an OPEN circuit, making it eligible for a
// controlled half-open recovery probe? (The probe itself is admin-triggered.)
export function isHalfOpenEligible(record, nowMs) {
  if (!record) return false;
  if (record.circuit_status !== CIRCUIT_STATUS.OPEN) return false;
  const retry = record.retry_after ? new Date(record.retry_after).getTime() : 0;
  if (!Number.isFinite(retry)) return false;
  return nowMs >= retry;
}

// Public-safe sanitized reason. Never includes raw provider payloads, auth
// headers, secrets, or full wallet addresses.
export function sanitizeReason(recessType) {
  const map = {
    court_recess_credits: "Provider credit quota exhausted.",
    court_recess_auth: "Provider credentials rejected.",
    court_recess_rate_limit: "Provider rate limit reached.",
    court_recess_provider: "Provider temporarily unavailable.",
    court_recess_unknown: "Provider returned an unexpected response."
  };
  return map[recessType] || map.court_recess_unknown;
}

// Abbreviate a wallet address for operational logs — the full address is NEVER
// stored in circuit/usage error logs.
export function sanitizeAddressForLog(address) {
  if (!address || typeof address !== "string") return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Precedence when multiple failures occur in one pipeline run (highest first):
// credits > auth > rate_limit > provider > unknown.
const PRECEDENCE = [
  RECESS_TYPES.CREDITS, RECESS_TYPES.AUTH, RECESS_TYPES.RATE_LIMIT,
  RECESS_TYPES.PROVIDER, RECESS_TYPES.UNKNOWN
];
export function highestPrecedenceRecess(types) {
  for (const t of PRECEDENCE) {
    if (types.includes(t)) return t;
  }
  return RECESS_TYPES.UNKNOWN;
}

// Hard operational errors are account-level: if any endpoint fails with one,
// every endpoint will, so the whole pipeline is blocked immediately.
export function isHardOperationalError(errorCategory) {
  return ["missing_key", "auth", "plan_credit", "rate_limit"].includes(errorCategory);
}

// HTTP status to return for a Court Recess response. 429 for rate-limit, 503 for
// provider/auth/credit outages.
export function recessHttpStatus(recessType) {
  return recessType === RECESS_TYPES.RATE_LIMIT ? 429 : 503;
}