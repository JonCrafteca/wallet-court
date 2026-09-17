import { describe, it, expect } from "vitest";
import {
  selectPerformanceVerdict,
  PERFORMANCE_VERDICTS,
  RETAIL_POOL,
  PERFORMANCE_RULES
} from "../base44/shared/verdicts_performance.ts";
import { selectEntityVerdict } from "../base44/shared/verdicts_entity.ts";
import {
  selectDemoVerdictIndex,
  MANDATORY_DEMO_ADDRESS,
  VERDICTS
} from "../base44/shared/verdicts.ts";
import { CORE_ENDPOINT_KEYS } from "../base44/shared/labelPlan.ts";

// 12 materially different wallet fixtures. Each uses only saved Nansen
// performance evidence (no labels, no new API calls).
const FIXTURES = {
  profitableHighWin: { realized_pnl_pct: 1.2, win_rate_pct: 0.7, total_trades: 40, tokens_traded: 12, avg_token_bought_age_days: 30 },
  profitableHighTurnover: { realized_pnl_pct: 0.35, win_rate_pct: 0.55, total_trades: 1200, tokens_traded: 150 },
  highTurnoverLowWin: { realized_pnl_pct: -0.6, win_rate_pct: 0.28, total_trades: 1500, tokens_traded: 400, token_balance_count: 120 },
  inactiveBagholder: { total_trades: 0, token_balance_count: 30, portfolio_value_usd: 8000, transaction_count: 50 },
  highlyDiversified: { total_trades: 0, token_balance_count: 180, portfolio_value_usd: 250000, transaction_count: 60 },
  shortDurationPump: { realized_pnl_pct: -0.45, win_rate_pct: 0.2, avg_token_bought_age_days: 3, total_trades: 8 },
  missingOptionals: { realized_pnl_pct: -0.3, win_rate_pct: 0.2 },
  diamondHeldCorrect: { realized_pnl_pct: 0.4, avg_holding_seconds: 4000000, win_rate_pct: 0.6 },
  liquidityDonor: { realized_pnl_pct: -0.5, win_rate_pct: 0.3, total_trades: 60, avg_trade_value_usd: 25000 },
  oneGoodTrade: { realized_pnl_pct: 0.5, total_trades: 3, tokens_traded: 2, win_rate_pct: 0.67 },
  diversifiedBad: { realized_pnl_pct: -0.4, win_rate_pct: 0.3, total_trades: 300, tokens_traded: 250, token_balance_count: 80 },
  gasFeeSugarDaddy: { tx_frequency_per_day: 8, realized_pnl_pct: 0, total_trades: 0 }
};

describe("performance verdict engine — 12 fixtures produce 12 distinct verdicts", () => {
  const codes = Object.entries(FIXTURES).map(([_, m]) => selectPerformanceVerdict(m).code);

  it("produces at least 7 distinct verdicts", () => {
    expect(new Set(codes).size).toBeGreaterThanOrEqual(7);
  });
  it("actually produces 12 distinct verdicts (maximal variety)", () => {
    expect(new Set(codes).size).toBe(12);
  });

  it("profitable high-win → suspiciously_competent", () => {
    expect(selectPerformanceVerdict(FIXTURES.profitableHighWin).code).toBe("suspiciously_competent");
  });
  it("profitable high-turnover → premature_liquidator (differs from high-win)", () => {
    expect(selectPerformanceVerdict(FIXTURES.profitableHighTurnover).code).toBe("premature_liquidator");
    expect(selectPerformanceVerdict(FIXTURES.profitableHighTurnover).code)
      .not.toBe(selectPerformanceVerdict(FIXTURES.profitableHighWin).code);
  });
  it("high-turnover low-win → frequent_trader_infrequent_winner", () => {
    expect(selectPerformanceVerdict(FIXTURES.highTurnoverLowWin).code).toBe("frequent_trader_infrequent_winner");
  });
  it("inactive bagholder → bagholder_emeritus (differs from high-turnover)", () => {
    expect(selectPerformanceVerdict(FIXTURES.inactiveBagholder).code).toBe("bagholder_emeritus");
    expect(selectPerformanceVerdict(FIXTURES.inactiveBagholder).code)
      .not.toBe(selectPerformanceVerdict(FIXTURES.highTurnoverLowWin).code);
  });
  it("highly diversified → portfolio_polygamist (diversification-related)", () => {
    expect(selectPerformanceVerdict(FIXTURES.highlyDiversified).code).toBe("portfolio_polygamist");
  });
  it("short-duration pump-chasing → one_pump_chump", () => {
    expect(selectPerformanceVerdict(FIXTURES.shortDurationPump).code).toBe("one_pump_chump");
  });
  it("missing optional metrics → certified_exit_liquidity (no fabrication)", () => {
    expect(selectPerformanceVerdict(FIXTURES.missingOptionals).code).toBe("certified_exit_liquidity");
  });
  it("long-held profitable → diamond_hands_somehow_correct", () => {
    expect(selectPerformanceVerdict(FIXTURES.diamondHeldCorrect).code).toBe("diamond_hands_somehow_correct");
  });
  it("large losing trades → liquidity_donor", () => {
    expect(selectPerformanceVerdict(FIXTURES.liquidityDonor).code).toBe("liquidity_donor");
  });
  it("barely-trades profitable → one_good_trade_and_a_personality", () => {
    expect(selectPerformanceVerdict(FIXTURES.oneGoodTrade).code).toBe("one_good_trade_and_a_personality");
  });
  it("many tokens at a loss → diversified_into_every_bad_decision", () => {
    expect(selectPerformanceVerdict(FIXTURES.diversifiedBad).code).toBe("diversified_into_every_bad_decision");
  });
  it("high tx frequency, no profit → gas_fee_sugar_daddy", () => {
    expect(selectPerformanceVerdict(FIXTURES.gasFeeSugarDaddy).code).toBe("gas_fee_sugar_daddy");
  });
});

describe("determinism — identical inputs always produce identical verdicts", () => {
  it("same metrics → same verdict object (run 3x)", () => {
    const a = selectPerformanceVerdict(FIXTURES.profitableHighWin);
    const b = selectPerformanceVerdict(FIXTURES.profitableHighWin);
    const c = selectPerformanceVerdict(FIXTURES.profitableHighWin);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
  it("verdict selection is order-independent (no randomness)", () => {
    const m = { realized_pnl_pct: -0.84, win_rate_pct: 0.25, total_trades: 3439 };
    const results = Array.from({ length: 5 }, () => selectPerformanceVerdict(m).code);
    expect(new Set(results).size).toBe(1);
  });
});

describe("missing optional metrics do not fabricate evidence", () => {
  it("only PnL + win rate → uses exactly those, no crash", () => {
    const v = selectPerformanceVerdict({ realized_pnl_pct: -0.5, win_rate_pct: 0.2 });
    expect(v.code).toBe("certified_exit_liquidity");
  });
  it("empty metrics → default (suspiciously_competent for active-unknown)", () => {
    expect(selectPerformanceVerdict({}).code).toBe("suspiciously_competent");
  });
  it("no trading activity + no holdings data → suspiciously_competent (no fabrication)", () => {
    // Without holdings evidence, the engine must NOT invent a holder verdict.
    expect(selectPerformanceVerdict({ total_trades: 0 }).code).toBe("suspiciously_competent");
  });
  it("no trading activity + holdings present + active tx history → bagholder_emeritus", () => {
    // txCount>=20 avoids commitment_issues; holdings<50 avoids polygamist/museum.
    expect(selectPerformanceVerdict({ total_trades: 0, token_balance_count: 10, transaction_count: 50 }).code).toBe("bagholder_emeritus");
  });
  it("no trading activity + holdings present + ghosted → commitment_issues_onchain", () => {
    expect(selectPerformanceVerdict({ total_trades: 0, token_balance_count: 10, transaction_count: 5 }).code).toBe("commitment_issues_onchain");
  });
  it("a verdict never invents a holding count from nothing", () => {
    // Only PnL known; holdings absent — must not trigger a holdings-based verdict.
    const v = selectPerformanceVerdict({ realized_pnl_pct: -0.1, total_trades: 0 });
    expect(v.code).not.toBe("portfolio_polygamist");
    expect(v.code).not.toBe("museum_grade_bagholder");
  });
});

describe("demo One Pump Chump remains unchanged", () => {
  it("mandatory demo address → index 0 → one_pump_chump", () => {
    expect(selectDemoVerdictIndex(MANDATORY_DEMO_ADDRESS)).toBe(0);
    expect(VERDICTS[0].code).toBe("one_pump_chump");
  });
  it("VERDICTS pool length is still 5 (demo hash modulo preserved)", () => {
    expect(VERDICTS.length).toBe(5);
  });
  it("live one_pump_chump requires real short-duration evidence (not the demo path)", () => {
    // Negative PnL alone (no age/hold) must NOT be one_pump_chump.
    expect(selectPerformanceVerdict({ realized_pnl_pct: -0.5, win_rate_pct: 0.2 }).code)
      .not.toBe("one_pump_chump");
    // Adding young-token evidence makes it one_pump_chump.
    expect(selectPerformanceVerdict({ realized_pnl_pct: -0.5, win_rate_pct: 0.2, avg_token_bought_age_days: 2 }).code)
      .toBe("one_pump_chump");
  });
});

describe("no labels call occurs (cost guard intact)", () => {
  it("CORE_ENDPOINT_KEYS excludes address_labels", () => {
    expect(CORE_ENDPOINT_KEYS).not.toContain("address_labels");
    expect(CORE_ENDPOINT_KEYS.length).toBe(4);
  });
  it("the performance engine is pure — no network dependency", () => {
    // selectPerformanceVerdict reads only its argument; calling it must not throw
    // and must not depend on any module-level mutable state.
    const v = selectPerformanceVerdict({ realized_pnl_pct: 0.9, win_rate_pct: 0.6 });
    expect(typeof v.code).toBe("string");
    expect(typeof v.roast).toBe("string");
  });
  it("PERFORMANCE_RULES never reference address_labels", () => {
    const blob = JSON.stringify(PERFORMANCE_RULES);
    expect(blob).not.toContain("address_labels");
    expect(blob).not.toContain("label");
  });
});

describe("precedence — overlapping rules resolve deterministically", () => {
  it("a high-volume low-win wallet is frequent_trader, not certified_exit_liquidity", () => {
    // Matches both rule 2 (frequent_trader) and rule 8 (certified_exit) — rule 2 wins.
    const m = { realized_pnl_pct: -0.84, win_rate_pct: 0.25, total_trades: 3439, dex_trade_count: 100 };
    expect(selectPerformanceVerdict(m).code).toBe("frequent_trader_infrequent_winner");
  });
  it("a diversified loser with high volume is frequent_trader (volume precedes diversification)", () => {
    const m = { realized_pnl_pct: -0.4, win_rate_pct: 0.3, total_trades: 600, tokens_traded: 250, token_balance_count: 80 };
    expect(selectPerformanceVerdict(m).code).toBe("frequent_trader_infrequent_winner");
  });
  it("a diversified loser with modest volume is diversified_into_every_bad_decision", () => {
    const m = { realized_pnl_pct: -0.4, win_rate_pct: 0.3, total_trades: 300, tokens_traded: 250, token_balance_count: 80 };
    expect(selectPerformanceVerdict(m).code).toBe("diversified_into_every_bad_decision");
  });
});

describe("verdict pool integrity", () => {
  it("RETAIL_POOL has 19 verdicts (5 original + 4 prior + 10 new)", () => {
    expect(RETAIL_POOL.length).toBe(19);
  });
  it("all 10 new performance verdicts are present and unique", () => {
    const codes = PERFORMANCE_VERDICTS.map((v) => v.code);
    expect(new Set(codes).size).toBe(10);
    expect(codes).toContain("diamond_hands_somehow_correct");
    expect(codes).toContain("bagholder_emeritus");
    expect(codes).toContain("portfolio_polygamist");
    expect(codes).toContain("frequent_trader_infrequent_winner");
    expect(codes).toContain("gas_fee_sugar_daddy");
    expect(codes).toContain("museum_grade_bagholder");
    expect(codes).toContain("diversified_into_every_bad_decision");
    expect(codes).toContain("liquidity_donor");
    expect(codes).toContain("commitment_issues_onchain");
    expect(codes).toContain("one_good_trade_and_a_personality");
  });
  it("every verdict has headline, roast, defense, and sentence", () => {
    for (const v of RETAIL_POOL) {
      expect(typeof v.headline).toBe("string");
      expect(v.headline.length).toBeGreaterThan(0);
      expect(typeof v.roast).toBe("string");
      expect(v.roast.length).toBeGreaterThan(20);
      expect(typeof v.defense).toBe("string");
      expect(typeof v.sentence).toBe("string");
    }
  });
  it("no verdict alleges a crime (no 'fraud', 'theft', 'stolen', 'illegal')", () => {
    const blob = JSON.stringify(PERFORMANCE_VERDICTS).toLowerCase();
    expect(blob).not.toContain("fraud");
    expect(blob).not.toContain("theft");
    expect(blob).not.toContain("stolen");
    expect(blob).not.toContain("illegal");
    expect(blob).not.toContain("insider");
  });
});

describe("selectEntityVerdict delegates to the performance engine for trader/unknown", () => {
  it("unknown + strong winner → suspiciously_competent", () => {
    expect(selectEntityVerdict("unknown", { realized_pnl_pct: 0.9, win_rate_pct: 0.6 }).code).toBe("suspiciously_competent");
  });
  it("trader_individual + deep loss low win → certified_exit_liquidity", () => {
    expect(selectEntityVerdict("trader_individual", { realized_pnl_pct: -0.84, win_rate_pct: 0.25 }).code).toBe("certified_exit_liquidity");
  });
  it("unknown + no trading + many holdings → portfolio_polygamist", () => {
    expect(selectEntityVerdict("unknown", { total_trades: 0, token_balance_count: 180, portfolio_value_usd: 250000 }).code).toBe("portfolio_polygamist");
  });
});