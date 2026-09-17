import { describe, it, expect } from "vitest";
import { selectEntityVerdict, recomputeVerdictFromLabels } from "../base44/shared/verdicts_entity.ts";
import { selectDemoVerdictIndex, MANDATORY_DEMO_ADDRESS, VERDICTS } from "../base44/shared/verdicts.ts";

describe("selectEntityVerdict — deterministic", () => {
  it("same class + metrics → same verdict", () => {
    const m = { realized_pnl_pct: 0.5, win_rate_pct: 0.6, tx_frequency_per_day: 15, total_trades: 2000, portfolio_value_usd: 5e6 };
    expect(selectEntityVerdict("cex_exchange", m)).toEqual(selectEntityVerdict("cex_exchange", m));
  });
});

describe("selectEntityVerdict — five materially different wallets get varied verdicts", () => {
  it("different classes → 5 different verdict codes", () => {
    const m = { realized_pnl_pct: 0.5, win_rate_pct: 0.6, tx_frequency_per_day: 15, total_trades: 2000, portfolio_value_usd: 5e6, token_balance_count: 60 };
    const codes = new Set([
      selectEntityVerdict("cex_exchange", m).code,
      selectEntityVerdict("market_maker", m).code,
      selectEntityVerdict("mev_bot", m).code,
      selectEntityVerdict("protocol_treasury", m).code,
      selectEntityVerdict("fund_institution", { ...m, realized_pnl_pct: -0.5 }).code
    ]);
    expect(codes.size).toBe(5);
  });
  it("within CEX, different metrics → different verdicts", () => {
    const hi = selectEntityVerdict("cex_exchange", { tx_frequency_per_day: 15 }).code;
    const big = selectEntityVerdict("cex_exchange", { portfolio_value_usd: 2e6 }).code;
    const many = selectEntityVerdict("cex_exchange", { total_trades: 2000 }).code;
    const def = selectEntityVerdict("cex_exchange", {}).code;
    expect(new Set([hi, big, many, def]).size).toBe(4);
  });
});

describe("selectEntityVerdict — retail/unknown preserves + expands existing verdicts", () => {
  it("deeply negative PnL + low win → Certified Exit Liquidity", () => {
    expect(selectEntityVerdict("trader_individual", { realized_pnl_pct: -0.84, win_rate_pct: 0.25 }).code).toBe("certified_exit_liquidity");
  });
  it("strong winner → Suspiciously Competent", () => {
    expect(selectEntityVerdict("unknown", { realized_pnl_pct: 0.9, win_rate_pct: 0.6 }).code).toBe("suspiciously_competent");
  });
  it("new retail verdicts are reachable", () => {
    expect(selectEntityVerdict("trader_individual", { realized_pnl_pct: -0.6, win_rate_pct: 0.6 }).code).toBe("rug_survivors_guilt");
    expect(selectEntityVerdict("trader_individual", { realized_pnl_pct: -0.1, total_trades: 800 }).code).toBe("stop_loss_optional");
  });
});

describe("mandatory demo One Pump Chump unchanged", () => {
  it("demo address → index 0 → one_pump_chump", () => {
    expect(selectDemoVerdictIndex(MANDATORY_DEMO_ADDRESS)).toBe(0);
    expect(VERDICTS[0].code).toBe("one_pump_chump");
  });
  it("demo verdict pool length unchanged (demo hash modulo preserved)", () => {
    expect(VERDICTS.length).toBe(5);
  });
});

describe("recomputeVerdictFromLabels — label-only backfill helper", () => {
  it("returns a complete verdict object from saved metrics + new class", () => {
    const v = recomputeVerdictFromLabels("cex_exchange", { tx_frequency_per_day: 15 });
    expect(v).toHaveProperty("code");
    expect(v).toHaveProperty("display_name");
    expect(v).toHaveProperty("headline");
    expect(v).toHaveProperty("roast");
    expect(v).toHaveProperty("defense");
    expect(v).toHaveProperty("sentence");
  });
  it("is pure — same inputs always yield the same verdict", () => {
    const a = recomputeVerdictFromLabels("fund_institution", { realized_pnl_pct: -0.5 });
    const b = recomputeVerdictFromLabels("fund_institution", { realized_pnl_pct: -0.5 });
    expect(a).toEqual(b);
  });
  it("changing only the class changes the verdict (backfill can change a verdict)", () => {
    const metrics = { realized_pnl_pct: 0.5, win_rate_pct: 0.6, tx_frequency_per_day: 15, total_trades: 2000, portfolio_value_usd: 5e6 };
    const before = recomputeVerdictFromLabels("unknown", metrics).code;
    const after = recomputeVerdictFromLabels("cex_exchange", metrics).code;
    expect(before).not.toBe(after);
  });
});

describe("no raw labels leaking publicly", () => {
  it("verdict text never contains personal names or org names from labels", () => {
    const v = selectEntityVerdict("cex_exchange", { realized_pnl_pct: 0.5, tx_frequency_per_day: 15 });
    const blob = JSON.stringify(v);
    expect(blob).not.toContain("vitalik");
    expect(blob).not.toContain("binance");
  });
});