// Wallet Court — Single Trade Trial FIFO lot accounting. Pure: no SDK, no
// network. Imported by backend functions and unit-tested in isolation.
//
// FIFO (First-In-First-Out) lot accounting attributes sells to the oldest
// buy lots first. The "selected lot" is the entry purchase the user chose to
// put on trial. Later buys create additional lots. Sells consume lots in
// chronological order.
//
// IMPORTANT: The blockchain does NOT identify which specific fungible units
// were sold. FIFO is an accounting convention, not an on-chain fact. When
// later activity (buys + sells) makes attribution complex, we disclose this
// clearly and never claim the blockchain identifies the specific units.
//
// For the simple case (one buy, no sells — e.g. JEANPHIL), the result is
// exact: the selected lot is the only lot, and all remaining tokens belong
// to it.

export const LOT_ACCOUNTING_METHOD = "fifo" as const;

export interface Lot {
  source: "entry" | "later_buy";
  tokens: number;
  cost_usd: number;
  price_usd: number | null;
  timestamp: string;
}

export interface FifoResult {
  lot_accounting_method: "fifo";
  selected_lot_tokens: number;          // tokens from the entry purchase
  selected_lot_cost_usd: number;        // cost basis of the entry purchase
  selected_lot_remaining_quantity: number; // tokens from entry lot still held
  selected_lot_sold_quantity: number;   // tokens from entry lot sold
  selected_lot_cost_basis_remaining: number; // remaining cost basis (proportional)
  selected_lot_current_value: number | null;  // remaining tokens * current price
  selected_lot_pnl_pct: number | null;  // selected-lot PnL percentage
  whole_position_tokens: number;        // total tokens across all lots
  whole_position_cost_usd: number;      // total cost across all lots
  whole_position_remaining: number;    // total tokens still held
  whole_position_current_value: number | null;
  whole_position_pnl_pct: number | null;
  lot_attribution_complex: boolean;     // true when later buys + sells exist
  attribution_note: string;             // human-readable disclosure
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Run FIFO lot accounting. Returns the full attribution result.
//
//   entryTokens      — tokens received in the entry purchase
//   entryCostUsd     — USD cost of the entry purchase
//   entryTimestamp   — ISO timestamp of the entry purchase
//   laterBuys        — array of { tokens, cost_usd, timestamp } (each is a later buy)
//   laterSells       — array of { tokens, timestamp } (each is a sell after entry)
//   currentPriceUsd  — current token price (from current-balance)
export function computeFifoLotAttribution(args: {
  entryTokens: number | null;
  entryCostUsd: number | null;
  entryTimestamp: string | null;
  laterBuys: any[];
  laterSells: any[];
  currentPriceUsd: number | null;
}): FifoResult {
  const {
    entryTokens, entryCostUsd, entryTimestamp,
    laterBuys, laterSells, currentPriceUsd
  } = args;

  const eTokens = num(entryTokens) ?? 0;
  const eCost = num(entryCostUsd) ?? 0;
  const ePrice = eTokens > 0 ? eCost / eTokens : null;

  // Build lots in chronological order: entry first, then later buys sorted by timestamp.
  const lots: Lot[] = [];
  if (eTokens > 0) {
    lots.push({
      source: "entry",
      tokens: eTokens,
      cost_usd: eCost,
      price_usd: ePrice,
      timestamp: entryTimestamp || ""
    });
  }
  for (const lb of laterBuys) {
    const t = num(lb.token_bought_amount ?? lb.tokens) ?? 0;
    const c = num(lb.trade_value_usd ?? lb.cost_usd) ?? 0;
    if (t > 0) {
      lots.push({
        source: "later_buy",
        tokens: t,
        cost_usd: c,
        price_usd: t > 0 ? c / t : null,
        timestamp: lb.block_timestamp || lb.timestamp || ""
      });
    }
  }
  // Sort later-buy lots after entry by timestamp (entry is always first).
  // We keep entry at index 0 and sort the rest.
  if (lots.length > 1) {
    const entry = lots[0];
    const rest = lots.slice(1).sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return ta - tb;
    });
    lots.length = 0;
    lots.push(entry, ...rest);
  }

  // Run FIFO: consume sells from the oldest lot first.
  // Track remaining tokens per lot.
  const remaining = lots.map((l) => l.tokens);
  let totalSold = 0;
  for (const sell of laterSells) {
    const sellTokens = num(sell.token_sold_amount ?? sell.tokens) ?? 0;
    if (sellTokens <= 0) continue;
    let toSell = sellTokens;
    for (let i = 0; i < lots.length && toSell > 0; i++) {
      if (remaining[i] <= 0) continue;
      const consumed = Math.min(remaining[i], toSell);
      remaining[i] -= consumed;
      toSell -= consumed;
      totalSold += consumed;
    }
  }

  // Selected lot is index 0 (the entry purchase).
  const selectedLotRemaining = remaining[0] ?? 0;
  const selectedLotSold = eTokens - selectedLotRemaining;
  // Proportional cost basis: (remaining / entry_tokens) * entry_cost
  const selectedLotCostBasisRemaining = eTokens > 0
    ? (selectedLotRemaining / eTokens) * eCost
    : 0;
  const selectedLotCurrentValue = currentPriceUsd !== null
    ? selectedLotRemaining * currentPriceUsd
    : null;
  const selectedLotPnlPct = (selectedLotCostBasisRemaining > 0 && selectedLotCurrentValue !== null)
    ? (selectedLotCurrentValue / selectedLotCostBasisRemaining) - 1
    : null;

  // Whole position.
  const wholePositionTokens = lots.reduce((s, l) => s + l.tokens, 0);
  const wholePositionCost = lots.reduce((s, l) => s + l.cost_usd, 0);
  const wholePositionRemaining = remaining.reduce((s, r) => s + r, 0);
  const wholePositionCurrentValue = currentPriceUsd !== null
    ? wholePositionRemaining * currentPriceUsd
    : null;
  const wholePositionPnlPct = (wholePositionCost > 0 && wholePositionCurrentValue !== null)
    ? (wholePositionCurrentValue / wholePositionCost) - 1
    : null;

  // Attribution complexity: when there are later buys AND sells, FIFO
  // attribution is an accounting convention, not an on-chain fact.
  const hasLaterBuys = lots.length > 1;
  const hasSells = totalSold > 0;
  const lotAttributionComplex = hasLaterBuys && hasSells;

  let attributionNote: string;
  if (!hasSells && !hasLaterBuys) {
    attributionNote = "Exact attribution: one purchase, no sells. The entire remaining position belongs to the selected trade.";
  } else if (!hasSells) {
    attributionNote = "FIFO attribution: no sells detected. The selected trade's tokens are fully intact; later buys are separate lots.";
  } else if (!hasLaterBuys) {
    attributionNote = "FIFO attribution: sells consumed the selected lot first (oldest-first). No later buys exist, so attribution is exact.";
  } else {
    attributionNote = "FIFO attribution (accounting convention): later buys and sells make lot attribution complex. The blockchain does not identify which specific units were sold. Selected-lot performance is estimated using FIFO ordering.";
  }

  return {
    lot_accounting_method: LOT_ACCOUNTING_METHOD,
    selected_lot_tokens: eTokens,
    selected_lot_cost_usd: eCost,
    selected_lot_remaining_quantity: selectedLotRemaining,
    selected_lot_sold_quantity: selectedLotSold,
    selected_lot_cost_basis_remaining: selectedLotCostBasisRemaining,
    selected_lot_current_value: selectedLotCurrentValue,
    selected_lot_pnl_pct: selectedLotPnlPct,
    whole_position_tokens: wholePositionTokens,
    whole_position_cost_usd: wholePositionCost,
    whole_position_remaining: wholePositionRemaining,
    whole_position_current_value: wholePositionCurrentValue,
    whole_position_pnl_pct: wholePositionPnlPct,
    lot_attribution_complex: lotAttributionComplex,
    attribution_note: attributionNote
  };
}