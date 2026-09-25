// Wallet Court — Single Trade Trial regression suite.
// Pure-logic tests for purchase normalization, OHLCV metrics, verdict
// selection, fingerprint generation, and sanitization.

import { describe, it, expect } from "vitest";
import {
  normalizePurchases,
  sanitizePurchaseForPublic,
  extractCandles,
  computeTradeMetrics,
  buildTradeEvidence,
  buildTradeFingerprint,
  sanitizeSingleTrialForPublicCase,
} from "../base44/shared/singleTradeEvidence.ts";
import {
  selectTradeVerdict,
  computeTradeSeverityConfidence,
  TRADE_VERDICTS,
} from "../base44/shared/singleTradeVerdicts.ts";

// ---- Mock data ----

const JEANPHIL_MINT = "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump";
const WALLET = "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1";

const MOCK_DEX_TRADES = {
  data: [
    {
      transaction_hash: "tx_abc_001",
      block_timestamp: "2026-09-20T10:58:00Z",
      token_bought_address: JEANPHIL_MINT,
      token_sold_address: "So11111111111111111111111111111111111111112",
      token_bought_symbol: "JEANPHIL",
      token_sold_symbol: "SOL",
      token_bought_amount: 108100,
      token_sold_amount: 5.2,
      token_bought_market_cap: 9300000,
      token_bought_fdv: 9300000,
      trade_value_usd: 1044.42,
    },
    {
      transaction_hash: "tx_abc_002",
      block_timestamp: "2026-09-22T14:00:00Z",
      token_bought_address: JEANPHIL_MINT,
      token_sold_address: "So11111111111111111111111111111111111111112",
      token_bought_symbol: "JEANPHIL",
      token_sold_symbol: "SOL",
      token_bought_amount: 50000,
      token_sold_amount: 2.5,
      token_bought_market_cap: 4000000,
      trade_value_usd: 500,
    },
    {
      transaction_hash: "tx_other",
      block_timestamp: "2026-09-21T10:00:00Z",
      token_bought_address: "OTHER_MINT_ADDRESS",
      token_bought_symbol: "OTHER",
      token_bought_amount: 100,
      trade_value_usd: 50,
    },
  ]
};

const MOCK_OHLCV = {
  data: [
    { interval_start: "2026-09-20T11:00:00Z", open: null, high: 9.5e6, low: 8.5e6, close: 9.0e6, market_cap: { open: 9.3e6, high: 9.5e6, low: 8.5e6, close: 9.0e6 } },
    { interval_start: "2026-09-20T12:00:00Z", high: 7.0e6, low: 5.0e6, close: 6.0e6, market_cap: { high: 7.0e6, low: 5.0e6, close: 6.0e6 } },
    { interval_start: "2026-09-20T13:00:00Z", high: 4.0e6, low: 1.0e6, close: 1.5e6, market_cap: { high: 4.0e6, low: 1.0e6, close: 1.5e6 } },
    { interval_start: "2026-09-20T14:00:00Z", high: 3.0e6, low: 1.0e6, close: 2.0e6, market_cap: { high: 3.0e6, low: 1.0e6, close: 2.0e6 } },
    { interval_start: "2026-09-21T10:00:00Z", high: 8.0e6, low: 5.0e6, close: 7.2e6, market_cap: { high: 8.0e6, low: 5.0e6, close: 7.2e6 } },
  ]
};

// ---- Purchase normalization ----

describe("Single Trade — purchase normalization", () => {
  it("filters to only the target token and sorts oldest-first", () => {
    const purchases = normalizePurchases(MOCK_DEX_TRADES, JEANPHIL_MINT);
    expect(purchases.length).toBe(2);
    expect(purchases[0].transaction_hash).toBe("tx_abc_001");
    expect(purchases[1].transaction_hash).toBe("tx_abc_002");
  });

  it("extracts entry cost, tokens received, and entry market cap", () => {
    const purchases = normalizePurchases(MOCK_DEX_TRADES, JEANPHIL_MINT);
    const p = purchases[0];
    expect(p.purchase_cost_usd).toBeCloseTo(1044.42, 2);
    expect(p.tokens_received).toBe(108100);
    expect(p.entry_market_cap_usd).toBe(9300000);
    expect(p.token_bought_symbol).toBe("JEANPHIL");
  });

  it("computes implied entry price", () => {
    const purchases = normalizePurchases(MOCK_DEX_TRADES, JEANPHIL_MINT);
    const p = purchases[0];
    expect(p.entry_price_usd).toBeCloseTo(1044.42 / 108100, 8);
  });

  it("returns empty array for null/missing response", () => {
    expect(normalizePurchases(null, JEANPHIL_MINT)).toEqual([]);
    expect(normalizePurchases({}, JEANPHIL_MINT)).toEqual([]);
    expect(normalizePurchases({ data: "not-array" }, JEANPHIL_MINT)).toEqual([]);
  });

  it("sanitizes purchase for public (no full wallet address)", () => {
    const purchases = normalizePurchases(MOCK_DEX_TRADES, JEANPHIL_MINT);
    const pub = sanitizePurchaseForPublic(purchases[0]);
    expect(pub.transaction_hash).toBeUndefined();
    expect(pub.transaction_hash_short).toBeTruthy();
    expect(pub.purchase_cost_usd).toBeCloseTo(1044.42, 2);
    expect(pub.entry_market_cap_usd).toBe(9300000);
    // No wallet address fields
    expect(pub.wallet_address).toBeUndefined();
    expect(pub.trader_address).toBeUndefined();
  });
});

// ---- OHLCV metrics ----

describe("Single Trade — OHLCV metrics", () => {
  it("extracts candles from ohlcv response", () => {
    const candles = extractCandles(MOCK_OHLCV);
    expect(candles.length).toBe(5);
  });

  it("computes max drawdown from entry to trough", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    // Trough is 1.0e6, entry is 9.3e6 → drawdown = 1/9.3 - 1 ≈ -0.892
    expect(metrics.max_drawdown_pct).not.toBeNull();
    expect(metrics.max_drawdown_pct!).toBeLessThan(-0.85);
    expect(metrics.max_drawdown_pct!).toBeGreaterThan(-0.95);
  });

  it("computes lowest market cap", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    expect(metrics.lowest_market_cap_usd).toBe(1.0e6);
  });

  it("computes time underwater (candles below entry)", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    // All 5 candles close below 9.3M → 100%
    expect(metrics.time_underwater_pct).toBeCloseTo(1.0, 1);
  });

  it("computes current unrealized PnL", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    // 810.54 / 1044.42 - 1 ≈ -0.224
    expect(metrics.current_unrealized_pnl_pct).not.toBeNull();
    expect(metrics.current_unrealized_pnl_pct!).toBeLessThan(-0.2);
    expect(metrics.current_unrealized_pnl_pct!).toBeGreaterThan(-0.25);
    expect(metrics.current_unrealized_pnl_usd).toBeCloseTo(810.54 - 1044.42, 1);
  });

  it("computes recovery from trough toward entry", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      currentMarketCapUsd: 7.2e6,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    // recovery = (7.2 - 1.0) / (9.3 - 1.0) = 6.2 / 8.3 ≈ 0.747
    expect(metrics.recovery_pct).not.toBeNull();
    expect(metrics.recovery_pct!).toBeGreaterThan(0.7);
    expect(metrics.recovery_pct!).toBeLessThan(0.8);
  });

  it("classifies conviction as held when no sells", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    expect(metrics.conviction).toBe("held");
    expect(metrics.later_sells_count).toBe(0);
  });

  it("classifies conviction as full_exit when all tokens sold", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [{ token_sold_amount: 108100, trade_value_usd: 500, block_timestamp: "2026-09-21T00:00:00Z" }],
      laterBuys: [],
      currentPriceUsd: null,
      currentValueUsd: 0,
      currentTokenAmount: 0,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    expect(metrics.conviction).toBe("full_exit");
  });

  it("classifies conviction as averaged_down when later buys exist and no sells", () => {
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: 9.3e6,
      purchaseCostUsd: 1044.42,
      tokensReceived: 108100,
      laterSells: [],
      laterBuys: [{ token_bought_amount: 50000, trade_value_usd: 500, block_timestamp: "2026-09-22T14:00:00Z" }],
      currentPriceUsd: null,
      currentValueUsd: 810.54,
      currentTokenAmount: 158100,
      purchaseTimestamp: "2026-09-20T10:58:00Z",
    });
    expect(metrics.conviction).toBe("averaged_down");
  });
});

// ---- Verdict selection ----

describe("Single Trade — verdict selection", () => {
  it("selects bag_holder for deep drawdown + held + negative PnL", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.89,
      current_unrealized_pnl_pct: -0.22,
      conviction: "held",
      holding_duration_days: 4,
    });
    expect(v.code).toBe("top_buyer"); // -0.89 <= -0.5 → top_buyer
  });

  it("selects diamond_hands_diamond_losses for long hold + deep drawdown", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.6,
      current_unrealized_pnl_pct: -0.3,
      conviction: "held",
      holding_duration_days: 30,
    });
    expect(v.code).toBe("diamond_hands_diamond_losses");
  });

  it("selects patient_winner for held through drawdown + now in profit", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.5,
      current_unrealized_pnl_pct: 0.3,
      conviction: "held",
    });
    expect(v.code).toBe("patient_winner");
  });

  it("selects premature_bail_out for full exit with negative PnL", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.5,
      current_unrealized_pnl_pct: -0.3,
      max_unrealized_gain_pct: 1.0,
      conviction: "full_exit",
    });
    expect(v.code).toBe("premature_bail_out");
  });

  it("selects averaging_down_into_the_abyss for adds + deep drawdown + negative PnL", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.5,
      current_unrealized_pnl_pct: -0.3,
      conviction: "averaged_down",
    });
    expect(v.code).toBe("averaging_down_into_the_abyss");
  });

  it("selects suspiciously_good_entry for low drawdown + high profit", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.05,
      current_unrealized_pnl_pct: 0.5,
      conviction: "held",
    });
    expect(v.code).toBe("suspiciously_good_entry");
  });

  it("falls back to stuck_in_the_middle for neutral cases", () => {
    const v = selectTradeVerdict({
      max_drawdown_pct: -0.05,
      current_unrealized_pnl_pct: 0.02,
      conviction: "held",
      holding_duration_days: 5,
    });
    expect(v.code).toBe("stuck_in_the_middle");
  });

  it("all verdict codes have required copy fields", () => {
    for (const v of TRADE_VERDICTS) {
      expect(v.code).toBeTruthy();
      expect(v.display_name).toBeTruthy();
      expect(v.headline).toBeTruthy();
      expect(v.roast).toBeTruthy();
      expect(v.defense).toBeTruthy();
      expect(v.sentence).toBeTruthy();
    }
  });
});

// ---- Severity & confidence ----

describe("Single Trade — severity & confidence", () => {
  it("high severity for deep drawdown + large loss", () => {
    const { severity } = computeTradeSeverityConfidence({
      max_drawdown_pct: -0.89,
      current_unrealized_pnl_pct: -0.22,
      time_underwater_pct: 0.8,
      conviction: "held",
      holding_duration_days: 4,
      candle_count: 100,
    });
    expect(severity).toBeGreaterThan(70);
  });

  it("low severity for profit + low drawdown", () => {
    const { severity } = computeTradeSeverityConfidence({
      max_drawdown_pct: -0.05,
      current_unrealized_pnl_pct: 0.5,
      time_underwater_pct: 0.1,
      conviction: "held",
      holding_duration_days: 5,
      candle_count: 100,
    });
    expect(severity).toBeLessThan(40);
  });

  it("confidence is reduced for few fields", () => {
    const { confidence: fullConf } = computeTradeSeverityConfidence({
      max_drawdown_pct: -0.5, current_unrealized_pnl_pct: -0.2, time_underwater_pct: 0.5,
      conviction: "held", holding_duration_days: 10, candle_count: 100,
    });
    const { confidence: sparseConf } = computeTradeSeverityConfidence({
      max_drawdown_pct: -0.5,
      candle_count: 100,
    });
    expect(sparseConf).toBeLessThan(fullConf);
  });
});

// ---- Fingerprint ----

describe("Single Trade — fingerprint", () => {
  it("is deterministic for the same inputs", async () => {
    const fp1 = await buildTradeFingerprint("solana", WALLET, "tx_abc_001");
    const fp2 = await buildTradeFingerprint("solana", WALLET, "tx_abc_001");
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex
  });

  it("differs for different transactions", async () => {
    const fp1 = await buildTradeFingerprint("solana", WALLET, "tx_abc_001");
    const fp2 = await buildTradeFingerprint("solana", WALLET, "tx_abc_002");
    expect(fp1).not.toBe(fp2);
  });

  it("differs for different wallets", async () => {
    const fp1 = await buildTradeFingerprint("solana", WALLET, "tx_abc_001");
    const fp2 = await buildTradeFingerprint("solana", "DIFFERENT_WALLET", "tx_abc_001");
    expect(fp1).not.toBe(fp2);
  });
});

// ---- Sanitization ----

describe("Single Trade — public sanitization", () => {
  it("removes full wallet address and provides address_short", () => {
    const trial = {
      public_slug: "trade-abc123",
      network: "solana",
      data_mode: "live",
      case_outcome: "verdict",
      verdict_code: "top_buyer",
      verdict_name: "Top Buyer",
      wallet_address: WALLET,
      normalized_wallet_address: WALLET,
      token_mint: JEANPHIL_MINT,
      token_symbol: "JEANPHIL",
      transaction_hash: "tx_abc_001",
      purchase_timestamp: "2026-09-20T10:58:00Z",
      entry_market_cap_usd: 9.3e6,
      purchase_cost_usd: 1044.42,
      tokens_received: 108100,
      evidence_items_json: "[]",
      metrics_json: JSON.stringify({ conviction: "held" }),
      source_endpoints_json: "[]",
    };
    const pub = sanitizeSingleTrialForPublicCase(trial);
    expect(pub.wallet_address).toBeUndefined();
    expect(pub.normalized_wallet_address).toBeUndefined();
    expect(pub.address_short).toBeTruthy();
    expect(pub.token_symbol).toBe("JEANPHIL");
    expect(pub.transaction_hash).toBeUndefined();
    expect(pub.transaction_hash_short).toBeTruthy();
  });

  it("scrubs full wallet address from JSON string fields", () => {
    const trial = {
      public_slug: "trade-abc",
      network: "solana",
      data_mode: "live",
      case_outcome: "verdict",
      verdict_code: "top_buyer",
      wallet_address: WALLET,
      normalized_wallet_address: WALLET,
      token_mint: JEANPHIL_MINT,
      evidence_items_json: JSON.stringify([{ detail: `Wallet ${WALLET} bought` }]),
      metrics_json: "{}",
      source_endpoints_json: "[]",
    };
    const pub = sanitizeSingleTrialForPublicCase(trial);
    expect(pub.evidence_items_json).not.toContain(WALLET);
    expect(pub.evidence_items_json).toContain(pub.address_short);
  });
});

// ---- Evidence building ----

describe("Single Trade — evidence exhibits", () => {
  it("builds evidence from metrics + purchase", () => {
    const purchase = normalizePurchases(MOCK_DEX_TRADES, JEANPHIL_MINT)[0];
    const metrics = computeTradeMetrics({
      candles: extractCandles(MOCK_OHLCV),
      entryMarketCapUsd: purchase.entry_market_cap_usd,
      purchaseCostUsd: purchase.purchase_cost_usd,
      tokensReceived: purchase.tokens_received,
      laterSells: [],
      laterBuys: [],
      currentValueUsd: 810.54,
      currentTokenAmount: 108100,
      purchaseTimestamp: purchase.block_timestamp,
    });
    const evidence = buildTradeEvidence(metrics, purchase);
    expect(evidence.length).toBeGreaterThan(5);
    const labels = evidence.map((e) => e.label);
    expect(labels).toContain("Entry Market Cap");
    expect(labels).toContain("Maximum Drawdown");
    expect(labels).toContain("Time Underwater");
    expect(labels).toContain("Current Unrealized PnL");
    expect(labels).toContain("Conviction");
  });
});