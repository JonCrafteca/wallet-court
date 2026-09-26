// Wallet Court — Single Trade Trial pure evidence logic. No SDK, no network, no
// side effects. Imported by backend functions and unit-tested in isolation.
//
// This module owns:
//   - Purchase-list normalization from a filtered dex-trades response
//   - OHLCV-series → trade-level metrics (drawdown, trough, time underwater,
//     max unrealized gain, recovery)
//   - Conviction classification (held / partial_exit / full_exit / averaged_down)
//   - Trade-level evidence exhibit construction
//   - Idempotency fingerprint generation

function num(v): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function safeLower(s: string | null | undefined): string {
  return (s || "").toLowerCase();
}

// ---- Idempotency fingerprint ----

// SHA-256 of network + ':' + normalized_wallet_address + ':' + transaction_hash.
// Uses Web Crypto. Returns lowercase hex. This is the permanent dedup key that
// prevents the same wallet+transaction from creating duplicate trials or
// duplicate paid Nansen calls.
export async function buildTradeFingerprint(
  network: string,
  normalizedWalletAddress: string,
  transactionHash: string
): Promise<string> {
  const input = `${network}:${normalizedWalletAddress}:${transactionHash}`;
  const subtle = (typeof crypto !== "undefined" && crypto.subtle)
    ? crypto.subtle
    : (globalThis as any).crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 unavailable: crypto.subtle not found.");
  const data = new TextEncoder().encode(input);
  const buf = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Purchase normalization ----

export interface PurchaseRecord {
  transaction_hash: string;
  block_timestamp: string;
  token_bought_address: string | null;
  token_sold_address: string | null;
  token_bought_symbol: string | null;
  token_sold_symbol: string | null;
  tokens_received: number | null;
  tokens_spent: number | null;
  purchase_cost_usd: number | null;
  entry_market_cap_usd: number | null;
  entry_fdv_usd: number | null;
  trade_value_usd: number | null;
  entry_price_usd: number | null;
}

// Normalize a dex-trades response (filtered by token_bought_address) into a
// sorted list of purchase records. Only trades where token_bought_address
// matches the mint are kept (defense-in-depth — the API filter should already
// ensure this). Sorted oldest-first so the user sees chronological order.
export function normalizePurchases(dexTradesJson: any, tokenMint: string): PurchaseRecord[] {
  if (!dexTradesJson) return [];
  const data = dexTradesJson.data || dexTradesJson.trades || [];
  if (!Array.isArray(data)) return [];
  const mintLower = safeLower(tokenMint);
  return data
    .filter((t: any) => safeLower(t.token_bought_address) === mintLower)
    .map((t: any) => {
      const cost = num(t.trade_value_usd);
      const received = num(t.token_bought_amount);
      return {
        transaction_hash: t.transaction_hash || null,
        block_timestamp: t.block_timestamp || null,
        token_bought_address: t.token_bought_address || null,
        token_sold_address: t.token_sold_address || null,
        token_bought_symbol: t.token_bought_symbol || null,
        token_sold_symbol: t.token_sold_symbol || null,
        tokens_received: received,
        tokens_spent: num(t.token_sold_amount),
        purchase_cost_usd: cost,
        entry_market_cap_usd: num(t.token_bought_market_cap),
        entry_fdv_usd: num(t.token_bought_fdv),
        trade_value_usd: cost,
        entry_price_usd: received && received > 0 && cost !== null ? cost / received : null,
      } as PurchaseRecord;
    })
    .filter((p: PurchaseRecord) => p.transaction_hash && p.block_timestamp)
    .sort((a: PurchaseRecord, b: PurchaseRecord) => new Date(a.block_timestamp).getTime() - new Date(b.block_timestamp).getTime());
}

// Sanitize a purchase for the public discovery response. Removes the full
// wallet address (trader_address) — only tx hash (abbreviated), timestamp,
// cost, mcap, and symbol are returned.
export function sanitizePurchaseForPublic(p: PurchaseRecord): Record<string, any> {
  if (!p) return null;
  return {
    transaction_hash_short: p.transaction_hash
      ? (p.transaction_hash.length > 12
        ? `${p.transaction_hash.slice(0, 6)}…${p.transaction_hash.slice(-4)}`
        : p.transaction_hash)
      : null,
    block_timestamp: p.block_timestamp,
    token_symbol: p.token_bought_symbol,
    tokens_received: p.tokens_received,
    purchase_cost_usd: p.purchase_cost_usd,
    entry_market_cap_usd: p.entry_market_cap_usd,
    entry_price_usd: p.entry_price_usd,
  };
}

// ---- OHLCV metrics ----

export interface OhlcvCandle {
  interval_start: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  volume_usd: number | null;
  market_cap: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  } | null;
}

// Extract the candle array from a token-ohlcv response.
export function extractCandles(ohlcvJson: any): OhlcvCandle[] {
  if (!ohlcvJson) return [];
  const data = ohlcvJson.data || [];
  if (!Array.isArray(data)) return [];
  return data;
}

// Maximum number of candles stored in ohlcv_snapshot_json. The full series is
// used for metrics computation; the stored snapshot is capped AND slimmed to
// keep the entity field within size limits. 80 slimmed candles at ~80 bytes
// each ≈ 6.4KB, safely under the ~16KB entity field limit. The original
// candle count is recorded in metrics._meta so the public page can disclose
// the sampling.
export const MAX_STORED_CANDLES = 80;

// Maximum serialized size (in characters) for the ohlcv_snapshot_json field.
// If the capped+slimmed snapshot exceeds this, it is further reduced. 12000
// chars ≈ 12KB, leaving margin under the ~16KB entity field limit.
export const MAX_OHLCV_FIELD_CHARS = 12000;

// Slim a candle to minimal fields for storage: { t, o, h, l, c, v }.
// The full candle object (with market_cap sub-object, volume_usd, etc.) is
// used for metrics computation on the full series; the stored snapshot only
// needs the price path for the public chart.
export function slimCandle(c: OhlcvCandle): Record<string, any> {
  return {
    t: c.interval_start || null,
    o: c.open ?? null,
    h: c.high ?? null,
    l: c.low ?? null,
    c: c.close ?? null,
    v: c.volume_usd ?? c.volume ?? null,
  };
}

// Cap an OHLCV candle array to a maximum number of candles by evenly
// sampling. Always preserves the first and last candles. Returns the
// original array if it is already within the limit. This prevents the
// ohlcv_snapshot_json field from exceeding the entity field size limit
// when Nansen returns a large candle series (e.g. 1h candles over months).
export function capCandles(candles: OhlcvCandle[], max: number = MAX_STORED_CANDLES): OhlcvCandle[] {
  if (!Array.isArray(candles) || candles.length <= max) return candles;
  const step = (candles.length - 1) / (max - 1);
  const result: OhlcvCandle[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.min(candles.length - 1, Math.round(i * step));
    result.push(candles[idx]);
  }
  return result;
}

// Build a capped, slimmed OHLCV snapshot for storage. Returns the JSON
// string, the original candle count, the stored candle count, and the
// sampling method. If the serialized size exceeds MAX_OHLCV_FIELD_CHARS,
// the candle count is further reduced until it fits.
//
//   originalCount  — the number of candles in the full series
//   storedCount    — the number of candles in the stored snapshot
//   samplingMethod — "none" (no sampling needed), "even" (even sampling)
//
// This function NEVER fabricates candles. If the input is empty, the output
// is "[]".
export function buildCappedOhlcvSnapshot(candles: OhlcvCandle[]): {
  json: string;
  originalCount: number;
  storedCount: number;
  samplingMethod: string;
} {
  const originalCount = Array.isArray(candles) ? candles.length : 0;
  if (originalCount === 0) {
    return { json: "[]", originalCount: 0, storedCount: 0, samplingMethod: "none" };
  }

  let max = MAX_STORED_CANDLES;
  let samplingMethod = originalCount <= max ? "none" : "even";

  // Iteratively reduce the cap until the serialized size fits.
  while (max > 0) {
    const capped = capCandles(candles, max);
    const slimmed = capped.map(slimCandle);
    const json = JSON.stringify(slimmed);
    if (json.length <= MAX_OHLCV_FIELD_CHARS) {
      return { json, originalCount, storedCount: slimmed.length, samplingMethod };
    }
    // Still too large — reduce by 20% and retry.
    max = Math.floor(max * 0.8);
    samplingMethod = "even";
  }

  // Fallback: store only the first and last candle (absolute minimum).
  const minimal = [slimCandle(candles[0]), slimCandle(candles[candles.length - 1])];
  return {
    json: JSON.stringify(minimal),
    originalCount,
    storedCount: 2,
    samplingMethod: "even_minimal",
  };
}

// Validate that a serialized field value fits within the entity field size
// limit. Returns true if safe to write, false if it would exceed the limit.
export function validateFieldSize(serialized: string, maxChars: number = MAX_OHLCV_FIELD_CHARS): boolean {
  if (!serialized) return true;
  return serialized.length <= maxChars;
}

export interface TradeMetrics {
  entry_market_cap_usd: number | null;
  max_drawdown_pct: number | null;
  lowest_market_cap_usd: number | null;
  time_underwater_pct: number | null;
  max_unrealized_gain_pct: number | null;
  current_market_cap_usd: number | null;
  recovery_pct: number | null;
  current_unrealized_pnl_pct: number | null;
  current_unrealized_pnl_usd: number | null;
  holding_duration_days: number | null;
  candle_count: number;
  conviction: "held" | "partial_exit" | "full_exit" | "averaged_down";
  later_sells_count: number;
  later_buys_count: number;
  total_tokens_sold: number | null;
  total_tokens_bought_later: number | null;
  // Comeback archetype inputs (canonical registry)
  purchase_cost_usd: number | null;
  current_value_usd: number | null;
  lowest_position_value_usd: number | null;
  realized_exit_value_usd: number | null;
  ending_value_usd: number | null;
  lowest_market_cap_timestamp: string | null;
  last_sell_timestamp: string | null;
}

// Compute trade-level metrics from an OHLCV candle series + trade context.
// Pure: no network. All inputs are already-fetched data.
//
//   entryMarketCapUsd — the market cap at purchase (from dex-trades)
//   purchaseCostUsd   — the USD cost of the purchase
//   tokensReceived     — tokens acquired in the entry purchase
//   laterSells        — array of sell trade objects (token_sold_amount, trade_value_usd, block_timestamp)
//   laterBuys         — array of additional buy trade objects (token_bought_amount, trade_value_usd, block_timestamp)
//   currentPriceUsd   — current token price (from current-balance)
//   currentValueUsd  — current USD value of remaining position
//   currentTokenAmount — current token balance
//   purchaseTimestamp  — ISO timestamp of the entry purchase
export function computeTradeMetrics(args: {
  candles: OhlcvCandle[];
  entryMarketCapUsd: number | null;
  purchaseCostUsd: number | null;
  tokensReceived: number | null;
  laterSells: any[];
  laterBuys: any[];
  currentPriceUsd: number | null;
  currentValueUsd: number | null;
  currentTokenAmount: number | null;
  currentMarketCapUsd?: number | null;
  purchaseTimestamp: string | null;
}): TradeMetrics {
  const {
    candles, entryMarketCapUsd, purchaseCostUsd, tokensReceived,
    laterSells, laterBuys, currentPriceUsd, currentValueUsd,
    currentTokenAmount, currentMarketCapUsd, purchaseTimestamp
  } = args;

  // Filter candles to those at or after the purchase timestamp.
  const entryMs = purchaseTimestamp ? new Date(purchaseTimestamp).getTime() : 0;
  const postEntryCandles = candles.filter((c) => {
    const t = new Date(c.interval_start).getTime();
    return t >= entryMs;
  });

  // Market-cap lows/highs from the OHLCV series.
  const mcapLows = postEntryCandles
    .map((c) => c.market_cap?.low ?? null)
    .filter((v): v is number => v !== null && v > 0);
  const mcapHighs = postEntryCandles
    .map((c) => c.market_cap?.high ?? null)
    .filter((v): v is number => v !== null && v > 0);

  const lowestMarketCap = mcapLows.length > 0 ? Math.min(...mcapLows) : null;
  const highestMarketCap = mcapHighs.length > 0 ? Math.max(...mcapHighs) : null;

  // Track the timestamp of the lowest market cap candle (for comeback
  // chronological validation).
  let lowestMarketCapTimestamp: string | null = null;
  if (postEntryCandles.length > 0) {
    let lowestCandle: { mcapLow: number; timestamp: string } | null = null;
    for (const c of postEntryCandles) {
      const low = c.market_cap?.low ?? null;
      if (low !== null && low > 0 && (lowestCandle === null || low < lowestCandle.mcapLow)) {
        lowestCandle = { mcapLow: low, timestamp: c.interval_start };
      }
    }
    if (lowestCandle) lowestMarketCapTimestamp = lowestCandle.timestamp;
  }

  // Max drawdown from entry.
  let maxDrawdownPct: number | null = null;
  if (entryMarketCapUsd && entryMarketCapUsd > 0 && lowestMarketCap !== null) {
    maxDrawdownPct = (lowestMarketCap / entryMarketCapUsd) - 1;
  }

  // Max unrealized gain from entry.
  let maxUnrealizedGainPct: number | null = null;
  if (entryMarketCapUsd && entryMarketCapUsd > 0 && highestMarketCap !== null) {
    maxUnrealizedGainPct = (highestMarketCap / entryMarketCapUsd) - 1;
  }

  // Time underwater: fraction of candles where close mcap < entry mcap.
  let timeUnderwaterPct: number | null = null;
  if (entryMarketCapUsd && entryMarketCapUsd > 0 && postEntryCandles.length > 0) {
    const underwater = postEntryCandles.filter((c) => {
      const closeMcap = c.market_cap?.close ?? null;
      return closeMcap !== null && closeMcap < entryMarketCapUsd;
    }).length;
    timeUnderwaterPct = underwater / postEntryCandles.length;
  }

  // Recovery: how far back from the trough toward entry.
  let recoveryPct: number | null = null;
  const currentMcap = currentMarketCapUsd ?? postEntryCandles[postEntryCandles.length - 1]?.market_cap?.close ?? null;
  if (entryMarketCapUsd && lowestMarketCap !== null && currentMcap !== null
      && entryMarketCapUsd > lowestMarketCap) {
    recoveryPct = (currentMcap - lowestMarketCap) / (entryMarketCapUsd - lowestMarketCap);
  }

  // Current unrealized PnL.
  let currentUnrealizedPnlPct: number | null = null;
  let currentUnrealizedPnlUsd: number | null = null;
  if (purchaseCostUsd !== null && purchaseCostUsd > 0 && currentValueUsd !== null) {
    currentUnrealizedPnlUsd = currentValueUsd - purchaseCostUsd;
    currentUnrealizedPnlPct = (currentValueUsd / purchaseCostUsd) - 1;
  } else if (purchaseCostUsd !== null && purchaseCostUsd > 0 && currentPriceUsd !== null && tokensReceived !== null) {
    const impliedCurrentValue = currentPriceUsd * tokensReceived;
    currentUnrealizedPnlUsd = impliedCurrentValue - purchaseCostUsd;
    currentUnrealizedPnlPct = (impliedCurrentValue / purchaseCostUsd) - 1;
  }

  // Holding duration.
  let holdingDurationDays: number | null = null;
  if (purchaseTimestamp) {
    const nowMs = Date.now();
    const entryMs2 = new Date(purchaseTimestamp).getTime();
    holdingDurationDays = (nowMs - entryMs2) / 86400000;
  }

  // Conviction classification.
  const totalTokensSold = laterSells.reduce((sum, s) => sum + (num(s.token_sold_amount) || 0), 0);
  const totalTokensBoughtLater = laterBuys.reduce((sum, b) => sum + (num(b.token_bought_amount) || 0), 0);
  let conviction: TradeMetrics["conviction"] = "held";
  if (tokensReceived && totalTokensSold >= tokensReceived) {
    conviction = "full_exit";
  } else if (totalTokensSold > 0) {
    conviction = "partial_exit";
  } else if (laterBuys.length > 0) {
    conviction = "averaged_down";
  }

  // ---- Comeback archetype inputs ----
  const realizedExitValueUsd = laterSells.reduce((sum, s) => sum + (num(s.trade_value_usd) || 0), 0);
  const lastSellTimestamp = laterSells.length > 0
    ? laterSells.reduce((latest, s) => {
        const ts = s.block_timestamp || s.timestamp || null;
        if (!ts) return latest;
        if (!latest) return ts;
        return new Date(ts).getTime() > new Date(latest).getTime() ? ts : latest;
      }, null as string | null)
    : null;

  const lowestPositionValueUsd =
    purchaseCostUsd !== null && purchaseCostUsd > 0 && maxDrawdownPct !== null
      ? purchaseCostUsd * (1 + maxDrawdownPct)
      : null;

  const endingValueUsd =
    conviction === "full_exit" && realizedExitValueUsd > 0
      ? realizedExitValueUsd
      : currentValueUsd ?? null;

  return {
    entry_market_cap_usd: entryMarketCapUsd,
    max_drawdown_pct: maxDrawdownPct,
    lowest_market_cap_usd: lowestMarketCap,
    time_underwater_pct: timeUnderwaterPct,
    max_unrealized_gain_pct: maxUnrealizedGainPct,
    current_market_cap_usd: currentMcap,
    recovery_pct: recoveryPct,
    current_unrealized_pnl_pct: currentUnrealizedPnlPct,
    current_unrealized_pnl_usd: currentUnrealizedPnlUsd,
    holding_duration_days: holdingDurationDays,
    candle_count: postEntryCandles.length,
    conviction,
    later_sells_count: laterSells.length,
    later_buys_count: laterBuys.length,
    total_tokens_sold: totalTokensSold > 0 ? totalTokensSold : null,
    total_tokens_bought_later: totalTokensBoughtLater > 0 ? totalTokensBoughtLater : null,
    purchase_cost_usd: purchaseCostUsd,
    current_value_usd: currentValueUsd ?? null,
    lowest_position_value_usd: lowestPositionValueUsd,
    realized_exit_value_usd: realizedExitValueUsd > 0 ? realizedExitValueUsd : null,
    ending_value_usd: endingValueUsd,
    lowest_market_cap_timestamp: lowestMarketCapTimestamp,
    last_sell_timestamp: lastSellTimestamp,
  };
}

// ---- Evidence exhibits ----

export function buildTradeEvidence(metrics: TradeMetrics, purchase: PurchaseRecord): any[] {
  const evidence: any[] = [];
  const m = metrics;

  if (m.entry_market_cap_usd !== null) {
    evidence.push({
      tag: "NANSEN · ENTRY",
      label: "Entry Market Cap",
      value: fmtUsd(m.entry_market_cap_usd),
      detail: "Market cap at the moment of purchase, from Nansen DEX trades."
    });
  }
  if (purchase.purchase_cost_usd !== null) {
    evidence.push({
      tag: "NANSEN · ENTRY",
      label: "Purchase Cost",
      value: fmtUsd(purchase.purchase_cost_usd),
      detail: "USD value of the entry trade."
    });
  }
  if (purchase.tokens_received !== null) {
    evidence.push({
      tag: "NANSEN · ENTRY",
      label: "Tokens Received",
      value: fmtInt(purchase.tokens_received),
      detail: "Quantity of tokens acquired."
    });
  }
  if (m.max_drawdown_pct !== null) {
    evidence.push({
      tag: "NANSEN · OHLCV",
      label: "Maximum Drawdown",
      value: fmtPctSigned(m.max_drawdown_pct),
      detail: "Deepest decline from entry market cap to the lowest subsequent market cap."
    });
  }
  if (m.lowest_market_cap_usd !== null) {
    evidence.push({
      tag: "NANSEN · OHLCV",
      label: "Lowest Market Cap",
      value: fmtUsd(m.lowest_market_cap_usd),
      detail: "The trough market cap after entry."
    });
  }
  if (m.time_underwater_pct !== null) {
    evidence.push({
      tag: "NANSEN · OHLCV",
      label: "Time Underwater",
      value: fmtPctPlain(m.time_underwater_pct),
      detail: "Share of candles closing below the entry market cap."
    });
  }
  if (m.max_unrealized_gain_pct !== null) {
    evidence.push({
      tag: "NANSEN · OHLCV",
      label: "Peak Unrealized Gain",
      value: fmtPctSigned(m.max_unrealized_gain_pct),
      detail: "Highest market cap reached after entry, relative to entry."
    });
  }
  if (m.recovery_pct !== null) {
    evidence.push({
      tag: "NANSEN · OHLCV",
      label: "Recovery",
      value: fmtPctPlain(m.recovery_pct),
      detail: "How far the market cap has climbed back from the trough toward entry."
    });
  }
  if (m.current_unrealized_pnl_pct !== null) {
    evidence.push({
      tag: "NANSEN · CURRENT",
      label: "Current Unrealized PnL",
      value: fmtPctSigned(m.current_unrealized_pnl_pct),
      detail: m.current_unrealized_pnl_usd !== null
        ? `${fmtUsd(m.current_unrealized_pnl_usd)} relative to purchase cost.`
        : "Relative to purchase cost."
    });
  }
  if (m.conviction !== "held") {
    evidence.push({
      tag: "NANSEN · DEX",
      label: "Conviction",
      value: m.conviction === "full_exit" ? "Full Exit" : m.conviction === "partial_exit" ? "Partial Exit" : "Averaged Down",
      detail: m.conviction === "full_exit"
        ? "The entire position was sold after entry."
        : m.conviction === "partial_exit"
          ? `${m.later_sells_count} sell trade(s) after entry.`
          : `${m.later_buys_count} additional buy(s) after entry.`
    });
  } else {
    evidence.push({
      tag: "NANSEN · DEX",
      label: "Conviction",
      value: "Diamond Hands",
      detail: "No sells detected after entry. The full position is still held."
    });
  }
  if (m.holding_duration_days !== null) {
    evidence.push({
      tag: "NANSEN · DURATION",
      label: "Holding Duration",
      value: fmtDuration(m.holding_duration_days),
      detail: "Time from purchase to now."
    });
  }
  return evidence;
}

// ---- Formatting helpers (local, to keep this module pure) ----

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPctSigned(v: number | null): string {
  if (v === null) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtPctPlain(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtInt(v: number | null): string {
  if (v === null) return "—";
  return Math.round(v).toLocaleString();
}

function fmtDuration(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${days.toFixed(1)}d`;
  return `${(days / 30).toFixed(1)}mo`;
}

// ---- Sanitization for public case page ----

// Sanitize a SingleTradeTrial for the public case page. Removes wallet_address
// and normalized_wallet_address; returns address_short + token details + verdict
// + evidence + metrics. Scrubs any full-address occurrence from JSON strings.
export function sanitizeSingleTrialForPublicCase(trial: any): Record<string, any> | null {
  if (!trial) return null;
  const fullAddr = trial.normalized_wallet_address || trial.wallet_address || "";
  const address_short = fullAddr.length > 12
    ? `${fullAddr.slice(0, 6)}…${fullAddr.slice(-4)}`
    : fullAddr;
  const addrsToScrub = [trial.normalized_wallet_address, trial.wallet_address]
    .filter((a: string) => a && a.length > 8);
  return {
    public_slug: trial.public_slug,
    trial_type: "single_trade",
    network: trial.network,
    data_mode: trial.data_mode,
    case_outcome: trial.case_outcome,
    verdict_code: trial.verdict_code,
    verdict_name: trial.verdict_name,
    severity_score: trial.severity_score,
    confidence_score: trial.confidence_score,
    headline: trial.headline,
    charge: trial.charge || null,
    roast: trial.roast,
    defense_statement: trial.defense_statement,
    sentence: trial.sentence,
    evidence_items_json: scrubAddr(trial.evidence_items_json, addrsToScrub, address_short),
    metrics_json: scrubAddr(trial.metrics_json, addrsToScrub, address_short),
    source_endpoints_json: scrubAddr(trial.source_endpoints_json, addrsToScrub, address_short),
    analyzed_at: trial.analyzed_at,
    created_date: trial.created_date,
    address_short,
    token_symbol: trial.token_symbol,
    token_mint: trial.token_mint,
    transaction_hash_short: trial.transaction_hash
      ? (trial.transaction_hash.length > 12
        ? `${trial.transaction_hash.slice(0, 6)}…${trial.transaction_hash.slice(-4)}`
        : trial.transaction_hash)
      : null,
    purchase_timestamp: trial.purchase_timestamp,
    entry_market_cap_usd: trial.entry_market_cap_usd,
    purchase_cost_usd: trial.purchase_cost_usd,
    tokens_received: trial.tokens_received,
    entry_price_usd: trial.entry_price_usd,
    current_price_usd: trial.current_price_usd,
    current_value_usd: trial.current_value_usd,
    conviction: trial.conviction || null,
    refresh_snapshots_json: trial.refresh_snapshots_json || "[]",
  };
}

function scrubAddr(jsonStr: string | null, addrsToScrub: string[], replacement: string): string | null {
  if (!jsonStr || typeof jsonStr !== "string") return jsonStr;
  let result = jsonStr;
  for (const a of addrsToScrub) {
    if (a && result.includes(a)) result = result.split(a).join(replacement);
  }
  return result;
}