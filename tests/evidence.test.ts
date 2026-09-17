import { describe, it, expect } from "vitest";
import { selectLiveVerdictIndex, computeSeverityConfidence } from "../base44/shared/verdicts_live.ts";
import { fmtPctSigned, fmtPctPlain, fmtUsd, fmtInt, totalTradesEvidence, sampleEvidence, avgTokenAge } from "../base44/shared/format.ts";

// Nansen docs (address-pnl-and-trade-performance) define the audited fields:
//   realized_pnl_percent — "a percentage (not multiplied by 100)" → decimal ratio (0.84 == 84%)
//   win_rate            — ratio (0.25 == 25%)
//   realized_pnl_usd    — USD currency
//   traded_times        — integer count (total sales over the window)
//   traded_token_count  — integer count
// The API returns decimal ratios, NOT already-percent values, so the
// "already-percent" case does not arise for this API (documented here, not tested).

describe("selectLiveVerdictIndex — decimal-ratio percentages", () => {
  it("win 0.25 (25%) + pnl -0.84 (-84%) → Certified Exit Liquidity", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: -0.84, win_rate_pct: 0.25 })).toBe(1);
  });
  it("win 0.25 is treated as 25% (ratio), not 0.25%", () => {
    // pnl -0.15 (-15%) → +18 band; win 0.25 (25%) → +8 band (win<45%, NOT win<25%).
    // If 0.25 were misread as 0.25%, win<25% would fire (+16) → severity 84, not 76.
    const { severity } = computeSeverityConfidence({ realized_pnl_pct: -0.15, win_rate_pct: 0.25 }, false);
    expect(severity).toBe(76); // 50 + 18 + 8
  });
  it("modest winner (pnl 0.5=50%, win 0.55=55%) → Premature Liquidator", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: 0.5, win_rate_pct: 0.55 })).toBe(2);
  });
  it("strong winner (pnl 0.9=90%, win 0.6=60%) → Suspiciously Competent", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: 0.9, win_rate_pct: 0.6 })).toBe(4);
  });
});

describe("selectLiveVerdictIndex — negative realized PnL", () => {
  it("deeply negative PnL + low win → Certified Exit Liquidity", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: -0.84, win_rate_pct: 0.25 })).toBe(1);
  });
  it("negative PnL, no win rate → Certified Exit Liquidity (fallback)", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: -0.5 })).toBe(1);
  });
  it("positive PnL, no win rate → Premature Liquidator (fallback)", () => {
    expect(selectLiveVerdictIndex({ realized_pnl_pct: 0.3 })).toBe(2);
  });
});

describe("selectLiveVerdictIndex — large trade counts do not affect verdict", () => {
  it("ignores total_trades and dex_trade_count", () => {
    const withCounts = selectLiveVerdictIndex({ realized_pnl_pct: -0.84, win_rate_pct: 0.25, total_trades: 3439, dex_trade_count: 100 });
    const without = selectLiveVerdictIndex({ realized_pnl_pct: -0.84, win_rate_pct: 0.25 });
    expect(withCounts).toBe(without);
    expect(withCounts).toBe(1);
  });
});

describe("selectLiveVerdictIndex — missing optional values", () => {
  it("no metrics → neutral default", () => {
    expect(selectLiveVerdictIndex({})).toBe(4);
  });
  it("only win rate, no PnL → neutral default", () => {
    expect(selectLiveVerdictIndex({ win_rate_pct: 0.6 })).toBe(4);
  });
});

describe("computeSeverityConfidence — partial evidence", () => {
  const fullMetrics = {
    realized_pnl_pct: -0.84, win_rate_pct: 0.25, total_trades: 3439, tokens_traded: 760,
    dex_trade_count: 100, transaction_count: 100, portfolio_value_usd: 672484
  };
  it("reduces confidence when partial", () => {
    const full = computeSeverityConfidence(fullMetrics, false);
    const partial = computeSeverityConfidence(fullMetrics, true);
    expect(partial.confidence).toBeLessThan(full.confidence);
  });
  it("Vitalik-class metrics → severity 90, confidence 86", () => {
    const m = {
      realized_pnl_pct: -0.8414, win_rate_pct: 0.2539, total_trades: 3439, tokens_traded: 760,
      dex_trade_count: 100, transaction_count: 100, portfolio_value_usd: 672484,
      avg_trade_value_usd: 2268, avg_tx_volume_usd: 61, tx_frequency_per_day: 0.55,
      avg_token_bought_age_days: 4030, token_balance_count: 100, top5_wins: 0, top5_losses: 5
    };
    const { severity, confidence } = computeSeverityConfidence(m, false);
    expect(severity).toBe(90);
    expect(confidence).toBe(86);
  });
});

describe("format — currency", () => {
  it("fmtUsd formats with sign and grouping", () => {
    expect(fmtUsd(-5065685.606)).toBe("-$5,065,686");
    expect(fmtUsd(672484.43)).toBe("$672,484");
  });
  it("fmtPctSigned / fmtPctPlain multiply ratios by 100", () => {
    expect(fmtPctSigned(-0.8414)).toBe("-84.1%");
    expect(fmtPctPlain(0.2539)).toBe("25%");
  });
});

describe("format — paginated sample vs summary total", () => {
  it("total trades evidence describes the window total (locale formatted)", () => {
    const e = totalTradesEvidence(3439);
    expect(e.value).toBe("3,439");
    expect(e.detail).toContain("evidence window");
  });
  it("sample evidence is never described as complete history", () => {
    const e = sampleEvidence("NANSEN · DEX", "Recent DEX Trades", 100, "on-chain swaps");
    expect(e.value).toBe("100");
    expect(e.detail).toContain("sample");
    expect(e.detail).toContain("not complete history");
  });
});

describe("format — integer locale separators", () => {
  it("fmtInt groups thousands", () => {
    expect(fmtInt(3439)).toBe("3,439");
    expect(fmtInt(100)).toBe("100");
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(4030.76)).toBe("4,031");
  });
});

describe("avgTokenAge — Nansen token_bought_age_days (integer days)", () => {
  it("uses the days field as-is — no seconds/ms conversion", () => {
    // Nansen provides token_bought_age_days as an INTEGER in days. 3600 means
    // 3600 days, NOT 3600 seconds (1 hour) or 3600 ms.
    const r = avgTokenAge([{ token_bought_age_days: 3600 }, { token_bought_age_days: 4462 }]);
    expect(r.avg).toBe(4031);
    expect(r.validCount).toBe(2);
  });
  it("does not read block_timestamp or other timestamp fields", () => {
    const r = avgTokenAge([{ block_timestamp: "2025-01-01T00:00:00Z", token_bought_age_days: 100 }]);
    expect(r.avg).toBe(100);
    expect(r.validCount).toBe(1);
  });
  it("excludes negative ages (pre-chain / malformed)", () => {
    const r = avgTokenAge([{ token_bought_age_days: -5 }, { token_bought_age_days: 100 }, { token_bought_age_days: 200 }]);
    expect(r.validCount).toBe(2);
    expect(r.avg).toBe(150);
  });
  it("excludes missing, null, and non-finite values", () => {
    const r = avgTokenAge([{ token_bought_age_days: null }, {}, { token_bought_age_days: "abc" }, { token_bought_age_days: NaN }, { token_bought_age_days: 300 }]);
    expect(r.validCount).toBe(1);
    expect(r.avg).toBe(300);
  });
  it("returns null when no valid trades", () => {
    expect(avgTokenAge([{ token_bought_age_days: null }, { token_bought_age_days: -1 }])).toBeNull();
    expect(avgTokenAge([])).toBeNull();
    expect(avgTokenAge(null)).toBeNull();
  });
  it("discloses sample size (validCount vs total)", () => {
    const r = avgTokenAge([{ token_bought_age_days: 100 }, { token_bought_age_days: null }, { token_bought_age_days: -1 }, { token_bought_age_days: 200 }]);
    expect(r.total).toBe(4);
    expect(r.validCount).toBe(2);
  });
  it("does not cap large valid values", () => {
    const r = avgTokenAge([{ token_bought_age_days: 4031 }]);
    expect(r.avg).toBe(4031);
  });
});