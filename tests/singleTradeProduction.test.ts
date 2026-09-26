// Wallet Court — Single Trade Trial production regression suite.
// Covers the 19 required tests from the production hardening request.
//
// Pure logic tests import from shared modules directly.
// Store tests use an in-memory mock base44 to verify CAS mutex, retry
// semantics, and concurrency.
// Structural tests read source files to verify wiring.
// No test calls Nansen — all tests use mocks or pure logic.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { isSingleTradeRenderable } from "../base44/shared/singleTradeRenderable.ts";
import { isSingleTradeRenderable as isSingleTradeRenderableClient } from "../src/lib/singleTradeRenderable.js";
import {
  computeTradeMetrics, buildCappedOhlcvSnapshot, validateFieldSize,
  MAX_STORED_CANDLES, MAX_OHLCV_FIELD_CHARS, buildTradeEvidence,
  sanitizeSingleTrialForPublicCase
} from "../base44/shared/singleTradeEvidence.ts";
import { selectTradeVerdict, computeTradeSeverityConfidence } from "../base44/shared/singleTradeVerdicts.ts";
import { computeFifoLotAttribution } from "../base44/shared/singleTradeFifo.ts";
import {
  isSingleTradeSupported, SINGLE_TRADE_CAPABILITIES,
  getSingleTradeCapability
} from "../base44/shared/singleTradeCapability.ts";
import {
  isSingleTradeSupported as isSingleTradeSupportedClient,
  SINGLE_TRADE_CAPABILITIES as CLIENT_CAPABILITIES,
  getSingleTradeCapability as getClientCapability
} from "../src/lib/singleTradeCapability.js";

// ---- Mock base44 factory (same pattern as singleTradeHardening.test.ts) ----

function createMockBase44() {
  const policy: any[] = [];
  const trials: any[] = [];
  const selections: any[] = [];
  let idCounter = 0;

  function matchesQuery(r: any, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        if ("$lte" in value) { if (!r[key] || r[key] > value.$lte) return false; continue; }
        if ("$lt" in value) { if (r[key] === undefined || r[key] >= value.$lt) return false; continue; }
        if ("$gte" in value) { if (!r[key] || r[key] < value.$gte) return false; continue; }
      }
      if (r[key] !== value) return false;
    }
    return true;
  }

  function filterArr(arr: any[], query: any): any[] {
    return arr.filter((r) => matchesQuery(r, query));
  }

  return {
    asServiceRole: {
      entities: {
        SingleTradeUsagePolicy: {
          filter: async (q: any) => filterArr(policy, q).map((r: any) => ({ ...r })),
          create: async (d: any) => { const r = { id: `pol_${++idCounter}`, ...d }; policy.push(r); return r; },
          update: async (id: string, d: any) => {
            const i = policy.findIndex((r) => r.id === id);
            if (i === -1) throw new Error("not found");
            policy[i] = { ...policy[i], ...d }; return policy[i];
          },
          updateMany: async (q: any, u: any) => {
            let updated = 0;
            for (const r of policy) {
              if (matchesQuery(r, q)) {
                if (u.$set) Object.assign(r, u.$set);
                if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) r[k] = (r[k] || 0) + v;
                updated++;
              }
            }
            return { updated };
          },
          get: async (id: string) => { const r = policy.find((r) => r.id === id); return r ? { ...r } : null; }
        },
        SingleTradeTrial: {
          filter: async (q: any, sort?: string, limit?: number) => {
            let results = filterArr(trials, q).map((r: any) => ({ ...r }));
            if (sort && sort.startsWith("-")) results = [...results].reverse();
            if (sort && !sort.startsWith("-")) results = results.sort((a, b) => new Date(a[sort]).getTime() - new Date(b[sort]).getTime());
            if (limit) results = results.slice(0, limit);
            return results;
          },
          create: async (d: any) => { const r = { id: `trl_${++idCounter}`, created_date: new Date().toISOString(), ...d }; trials.push(r); return r; },
          update: async (id: string, d: any) => {
            const i = trials.findIndex((r) => r.id === id);
            if (i === -1) throw new Error("not found");
            trials[i] = { ...trials[i], ...d }; return trials[i];
          },
          updateMany: async (q: any, u: any) => {
            let updated = 0;
            for (const r of trials) {
              if (matchesQuery(r, q)) {
                if (u.$set) Object.assign(r, u.$set);
                if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) r[k] = (r[k] || 0) + v;
                updated++;
              }
            }
            return { updated };
          },
          get: async (id: string) => { const r = trials.find((r) => r.id === id); return r ? { ...r } : null; },
          delete: async (id: string) => { const i = trials.findIndex((r) => r.id === id); if (i !== -1) trials.splice(i, 1); }
        },
        SingleTradePurchaseSelection: {
          filter: async (q: any, sort?: string, limit?: number) => {
            let results = filterArr(selections, q).map((r: any) => ({ ...r }));
            if (sort && sort.startsWith("-")) results = [...results].reverse();
            if (limit) results = results.slice(0, limit);
            return results;
          },
          create: async (d: any) => { const r = { id: `sel_${++idCounter}`, ...d }; selections.push(r); return r; },
          update: async (id: string, d: any) => {
            const i = selections.findIndex((r) => r.id === id);
            if (i === -1) throw new Error("not found");
            selections[i] = { ...selections[i], ...d }; return selections[i];
          },
          updateMany: async (q: any, u: any) => {
            let updated = 0;
            for (const r of selections) {
              if (matchesQuery(r, q)) {
                if (u.$set) Object.assign(r, u.$set);
                if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) r[k] = (r[k] || 0) + v;
                updated++;
              }
            }
            return { updated };
          },
          get: async (id: string) => { const r = selections.find((r) => r.id === id); return r ? { ...r } : null; }
        }
      }
    },
    _policy: policy,
    _trials: trials,
    _selections: selections
  };
}

// ---- Exact production failed-trial shape (from the live JEANPHIL failure) ----

const PRODUCTION_FAILED_TRIAL = {
  id: "6ab5d886d0fcf97bd9bf9b77",
  trial_type: "single_trade",
  wallet_address: "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1",
  normalized_wallet_address: "8qisffwsucpzhl3afgwt1ychsk3aguyxkmwstwtturqu1",
  network: "solana",
  token_mint: "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump",
  token_symbol: "JEANPHIL",
  transaction_hash: "5WJrqxuXekEG6CSGZQWnzZZoL66CUVU6gSvk1AJM37SqRzjLLdiERx1YV3VBrQkTKDEtW5Wu9P3uN3tn1WniZjd1",
  trade_fingerprint: "cb77903fa105e167b1933f2f5b11639bf08dd36b6adea458f45e8d45d1cbd5d0",
  purchase_timestamp: "2026-09-20T16:58:32Z",
  entry_price_usd: 0.00969,
  entry_market_cap_usd: null,
  tokens_received: 108118,
  purchase_cost_usd: 1048.08,
  status: "failed",
  data_mode: "live",
  case_outcome: null,
  verdict_code: null,
  verdict_name: null,
  severity_score: null,
  confidence_score: null,
  headline: null,
  roast: null,
  defense_statement: null,
  sentence: null,
  evidence_items_json: "[]",
  metrics_json: "{}",
  ohlcv_snapshot_json: "[]",
  refresh_snapshots_json: "[]",
  source_endpoints_json: "[]",
  public_slug: "trade-6iitjk72sg68",
  error_code: "analysis_error",
  error_message: "Field 'ohlcv_snapshot_json' exceeds the maximum allowed size.",
  analyzed_at: "2026-09-25T02:12:26.828Z",
  version: 0,
};

// ============================================================
// 1. Exact production failed-trial shape cannot render
// ============================================================

describe("Production hardening — failed-trial shape", () => {
  it("1. Exact production failed-trial shape cannot render (backend gate)", () => {
    expect(isSingleTradeRenderable(PRODUCTION_FAILED_TRIAL)).toBe(false);
  });

  it("1b. Exact production failed-trial shape cannot render (frontend gate)", () => {
    const sanitized = sanitizeSingleTrialForPublicCase(PRODUCTION_FAILED_TRIAL);
    expect(isSingleTradeRenderableClient(sanitized)).toBe(false);
  });
});

// ============================================================
// 2 & 3. Null verdict never becomes GUILTY; null numerics never become zero
// ============================================================

describe("Production hardening — null safety", () => {
  it("2. Null verdict never becomes GUILTY (verdict_code=null is not renderable)", () => {
    const nullVerdict = { ...PRODUCTION_FAILED_TRIAL, status: "completed", case_outcome: "verdict", verdict_code: null, verdict_name: null };
    expect(isSingleTradeRenderable(nullVerdict)).toBe(false);
  });

  it("3. Null numeric values never become zero (severity_score=null is not renderable)", () => {
    const nullSeverity = {
      ...PRODUCTION_FAILED_TRIAL,
      status: "completed", case_outcome: "verdict",
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      severity_score: null, confidence_score: 85,
      headline: "H", roast: "R", sentence: "S",
      evidence_items_json: '[{"tag":"x"}]',
      metrics_json: '{"max_drawdown_pct":-0.5}',
      source_endpoints_json: '["nansen:dex_trades:live"]',
    };
    expect(isSingleTradeRenderable(nullSeverity)).toBe(false);
  });
});

// ============================================================
// 4. Failed slug is blocked by the backend
// ============================================================

describe("Production hardening — backend slug blocking", () => {
  it("4. getSingleTradeBySlug blocks the failed slug (structural check)", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/getSingleTradeBySlug/entry.ts"), "utf-8");
    expect(src).toContain("isSingleTradeRenderable");
    expect(src).toMatch(/isSingleTradeRenderable\(trial\)/);
    // Must return 404 when not renderable.
    expect(src).toMatch(/status:\s*404/);
  });
});

// ============================================================
// 5. Cached frontend state cannot bypass backend validation
// ============================================================

describe("Production hardening — cached state bypass", () => {
  it("5. SingleTradeCase checks isSingleTradeRenderable on every render (not just on fetch)", () => {
    const src = readFileSync(join(__dirname, "../src/pages/SingleTradeCase.jsx"), "utf-8");
    // The frontend must check renderability in the done state, not just in the fetch handler.
    expect(src).toContain("isSingleTradeRenderable(result.trial)");
    expect(src).toContain("isSingleTradeRenderable(trial)");
    // Must use SingleTradeVerdict (not VerdictReveal).
    expect(src).toContain("SingleTradeVerdict");
    expect(src).not.toContain("VerdictReveal");
  });

  it("5b. SingleTradeIntake checks renderability before rendering done state", () => {
    const src = readFileSync(join(__dirname, "../src/components/walletcourt/SingleTradeIntake.jsx"), "utf-8");
    expect(src).toContain("isSingleTradeRenderable");
    expect(src).toContain("SingleTradeVerdict");
    expect(src).not.toContain("VerdictReveal");
  });
});

// ============================================================
// 6, 7, 8, 9. Failed-trial retry semantics (CAS-safe)
// ============================================================

describe("Production hardening — retry semantics", () => {
  async function setupMockWithFailedTrial() {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    // Pre-create a failed trial.
    mock._trials.push({
      id: "trl_failed", status: "failed", case_outcome: null,
      verdict_code: null, verdict_name: null, severity_score: null,
      confidence_score: null, headline: null, roast: null, sentence: null,
      evidence_items_json: "[]", metrics_json: "{}", ohlcv_snapshot_json: "[]",
      source_endpoints_json: "[]", refresh_snapshots_json: "[]",
      trade_fingerprint: "fp_retry_test", public_slug: "trade-failed-old",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1",
      version: 0, created_date: "2026-09-25T00:00:00.000Z",
    });
    return mock;
  }

  it("6. Failed fingerprint creates one fresh retry attempt", async () => {
    const mock = await setupMockWithFailedTrial();
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const result = await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_retry_test", public_slug: "trade-retry-new",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    expect(result.created).toBe(true);
    expect(result.trial).toBeTruthy();
    expect(result.trial.status).toBe("analyzing");
    expect(result.trial.public_slug).toBe("trade-retry-new");
    // The original failed trial is still there, unchanged.
    const failed = mock._trials.find((t) => t.id === "trl_failed");
    expect(failed).toBeTruthy();
    expect(failed.status).toBe("failed");
  });

  it("7. Completed fingerprint remains idempotent (zero new trials)", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    // Pre-create a completed trial.
    mock._trials.push({
      id: "trl_done", status: "completed", case_outcome: "verdict",
      trade_fingerprint: "fp_done", public_slug: "trade-done",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1",
      version: 0, created_date: "2026-09-25T00:00:00.000Z",
    });
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const result = await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_done", public_slug: "trade-should-not-create",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    expect(result.created).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.trial.id).toBe("trl_done");
    expect(mock._trials.length).toBe(1); // no new trial created
  });

  it("8. Processing (analyzing) fingerprint cannot duplicate", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    mock._trials.push({
      id: "trl_analyzing", status: "analyzing", case_outcome: null,
      trade_fingerprint: "fp_analyzing", public_slug: "trade-analyzing",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1",
      version: 0, created_date: "2026-09-25T00:00:00.000Z",
    });
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const result = await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_analyzing", public_slug: "trade-should-not-create",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    expect(result.created).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(mock._trials.length).toBe(1);
  });

  it("9. Twenty-five concurrent retries create exactly one winner", async () => {
    const mock = await setupMockWithFailedTrial();
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const fields = {
      trade_fingerprint: "fp_retry_test", public_slug: "trade-concurrent-retry",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    };
    const results = await Promise.all(Array.from({ length: 25 }, () => findOrCreateTrial(mock, fields)));
    const winners = results.filter((r) => r.created);
    const duplicates = results.filter((r) => r.duplicate);
    // Exactly one new trial created (plus the original failed trial = 2 total).
    expect(mock._trials.filter((t) => t.status !== "failed").length).toBe(1);
    expect(winners.length).toBe(1);
    // The rest are duplicates (they see the new analyzing trial).
    expect(duplicates.length + winners.length).toBe(25);
    // Lock is released.
    expect(mock._policy[0].creation_lock_id).toBeNull();
  });
});

// ============================================================
// 10 & 11. Selection consumed exactly once; original failed trial unchanged
// ============================================================

describe("Production hardening — selection and failed-trial immutability", () => {
  it("10. Selection is consumed exactly once (concurrent)", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1"
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeSelection(mock, "sel_1", "0xabc", "MINT1")));
    const winners = results.filter((r) => r.consumed);
    expect(winners.length).toBe(1);
  });

  it("11. Original failed trial remains unchanged after retry", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    mock._trials.push({
      id: "trl_failed", status: "failed", case_outcome: null,
      verdict_code: null, verdict_name: null, severity_score: null,
      confidence_score: null, headline: null, roast: null, sentence: null,
      evidence_items_json: "[]", metrics_json: "{}", ohlcv_snapshot_json: "[]",
      source_endpoints_json: "[]", refresh_snapshots_json: "[]",
      trade_fingerprint: "fp_immutable", public_slug: "trade-failed-old",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1",
      version: 5, created_date: "2026-09-25T00:00:00.000Z",
      error_code: "analysis_error", error_message: "original error",
    });
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_immutable", public_slug: "trade-retry",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    // The original failed trial is unchanged.
    const failed = mock._trials.find((t) => t.id === "trl_failed");
    expect(failed.status).toBe("failed");
    expect(failed.version).toBe(5);
    expect(failed.error_code).toBe("analysis_error");
    expect(failed.public_slug).toBe("trade-failed-old");
  });
});

// ============================================================
// 12 & 13. OHLCV metrics + snapshot size
// ============================================================

describe("Production hardening — OHLCV capping and metrics", () => {
  // Generate a large candle series (e.g., 2000 1h candles = ~83 days).
  function generateCandles(count: number): any[] {
    const candles: any[] = [];
    const base = new Date("2026-09-20T16:58:32Z").getTime();
    for (let i = 0; i < count; i++) {
      const price = 0.01 * (1 - i * 0.0003 + Math.sin(i / 10) * 0.001);
      candles.push({
        interval_start: new Date(base + i * 3600000).toISOString(),
        open: price, high: price * 1.02, low: price * 0.98, close: price * 0.99,
        volume: 50000, volume_usd: 50000,
        market_cap: { open: price * 1e7, high: price * 1.02e7, low: price * 0.98e7, close: price * 0.99e7 },
      });
    }
    return candles;
  }

  it("12. Full OHLCV metrics use the full series (not the capped snapshot)", () => {
    const candles = generateCandles(2000);
    const metrics = computeTradeMetrics({
      candles,
      entryMarketCapUsd: 100000, purchaseCostUsd: 1000, tokensReceived: 100000,
      laterSells: [], laterBuys: [],
      currentPriceUsd: 0.005, currentValueUsd: 500, currentTokenAmount: 100000,
      currentMarketCapUsd: null, purchaseTimestamp: "2026-09-20T16:58:32Z"
    });
    // Metrics are computed from all 2000 candles (filtered to post-entry).
    expect(metrics.candle_count).toBe(2000);
    expect(metrics.max_drawdown_pct).not.toBeNull();
    expect(metrics.holding_duration_days).not.toBeNull();
  });

  it("13. Stored OHLCV snapshot remains under the entity limit", () => {
    const candles = generateCandles(2000);
    const snapshot = buildCappedOhlcvSnapshot(candles);
    // The stored snapshot must be under the field size limit.
    expect(snapshot.json.length).toBeLessThan(MAX_OHLCV_FIELD_CHARS);
    // The stored count must be at most MAX_STORED_CANDLES.
    expect(snapshot.storedCount).toBeLessThanOrEqual(MAX_STORED_CANDLES);
    // The original count is recorded.
    expect(snapshot.originalCount).toBe(2000);
    // The snapshot is valid JSON.
    expect(() => JSON.parse(snapshot.json)).not.toThrow();
  });

  it("13b. buildCappedOhlcvSnapshot records sampling method", () => {
    const small = generateCandles(50);
    const snap1 = buildCappedOhlcvSnapshot(small);
    expect(snap1.samplingMethod).toBe("none");
    expect(snap1.storedCount).toBe(50);

    const large = generateCandles(500);
    const snap2 = buildCappedOhlcvSnapshot(large);
    expect(snap2.samplingMethod).toBe("even");
    expect(snap2.storedCount).toBeLessThanOrEqual(MAX_STORED_CANDLES);
  });

  it("13c. validateFieldSize rejects oversized fields", () => {
    expect(validateFieldSize("[]")).toBe(true);
    expect(validateFieldSize("x".repeat(MAX_OHLCV_FIELD_CHARS + 1))).toBe(false);
    expect(validateFieldSize("x".repeat(MAX_OHLCV_FIELD_CHARS))).toBe(true);
  });
});

// ============================================================
// 14. Production-like Nansen payload creates a complete presentation model
// ============================================================

describe("Production hardening — production-like payload", () => {
  // Known JEANPHIL purchase details (acceptance-test expectations).
  const JEANPHIL_WALLET = "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1";
  const JEANPHIL_MINT = "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump";
  const JEANPHIL_SYMBOL = "JEANPHIL";
  const JEANPHIL_PURCHASE_TS = "2026-09-20T16:58:32Z";
  const JEANPHIL_TOKENS = 108118;
  const JEANPHIL_COST = 1048.08;
  const JEANPHIL_ENTRY_PRICE = 0.00969;

  // Simulate a production-like Nansen OHLCV + DEX response.
  function generateProductionCandles(count: number): any[] {
    const candles: any[] = [];
    const base = new Date(JEANPHIL_PURCHASE_TS).getTime();
    for (let i = 0; i < count; i++) {
      // Simulate a drawdown: price drops from 0.00969 to ~0.002 over the period.
      const drawdown = 1 - (i / count) * 0.8;
      const price = JEANPHIL_ENTRY_PRICE * drawdown;
      candles.push({
        interval_start: new Date(base + i * 3600000).toISOString(),
        open: price, high: price * 1.03, low: price * 0.97, close: price * 0.995,
        volume: 50000, volume_usd: 50000,
        market_cap: { open: price * 1e7, high: price * 1.03e7, low: price * 0.97e7, close: price * 0.995e7 },
      });
    }
    return candles;
  }

  it("14. Production-like Nansen payload creates a complete presentation model", () => {
    const candles = generateProductionCandles(500);
    const purchase = {
      transaction_hash: "tx_jeanphil",
      block_timestamp: JEANPHIL_PURCHASE_TS,
      token_bought_address: JEANPHIL_MINT,
      token_bought_symbol: JEANPHIL_SYMBOL,
      tokens_received: JEANPHIL_TOKENS,
      purchase_cost_usd: JEANPHIL_COST,
      entry_market_cap_usd: 100000,
      trade_value_usd: JEANPHIL_COST,
      entry_price_usd: JEANPHIL_ENTRY_PRICE,
    };

    const metrics = computeTradeMetrics({
      candles,
      entryMarketCapUsd: purchase.entry_market_cap_usd,
      purchaseCostUsd: purchase.purchase_cost_usd,
      tokensReceived: purchase.tokens_received,
      laterSells: [], laterBuys: [],
      currentPriceUsd: 0.002, currentValueUsd: 216, currentTokenAmount: JEANPHIL_TOKENS,
      currentMarketCapUsd: null, purchaseTimestamp: JEANPHIL_PURCHASE_TS
    });

    const fifo = computeFifoLotAttribution({
      entryTokens: purchase.tokens_received,
      entryCostUsd: purchase.purchase_cost_usd,
      entryTimestamp: JEANPHIL_PURCHASE_TS,
      laterBuys: [], laterSells: [],
      currentPriceUsd: 0.002
    });

    const verdict = selectTradeVerdict(metrics);
    const { severity, confidence } = computeTradeSeverityConfidence(metrics);
    const evidence = buildTradeEvidence(metrics, purchase as any);
    const snapshot = buildCappedOhlcvSnapshot(candles);

    // The verdict must be a real verdict (not null/GUILTY).
    expect(verdict.code).toBeTruthy();
    expect(verdict.display_name).toBeTruthy();
    expect(verdict.roast).toBeTruthy();
    expect(verdict.sentence).toBeTruthy();

    // Severity and confidence must be finite and in range.
    expect(Number.isFinite(severity)).toBe(true);
    expect(severity).toBeGreaterThanOrEqual(0);
    expect(severity).toBeLessThanOrEqual(100);
    expect(Number.isFinite(confidence)).toBe(true);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(100);

    // Evidence must be a non-empty array.
    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.length).toBeGreaterThan(0);

    // Metrics must have the required fields.
    expect(metrics.max_drawdown_pct).not.toBeNull();
    expect(metrics.holding_duration_days).not.toBeNull();
    expect(metrics.conviction).toBeTruthy();
    expect(metrics.candle_count).toBe(500);

    // FIFO: simple case (one buy, no sells) → exact attribution.
    expect(fifo.lot_attribution_complex).toBe(false);
    expect(fifo.selected_lot_remaining_quantity).toBe(JEANPHIL_TOKENS);

    // Snapshot must be under the limit.
    expect(snapshot.json.length).toBeLessThan(MAX_OHLCV_FIELD_CHARS);

    // Build a trial record and verify it's renderable.
    const trial = {
      status: "completed", case_outcome: "verdict",
      verdict_code: verdict.code, verdict_name: verdict.display_name,
      severity_score: severity, confidence_score: confidence,
      headline: verdict.headline, roast: verdict.roast,
      defense_statement: verdict.defense, sentence: verdict.sentence,
      evidence_items_json: JSON.stringify(evidence),
      metrics_json: JSON.stringify({ ...metrics, ...fifo, _meta: { candle_count: metrics.candle_count, original_candle_count: snapshot.originalCount, stored_candle_count: snapshot.storedCount } }),
      source_endpoints_json: JSON.stringify(["nansen:dex_trades:live", "nansen:token_ohlcv:live", "nansen:current_balance:live"]),
      purchase_cost_usd: JEANPHIL_COST, tokens_received: JEANPHIL_TOKENS,
    };
    expect(isSingleTradeRenderable(trial)).toBe(true);
  });
});

// ============================================================
// 15. Receipts and share cards reject incomplete cases
// ============================================================

describe("Production hardening — receipt rejection", () => {
  it("15. drawCourtReceipt rejects incomplete verdict trials (structural check)", () => {
    const src = readFileSync(join(__dirname, "../src/lib/courtReceipt.js"), "utf-8");
    // Must check for null/missing verdict fields before rendering.
    expect(src).toContain("incomplete trade cases");
    expect(src).toMatch(/verdict_name.*roast.*sentence|!trial\.verdict_name.*!trial\.roast.*!trial\.sentence/);
  });
});

// ============================================================
// 16. Whole Wallet case rendering remains unchanged
// ============================================================

describe("Production hardening — whole-wallet unchanged", () => {
  it("16. Whole-wallet Case.jsx does not import Single Trade components", () => {
    const src = readFileSync(join(__dirname, "../src/pages/Case.jsx"), "utf-8");
    expect(src).not.toContain("SingleTradeVerdict");
    expect(src).not.toContain("isSingleTradeRenderable");
    expect(src).toContain("VerdictReveal");
  });

  it("16b. Whole-wallet VerdictReveal.jsx does not import Single Trade components", () => {
    const src = readFileSync(join(__dirname, "../src/components/walletcourt/VerdictReveal.jsx"), "utf-8");
    expect(src).not.toContain("SingleTradeVerdict");
    expect(src).not.toContain("singleTradeRenderable");
  });
});

// ============================================================
// 17. Capability registry parity between backend and frontend
// ============================================================

describe("Production hardening — capability registry parity", () => {
  it("17. Backend and frontend capability registries have the same networks", () => {
    const backendNetworks = SINGLE_TRADE_CAPABILITIES.map((c) => c.network).sort();
    const frontendNetworks = CLIENT_CAPABILITIES.map((c) => c.network).sort();
    expect(backendNetworks).toEqual(frontendNetworks);
  });

  it("17b. Backend and frontend isSingleTradeSupported agree for all networks", () => {
    for (const net of ["solana", "ethereum", "base", "robinhood"]) {
      expect(isSingleTradeSupported(net)).toBe(isSingleTradeSupportedClient(net));
    }
  });

  it("17c. Backend and frontend capability details match for each network", () => {
    for (const cap of SINGLE_TRADE_CAPABILITIES) {
      const clientCap = getClientCapability(cap.network);
      expect(clientCap).toBeTruthy();
      expect(clientCap.discoveryAvailable).toBe(cap.discoveryAvailable);
      expect(clientCap.ohlcvAvailable).toBe(cap.ohlcvAvailable);
      expect(clientCap.balanceAvailable).toBe(cap.balanceAvailable);
    }
  });
});

// ============================================================
// 18. Unsupported networks make zero physical calls
// ============================================================

describe("Production hardening — unsupported networks", () => {
  it("18. analyzeSingleTrade rejects unsupported networks before any Nansen call (structural)", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/analyzeSingleTrade/entry.ts"), "utf-8");
    // Must use the capability registry, not a hardcoded "solana" check.
    expect(src).toContain("isSingleTradeSupported");
    expect(src).not.toMatch(/network !== "solana"/);
    // Must return UNSUPPORTED_CHAIN before any Nansen call.
    expect(src).toContain("UNSUPPORTED_CHAIN");
  });

  it("18b. discoverTokenPurchases rejects unsupported networks before any Nansen call (structural)", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/discoverTokenPurchases/entry.ts"), "utf-8");
    expect(src).toContain("isSingleTradeSupported");
    expect(src).not.toMatch(/network !== "solana"/);
  });

  it("18c. Robinhood is not supported for Single Trade", () => {
    expect(isSingleTradeSupported("robinhood")).toBe(false);
    const cap = getSingleTradeCapability("robinhood");
    expect(cap).toBeTruthy();
    expect(cap!.discoveryAvailable).toBe(false);
    expect(cap!.ohlcvAvailable).toBe(false);
  });

  it("18d. Solana, Ethereum, and Base are supported for Single Trade", () => {
    expect(isSingleTradeSupported("solana")).toBe(true);
    expect(isSingleTradeSupported("ethereum")).toBe(true);
    expect(isSingleTradeSupported("base")).toBe(true);
  });
});

// ============================================================
// 19. Automated tests make zero live Nansen calls
// ============================================================

describe("Production hardening — zero live Nansen calls in tests", () => {
  it("19. No test file imports from nansen.ts (live Nansen functions)", () => {
    const testFiles = [
      "singleTradeProduction.test.ts",
      "singleTradeRenderable.test.ts",
      "singleTradeHardening.test.ts",
      "singleTradeDiscovery.test.ts",
      "singleTradeEvidence.test.ts",
    ];
    for (const f of testFiles) {
      const src = readFileSync(join(__dirname, f), "utf-8");
      // Tests must not import from nansen.ts (which exports live fetch functions).
      // nansenTelemetry.ts is OK — it's pure logic with no network calls.
      expect(src).not.toMatch(/from\s+["'].*nansen\.ts["']/);
    }
  });
});