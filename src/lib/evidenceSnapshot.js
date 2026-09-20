// Client-side mirror of base44/shared/evidenceSnapshot.ts. Pure functions for
// client-side tests and the NansenEvidence component. Cannot import from
// base44/ (server-side only). Kept in sync with the backend logic.

export const SNAPSHOT_MAX = 6;

const SUSPICIOUSLY_COMPETENT = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "top5_wins", label: "Top-5 Record" },
  { key: "avg_token_bought_age_days", label: "Wallet Age" },
  { key: "dex_trade_count", label: "Recent DEX Trades" },
];

const ONE_PUMP_CHUMP = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "avg_holding_seconds", label: "Holding Duration" },
  { key: "missed_upside_pct", label: "Missed Upside" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const CERTIFIED_EXIT_LIQUIDITY = [
  { key: "avg_buy_after_pump_pct", label: "Buy Timing" },
  { key: "avg_sell_after_drawdown_pct", label: "Sell Timing" },
  { key: "smart_money_delta_pct", label: "vs Smart Money" },
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const DIAMOND_HANDED_HOSTAGE = [
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "max_drawdown_pct", label: "Avg Drawdown" },
  { key: "position_reduction_pct", label: "Position Reduction" },
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "token_balance_count", label: "Holdings" },
  { key: "portfolio_value_usd", label: "Portfolio Value" },
];

const PREMATURE_LIQUIDATOR = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "missed_upside_pct", label: "Missed Upside" },
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
];

const DEFAULT_PRIORITY = [
  { key: "realized_pnl_pct", label: "Realized P&L" },
  { key: "win_rate_pct", label: "Win Rate" },
  { key: "total_trades", label: "Total Trades" },
  { key: "avg_holding_seconds", label: "Holding Period" },
  { key: "max_drawdown_pct", label: "Max Drawdown" },
  { key: "portfolio_value_usd", label: "Portfolio Value" },
];

const PRIORITY_MAPS = {
  suspiciously_competent: SUSPICIOUSLY_COMPETENT,
  one_pump_chump: ONE_PUMP_CHUMP,
  certified_exit_liquidity: CERTIFIED_EXIT_LIQUIDITY,
  diamond_handed_hostage: DIAMOND_HANDED_HOSTAGE,
  premature_liquidator: PREMATURE_LIQUIDATOR,
};

export function getPriorityMap(verdictCode) {
  if (verdictCode && PRIORITY_MAPS[verdictCode]) return PRIORITY_MAPS[verdictCode];
  return DEFAULT_PRIORITY;
}

function isValid(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number") return true;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n);
  }
  return false;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function formatValue(key, raw) {
  const n = num(raw);
  if (n === null) return String(raw);

  const pctKeys = new Set([
    "realized_pnl_pct", "win_rate_pct", "missed_upside_pct",
    "avg_buy_after_pump_pct", "avg_sell_after_drawdown_pct",
    "smart_money_delta_pct", "max_drawdown_pct", "position_reduction_pct",
  ]);
  if (pctKeys.has(key)) {
    const sign = (key === "realized_pnl_pct" || key === "smart_money_delta_pct" || key === "missed_upside_pct") && n > 0 ? "+" : "";
    return `${sign}${(n * 100).toFixed(1)}%`;
  }
  if (key.endsWith("_usd") || key === "portfolio_value_usd" || key === "avg_trade_value_usd") {
    const s = n >= 0 ? "$" : "-$";
    return `${s}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (key === "avg_token_bought_age_days") return `${Math.round(n).toLocaleString()} days`;
  if (key === "avg_holding_seconds") return formatDuration(n);
  if (key === "tx_frequency_per_day") return `${n.toFixed(2)}/day`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)} days`;
}

const CONTEXT_MAP = {
  realized_pnl_pct: "Realized during evidence window",
  win_rate_pct: "Of closed positions",
  total_trades: "Sales recorded by Nansen",
  avg_holding_seconds: "Average across positions",
  missed_upside_pct: "After exit",
  max_drawdown_pct: "Peak-to-trough",
};

export function selectSnapshotMetrics(metricsJson, verdictCode) {
  let metrics = {};
  if (metricsJson) {
    try { metrics = JSON.parse(metricsJson) || {}; } catch { metrics = {}; }
  }
  const clean = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (!k.startsWith("_")) clean[k] = v;
  }

  const priority = getPriorityMap(verdictCode);
  const result = [];
  for (const entry of priority) {
    if (result.length >= SNAPSHOT_MAX) break;
    const raw = clean[entry.key];
    if (!isValid(raw)) continue;
    result.push({
      key: entry.key,
      label: entry.label,
      value: formatValue(entry.key, raw),
      context: CONTEXT_MAP[entry.key],
    });
  }
  return result;
}

export function countExhibits(evidenceItemsJson) {
  if (!evidenceItemsJson) return 0;
  try {
    const items = JSON.parse(evidenceItemsJson);
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}