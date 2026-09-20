// Wallet Court — Nansen Evidence Snapshot metric selection. Pure +
// deterministic: reads only saved evidence (metrics_json + evidence_items_json),
// makes zero Nansen calls, and never invents/estimates/recomputes values.
//
// Reused by NansenEvidence.jsx (client) and mirrored by src/lib/evidenceSnapshot.js
// for client-side tests.
//
// SELECTION RULES:
//   - Each verdict family has an explicit priority map of metric keys → labels.
//   - The snapshot picks the first 6 metrics (by priority) that have a valid
//     (non-null, non-undefined, non-empty) saved value.
//   - If fewer than 6 valid metrics exist, only those available are shown.
//   - Missing metrics are NEVER shown as zero or placeholder — they are omitted.
//   - The full evidence_items array (exhibits) is preserved for the expanded view.

export interface SnapshotMetric {
  key: string;
  label: string;
  value: string;
  context?: string;
}

type PriorityMap = { key: string; label: string }[];

// ---- Verdict-family priority maps ----
// Ordered: the first 6 metrics with valid saved values are shown.

const SUSPICIOUSLY_COMPETENT: PriorityMap = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "top5_wins", label: "Top-5 Record" },
  { key: "avg_token_bought_age_days", label: "Wallet Age" },
  { key: "dex_trade_count", label: "Recent DEX Trades" },
];

const ONE_PUMP_CHUMP: PriorityMap = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "avg_holding_seconds", label: "Holding Duration" },
  { key: "missed_upside_pct", label: "Missed Upside" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const CERTIFIED_EXIT_LIQUIDITY: PriorityMap = [
  { key: "avg_buy_after_pump_pct", label: "Buy Timing" },
  { key: "avg_sell_after_drawdown_pct", label: "Sell Timing" },
  { key: "smart_money_delta_pct", label: "vs Smart Money" },
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const DIAMOND_HANDED_HOSTAGE: PriorityMap = [
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "max_drawdown_pct", label: "Avg Drawdown" },
  { key: "position_reduction_pct", label: "Position Reduction" },
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "token_balance_count", label: "Holdings" },
  { key: "portfolio_value_usd", label: "Portfolio Value" },
];

const PREMATURE_LIQUIDATOR: PriorityMap = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "missed_upside_pct", label: "Missed Upside" },
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const DEFAULT_PRIORITY: PriorityMap = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
  { key: "portfolio_value_usd", label: "Portfolio Value" },
];

const PRIORITY_MAPS: Record<string, PriorityMap> = {
  suspiciously_competent: SUSPICIOUSLY_COMPETENT,
  one_pump_chump: ONE_PUMP_CHUMP,
  certified_exit_liquidity: CERTIFIED_EXIT_LIQUIDITY,
  diamond_handed_hostage: DIAMOND_HANDED_HOSTAGE,
  premature_liquidator: PREMATURE_LIQUIDATOR,
};

export function getPriorityMap(verdictCode: string | null | undefined): PriorityMap {
  if (verdictCode && PRIORITY_MAPS[verdictCode]) return PRIORITY_MAPS[verdictCode];
  return DEFAULT_PRIORITY;
}

// ---- Value validation ----

function isValid(v: any): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number") return true;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n);
  }
  return false;
}

// ---- Formatting ----

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function formatValue(key: string, raw: any): string {
  const n = num(raw);
  if (n === null) return String(raw);

  if (key === "realized_pnl_pct" || key === "win_rate_pct" || key === "missed_upside_pct" ||
      key === "avg_buy_after_pump_pct" || key === "avg_sell_after_drawdown_pct" ||
      key === "smart_money_delta_pct" || key === "max_drawdown_pct" ||
      key === "position_reduction_pct") {
    const sign = (key === "realized_pnl_pct" || key === "smart_money_delta_pct" || key === "missed_upside_pct") && n > 0 ? "+" : "";
    return `${sign}${(n * 100).toFixed(1)}%`;
  }
  if (key.endsWith("_usd") || key === "portfolio_value_usd" || key === "avg_trade_value_usd") {
    const s = n >= 0 ? "$" : "-$";
    return `${s}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (key === "avg_token_bought_age_days") {
    return `${Math.round(n).toLocaleString()} days`;
  }
  if (key === "avg_holding_seconds") {
    return formatDuration(n);
  }
  if (key === "tx_frequency_per_day") {
    return `${n.toFixed(2)}/day`;
  }
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)} days`;
}

// ---- Context lines (optional, only when essential) ----

function contextFor(key: string): string | undefined {
  const map: Record<string, string> = {
    realized_pnl_pct: "Realized during evidence window",
    win_rate_pct: "Of closed positions",
    total_trades: "Sales recorded by Nansen",
    avg_holding_seconds: "Average across positions",
    missed_upside_pct: "After exit",
    max_drawdown_pct: "Peak-to-trough",
  };
  return map[key];
}

// ---- Main selection function ----

export const SNAPSHOT_MAX = 6;

export function selectSnapshotMetrics(
  metricsJson: string | null | undefined,
  verdictCode: string | null | undefined
): SnapshotMetric[] {
  let metrics: Record<string, any> = {};
  if (metricsJson) {
    try {
      metrics = JSON.parse(metricsJson) || {};
    } catch {
      metrics = {};
    }
  }
  // Strip internal _meta key
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (!k.startsWith("_")) clean[k] = v;
  }

  const priority = getPriorityMap(verdictCode);
  const result: SnapshotMetric[] = [];

  for (const entry of priority) {
    if (result.length >= SNAPSHOT_MAX) break;
    const raw = clean[entry.key];
    if (!isValid(raw)) continue;
    result.push({
      key: entry.key,
      label: entry.label,
      value: formatValue(entry.key, raw),
      context: contextFor(entry.key),
    });
  }

  return result;
}

// Count the actual number of saved exhibits (evidence_items).
export function countExhibits(evidenceItemsJson: string | null | undefined): number {
  if (!evidenceItemsJson) return 0;
  try {
    const items = JSON.parse(evidenceItemsJson);
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}