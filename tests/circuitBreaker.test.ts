import { describe, it, expect } from "vitest";
import {
  classifyRecessType,
  computeRetryAfterMs,
  secondsUntilRetry,
  isCircuitOpen,
  isHalfOpenEligible,
  sanitizeReason,
  sanitizeAddressForLog,
  highestPrecedenceRecess,
  isHardOperationalError,
  recessHttpStatus,
  hasActiveProbeLease,
  isProbeLeaseExpired,
  ownsCurrentVersion,
  readCircuitVersion,
  generateLeaseId,
  RECESS_TYPES,
  CIRCUIT_STATUS,
  COOLDOWN_SECONDS,
  MAX_RATE_LIMIT_COOLDOWN_SECONDS,
  DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS
} from "../base44/shared/circuitBreaker.ts";

// ---- Recess classification ----

describe("classifyRecessType — error category → recess type", () => {
  it("plan_credit → credits recess", () => {
    expect(classifyRecessType("plan_credit")).toBe(RECESS_TYPES.CREDITS);
  });
  it("auth and missing_key → auth recess", () => {
    expect(classifyRecessType("auth")).toBe(RECESS_TYPES.AUTH);
    expect(classifyRecessType("missing_key")).toBe(RECESS_TYPES.AUTH);
  });
  it("rate_limit → rate-limit recess", () => {
    expect(classifyRecessType("rate_limit")).toBe(RECESS_TYPES.RATE_LIMIT);
  });
  it("timeout and network → provider recess", () => {
    expect(classifyRecessType("timeout")).toBe(RECESS_TYPES.PROVIDER);
    expect(classifyRecessType("network")).toBe(RECESS_TYPES.PROVIDER);
  });
  it("malformed → schema recess (parse failure is not unknown)", () => {
    expect(classifyRecessType("malformed")).toBe(RECESS_TYPES.SCHEMA);
  });
  it("ceiling_reached → ceiling recess (budget limit, not provider error)", () => {
    expect(classifyRecessType("ceiling_reached")).toBe(RECESS_TYPES.CEILING);
  });
  it("provider (5xx) → provider recess", () => {
    expect(classifyRecessType("provider")).toBe(RECESS_TYPES.PROVIDER);
  });
  it("unsupported_chain / unknown / undefined → unknown recess", () => {
    expect(classifyRecessType("unsupported_chain")).toBe(RECESS_TYPES.UNKNOWN);
    expect(classifyRecessType("unknown")).toBe(RECESS_TYPES.UNKNOWN);
    expect(classifyRecessType(undefined)).toBe(RECESS_TYPES.UNKNOWN);
  });
});

// ---- Hard operational errors (account-level) ----

describe("isHardOperationalError — account-level failures", () => {
  it("missing_key, auth, plan_credit, rate_limit, ceiling_reached are hard (block every endpoint)", () => {
    expect(isHardOperationalError("missing_key")).toBe(true);
    expect(isHardOperationalError("auth")).toBe(true);
    expect(isHardOperationalError("plan_credit")).toBe(true);
    expect(isHardOperationalError("rate_limit")).toBe(true);
    expect(isHardOperationalError("ceiling_reached")).toBe(true);
  });
  it("provider, timeout, network, malformed, unknown are NOT hard (transient/per-endpoint)", () => {
    expect(isHardOperationalError("provider")).toBe(false);
    expect(isHardOperationalError("timeout")).toBe(false);
    expect(isHardOperationalError("network")).toBe(false);
    expect(isHardOperationalError("malformed")).toBe(false);
    expect(isHardOperationalError("unknown")).toBe(false);
  });
});

// ---- Retry-after computation ----

describe("computeRetryAfterMs — cooldown timing", () => {
  const now = 1_700_000_000_000;

  it("credits/auth cooldown is 15 minutes (900s)", () => {
    expect(computeRetryAfterMs(RECESS_TYPES.CREDITS, now) - now).toBe(900 * 1000);
    expect(computeRetryAfterMs(RECESS_TYPES.AUTH, now) - now).toBe(900 * 1000);
  });
  it("provider cooldown is 30s, unknown is 20s", () => {
    expect(computeRetryAfterMs(RECESS_TYPES.PROVIDER, now) - now).toBe(30 * 1000);
    expect(computeRetryAfterMs(RECESS_TYPES.UNKNOWN, now) - now).toBe(20 * 1000);
  });
  it("rate-limit uses bounded default when no provider Retry-After", () => {
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now) - now).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS * 1000);
  });
  it("rate-limit honors provider Retry-After, capped at 5 minutes", () => {
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now, 10) - now).toBe(10 * 1000);
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now, 999) - now).toBe(MAX_RATE_LIMIT_COOLDOWN_SECONDS * 1000);
  });
  it("rate-limit ignores non-positive / invalid provider Retry-After", () => {
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now, 0) - now).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS * 1000);
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now, -5) - now).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS * 1000);
    expect(computeRetryAfterMs(RECESS_TYPES.RATE_LIMIT, now, "abc") - now).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS * 1000);
  });
  it("unknown recess type falls back to the unknown cooldown", () => {
    expect(computeRetryAfterMs("not_a_real_type", now) - now).toBe(COOLDOWN_SECONDS.court_recess_unknown * 1000);
  });
});

// ---- secondsUntilRetry ----

describe("secondsUntilRetry — remaining cooldown", () => {
  const now = 1_700_000_000_000;
  it("returns seconds remaining, rounded up, never negative", () => {
    const retry = now + 45_000;
    expect(secondsUntilRetry({ retry_after: new Date(retry).toISOString() }, now)).toBe(45);
    expect(secondsUntilRetry({ retry_after: new Date(retry).toISOString() }, now + 44_500)).toBe(1);
  });
  it("returns 0 when cooldown elapsed or no retry_after", () => {
    expect(secondsUntilRetry({ retry_after: new Date(now - 1000).toISOString() }, now)).toBe(0);
    expect(secondsUntilRetry({}, now)).toBe(0);
    expect(secondsUntilRetry(null, now)).toBe(0);
  });
  it("returns 0 for an unparseable retry_after", () => {
    expect(secondsUntilRetry({ retry_after: "not-a-date" }, 1)).toBe(0);
  });
});

// ---- isCircuitOpen — the core blocking decision ----

describe("isCircuitOpen — visitor blocking decision", () => {
  const now = 1_700_000_000_000;

  it("null/undefined record → not open (no circuit = closed)", () => {
    expect(isCircuitOpen(null, now)).toBe(false);
    expect(isCircuitOpen(undefined, now)).toBe(false);
  });
  it("CLOSED circuit → not blocking", () => {
    expect(isCircuitOpen({ circuit_status: CIRCUIT_STATUS.CLOSED }, now)).toBe(false);
  });
  it("HALF_OPEN circuit → blocking (a probe is in flight)", () => {
    expect(isCircuitOpen({ circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now)).toBe(true);
  });
  it("OPEN circuit within cooldown → blocking", () => {
    expect(isCircuitOpen({
      circuit_status: CIRCUIT_STATUS.OPEN,
      retry_after: new Date(now + 60_000).toISOString()
    }, now)).toBe(true);
  });
  it("OPEN circuit past cooldown → NOT blocking (eligible for probe)", () => {
    expect(isCircuitOpen({
      circuit_status: CIRCUIT_STATUS.OPEN,
      retry_after: new Date(now - 1000).toISOString()
    }, now)).toBe(false);
  });
  it("OPEN circuit with unparseable retry_after → blocking (fail safe)", () => {
    expect(isCircuitOpen({
      circuit_status: CIRCUIT_STATUS.OPEN,
      retry_after: "garbage"
    }, now)).toBe(true);
  });
  it("OPEN circuit with no retry_after → blocking (fail safe)", () => {
    expect(isCircuitOpen({ circuit_status: CIRCUIT_STATUS.OPEN }, now)).toBe(true);
  });
});

// ---- isHalfOpenEligible — admin probe gating ----

describe("isHalfOpenEligible — admin probe eligibility", () => {
  const now = 1_700_000_000_000;

  it("only OPEN circuits past cooldown are eligible", () => {
    expect(isHalfOpenEligible({
      circuit_status: CIRCUIT_STATUS.OPEN,
      retry_after: new Date(now - 1).toISOString()
    }, now)).toBe(true);
  });
  it("OPEN circuit still within cooldown is NOT eligible", () => {
    expect(isHalfOpenEligible({
      circuit_status: CIRCUIT_STATUS.OPEN,
      retry_after: new Date(now + 60_000).toISOString()
    }, now)).toBe(false);
  });
  it("CLOSED and HALF_OPEN circuits are NOT eligible (no probe needed / already probing)", () => {
    expect(isHalfOpenEligible({ circuit_status: CIRCUIT_STATUS.CLOSED }, now)).toBe(false);
    expect(isHalfOpenEligible({ circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now)).toBe(false);
  });
  it("null record is not eligible", () => {
    expect(isHalfOpenEligible(null, now)).toBe(false);
  });
});

// ---- Precedence — multiple failures in one run ----

describe("highestPrecedenceRecess — multiple failures resolve deterministically", () => {
  it("credits > auth > rate_limit > provider > unknown", () => {
    expect(highestPrecedenceRecess([RECESS_TYPES.UNKNOWN, RECESS_TYPES.CREDITS])).toBe(RECESS_TYPES.CREDITS);
    expect(highestPrecedenceRecess([RECESS_TYPES.AUTH, RECESS_TYPES.RATE_LIMIT, RECESS_TYPES.PROVIDER])).toBe(RECESS_TYPES.AUTH);
    expect(highestPrecedenceRecess([RECESS_TYPES.RATE_LIMIT, RECESS_TYPES.PROVIDER])).toBe(RECESS_TYPES.RATE_LIMIT);
    expect(highestPrecedenceRecess([RECESS_TYPES.PROVIDER, RECESS_TYPES.UNKNOWN])).toBe(RECESS_TYPES.PROVIDER);
  });
  it("empty list → unknown", () => {
    expect(highestPrecedenceRecess([])).toBe(RECESS_TYPES.UNKNOWN);
  });
});

// ---- Sanitization — privacy guarantees ----

describe("sanitizeReason — public-safe reason strings", () => {
  it("returns a safe, generic message per recess type", () => {
    for (const t of Object.values(RECESS_TYPES)) {
      const r = sanitizeReason(t);
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });
  it("never includes raw provider payloads, secrets, or addresses", () => {
    const blob = Object.values(RECESS_TYPES).map(sanitizeReason).join(" ");
    expect(blob).not.toContain("apikey");
    expect(blob).not.toContain("Bearer");
    expect(blob).not.toContain("0x");
    expect(blob).not.toContain("secret");
    expect(blob).not.toContain("401");
    expect(blob).not.toContain("429");
  });
  it("unknown recess type falls back to the generic unknown message", () => {
    expect(sanitizeReason("not_a_type")).toBe(sanitizeReason(RECESS_TYPES.UNKNOWN));
  });
});

describe("sanitizeAddressForLog — full addresses never reach operational logs", () => {
  const FULL_EVM = "0x1ad2cfe71d1234567890abcdef1234567890e71d";
  const FULL_SOL = "5r1p2k9X2Yzabcdef1234567890abcdef12345678";
  it("abbreviates a long EVM address to 6…4", () => {
    const s = sanitizeAddressForLog(FULL_EVM);
    expect(s).toBe(`${FULL_EVM.slice(0, 6)}…${FULL_EVM.slice(-4)}`);
    expect(s.length).toBeLessThan(FULL_EVM.length);
    expect(s).not.toContain(FULL_EVM.slice(6, -4));
  });
  it("abbreviates a long Solana address", () => {
    const s = sanitizeAddressForLog(FULL_SOL);
    expect(s.startsWith(FULL_SOL.slice(0, 6))).toBe(true);
    expect(s.endsWith(FULL_SOL.slice(-4))).toBe(true);
  });
  it("returns short strings unchanged", () => {
    expect(sanitizeAddressForLog("0x1234")).toBe("0x1234");
  });
  it("returns empty string for null/undefined/non-string", () => {
    expect(sanitizeAddressForLog(null)).toBe("");
    expect(sanitizeAddressForLog(undefined)).toBe("");
    expect(sanitizeAddressForLog(123)).toBe("");
  });
  it("the full address substring never appears in the abbreviated form", () => {
    const s = sanitizeAddressForLog(FULL_EVM);
    expect(s).not.toContain(FULL_EVM);
  });
});

// ---- HTTP status mapping ----

describe("recessHttpStatus — response status codes", () => {
  it("rate-limit → 429", () => {
    expect(recessHttpStatus(RECESS_TYPES.RATE_LIMIT)).toBe(429);
  });
  it("provider/auth/credit/ceiling/schema/unknown → 503", () => {
    expect(recessHttpStatus(RECESS_TYPES.PROVIDER)).toBe(503);
    expect(recessHttpStatus(RECESS_TYPES.AUTH)).toBe(503);
    expect(recessHttpStatus(RECESS_TYPES.CREDITS)).toBe(503);
    expect(recessHttpStatus(RECESS_TYPES.CEILING)).toBe(503);
    expect(recessHttpStatus(RECESS_TYPES.SCHEMA)).toBe(503);
    expect(recessHttpStatus(RECESS_TYPES.UNKNOWN)).toBe(503);
  });
});

// ---- Concurrency / single-probe reasoning (pure logic) ----
// The half-open transition is a DB write in circuitStore, but the gating logic
// that prevents two concurrent probes is testable here: a HALF_OPEN circuit
// blocks visitors AND is not eligible for a new probe, so a second admin
// invocation returns "probe in flight" rather than starting a second probe.

describe("concurrent probe protection — HALF_OPEN blocks a second probe", () => {
  const now = 1_700_000_000_000;
  it("a HALF_OPEN circuit blocks visitors (no paid calls during probe)", () => {
    expect(isCircuitOpen({ circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now)).toBe(true);
  });
  it("a HALF_OPEN circuit is NOT half-open-eligible (no second probe)", () => {
    expect(isHalfOpenEligible({ circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now)).toBe(false);
  });
  it("an OPEN circuit still in cooldown blocks visitors AND is not probe-eligible", () => {
    const rec = { circuit_status: CIRCUIT_STATUS.OPEN, retry_after: new Date(now + 60_000).toISOString() };
    expect(isCircuitOpen(rec, now)).toBe(true);
    expect(isHalfOpenEligible(rec, now)).toBe(false);
  });
  it("only an OPEN circuit past cooldown is probe-eligible (single transition point)", () => {
    const rec = { circuit_status: CIRCUIT_STATUS.OPEN, retry_after: new Date(now - 1).toISOString() };
    expect(isCircuitOpen(rec, now)).toBe(false);
    expect(isHalfOpenEligible(rec, now)).toBe(true);
  });
});

// ---- Probe-lease helpers (pure) ----

describe("hasActiveProbeLease — a live lease blocks concurrent probes", () => {
  const now = 1_700_000_000_000;
  it("a half_open circuit with a non-expired lease is active", () => {
    expect(hasActiveProbeLease({
      circuit_status: CIRCUIT_STATUS.HALF_OPEN,
      probe_lease_id: "lease-1",
      probe_expires_at: new Date(now + 10_000).toISOString()
    }, now)).toBe(true);
  });
  it("an expired lease is NOT active", () => {
    expect(hasActiveProbeLease({
      circuit_status: CIRCUIT_STATUS.HALF_OPEN,
      probe_lease_id: "lease-1",
      probe_expires_at: new Date(now - 1).toISOString()
    }, now)).toBe(false);
  });
  it("a half_open circuit with no lease_id is NOT active", () => {
    expect(hasActiveProbeLease({ circuit_status: CIRCUIT_STATUS.HALF_OPEN, probe_expires_at: new Date(now + 10_000).toISOString() }, now)).toBe(false);
  });
  it("an open or closed circuit with a lease_id is NOT active", () => {
    expect(hasActiveProbeLease({ circuit_status: CIRCUIT_STATUS.OPEN, probe_lease_id: "x", probe_expires_at: new Date(now + 10_000).toISOString() }, now)).toBe(false);
    expect(hasActiveProbeLease({ circuit_status: CIRCUIT_STATUS.CLOSED, probe_lease_id: "x", probe_expires_at: new Date(now + 10_000).toISOString() }, now)).toBe(false);
  });
  it("an unparseable expiry is NOT active", () => {
    expect(hasActiveProbeLease({ circuit_status: CIRCUIT_STATUS.HALF_OPEN, probe_lease_id: "x", probe_expires_at: "garbage" }, now)).toBe(false);
  });
  it("null record is NOT active", () => {
    expect(hasActiveProbeLease(null, now)).toBe(false);
  });
});

describe("isProbeLeaseExpired — stale lease reclamation", () => {
  const now = 1_700_000_000_000;
  it("a lease past its expiry is expired", () => {
    expect(isProbeLeaseExpired({ probe_lease_id: "x", probe_expires_at: new Date(now - 1).toISOString() }, now)).toBe(true);
  });
  it("a lease before its expiry is NOT expired", () => {
    expect(isProbeLeaseExpired({ probe_lease_id: "x", probe_expires_at: new Date(now + 10_000).toISOString() }, now)).toBe(false);
  });
  it("no lease_id → not expired (nothing to reclaim)", () => {
    expect(isProbeLeaseExpired({ probe_expires_at: new Date(now - 1).toISOString() }, now)).toBe(false);
  });
  it("an unparseable expiry is treated as expired (reclaimable)", () => {
    expect(isProbeLeaseExpired({ probe_lease_id: "x", probe_expires_at: "garbage" }, now)).toBe(true);
  });
});

describe("generateLeaseId — unique probe-lease tokens", () => {
  it("returns a non-empty string", () => {
    const id = generateLeaseId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
  it("two calls produce different ids", () => {
    expect(generateLeaseId()).not.toBe(generateLeaseId());
  });
});

// ---- Stale-success protection (pure CAS guard) ----
// Regression: Request A begins (captures version V). Request B fails and opens
// the circuit (version V+1). Request A later succeeds. A must NOT close the
// newer circuit because it does not own the recovery generation.

describe("ownsCurrentVersion — stale-success CAS guard", () => {
  it("matching versions → owns the recovery generation (may close)", () => {
    expect(ownsCurrentVersion(5, 5)).toBe(true);
    expect(ownsCurrentVersion(0, 0)).toBe(true);
  });
  it("stale version (A captured V, B bumped to V+1) → does NOT own (may not close)", () => {
    expect(ownsCurrentVersion(5, 6)).toBe(false);
    expect(ownsCurrentVersion(0, 1)).toBe(false);
  });
  it("non-finite versions → does NOT own (fail safe)", () => {
    expect(ownsCurrentVersion(NaN, 5)).toBe(false);
    expect(ownsCurrentVersion(5, NaN)).toBe(false);
    expect(ownsCurrentVersion(null, 0)).toBe(false);
    expect(ownsCurrentVersion(undefined, 0)).toBe(false);
  });
});

describe("readCircuitVersion — defaults null/undefined to 0", () => {
  it("reads a numeric version", () => {
    expect(readCircuitVersion({ circuit_version: 7 })).toBe(7);
  });
  it("defaults null/undefined/missing to 0", () => {
    expect(readCircuitVersion({ circuit_version: null })).toBe(0);
    expect(readCircuitVersion({})).toBe(0);
    expect(readCircuitVersion(null)).toBe(0);
  });
  it("defaults non-numeric to 0", () => {
    expect(readCircuitVersion({ circuit_version: "abc" })).toBe(0);
  });
});

describe("stale-success regression — A cannot close a circuit B opened", () => {
  // Simulates the pure decision the pipeline makes via closeCircuitWithVersion:
  // A captured version V at start; after B opened (V→V+1), A's captured version
  // no longer owns the current version, so the CAS would match 0 documents.
  it("A captured V=3, B opened to V=4 → A does not own V=4 → CAS rejects", () => {
    const aCaptured = 3;
    const currentAfterB = 4;
    expect(ownsCurrentVersion(aCaptured, currentAfterB)).toBe(false);
  });
  it("A captured V=3, no one opened → current is still V=3 → A owns → CAS accepts", () => {
    const aCaptured = 3;
    const currentUnchanged = 3;
    expect(ownsCurrentVersion(aCaptured, currentUnchanged)).toBe(true);
  });
  it("A captured V=0 (old record), B opened to V=1 → A does not own V=1", () => {
    expect(ownsCurrentVersion(0, 1)).toBe(false);
  });
});