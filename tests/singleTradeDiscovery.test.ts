// Wallet Court — Single Trade Trial discovery + analysis regression test.
// Reproduces the production Solana discovery path with a mocked Nansen
// response matching the scenario that caused the live HTTP 500:
//   - discoverTokenPurchases returns a large purchase list
//   - analyzeSingleTrade fetches a LARGE OHLCV series (thousands of 1h candles)
//   - The OHLCV snapshot must be capped before storage to avoid exceeding
//     the entity field size limit.
//
// No live Nansen calls are made. All Nansen responses are mocked.
//
// This test verifies:
//   1. capCandles reduces a large candle array to MAX_STORED_CANDLES.
//   2. capCandles preserves first and last candles.
//   3. capCandles is a no-op for small arrays.
//   4. The discovery workflow "single_trade_discovery" is in ALLOWED_WORKFLOWS
//      (not sanitized to "unknown").
//   5. Backend catch blocks return a `code` field.
//   6. The stored ohlcv_snapshot_json is capped (structural test on source).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  capCandles,
  MAX_STORED_CANDLES,
  extractCandles,
  normalizePurchases,
  sanitizePurchaseForPublic,
  type OhlcvCandle
} from "../base44/shared/singleTradeEvidence.ts";

import { sanitizeWorkflow, ALLOWED_WORKFLOWS } from "../base44/shared/nansenTelemetry.ts";

// ---- capCandles pure logic ----

describe("Single Trade — capCandles", () => {
  function makeCandle(i: number): OhlcvCandle {
    return {
      interval_start: new Date(Date.now() + i * 3600000).toISOString(),
      open: 1 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 1000 + i,
      volume_usd: 1000 + i,
      market_cap: { open: 1e6, high: 1.1e6, low: 0.9e6, close: 1.05e6 }
    };
  }

  it("caps a large array to MAX_STORED_CANDLES", () => {
    const candles = Array.from({ length: 5000 }, (_, i) => makeCandle(i));
    const capped = capCandles(candles);
    expect(capped.length).toBe(MAX_STORED_CANDLES);
  });

  it("preserves the first and last candles", () => {
    const candles = Array.from({ length: 5000 }, (_, i) => makeCandle(i));
    const capped = capCandles(candles);
    expect(capped[0]).toBe(candles[0]);
    expect(capped[capped.length - 1]).toBe(candles[candles.length - 1]);
  });

  it("is a no-op for arrays within the limit", () => {
    const candles = Array.from({ length: 100 }, (_, i) => makeCandle(i));
    const capped = capCandles(candles);
    expect(capped.length).toBe(100);
    expect(capped).toBe(candles); // same reference, no copy
  });

  it("is a no-op for empty arrays", () => {
    expect(capCandles([])).toEqual([]);
  });

  it("handles exactly MAX_STORED_CANDLES (no cap)", () => {
    const candles = Array.from({ length: MAX_STORED_CANDLES }, (_, i) => makeCandle(i));
    const capped = capCandles(candles);
    expect(capped.length).toBe(MAX_STORED_CANDLES);
    expect(capped).toBe(candles);
  });

  it("produces evenly sampled candles (no duplicates)", () => {
    const candles = Array.from({ length: 3000 }, (_, i) => makeCandle(i));
    const capped = capCandles(candles, 300);
    // All candles should be distinct (no duplicates from rounding).
    const indices = new Set(capped.map((c) => c.interval_start));
    expect(indices.size).toBe(capped.length);
  });

  it("the capped JSON is much smaller than the full JSON", () => {
    const candles = Array.from({ length: 5000 }, (_, i) => makeCandle(i));
    const fullJson = JSON.stringify(candles);
    const cappedJson = JSON.stringify(capCandles(candles));
    expect(cappedJson.length).toBeLessThan(fullJson.length / 10);
    // Capped JSON should be well under 100KB (entity field limit).
    expect(cappedJson.length).toBeLessThan(100000);
  });
});

// ---- Workflow sanitization ----

describe("Single Trade — discovery workflow in ALLOWED_WORKFLOWS", () => {
  it("single_trade_discovery is in the allowed set", () => {
    expect(ALLOWED_WORKFLOWS.has("single_trade_discovery")).toBe(true);
  });

  it("sanitizeWorkflow preserves single_trade_discovery", () => {
    expect(sanitizeWorkflow("single_trade_discovery")).toBe("single_trade_discovery");
  });

  it("sanitizeWorkflow preserves single_trade_analysis", () => {
    expect(sanitizeWorkflow("single_trade_analysis")).toBe("single_trade_analysis");
  });
});

// ---- Structural: analyzeSingleTrade uses capCandles ----

const analyzeSrc = readFileSync(join(__dirname, "../base44/functions/analyzeSingleTrade/entry.ts"), "utf-8");
const discoverSrc = readFileSync(join(__dirname, "../base44/functions/discoverTokenPurchases/entry.ts"), "utf-8");

describe("Single Trade — analyzeSingleTrade uses capCandles for ohlcv storage", () => {
  it("imports capCandles from singleTradeEvidence", () => {
    expect(analyzeSrc).toContain("capCandles");
    expect(analyzeSrc).toContain("from \"../../shared/singleTradeEvidence.ts\"");
  });

  it("wraps ohlcv_snapshot_json with capCandles (both paths)", () => {
    // Should appear twice: mistrial path + verdict path.
    const matches = analyzeSrc.match(/capCandles\(candles\)/g) || [];
    expect(matches.length).toBe(2);
  });

  it("does NOT store raw JSON.stringify(candles) without capCandles", () => {
    // Every ohlcv_snapshot_json assignment that uses JSON.stringify(candles)
    // must wrap it with capCandles. The initial creation uses "[]" (empty).
    const lines = analyzeSrc.split("\n");
    for (const line of lines) {
      if (line.includes("ohlcv_snapshot_json:") && line.includes("JSON.stringify")) {
        expect(line).toContain("capCandles");
      }
    }
  });

  it("catch block returns a code field", () => {
    expect(analyzeSrc).toContain("code: \"ANALYSIS_ERROR\"");
  });
});

describe("Single Trade — discoverTokenPurchases catch block returns a code", () => {
  it("catch block returns a code field", () => {
    expect(discoverSrc).toContain("code: \"DISCOVERY_ERROR\"");
  });
});

// ---- Frontend error extraction (structural) ----

describe("Single Trade — frontend extracts backend error from Base44Error", () => {
  const intakeSrc = readFileSync(join(__dirname, "../src/components/walletcourt/SingleTradeIntake.jsx"), "utf-8");

  it("discovery catch extracts e.data.error before e.message", () => {
    expect(intakeSrc).toContain("e?.data?.error");
  });

  it("analysis catch extracts e.data.error before e.message", () => {
    // Both catch blocks should use e?.data?.error.
    const matches = intakeSrc.match(/e\?\.data\?\.error/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- Mocked Nansen response: large OHLCV → capped storage ----

describe("Single Trade — large OHLCV response is capped for storage", () => {
  // Simulate a production-like Nansen token-ohlcv response with 5000 candles.
  function makeLargeOhlcvResponse(count: number): any {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        interval_start: new Date(Date.now() - (count - i) * 3600000).toISOString(),
        open: 0.05 + i * 0.0001,
        high: 0.06 + i * 0.0001,
        low: 0.04 + i * 0.0001,
        close: 0.055 + i * 0.0001,
        volume: 10000 + i * 10,
        volume_usd: 500 + i,
        market_cap: {
          open: 5e6 + i * 10000,
          high: 6e6 + i * 10000,
          low: 4e6 + i * 10000,
          close: 5.5e6 + i * 10000
        }
      });
    }
    return { data };
  }

  it("extractCandles + capCandles reduces 5000 candles to 300", () => {
    const mockResponse = makeLargeOhlcvResponse(5000);
    const candles = extractCandles(mockResponse);
    expect(candles.length).toBe(5000);
    const capped = capCandles(candles);
    expect(capped.length).toBe(MAX_STORED_CANDLES);
    // The capped JSON is small enough for entity storage.
    const json = JSON.stringify(capped);
    expect(json.length).toBeLessThan(100000);
  });

  it("normalizePurchases handles a production-like dex-trades response", () => {
    const mint = "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump";
    const mockDexTrades = {
      data: [
        {
          transaction_hash: "5xK9pQm2VtKEHFEbLn7mQ4g5KqXKfY2pLmNzZ3vQwR5o1234567890abcdef",
          block_timestamp: "2026-09-20T00:00:00Z",
          token_bought_address: mint,
          token_bought_symbol: "JEANPHIL",
          token_bought_amount: 1000,
          token_sold_address: "So11111111111111111111111111111111111111112",
          token_sold_symbol: "SOL",
          token_sold_amount: 0.5,
          trade_value_usd: 50,
          token_bought_market_cap: 100000,
          token_bought_fdv: 100000
        }
      ]
    };
    const purchases = normalizePurchases(mockDexTrades, mint);
    expect(purchases.length).toBe(1);
    expect(purchases[0].transaction_hash).toBeTruthy();
    expect(purchases[0].purchase_cost_usd).toBe(50);
    expect(purchases[0].tokens_received).toBe(1000);
    expect(purchases[0].entry_price_usd).toBeCloseTo(0.05, 4);

    // Sanitize for public — must not expose the full transaction hash.
    const pub = sanitizePurchaseForPublic(purchases[0]);
    expect(pub.transaction_hash).toBeUndefined();
    expect(pub.transaction_hash_short).toBeTruthy();
    expect(pub.transaction_hash_short).not.toContain(purchases[0].transaction_hash);
  });
});