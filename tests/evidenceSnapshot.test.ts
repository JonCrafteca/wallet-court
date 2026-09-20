// Evidence Snapshot tests. Pure: imports only evidenceSnapshot.ts. Proves
// that the snapshot selects max 6 metrics by verdict-family priority, that
// missing metrics are omitted (never shown as zero), that the exhibit count
// reflects the actual saved exhibits, and that selection is deterministic.
import { describe, it, expect } from "vitest";
import {
  selectSnapshotMetrics,
  countExhibits,
  getPriorityMap,
  SNAPSHOT_MAX,
} from "../base44/shared/evidenceSnapshot.ts";

describe("Evidence Snapshot — max 6 metrics", () => {
  it("SNAPSHOT_MAX is 6", () => {
    expect(SNAPSHOT_MAX).toBe(6);
  });

  it("returns at most 6 metrics even when more are available", () => {
    const metrics = JSON.stringify({
      realized_pnl_pct: 1.5,
      win_rate_pct: 0.7,
      total_trades: 42,
      top5_wins: 3,
      avg_token_bought_age_days: 120,
      dex_trade_count: 15,
      max_drawdown_pct: -0.12,
      portfolio_value_usd: 50000,
    });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot.length).toBeLessThanOrEqual(6);
    expect(snapshot).toHaveLength(6);
  });
});

describe("Evidence Snapshot — verdict-specific priority", () => {
  it("Suspiciously Competent prioritizes Realized P&L, Win Rate, Total Trades, Top-5, Wallet Age, DEX Trades", () => {
    const metrics = JSON.stringify({
      realized_pnl_pct: 2.1,
      win_rate_pct: 0.71,
      total_trades: 42,
      top5_wins: 3,
      avg_token_bought_age_days: 120,
      dex_trade_count: 15,
    });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot.map((m) => m.label)).toEqual([
      "Realized P&L",
      "Win Rate",
      "Total Trades",
      "Top-5 Record",
      "Wallet Age",
      "Recent DEX Trades",
    ]);
  });

  it("One Pump Chump prioritizes Realized P&L, Holding Duration, Missed Upside", () => {
    const metrics = JSON.stringify({
      realized_pnl_pct: -0.074,
      avg_holding_seconds: 252,
      missed_upside_pct: 3.4,
      win_rate_pct: 0,
      total_trades: 1,
      max_drawdown_pct: -0.074,
    });
    const snapshot = selectSnapshotMetrics(metrics, "one_pump_chump");
    expect(snapshot.map((m) => m.label)).toEqual([
      "Realized P&L",
      "Holding Duration",
      "Missed Upside",
      "Win Rate",
      "Total Trades",
      "Max Drawdown",
    ]);
  });

  it("uses default priority for unknown verdict codes", () => {
    const metrics = JSON.stringify({ realized_pnl_pct: 0.5, win_rate_pct: 0.6, total_trades: 10 });
    const snapshot = selectSnapshotMetrics(metrics, "unknown_verdict_code");
    expect(snapshot.map((m) => m.label)).toEqual(["Realized P&L", "Win Rate", "Total Trades"]);
  });

  it("getPriorityMap returns the correct map for each verdict family", () => {
    expect(getPriorityMap("suspiciously_competent")[0].label).toBe("Realized P&L");
    expect(getPriorityMap("one_pump_chump")[0].label).toBe("Realized P&L");
    expect(getPriorityMap("certified_exit_liquidity")[0].label).toBe("Buy Timing");
    expect(getPriorityMap("diamond_handed_hostage")[0].label).toBe("Holding Period");
    expect(getPriorityMap("premature_liquidator")[0].label).toBe("Realized P&L");
    expect(getPriorityMap(null)[0].label).toBe("Realized P&L");
  });
});

describe("Evidence Snapshot — missing metrics omitted, never shown as zero", () => {
  it("omits missing metrics instead of showing zero or placeholder", () => {
    const metrics = JSON.stringify({ realized_pnl_pct: 1.5, win_rate_pct: 0.7 });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((m) => m.label)).toEqual(["Realized P&L", "Win Rate"]);
  });

  it("returns empty array when no metrics are valid", () => {
    const metrics = JSON.stringify({});
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot).toHaveLength(0);
  });

  it("treats null, undefined, and empty string as invalid (omitted)", () => {
    const metrics = JSON.stringify({
      realized_pnl_pct: null,
      win_rate_pct: "",
      total_trades: undefined,
      top5_wins: 3,
    });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].label).toBe("Top-5 Record");
  });

  it("never shows a placeholder zero for missing evidence", () => {
    const metrics = JSON.stringify({ realized_pnl_pct: 0, win_rate_pct: 0 });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    // 0 is a valid number — it IS shown (it's a real value, not missing)
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].value).toContain("0%");
  });
});

describe("Evidence Snapshot — formatting", () => {
  it("formats percentage fields with *100 and sign for PnL", () => {
    const metrics = JSON.stringify({ realized_pnl_pct: 2.1 });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot[0].value).toBe("+210.0%");
  });

  it("formats USD fields with $ and locale string", () => {
    const metrics = JSON.stringify({ portfolio_value_usd: 50000 });
    const snapshot = selectSnapshotMetrics(metrics, "unknown");
    expect(snapshot[0].value).toBe("$50,000");
  });

  it("formats holding seconds as duration", () => {
    const metrics = JSON.stringify({ avg_holding_seconds: 252 });
    const snapshot = selectSnapshotMetrics(metrics, "one_pump_chump");
    expect(snapshot[1].value).toBe("4m"); // 252s ≈ 4m
  });

  it("formats token age in days", () => {
    const metrics = JSON.stringify({ avg_token_bought_age_days: 120 });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot[4].value).toBe("120 days");
  });

  it("includes optional context line for key metrics", () => {
    const metrics = JSON.stringify({ realized_pnl_pct: 1.5 });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot[0].context).toBeTruthy();
    expect(snapshot[0].context).toContain("Realized");
  });
});

describe("Evidence Snapshot — exhibit count", () => {
  it("countExhibits returns the actual number of saved exhibits", () => {
    const items = JSON.stringify([
      { tag: "NANSEN · PNL", label: "Realized PnL", value: "+210%", detail: "..." },
      { tag: "NANSEN · DURATION", label: "Holding", value: "6 days", detail: "..." },
      { tag: "NANSEN · SMART MONEY", label: "vs Smart Money", value: "+9 pts", detail: "..." },
    ]);
    expect(countExhibits(items)).toBe(3);
  });

  it("countExhibits returns 0 for empty or null", () => {
    expect(countExhibits(null)).toBe(0);
    expect(countExhibits("")).toBe(0);
    expect(countExhibits("[]")).toBe(0);
  });

  it("countExhibits returns 0 for invalid JSON", () => {
    expect(countExhibits("not json")).toBe(0);
  });

  it("countExhibits is not hard-coded to 13", () => {
    const items = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ label: `Exhibit ${i}` })));
    expect(countExhibits(items)).toBe(7);
  });
});

describe("Evidence Snapshot — determinism", () => {
  it("same input always produces the same output", () => {
    const metrics = JSON.stringify({
      realized_pnl_pct: 1.5,
      win_rate_pct: 0.7,
      total_trades: 42,
    });
    const a = selectSnapshotMetrics(metrics, "suspiciously_competent");
    const b = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(a).toEqual(b);
  });

  it("strips _meta internal key from metrics", () => {
    const metrics = JSON.stringify({
      _meta: { partial: true, failed_sources: ["pnl_summary"] },
      realized_pnl_pct: 1.5,
    });
    const snapshot = selectSnapshotMetrics(metrics, "suspiciously_competent");
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].key).toBe("realized_pnl_pct");
  });
});