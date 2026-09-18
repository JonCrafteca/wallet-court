import { describe, it, expect } from "vitest";
import { assessRecess } from "../base44/shared/recessAssessment.ts";
import { OPERATIONAL_FAILURE } from "../base44/shared/evidenceGate.ts";
import { RECESS_TYPES } from "../base44/shared/circuitBreaker.ts";

// Helpers to build a nansenResult shape with per-call failure details.
function result(failedCalls) {
  return { failedCalls: failedCalls || [], failedSources: (failedCalls || []).map((c) => c.key) };
}
function call(key, errorCategory, opts = {}) {
  return { key, errorCategory, status: opts.status ?? 0, requestId: opts.requestId || null };
}

// ---- No failure → proceed ----

describe("assessRecess — no failure → proceed (null)", () => {
  it("empty failedCalls → null", () => {
    expect(assessRecess(result([]), "verdict")).toBeNull();
  });
  it("missing failedCalls property → null", () => {
    expect(assessRecess({}, "verdict")).toBeNull();
    expect(assessRecess(null, "verdict")).toBeNull();
  });
  it("all endpoints succeeded → null (no blocking)", () => {
    expect(assessRecess(result([]), "verdict")).toBeNull();
  });
});

// ---- Rule 1: hard operational error anywhere → block ----

describe("rule 1 — hard operational error anywhere blocks the case", () => {
  it("auth on any endpoint → auth recess (blocks all)", () => {
    const r = assessRecess(result([call("transactions", "auth")]), "verdict");
    expect(r).not.toBeNull();
    expect(r.recessType).toBe(RECESS_TYPES.AUTH);
    expect(r.errorCategory).toBe("auth");
  });
  it("plan_credit on an optional endpoint → credits recess (account-level)", () => {
    const r = assessRecess(result([call("current_balance", "plan_credit")]), OPERATIONAL_FAILURE);
    expect(r.recessType).toBe(RECESS_TYPES.CREDITS);
    expect(r.errorCategory).toBe("plan_credit");
  });
  it("rate_limit on any endpoint → rate-limit recess", () => {
    const r = assessRecess(result([call("dex_trades", "rate_limit")]), "verdict");
    expect(r.recessType).toBe(RECESS_TYPES.RATE_LIMIT);
  });
  it("missing_key → auth recess", () => {
    const r = assessRecess(result([call("pnl_summary", "missing_key")]), "verdict");
    expect(r.recessType).toBe(RECESS_TYPES.AUTH);
  });
  it("multiple hard errors → highest precedence wins (credits > auth > rate_limit)", () => {
    const r = assessRecess(result([
      call("transactions", "rate_limit"),
      call("current_balance", "auth"),
      call("dex_trades", "plan_credit")
    ]), "verdict");
    expect(r.recessType).toBe(RECESS_TYPES.CREDITS);
  });
  it("preserves the request id of the lead hard failure", () => {
    const r = assessRecess(result([call("transactions", "auth", { requestId: "req-123" })]), "verdict");
    expect(r.requestId).toBe("req-123");
  });
});

// ---- Rule 2: required endpoint (pnl/dex) failed → block ----

describe("rule 2 — required endpoint failure blocks (no defensible verdict without PnL+DEX)", () => {
  it("pnl_summary failed (soft error) → block with classified recess", () => {
    const r = assessRecess(result([call("pnl_summary", "timeout")]), "verdict");
    expect(r).not.toBeNull();
    expect(r.recessType).toBe(RECESS_TYPES.PROVIDER);
    expect(r.errorCategory).toBe("timeout");
  });
  it("dex_trades failed (soft error) → block", () => {
    const r = assessRecess(result([call("dex_trades", "network")]), "verdict");
    expect(r.recessType).toBe(RECESS_TYPES.PROVIDER);
  });
  it("required failure takes precedence over an optional operational_failure gate", () => {
    // Even if the gate says operational_failure, a required-endpoint failure
    // is the more specific cause and should be reported.
    const r = assessRecess(result([call("pnl_summary", "malformed")]), OPERATIONAL_FAILURE);
    expect(r.errorCategory).toBe("malformed");
    expect(r.recessType).toBe(RECESS_TYPES.UNKNOWN);
  });
});

// ---- Rule 3: gate OPERATIONAL_FAILURE + balance failed → block ----

describe("rule 3 — empty profile unconfirmable (balance failed) → block", () => {
  it("gate operational_failure + balance failed → block with balance recess type", () => {
    const r = assessRecess(result([call("current_balance", "timeout")]), OPERATIONAL_FAILURE);
    expect(r).not.toBeNull();
    expect(r.recessType).toBe(RECESS_TYPES.PROVIDER);
    expect(r.errorCategory).toBe("timeout");
  });
  it("gate operational_failure + only transactions failed → NOT blocked by rule 3 (transactions is optional)", () => {
    // transactions failure alone cannot cause operational_failure (balance is
    // the confirming endpoint), so this combination should not arise — but if
    // it did, rule 3's fallback still blocks because the gate said operational_failure.
    const r = assessRecess(result([call("transactions", "timeout")]), OPERATIONAL_FAILURE);
    expect(r).not.toBeNull();
    expect(r.recessType).toBe(RECESS_TYPES.PROVIDER);
  });
});

// ---- Rule 4: optional soft failure + sufficient evidence → proceed ----

describe("rule 4 — optional soft failure with sufficient evidence → proceed (null)", () => {
  it("only transactions failed + verdict gate → proceed", () => {
    expect(assessRecess(result([call("transactions", "timeout")]), "verdict")).toBeNull();
  });
  it("only current_balance failed + verdict gate (activity present) → proceed", () => {
    // Balance failed but the gate found affirmative activity → verdict, not recess.
    expect(assessRecess(result([call("current_balance", "timeout")]), "verdict")).toBeNull();
  });
  it("only transactions failed + mistrial gate → proceed (mistrial, not recess)", () => {
    expect(assessRecess(result([call("transactions", "timeout")]), "mistrial_insufficient_evidence")).toBeNull();
  });
  it("only transactions failed + dismissed gate → proceed (dismissed, not recess)", () => {
    expect(assessRecess(result([call("transactions", "timeout")]), "dismissed_no_evidence")).toBeNull();
  });
});

// ---- Precedence between rules ----

describe("rule precedence — hard errors rank above required-endpoint soft failures", () => {
  it("hard error on optional + soft error on required → hard error wins", () => {
    const r = assessRecess(result([
      call("pnl_summary", "timeout"),       // required, soft → provider
      call("transactions", "plan_credit")    // optional, hard → credits
    ]), "verdict");
    expect(r.recessType).toBe(RECESS_TYPES.CREDITS);
    expect(r.errorCategory).toBe("plan_credit");
  });
  it("required failure ranks above the operational_failure gate fallback", () => {
    const r = assessRecess(result([
      call("dex_trades", "network"),        // required, soft → provider
      call("current_balance", "timeout")     // optional, soft
    ]), OPERATIONAL_FAILURE);
    expect(r.errorCategory).toBe("network");
    expect(r.recessType).toBe(RECESS_TYPES.PROVIDER);
  });
});

// ---- The core N2.4 guarantee: a blocking recess means NO WalletTrial ----
// (This is enforced by the pipeline: when assessRecess returns non-null, the
// pipeline opens the circuit and returns a Court Recess response WITHOUT
// creating a WalletTrial. These tests prove the decision logic that gates that.)

describe("N2.4 guarantee — blocking recess returns a non-null decision (no trial/dismissal/mistrial)", () => {
  it("a blocking recess is a non-null object, never a stored case outcome", () => {
    const r = assessRecess(result([call("pnl_summary", "auth")]), "verdict");
    expect(r).not.toBeNull();
    expect(typeof r).toBe("object");
    expect(r).not.toBe("verdict");
    expect(r).not.toBe("dismissed_no_evidence");
    expect(r).not.toBe("mistrial_insufficient_evidence");
    expect(r).not.toBe(OPERATIONAL_FAILURE);
  });
  it("a proceed decision is exactly null (case continues to verdict/dismissal/mistrial)", () => {
    expect(assessRecess(result([call("transactions", "timeout")]), "verdict")).toBeNull();
  });
});

// ---- unsupported_chain must NOT open the global circuit (N2.4 correction) ----

describe("unsupported_chain — never blocks, never opens the circuit", () => {
  it("unsupported_chain on a required endpoint does NOT block (filtered out)", () => {
    // Even though pnl_summary is required, unsupported_chain is request
    // validation, not a provider outage. assessRecess filters it out and
    // returns null; the pipeline handles it as a 400 upstream.
    expect(assessRecess(result([call("pnl_summary", "unsupported_chain")]), "verdict")).toBeNull();
  });
  it("unsupported_chain on an optional endpoint does NOT block", () => {
    expect(assessRecess(result([call("current_balance", "unsupported_chain")]), OPERATIONAL_FAILURE)).toBeNull();
  });
  it("unsupported_chain mixed with a real provider failure → only the real failure blocks", () => {
    const r = assessRecess(result([
      call("pnl_summary", "unsupported_chain"),
      call("dex_trades", "auth")
    ]), "verdict");
    expect(r).not.toBeNull();
    expect(r.recessType).toBe(RECESS_TYPES.AUTH);
    expect(r.errorCategory).toBe("auth");
  });
  it("unsupported_chain alone with operational_failure gate → does NOT block (filtered)", () => {
    expect(assessRecess(result([call("current_balance", "unsupported_chain")]), OPERATIONAL_FAILURE)).toBeNull();
  });
  it("only unsupported_chain failures → null (no blocking, no circuit)", () => {
    expect(assessRecess(result([
      call("pnl_summary", "unsupported_chain"),
      call("dex_trades", "unsupported_chain"),
      call("current_balance", "unsupported_chain")
    ]), "verdict")).toBeNull();
  });
});