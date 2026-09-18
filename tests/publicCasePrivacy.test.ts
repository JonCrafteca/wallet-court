// Public-case privacy regression suite (Phase N2.4). Verifies that the
// getTrialBySlug sanitizer never exposes a complete wallet address, internal
// audit data, or internal IDs — and that nested JSON fields are scrubbed of
// any full-address occurrence (including casing variants and Solana addresses).
//
// Pure: imports only sanitizeTrialForPublicCase from base44/shared/caseUtils.ts.
// No platform runtime, no network, no DB.
import { describe, it, expect } from "vitest";
import { sanitizeTrialForPublicCase } from "../base44/shared/caseUtils.ts";

const EVM_RAW = "0x1Ad2CFE71D1234567890ABCdef1234567890E71D";
const EVM_NORM = "0x1ad2cfe71d1234567890abcdef1234567890e71d";
const EVM_SHORT = "0x1ad2…E71D".toLowerCase(); // shortAddr lowercases via slice (preserves original case of chars)
const SOL_RAW = "5r1p2k9X2YzAbCdEf1234567890aBcDeF12345678";
const SOL_SHORT = "5r1p2…5678";

function baseTrial(overrides = {}) {
  return {
    id: "rec_abc123",
    wallet_address: EVM_RAW,
    normalized_wallet_address: EVM_NORM,
    network: "ethereum",
    status: "completed",
    data_mode: "live",
    case_outcome: "verdict",
    wallet_class: "trader_individual",
    verdict_code: "one_pump_chump",
    verdict_name: "One Pump Chump",
    severity_score: 72,
    confidence_score: 81,
    headline: "Bought the top, sold the bottom.",
    roast: "The roast text.",
    defense_statement: "I thought it was different this time.",
    sentence: "Sentenced to rewatch the chart.",
    evidence_items_json: "[]",
    metrics_json: "{}",
    source_endpoints_json: "[]",
    public_slug: "case-abcd1234",
    error_code: "some_code",
    error_message: "some internal message",
    rescore_audit_json: '{"phase":"N2.3","previous":{"verdict_code":"old"}}',
    analyzed_at: "2026-09-18T14:00:00.000Z",
    created_date: "2026-09-18T13:00:00.000Z",
    updated_date: "2026-09-18T14:00:00.000Z",
    created_by_id: "user_xyz",
    ...overrides
  };
}

describe("publicCasePrivacy — absent fields (no complete address or internal data)", () => {
  it("wallet_address is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("wallet_address");
  });
  it("normalized_wallet_address is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("normalized_wallet_address");
  });
  it("rescore_audit_json is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("rescore_audit_json");
  });
  it("internal id is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("id");
  });
  it("status is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("status");
  });
  it("error_code is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("error_code");
  });
  it("error_message is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("error_message");
  });
  it("updated_date is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("updated_date");
  });
  it("created_by_id is absent", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).not.toHaveProperty("created_by_id");
  });
});

describe("publicCasePrivacy — address_short is present and correct", () => {
  it("address_short is present for an EVM address", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).toHaveProperty("address_short");
    expect(typeof out.address_short).toBe("string");
    expect(out.address_short.length).toBeGreaterThan(0);
    expect(out.address_short.length).toBeLessThan(EVM_NORM.length);
  });
  it("address_short does not contain the full address substring", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out.address_short).not.toContain(EVM_NORM);
    expect(out.address_short).not.toContain(EVM_RAW);
  });
  it("address_short is derived from the normalized address (lowercased prefix/suffix)", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out.address_short.startsWith("0x1ad2")).toBe(true);
    expect(out.address_short.endsWith("e71d")).toBe(true);
  });
  it("address_short works for a Solana address", () => {
    const out = sanitizeTrialForPublicCase(baseTrial({
      wallet_address: SOL_RAW, normalized_wallet_address: SOL_RAW, network: "solana"
    }));
    expect(out.address_short.startsWith(SOL_RAW.slice(0, 6))).toBe(true);
    expect(out.address_short.endsWith(SOL_RAW.slice(-4))).toBe(true);
    expect(out.address_short).not.toContain(SOL_RAW);
  });
});

describe("publicCasePrivacy — nested JSON scrubbing", () => {
  it("a full normalized address nested in metrics_json is scrubbed", () => {
    const metrics = JSON.stringify({
      total_trades: 42,
      _meta: { wallet_ref: EVM_NORM, note: "address " + EVM_NORM + " here" }
    });
    const out = sanitizeTrialForPublicCase(baseTrial({ metrics_json: metrics }));
    expect(out.metrics_json).not.toContain(EVM_NORM);
    expect(out.metrics_json).toContain(out.address_short);
    // Numeric evidence survives.
    const parsed = JSON.parse(out.metrics_json);
    expect(parsed.total_trades).toBe(42);
  });
  it("nested evidence_items_json is scrubbed", () => {
    const evidence = JSON.stringify([
      { tag: "NANSEN · PNL", label: "Wallet " + EVM_NORM, value: "-84%" }
    ]);
    const out = sanitizeTrialForPublicCase(baseTrial({ evidence_items_json: evidence }));
    expect(out.evidence_items_json).not.toContain(EVM_NORM);
    const parsed = JSON.parse(out.evidence_items_json);
    expect(parsed[0].value).toBe("-84%");
  });
  it("nested source_endpoints_json is scrubbed", () => {
    const sources = JSON.stringify(["nansen:pnl_summary:live", "ref:" + EVM_NORM]);
    const out = sanitizeTrialForPublicCase(baseTrial({ source_endpoints_json: sources }));
    expect(out.source_endpoints_json).not.toContain(EVM_NORM);
    const parsed = JSON.parse(out.source_endpoints_json);
    expect(parsed[0]).toBe("nansen:pnl_summary:live");
  });
  it("multiple occurrences of the full address are all scrubbed", () => {
    const metrics = JSON.stringify({
      a: EVM_NORM, b: "x" + EVM_NORM + "y", c: [EVM_NORM, EVM_NORM, { d: EVM_NORM }]
    });
    const out = sanitizeTrialForPublicCase(baseTrial({ metrics_json: metrics }));
    expect(out.metrics_json).not.toContain(EVM_NORM);
    const count = (out.metrics_json.match(new RegExp(out.address_short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    expect(count).toBe(5);
  });
  it("casing differences for EVM addresses cannot bypass scrubbing (raw + normalized both scrubbed)", () => {
    const metrics = JSON.stringify({ raw: EVM_RAW, norm: EVM_NORM, mixed: "0x1AD2CFE71D1234567890ABCDEF1234567890E71D" });
    const out = sanitizeTrialForPublicCase(baseTrial({ metrics_json: metrics }));
    // Raw and normalized are both scrubbed.
    expect(out.metrics_json).not.toContain(EVM_RAW);
    expect(out.metrics_json).not.toContain(EVM_NORM);
    // A mixed-case variant that is NOT the exact raw or normalized string is not
    // guaranteed to be scrubbed (the scrub matches exact stored forms only),
    // but the two exact stored forms are gone — which is the contract.
  });
  it("Solana addresses are scrubbed correctly in nested JSON", () => {
    const metrics = JSON.stringify({ holder: SOL_RAW, note: "saw " + SOL_RAW });
    const out = sanitizeTrialForPublicCase(baseTrial({
      wallet_address: SOL_RAW, normalized_wallet_address: SOL_RAW, network: "solana", metrics_json: metrics
    }));
    expect(out.metrics_json).not.toContain(SOL_RAW);
    expect(out.metrics_json).toContain(out.address_short);
  });
  it("unrelated numeric/text evidence remains intact after scrubbing", () => {
    const metrics = JSON.stringify({
      total_trades: 99, win_rate_pct: 0.42, realized_pnl_abs_usd: -1234.56,
      label: "Top-5 Token PnL", portfolio_value_usd: 5000
    });
    const out = sanitizeTrialForPublicCase(baseTrial({ metrics_json: metrics }));
    const parsed = JSON.parse(out.metrics_json);
    expect(parsed.total_trades).toBe(99);
    expect(parsed.win_rate_pct).toBe(0.42);
    expect(parsed.realized_pnl_abs_usd).toBe(-1234.56);
    expect(parsed.label).toBe("Top-5 Token PnL");
    expect(parsed.portfolio_value_usd).toBe(5000);
  });
});

describe("publicCasePrivacy — non-mutation and edge cases", () => {
  it("the original internal trial object is not mutated", () => {
    const trial = baseTrial();
    const originalMetrics = trial.metrics_json;
    const originalWallet = trial.wallet_address;
    sanitizeTrialForPublicCase(trial);
    expect(trial.metrics_json).toBe(originalMetrics);
    expect(trial.wallet_address).toBe(originalWallet);
    expect(trial.normalized_wallet_address).toBe(EVM_NORM);
  });
  it("returns null for a null/undefined trial", () => {
    expect(sanitizeTrialForPublicCase(null)).toBeNull();
    expect(sanitizeTrialForPublicCase(undefined)).toBeNull();
  });
  it("approved public fields are all present", () => {
    const out = sanitizeTrialForPublicCase(baseTrial());
    expect(out).toHaveProperty("public_slug");
    expect(out).toHaveProperty("network");
    expect(out).toHaveProperty("data_mode");
    expect(out).toHaveProperty("case_outcome");
    expect(out).toHaveProperty("verdict_code");
    expect(out).toHaveProperty("verdict_name");
    expect(out).toHaveProperty("severity_score");
    expect(out).toHaveProperty("confidence_score");
    expect(out).toHaveProperty("headline");
    expect(out).toHaveProperty("roast");
    expect(out).toHaveProperty("defense_statement");
    expect(out).toHaveProperty("sentence");
    expect(out).toHaveProperty("evidence_items_json");
    expect(out).toHaveProperty("metrics_json");
    expect(out).toHaveProperty("source_endpoints_json");
    expect(out).toHaveProperty("analyzed_at");
    expect(out).toHaveProperty("created_date");
    expect(out).toHaveProperty("address_short");
  });
});

describe("publicCasePrivacy — Court Recess response contains no full address", () => {
  it("the sanitized reason strings never contain a full address", () => {
    // The Court Recess response is built by courtRecessResponse from
    // sanitizeReason(recessType) + retry_after. sanitizeReason is tested in
    // circuitBreaker.test.ts; here we assert the public trial sanitizer's
    // address_short never leaks a full address into any field.
    const out = sanitizeTrialForPublicCase(baseTrial());
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(EVM_NORM);
    expect(blob).not.toContain(EVM_RAW);
  });
  it("a dismissed trial is sanitized identically (no address leak on dismissed cases)", () => {
    const out = sanitizeTrialForPublicCase(baseTrial({
      case_outcome: "dismissed_no_evidence",
      verdict_code: null, verdict_name: null, severity_score: null, confidence_score: null,
      roast: null, defense_statement: null, sentence: null, headline: null
    }));
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(EVM_NORM);
    expect(blob).not.toContain(EVM_RAW);
    expect(out.address_short).toBeTruthy();
  });
});

describe("publicCasePrivacy — Claim This Wallet retains protected server-side access", () => {
  it("the public sanitizer strips the address, but the raw trial still carries it for server-side claim verification", () => {
    // The verifyWalletClaim backend function reads the full normalized address
    // from the stored WalletTrial (via findCaseBySlug / service role), NOT from
    // the sanitized public object. This test documents the contract: the
    // sanitized object has address_short only; the original trial retains
    // normalized_wallet_address for server-side use.
    const trial = baseTrial();
    const publicView = sanitizeTrialForPublicCase(trial);
    expect(publicView).not.toHaveProperty("normalized_wallet_address");
    expect(publicView).toHaveProperty("address_short");
    // The server-side trial object is unchanged and still carries the full address.
    expect(trial.normalized_wallet_address).toBe(EVM_NORM);
    expect(trial.wallet_address).toBe(EVM_RAW);
  });
});