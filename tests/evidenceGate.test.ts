import { describe, it, expect } from "vitest";
import {
  classifyOutcome,
  isDismissed,
  isMistrial,
  getCaseOutcome,
  isDismissedOrMistrial,
  isVerdictOutcome,
  buildOutcomeUpdate,
  CASE_OUTCOMES,
  OPERATIONAL_FAILURE
} from "../base44/shared/evidenceGate.ts";
import { hasMeaningfulHoldingsEvidence, MIN_PORTFOLIO_VALUE_USD } from "../base44/shared/holdingsEvidence.ts";

// --- Dismissed: fully successful all-zero evidence ---

describe("dismissed_no_evidence — successful empty profile", () => {
  const allZero = {
    realized_pnl_pct: 0, realized_pnl_abs_usd: 0, win_rate_pct: 0,
    tokens_traded: 0, total_trades: 0, dex_trade_count: 0,
    token_balance_count: 0, transaction_count: 0, tx_frequency_per_day: 0
  };
  const okMeta = { partial: false, failed_sources: [] };

  it("all metrics present-zero + all endpoints succeeded → dismissed", () => {
    expect(classifyOutcome(allZero, okMeta)).toBe("dismissed_no_evidence");
  });
  it("isDismissed true only when endpoints succeeded and no activity", () => {
    expect(isDismissed(allZero, okMeta)).toBe(true);
  });
  it("empty metrics object + all endpoints ok → dismissed", () => {
    expect(classifyOutcome({}, okMeta)).toBe("dismissed_no_evidence");
  });
});

// --- Operational failures are never dismissed OR mistrial (N2.4 correction) ---

describe("operational failures are never dismissed or mistrial (N2.4)", () => {
  const emptyish = { total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0, token_balance_count: 0, portfolio_value_usd: 0 };

  it("balance endpoint failed + no activity → operational_failure (NOT dismissed, NOT mistrial)", () => {
    expect(classifyOutcome(emptyish, { failed_sources: ["current_balance"] })).toBe(OPERATIONAL_FAILURE);
    expect(classifyOutcome(emptyish, { failed_sources: ["current_balance"] })).not.toBe("dismissed_no_evidence");
    expect(classifyOutcome(emptyish, { failed_sources: ["current_balance"] })).not.toBe("mistrial_insufficient_evidence");
    expect(isDismissed(emptyish, { failed_sources: ["current_balance"] })).toBe(false);
  });
  it("required endpoint (pnl) failed + no activity → operational_failure", () => {
    expect(classifyOutcome(emptyish, { failed_sources: ["pnl_summary"] })).toBe(OPERATIONAL_FAILURE);
  });
  it("required endpoint (dex) failed + no activity → operational_failure", () => {
    expect(classifyOutcome(emptyish, { failed_sources: ["dex_trades", "transactions"] })).toBe(OPERATIONAL_FAILURE);
  });
  it("only transactions failed + no activity → dismissed (transactions is optional; emptiness confirmable)", () => {
    // pnl + dex + current_balance all succeeded → can confirm empty profile.
    expect(classifyOutcome(emptyish, { failed_sources: ["transactions"] })).toBe("dismissed_no_evidence");
  });
  it("operational_failure is not a stored case outcome (not in CASE_OUTCOMES)", () => {
    expect(CASE_OUTCOMES).not.toContain(OPERATIONAL_FAILURE);
  });
});

// --- Mistrial: some activity, too thin to defensibly verdict ---

describe("mistrial_insufficient_evidence — thin activity", () => {
  it("one or two isolated trades without enough context → mistrial", () => {
    expect(classifyOutcome({ total_trades: 1, realized_pnl_pct: -0.5 }, { failed_sources: [] })).toBe("mistrial_insufficient_evidence");
    expect(classifyOutcome({ total_trades: 2, tokens_traded: 1, realized_pnl_pct: 0.2 }, { failed_sources: [] })).toBe("mistrial_insufficient_evidence");
  });
  it("tiny DEX sample with no PnL context → mistrial", () => {
    expect(classifyOutcome({ dex_trade_count: 3 }, { failed_sources: [] })).toBe("mistrial_insufficient_evidence");
    expect(classifyOutcome({ dex_trade_count: 5 }, { failed_sources: [] })).toBe("mistrial_insufficient_evidence");
  });
  it("only transactions, no trades/tokens/dex → mistrial", () => {
    expect(classifyOutcome({ transaction_count: 12, total_trades: 0, tokens_traded: 0, dex_trade_count: 0 }, { failed_sources: [] })).toBe("mistrial_insufficient_evidence");
  });
  it("isMistrial false when meaningful holdings exist (holder verdict path)", () => {
    expect(isMistrial({ total_trades: 1, token_balance_count: 5, portfolio_value_usd: 5000 })).toBe(false);
  });
  it("isMistrial true for dust-only holdings (token count without meaningful value)", () => {
    expect(isMistrial({ total_trades: 1, token_balance_count: 5 })).toBe(true);
  });
});

// --- Holdings-evidence hardening (N2.4) — token count alone is not meaningful ---

describe("holdings-evidence hardening (N2.4) — token count alone is not meaningful", () => {
  const okMeta = { failed_sources: [] };

  it("token count alone (no portfolio value) does not support a holder verdict → mistrial", () => {
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 30, transaction_count: 5 }, okMeta)).toBe("mistrial_insufficient_evidence");
  });
  it("dust/spam-only holdings (portfolio value below minimum) → mistrial, not a holder verdict", () => {
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 30, portfolio_value_usd: 1, transaction_count: 5 }, okMeta)).toBe("mistrial_insufficient_evidence");
  });
  it("portfolio value exactly at the minimum → meaningful (holder verdict path)", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD })).toBe(true);
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 5, portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD, transaction_count: 50 }, okMeta)).toBe("verdict");
  });
  it("portfolio value just below the minimum → not meaningful (mistrial)", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD - 0.01 })).toBe(false);
  });
  it("meaningful holdings + sufficient portfolio value → verdict (holder path)", () => {
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 25, portfolio_value_usd: 150000, transaction_count: 100 }, okMeta)).toBe("verdict");
  });
  it("unvalued balance (token count present, portfolio value absent) → mistrial", () => {
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 10, transaction_count: 3 }, okMeta)).toBe("mistrial_insufficient_evidence");
  });
  it("dust holdings + affirmative trading loss → verdict (loss-based, not holder)", () => {
    // Dust holdings but a realized loss backed by trades is affirmative evidence → not mistrial.
    expect(classifyOutcome({ realized_pnl_pct: -0.5, total_trades: 10, token_balance_count: 30, portfolio_value_usd: 1 }, okMeta)).toBe("verdict");
  });
  it("a single dust token cannot independently support a holder verdict", () => {
    expect(classifyOutcome({ total_trades: 0, token_balance_count: 1, portfolio_value_usd: 0.01, transaction_count: 2 }, okMeta)).toBe("mistrial_insufficient_evidence");
  });
});

// --- Partial evidence may proceed only when remaining evidence independently supports the verdict ---

describe("partial evidence — remaining affirmative evidence must independently support the verdict", () => {
  it("partial (transactions failed) + meaningful holdings → verdict (holdings independently support it)", () => {
    const m = { token_balance_count: 25, portfolio_value_usd: 150000, total_trades: 0 };
    expect(classifyOutcome(m, { partial: true, failed_sources: ["transactions"] })).toBe("verdict");
  });
  it("partial (transactions failed) + dust-only holdings → mistrial (holdings do NOT independently support)", () => {
    const m = { token_balance_count: 25, portfolio_value_usd: 1, total_trades: 0 };
    expect(classifyOutcome(m, { partial: true, failed_sources: ["transactions"] })).toBe("mistrial_insufficient_evidence");
  });
  it("partial (current_balance failed) + affirmative trading loss → verdict (loss independently supports)", () => {
    const m = { realized_pnl_pct: -0.5, win_rate_pct: 0.3, total_trades: 100, dex_trade_count: 50 };
    expect(classifyOutcome(m, { partial: true, failed_sources: ["current_balance"] })).toBe("verdict");
  });
  it("partial (current_balance failed) + thin trading → mistrial (no independent support)", () => {
    const m = { total_trades: 1, realized_pnl_pct: -0.1 };
    expect(classifyOutcome(m, { partial: true, failed_sources: ["current_balance"] })).toBe("mistrial_insufficient_evidence");
  });
});

// --- Verdict: sufficient affirmative evidence ---

describe("verdict — sufficient affirmative evidence", () => {
  it("partial evidence with sufficient affirmative support → valid verdict", () => {
    // Portfolio Polygamist partial case: transactions endpoint failed, but
    // holdings + portfolio value independently support a holder verdict.
    const m = { token_balance_count: 427, portfolio_value_usd: 2.14e9, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0 };
    const meta = { partial: true, failed_sources: ["transactions"] };
    expect(classifyOutcome(m, meta)).toBe("verdict");
  });
  it("holdings and portfolio evidence independently support a holder verdict", () => {
    const m = { token_balance_count: 25, portfolio_value_usd: 150000, total_trades: 0 };
    expect(classifyOutcome(m, { failed_sources: [] })).toBe("verdict");
  });
  it("substantial trading activity → verdict", () => {
    const m = { realized_pnl_pct: -0.84, win_rate_pct: 0.254, total_trades: 3439, dex_trade_count: 100 };
    expect(classifyOutcome(m, { failed_sources: [] })).toBe("verdict");
  });
  it("four trades with PnL context → verdict (not mistrial)", () => {
    const m = { realized_pnl_pct: -0.28, total_trades: 4, tokens_traded: 2, transaction_count: 5 };
    expect(classifyOutcome(m, { failed_sources: [] })).toBe("verdict");
  });
});

// --- Empty evidence cannot produce Suspiciously Competent ---

describe("empty evidence never produces a verdict", () => {
  it("all-zero evidence → dismissed, not verdict (no Suspiciously Competent)", () => {
    const allZero = { total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0, token_balance_count: 0, realized_pnl_pct: 0, win_rate_pct: 0 };
    expect(classifyOutcome(allZero, { failed_sources: [] })).not.toBe("verdict");
    expect(classifyOutcome(allZero, { failed_sources: [] })).toBe("dismissed_no_evidence");
  });
});

// --- Outcome helpers + backward compatibility ---

describe("getCaseOutcome / exclusion helpers", () => {
  it("explicit case_outcome is returned as-is", () => {
    expect(getCaseOutcome({ case_outcome: "dismissed_no_evidence", data_mode: "live" })).toBe("dismissed_no_evidence");
    expect(getCaseOutcome({ case_outcome: "mistrial_insufficient_evidence", data_mode: "live" })).toBe("mistrial_insufficient_evidence");
    expect(getCaseOutcome({ case_outcome: "verdict", data_mode: "live" })).toBe("verdict");
    expect(getCaseOutcome({ case_outcome: "demo", data_mode: "demo" })).toBe("demo");
  });
  it("absent case_outcome infers verdict (live) or demo — N2.2 records stay verdicts", () => {
    expect(getCaseOutcome({ data_mode: "live" })).toBe("verdict");
    expect(getCaseOutcome({ data_mode: "demo" })).toBe("demo");
  });
  it("isVerdictOutcome true for verdict/demo, false for dismissed/mistrial", () => {
    expect(isVerdictOutcome({ case_outcome: "verdict" })).toBe(true);
    expect(isVerdictOutcome({ case_outcome: "demo" })).toBe(true);
    expect(isVerdictOutcome({ data_mode: "live" })).toBe(true); // backward compat
    expect(isVerdictOutcome({ case_outcome: "dismissed_no_evidence" })).toBe(false);
    expect(isVerdictOutcome({ case_outcome: "mistrial_insufficient_evidence" })).toBe(false);
  });
  it("isDismissedOrMistrial true only for dismissed/mistrial", () => {
    expect(isDismissedOrMistrial({ case_outcome: "dismissed_no_evidence" })).toBe(true);
    expect(isDismissedOrMistrial({ case_outcome: "mistrial_insufficient_evidence" })).toBe(true);
    expect(isDismissedOrMistrial({ case_outcome: "verdict" })).toBe(false);
    expect(isDismissedOrMistrial({ data_mode: "live" })).toBe(false);
  });
  it("CASE_OUTCOMES includes all four outcomes", () => {
    expect(CASE_OUTCOMES).toEqual(["verdict", "dismissed_no_evidence", "mistrial_insufficient_evidence", "demo"]);
  });
});

// --- buildOutcomeUpdate: field safety for the migration ---

describe("buildOutcomeUpdate — migration write surface", () => {
  const prevTrial = {
    case_outcome: null,
    verdict_code: "suspiciously_competent",
    verdict_name: "Suspiciously Competent",
    severity_score: 74,
    confidence_score: 86,
    public_slug: "case-p6zqrbk3kkgp",
    normalized_wallet_address: "0x1ad2...e71d",
    network: "ethereum",
    metrics_json: "{}",
    evidence_items_json: "[]",
    source_endpoints_json: "[]"
  };

  it("dismissed update nulls severity and confidence (no active scores)", () => {
    const u = buildOutcomeUpdate(prevTrial, "dismissed_no_evidence", "N2.3");
    expect(u.case_outcome).toBe("dismissed_no_evidence");
    expect(u.severity_score).toBeNull();
    expect(u.confidence_score).toBeNull();
  });
  it("dismissed update nulls verdict code/name and all verdict text", () => {
    const u = buildOutcomeUpdate(prevTrial, "dismissed_no_evidence", "N2.3");
    expect(u.verdict_code).toBeNull();
    expect(u.verdict_name).toBeNull();
    expect(u.headline).toBeNull();
    expect(u.roast).toBeNull();
    expect(u.defense_statement).toBeNull();
    expect(u.sentence).toBeNull();
  });
  it("mistrial update also nulls severity and confidence", () => {
    const u = buildOutcomeUpdate(prevTrial, "mistrial_insufficient_evidence", "N2.3");
    expect(u.case_outcome).toBe("mistrial_insufficient_evidence");
    expect(u.severity_score).toBeNull();
    expect(u.confidence_score).toBeNull();
    expect(u.verdict_code).toBeNull();
  });
  it("update never touches slug, identity, evidence, metrics, or sources (slug preserved)", () => {
    const u = buildOutcomeUpdate(prevTrial, "dismissed_no_evidence", "N2.3");
    expect(u).not.toHaveProperty("public_slug");
    expect(u).not.toHaveProperty("normalized_wallet_address");
    expect(u).not.toHaveProperty("network");
    expect(u).not.toHaveProperty("metrics_json");
    expect(u).not.toHaveProperty("evidence_items_json");
    expect(u).not.toHaveProperty("source_endpoints_json");
    expect(u).not.toHaveProperty("data_mode");
  });
  it("audit note records phase, previous verdict, next outcome, and timestamp", () => {
    const u = buildOutcomeUpdate(prevTrial, "dismissed_no_evidence", "N2.3");
    const note = JSON.parse(u.rescore_audit_json);
    expect(note.phase).toBe("N2.3");
    expect(note.operation).toBe("evidence-sufficiency dismissal");
    expect(note.evidence_source).toContain("no Nansen calls");
    expect(note.migration).toBe("approved allowlist");
    expect(note.previous.verdict_code).toBe("suspiciously_competent");
    expect(note.previous.severity_score).toBe(74);
    expect(note.next.case_outcome).toBe("dismissed_no_evidence");
    expect(typeof note.timestamp).toBe("string");
  });
  it("update writes exactly the 10 expected fields", () => {
    const u = buildOutcomeUpdate(prevTrial, "dismissed_no_evidence", "N2.3");
    expect(Object.keys(u).sort()).toEqual([
      "case_outcome", "confidence_score", "defense_statement", "headline",
      "rescore_audit_json", "roast", "sentence", "severity_score",
      "verdict_code", "verdict_name"
    ]);
  });
});

// --- No regression to the seven approved N2.2 cases ---

describe("no regression — seven approved N2.2 cases remain verdicts", () => {
  const okMeta = { partial: false, failed_sources: [] };
  const partialMeta = { partial: true, failed_sources: ["transactions"] };

  const cases = [
    { name: "j52pibwa84ye — Portfolio Polygamist", m: { token_balance_count: 222, portfolio_value_usd: 98.7e6, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0 }, meta: okMeta },
    { name: "fhq7s3vi7znw — Portfolio Polygamist", m: { token_balance_count: 127, portfolio_value_usd: 157e6, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0 }, meta: okMeta },
    { name: "cowcr3ng7vff — Token Collector", m: { token_balance_count: 25, portfolio_value_usd: 150000, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 100 }, meta: okMeta },
    { name: "633xj1sn7ss7 — Wallet in Witness Protection", m: { token_balance_count: 36, portfolio_value_usd: 25000, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 8 }, meta: okMeta },
    { name: "rxfbvjj27bac — Portfolio Polygamist (partial)", m: { token_balance_count: 427, portfolio_value_usd: 2.14e9, total_trades: 0, tokens_traded: 0, dex_trade_count: 0, transaction_count: 0 }, meta: partialMeta },
    { name: "hth2ek06jb3y — Frequent Trader", m: { realized_pnl_pct: -0.8414, win_rate_pct: 0.254, total_trades: 3439, dex_trade_count: 100 }, meta: okMeta },
    { name: "pxw22re8zyxn — Frequent Trader", m: { realized_pnl_pct: -0.8414, win_rate_pct: 0.254, total_trades: 3439, dex_trade_count: 100 }, meta: okMeta }
  ];

  for (const c of cases) {
    it(`${c.name} → verdict (not dismissed/mistrial)`, () => {
      expect(classifyOutcome(c.m, c.meta)).toBe("verdict");
    });
  }
  it("all seven are verdicts (no regression)", () => {
    expect(cases.every((c) => classifyOutcome(c.m, c.meta) === "verdict")).toBe(true);
  });
});

// --- The two N2.3 migration candidates classify as dismissed ---

describe("N2.3 migration candidates — both dismissed", () => {
  const allZero = {
    realized_pnl_pct: 0, realized_pnl_abs_usd: 0, win_rate_pct: 0,
    tokens_traded: 0, total_trades: 0, dex_trade_count: 0,
    token_balance_count: 0, transaction_count: 0, tx_frequency_per_day: 0
  };
  const okMeta = { partial: false, failed_sources: [] };

  it("case-p6zqrbk3kkgp metrics → dismissed_no_evidence", () => {
    expect(classifyOutcome(allZero, okMeta)).toBe("dismissed_no_evidence");
  });
  it("case-z4iqclvyhpuj metrics → dismissed_no_evidence", () => {
    expect(classifyOutcome(allZero, okMeta)).toBe("dismissed_no_evidence");
  });
  it("both have no affirmative holder, transaction, or trading evidence", () => {
    expect(isDismissed(allZero, okMeta)).toBe(true);
  });
});

// --- Deferred Base & Solana cases are NOT dismissed ---

describe("deferred Base & Solana cases are not dismissed", () => {
  it("Base case (4 trades, pnl -0.28) → verdict, not dismissed", () => {
    const m = { realized_pnl_pct: -0.283, realized_pnl_abs_usd: -158, win_rate_pct: 0, tokens_traded: 2, total_trades: 4, dex_trade_count: 0, token_balance_count: 0, transaction_count: 5 };
    expect(classifyOutcome(m, { failed_sources: [] })).toBe("verdict");
  });
  it("Solana case (164 trades, holdings) → verdict, not dismissed", () => {
    const m = { realized_pnl_pct: 0.165, win_rate_pct: 0.389, total_trades: 164, tokens_traded: 18, dex_trade_count: 39, token_balance_count: 6, portfolio_value_usd: 127, transaction_count: 100 };
    expect(classifyOutcome(m, { failed_sources: [] })).toBe("verdict");
  });
});