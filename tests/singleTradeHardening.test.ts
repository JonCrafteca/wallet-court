// Wallet Court — Single Trade Trial hardening regression suite.
// Covers all 9 hardening requirements: separate usage policy, feature flag,
// CAS mutex idempotency, secure purchase selection, privacy, FIFO lot
// accounting, refresh, and structural tests proving the legacy 1,020 ceiling
// is not used.
//
// Pure logic tests import from shared modules directly.
// Store tests use an in-memory mock base44 to verify CAS mutex, budget
// reservation, selection consumption, and concurrency.
// Structural tests read source files to verify wiring.
// No test calls Nansen.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  defaultUsagePolicy,
  todayUtcStr,
  needsDailyReset,
  canReserveCall,
  canDiscover,
  canAnalyze,
  canReclaimCreationLock,
  buildCreationLockCasFilter,
  buildReserveCallCasFilter,
  buildReserveCallCasUpdate,
  buildDailyResetCas,
  sanitizePolicyForAdmin,
  CREATION_LOCK_STALE_TIMEOUT_MS,
  CONTROL_KEY
} from "../base44/shared/singleTradeUsagePolicy.ts";

import {
  computeFifoLotAttribution,
  LOT_ACCOUNTING_METHOD
} from "../base44/shared/singleTradeFifo.ts";

import {
  sanitizeSingleTrialForPublicCase,
  sanitizePurchaseForPublic,
  buildTradeFingerprint
} from "../base44/shared/singleTradeEvidence.ts";

// ---- Mock base44 factory ----

function createMockBase44() {
  const policy: any[] = [];
  const trials: any[] = [];
  const selections: any[] = [];
  let idCounter = 0;

  function matchesQuery(r: any, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === "$or") {
        if (!Array.isArray(value) || !value.some((sub: any) => matchesQuery(r, sub))) return false;
        continue;
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        if ("$lte" in value) { if (!r[key] || r[key] > value.$lte) return false; continue; }
        if ("$lt" in value) { if (r[key] === undefined || r[key] >= value.$lt) return false; continue; }
        if ("$gte" in value) { if (!r[key] || r[key] < value.$gte) return false; continue; }
        if ("$ne" in value) { if (r[key] === value.$ne) return false; continue; }
        if ("$exists" in value) { const has = r[key] !== undefined; if (has !== value.$exists) return false; continue; }
        if ("$in" in value) { if (!Array.isArray(value.$in) || !value.$in.includes(r[key])) return false; continue; }
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

// ============================================================
// 1. USAGE POLICY — pure logic
// ============================================================

describe("Single Trade — usage policy pure logic", () => {
  it("defaultUsagePolicy has enabled=false, emergency_stop=false, daily limit 100", () => {
    const d = defaultUsagePolicy();
    expect(d.enabled).toBe(false);
    expect(d.emergency_stop).toBe(false);
    expect(d.daily_physical_call_limit).toBe(100);
    expect(d.physical_calls_used_today).toBe(0);
    expect(d.discoveries_per_wallet_per_hour).toBe(3);
    expect(d.analyses_per_wallet_per_day).toBe(5);
  });

  it("canReserveCall blocks when enabled is false", () => {
    const p = { ...defaultUsagePolicy(), enabled: false };
    expect(canReserveCall(p).allowed).toBe(false);
  });

  it("canReserveCall blocks when emergency_stop is true", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, emergency_stop: true };
    expect(canReserveCall(p).allowed).toBe(false);
    expect(canReserveCall(p).reason).toContain("Emergency stop");
  });

  it("canReserveCall blocks when daily limit is reached", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, physical_calls_used_today: 100, usage_date: todayUtcStr() };
    expect(canReserveCall(p).allowed).toBe(false);
    expect(canReserveCall(p).reason).toContain("Daily physical call limit");
  });

  it("canReserveCall allows when enabled, no emergency stop, under limit", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, physical_calls_used_today: 50, usage_date: todayUtcStr() };
    expect(canReserveCall(p).allowed).toBe(true);
  });

  it("canReserveCall treats stale date as 0 used (daily reset)", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, physical_calls_used_today: 100, usage_date: "2020-01-01" };
    expect(canReserveCall(p).allowed).toBe(true);
  });

  it("needsDailyReset returns true when date differs", () => {
    expect(needsDailyReset({ usage_date: "2020-01-01" }, "2026-09-25")).toBe(true);
    expect(needsDailyReset({ usage_date: todayUtcStr() }, todayUtcStr())).toBe(false);
  });

  it("canDiscover blocks when enabled is false", () => {
    const p = { ...defaultUsagePolicy(), enabled: false };
    expect(canDiscover(p, 0).allowed).toBe(false);
  });

  it("canDiscover blocks when rate limit reached", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, discoveries_per_wallet_per_hour: 3 };
    expect(canDiscover(p, 3).allowed).toBe(false);
    expect(canDiscover(p, 2).allowed).toBe(true);
  });

  it("canAnalyze blocks when rate limit reached", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, analyses_per_wallet_per_day: 5 };
    expect(canAnalyze(p, 5).allowed).toBe(false);
    expect(canAnalyze(p, 4).allowed).toBe(true);
  });

  it("canReclaimCreationLock returns true when lock is free", () => {
    expect(canReclaimCreationLock(null)).toBe(true);
    expect(canReclaimCreationLock({ creation_lock_id: null })).toBe(true);
  });

  it("canReclaimCreationLock returns false when lock is freshly held", () => {
    const now = Date.now();
    const p = { creation_lock_id: "stl_123", creation_lock_acquired_at: new Date(now).toISOString() };
    expect(canReclaimCreationLock(p, now)).toBe(false);
  });

  it("canReclaimCreationLock returns true when lock is stale", () => {
    const now = Date.now();
    const stale = new Date(now - CREATION_LOCK_STALE_TIMEOUT_MS - 5000).toISOString();
    const p = { creation_lock_id: "stl_stale", creation_lock_acquired_at: stale };
    expect(canReclaimCreationLock(p, now)).toBe(true);
  });

  it("buildCreationLockCasFilter returns null when lock is freshly held", () => {
    const now = Date.now();
    const p = { control_key: "main", version: 1, creation_lock_id: "stl_x", creation_lock_acquired_at: new Date(now).toISOString() };
    expect(buildCreationLockCasFilter(p, now)).toBeNull();
  });

  it("buildCreationLockCasFilter returns version-guarded filter when lock is free", () => {
    const p = { control_key: "main", version: 3, creation_lock_id: null, creation_lock_acquired_at: null };
    const filter = buildCreationLockCasFilter(p, Date.now());
    expect(filter).toBeTruthy();
    expect(filter.control_key).toBe("main");
    expect(filter.version).toBe(3);
    expect(filter).not.toHaveProperty("creation_lock_id");
  });

  it("buildReserveCallCasFilter returns null when disabled", () => {
    const p = { ...defaultUsagePolicy(), enabled: false, usage_date: todayUtcStr() };
    expect(buildReserveCallCasFilter(p)).toBeNull();
  });

  it("buildReserveCallCasFilter returns filter when enabled and under limit", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, physical_calls_used_today: 50, usage_date: todayUtcStr() };
    const filter = buildReserveCallCasFilter(p);
    expect(filter).toBeTruthy();
    expect(filter.control_key).toBe(CONTROL_KEY);
    expect(filter.emergency_stop).toBe(false);
  });

  it("sanitizePolicyForAdmin includes remaining_today", () => {
    const p = { ...defaultUsagePolicy(), enabled: true, physical_calls_used_today: 30, daily_physical_call_limit: 100, usage_date: todayUtcStr() };
    const admin = sanitizePolicyForAdmin(p);
    expect(admin.remaining_today).toBe(70);
    expect(admin.enabled).toBe(true);
  });
});

// ============================================================
// 2. USAGE POLICY — store (budget reservation under concurrency)
// ============================================================

describe("Single Trade — usage policy store (budget reservation)", () => {
  it("reservePhysicalCall increments counter atomically", async () => {
    const mock = createMockBase44();
    const { ensurePolicy, reservePhysicalCall } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    // Enable the policy.
    mock._policy[0].enabled = true;
    const r1 = await reservePhysicalCall(mock);
    expect(r1.allowed).toBe(true);
    expect(mock._policy[0].physical_calls_used_today).toBe(1);
    const r2 = await reservePhysicalCall(mock);
    expect(r2.allowed).toBe(true);
    expect(mock._policy[0].physical_calls_used_today).toBe(2);
  });

  it("reservePhysicalCall blocks when daily limit reached", async () => {
    const mock = createMockBase44();
    const { ensurePolicy, reservePhysicalCall } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    mock._policy[0].enabled = true;
    mock._policy[0].daily_physical_call_limit = 2;
    await reservePhysicalCall(mock);
    await reservePhysicalCall(mock);
    const r3 = await reservePhysicalCall(mock);
    expect(r3.allowed).toBe(false);
    expect(r3.reason).toContain("Daily physical call limit");
  });

  it("reservePhysicalCall blocks when emergency stop is active", async () => {
    const mock = createMockBase44();
    const { ensurePolicy, reservePhysicalCall } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    mock._policy[0].enabled = true;
    mock._policy[0].emergency_stop = true;
    const r = await reservePhysicalCall(mock);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Emergency stop");
  });

  it("reservePhysicalCall blocks when disabled", async () => {
    const mock = createMockBase44();
    const { ensurePolicy, reservePhysicalCall } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    // enabled defaults to false
    const r = await reservePhysicalCall(mock);
    expect(r.allowed).toBe(false);
  });

  it("concurrent reservePhysicalCall calls do not exceed the daily limit", async () => {
    const mock = createMockBase44();
    const { ensurePolicy, reservePhysicalCall } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    mock._policy[0].enabled = true;
    mock._policy[0].daily_physical_call_limit = 5;
    // 10 concurrent reservations, only 5 should succeed.
    const results = await Promise.all(Array.from({ length: 10 }, () => reservePhysicalCall(mock)));
    const allowed = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);
    expect(allowed.length).toBe(5);
    expect(denied.length).toBe(5);
    expect(mock._policy[0].physical_calls_used_today).toBe(5);
  });
});

// ============================================================
// 3. CAS MUTEX — trial creation (25-way concurrency)
// ============================================================

describe("Single Trade — CAS mutex trial creation", () => {
  it("findOrCreateTrial creates exactly one trial (single caller)", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const result = await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_1", public_slug: "trade-1",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    expect(result.created).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.trial).toBeTruthy();
    expect(result.trial.status).toBe("analyzing");
    expect(mock._trials.length).toBe(1);
    // Lock must be released.
    expect(mock._policy[0].creation_lock_id).toBeNull();
  });

  it("findOrCreateTrial returns existing trial for duplicate fingerprint", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_1", public_slug: "trade-1",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    const result2 = await findOrCreateTrial(mock, {
      trade_fingerprint: "fp_1", public_slug: "trade-2",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    });
    expect(result2.created).toBe(false);
    expect(result2.duplicate).toBe(true);
    expect(mock._trials.length).toBe(1);
  });

  it("25 concurrent findOrCreateTrial calls produce exactly one trial, one winner, 24 duplicates", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    const fields = {
      trade_fingerprint: "fp_concurrent", public_slug: "trade-concurrent",
      wallet_address: "0xabc", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "mint1", transaction_hash: "tx1"
    };
    const results = await Promise.all(Array.from({ length: 25 }, () => findOrCreateTrial(mock, fields)));
    // Exactly one trial.
    expect(mock._trials.length).toBe(1);
    // Exactly one winner.
    const winners = results.filter((r) => r.created);
    const duplicates = results.filter((r) => r.duplicate);
    expect(winners.length).toBe(1);
    expect(duplicates.length).toBe(24);
    // All results have a trial.
    expect(results.every((r) => r.trial !== null)).toBe(true);
    // Lock is released afterward.
    expect(mock._policy[0].creation_lock_id).toBeNull();
  });

  it("lock is released on every failure path (create throws)", async () => {
    const mock = createMockBase44();
    const { ensurePolicy } = await import("../base44/shared/singleTradeUsageStore.ts");
    await ensurePolicy(mock);
    // Make create throw.
    const originalCreate = mock.asServiceRole.entities.SingleTradeTrial.create;
    mock.asServiceRole.entities.SingleTradeTrial.create = async () => { throw new Error("DB down"); };
    const { findOrCreateTrial } = await import("../base44/shared/singleTradeStore.ts");
    let threw = false;
    try {
      await findOrCreateTrial(mock, {
        trade_fingerprint: "fp_err", public_slug: "trade-err",
        wallet_address: "0xabc", normalized_wallet_address: "0xabc",
        network: "solana", token_mint: "mint1", transaction_hash: "tx1"
      });
    } catch { threw = true; }
    expect(threw).toBe(true);
    // Lock MUST be released even though create threw.
    expect(mock._policy[0].creation_lock_id).toBeNull();
    // Restore.
    mock.asServiceRole.entities.SingleTradeTrial.create = originalCreate;
  });
});

// ============================================================
// 4. SECURE PURCHASE SELECTION
// ============================================================

describe("Single Trade — secure purchase selection", () => {
  it("consumeSelection succeeds for a valid, unconsumed, non-expired selection", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1",
      normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1",
      transaction_hash: "tx1"
    });
    const result = await consumeSelection(mock, "sel_1", "0xabc", "MINT1");
    expect(result.consumed).toBe(true);
    expect(result.selection.consumed_at).toBeTruthy();
  });

  it("consumeSelection rejects an already-consumed selection (replay)", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1"
    });
    await consumeSelection(mock, "sel_1", "0xabc", "MINT1");
    const replay = await consumeSelection(mock, "sel_1", "0xabc", "MINT1");
    expect(replay.consumed).toBe(false);
    expect(replay.reason).toContain("already been used");
  });

  it("consumeSelection rejects an expired selection", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    const expired = new Date(Date.now() - 60000).toISOString();
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1",
      expires_at: expired
    });
    const result = await consumeSelection(mock, "sel_1", "0xabc", "MINT1");
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("consumeSelection rejects a wallet mismatch (tampering)", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1"
    });
    const result = await consumeSelection(mock, "sel_1", "0xWRONG", "MINT1");
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain("Wallet address does not match");
  });

  it("consumeSelection rejects a mint mismatch (tampering)", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1"
    });
    const result = await consumeSelection(mock, "sel_1", "0xabc", "MINT_WRONG");
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain("Token mint does not match");
  });

  it("consumeSelection rejects a non-existent selection", async () => {
    const mock = createMockBase44();
    const { consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    const result = await consumeSelection(mock, "sel_nonexistent", "0xabc", "MINT1");
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("concurrent consumeSelection calls produce exactly one winner", async () => {
    const mock = createMockBase44();
    const { createSelection, consumeSelection } = await import("../base44/shared/singleTradeSelectionStore.ts");
    await createSelection(mock, {
      selection_id: "sel_1", normalized_wallet_address: "0xabc",
      network: "solana", token_mint: "MINT1", transaction_hash: "tx1"
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeSelection(mock, "sel_1", "0xabc", "MINT1")));
    const winners = results.filter((r) => r.consumed);
    const losers = results.filter((r) => !r.consumed);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(9);
  });
});

// ============================================================
// 5. PRIVACY SANITIZER
// ============================================================

describe("Single Trade — privacy sanitizer", () => {
  const FULL_WALLET = "7NQ4YqW2VtKEHFEbLn7mQ4g5KqXKfY2pLmNzZ3vQwR5o";
  const FULL_TX = "5xK9pQm2VtKEHFEbLn7mQ4g5KqXKfY2pLmNzZ3vQwR5o1234567890abcdef";

  it("sanitizeSingleTrialForPublicCase never exposes full wallet address", () => {
    const trial = {
      public_slug: "trade-1", network: "solana",
      wallet_address: FULL_WALLET, normalized_wallet_address: FULL_WALLET,
      token_mint: "mint1", transaction_hash: FULL_TX,
      status: "completed", case_outcome: "verdict",
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      evidence_items_json: "[]", metrics_json: "{}",
      ohlcv_snapshot_json: "[]", source_endpoints_json: "[]",
      refresh_snapshots_json: "[]"
    };
    const pub = sanitizeSingleTrialForPublicCase(trial);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(FULL_WALLET);
    expect(pub.address_short).toBeTruthy();
    expect(pub.address_short).not.toBe(FULL_WALLET);
  });

  it("sanitizeSingleTrialForPublicCase never exposes full transaction hash", () => {
    const trial = {
      public_slug: "trade-1", network: "solana",
      wallet_address: FULL_WALLET, normalized_wallet_address: FULL_WALLET,
      token_mint: "mint1", transaction_hash: FULL_TX,
      status: "completed", case_outcome: "verdict",
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      evidence_items_json: "[]", metrics_json: "{}",
      ohlcv_snapshot_json: "[]", source_endpoints_json: "[]",
      refresh_snapshots_json: "[]"
    };
    const pub = sanitizeSingleTrialForPublicCase(trial);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(FULL_TX);
    expect(pub.transaction_hash_short).toBeTruthy();
    expect(pub.transaction_hash_short).not.toBe(FULL_TX);
    // Must NOT have a transaction_hash field.
    expect(pub.transaction_hash).toBeUndefined();
  });

  it("sanitizeSingleTrialForPublicCase scrubs full addresses from JSON strings", () => {
    const trial = {
      public_slug: "trade-1", network: "solana",
      wallet_address: FULL_WALLET, normalized_wallet_address: FULL_WALLET,
      token_mint: "mint1", transaction_hash: FULL_TX,
      status: "completed", case_outcome: "verdict",
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      evidence_items_json: JSON.stringify([{ detail: `Wallet ${FULL_WALLET} did stuff` }]),
      metrics_json: "{}", ohlcv_snapshot_json: "[]",
      source_endpoints_json: "[]", refresh_snapshots_json: "[]"
    };
    const pub = sanitizeSingleTrialForPublicCase(trial);
    expect(pub.evidence_items_json).not.toContain(FULL_WALLET);
  });

  it("sanitizePurchaseForPublic never exposes full transaction hash", () => {
    const purchase = {
      transaction_hash: FULL_TX,
      block_timestamp: "2026-09-20T00:00:00Z",
      token_bought_symbol: "JEANPHIL",
      tokens_received: 1000,
      purchase_cost_usd: 50,
      entry_market_cap_usd: 100000,
      entry_price_usd: 0.05
    };
    const pub = sanitizePurchaseForPublic(purchase);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(FULL_TX);
    expect(pub.transaction_hash_short).toBeTruthy();
    expect(pub.transaction_hash).toBeUndefined();
  });
});

// ============================================================
// 6. FIFO LOT ACCOUNTING
// ============================================================

describe("Single Trade — FIFO lot accounting", () => {
  it("simple case: one buy, no sells — exact attribution (JEANPHIL)", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000,
      entryCostUsd: 50,
      entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [],
      laterSells: [],
      currentPriceUsd: 0.03
    });
    expect(result.lot_accounting_method).toBe("fifo");
    expect(result.selected_lot_remaining_quantity).toBe(1000);
    expect(result.selected_lot_sold_quantity).toBe(0);
    expect(result.lot_attribution_complex).toBe(false);
    expect(result.attribution_note).toContain("Exact attribution");
    expect(result.selected_lot_current_value).toBe(30); // 1000 * 0.03
    expect(result.selected_lot_pnl_pct).toBeCloseTo(-0.4, 2); // 30/50 - 1 = -0.4
  });

  it("full exit: all tokens sold — remaining is 0", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000,
      entryCostUsd: 50,
      entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [],
      laterSells: [{ token_sold_amount: 1000, block_timestamp: "2026-09-22T00:00:00Z" }],
      currentPriceUsd: 0.03
    });
    expect(result.selected_lot_remaining_quantity).toBe(0);
    expect(result.selected_lot_sold_quantity).toBe(1000);
    expect(result.lot_attribution_complex).toBe(false);
    expect(result.attribution_note).toContain("FIFO attribution: sells consumed the selected lot first");
  });

  it("partial exit: half sold — remaining is 500", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000,
      entryCostUsd: 50,
      entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [],
      laterSells: [{ token_sold_amount: 500, block_timestamp: "2026-09-22T00:00:00Z" }],
      currentPriceUsd: 0.03
    });
    expect(result.selected_lot_remaining_quantity).toBe(500);
    expect(result.selected_lot_sold_quantity).toBe(500);
    expect(result.lot_attribution_complex).toBe(false);
  });

  it("later add (averaging down) with no sells — entry lot fully intact", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000,
      entryCostUsd: 50,
      entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [{ token_bought_amount: 500, trade_value_usd: 15, block_timestamp: "2026-09-21T00:00:00Z" }],
      laterSells: [],
      currentPriceUsd: 0.03
    });
    expect(result.selected_lot_remaining_quantity).toBe(1000);
    expect(result.whole_position_tokens).toBe(1500);
    expect(result.whole_position_cost_usd).toBe(65);
    expect(result.lot_attribution_complex).toBe(false);
    expect(result.attribution_note).toContain("no sells detected");
  });

  it("complex case: later buys AND sells — attribution is complex (accounting convention)", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000,
      entryCostUsd: 50,
      entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [{ token_bought_amount: 500, trade_value_usd: 15, block_timestamp: "2026-09-21T00:00:00Z" }],
      laterSells: [{ token_sold_amount: 800, block_timestamp: "2026-09-22T00:00:00Z" }],
      currentPriceUsd: 0.03
    });
    // FIFO: 800 sold from entry lot first → entry lot has 200 remaining.
    expect(result.selected_lot_remaining_quantity).toBe(200);
    expect(result.selected_lot_sold_quantity).toBe(800);
    expect(result.whole_position_remaining).toBe(700); // 200 + 500
    expect(result.lot_attribution_complex).toBe(true);
    expect(result.attribution_note).toContain("accounting convention");
    expect(result.attribution_note).toContain("blockchain does not identify");
  });

  it("never claims the blockchain identifies which units were sold (complex case)", () => {
    const result = computeFifoLotAttribution({
      entryTokens: 1000, entryCostUsd: 50, entryTimestamp: "2026-09-20T00:00:00Z",
      laterBuys: [{ token_bought_amount: 500, trade_value_usd: 15, block_timestamp: "2026-09-21T00:00:00Z" }],
      laterSells: [{ token_sold_amount: 800, block_timestamp: "2026-09-22T00:00:00Z" }],
      currentPriceUsd: 0.03
    });
    expect(result.attribution_note).not.toContain("exact");
    expect(result.attribution_note).toContain("FIFO");
  });
});

// ============================================================
// 7. IMMUTABLE VERDICT DURING REFRESH
// ============================================================

describe("Single Trade — immutable verdict during refresh", () => {
  it("appendRefreshSnapshot does not modify verdict fields", async () => {
    const mock = createMockBase44();
    // Create a completed trial.
    mock._trials.push({
      id: "trl_1", status: "completed", case_outcome: "verdict", version: 0,
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      headline: "Held the bag", roast: "roast text", sentence: "sentence",
      severity_score: 80, confidence_score: 85,
      ohlcv_snapshot_json: JSON.stringify([{ open: 1 }]),
      refresh_snapshots_json: "[]",
      current_price_usd: 0.05, current_value_usd: 50,
      current_token_amount: 1000, purchase_cost_usd: 50,
      entry_market_cap_usd: 100000, entry_price_usd: 0.05,
      metrics_json: JSON.stringify({ lowest_market_cap_usd: 50000 })
    });
    const { appendRefreshSnapshot } = await import("../base44/shared/singleTradeStore.ts");
    const snapshot = {
      refreshed_at: new Date().toISOString(),
      current_price_usd: 0.03, current_value_usd: 30,
      current_token_amount: 1000, current_unrealized_pnl_pct: -0.4,
      recovery_pct: 0.2
    };
    const { appended, trial } = await appendRefreshSnapshot(mock, "trl_1", snapshot);
    expect(appended).toBe(true);
    // Verdict fields are immutable.
    expect(trial.verdict_code).toBe("bag_holder");
    expect(trial.verdict_name).toBe("Bag Holder");
    expect(trial.headline).toBe("Held the bag");
    expect(trial.roast).toBe("roast text");
    expect(trial.sentence).toBe("sentence");
    expect(trial.severity_score).toBe(80);
    expect(trial.confidence_score).toBe(85);
    // OHLCV snapshot is immutable.
    expect(JSON.parse(trial.ohlcv_snapshot_json)).toHaveLength(1);
    // Refresh snapshot was appended.
    const refreshes = JSON.parse(trial.refresh_snapshots_json);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].current_price_usd).toBe(0.03);
  });

  it("concurrent appendRefreshSnapshot calls produce exactly one append", async () => {
    const mock = createMockBase44();
    mock._trials.push({
      id: "trl_1", status: "completed", case_outcome: "verdict", version: 0,
      verdict_code: "bag_holder", verdict_name: "Bag Holder",
      headline: "H", roast: "R", sentence: "S",
      severity_score: 80, confidence_score: 85,
      ohlcv_snapshot_json: "[]", refresh_snapshots_json: "[]",
      current_price_usd: 0.05, current_value_usd: 50,
      current_token_amount: 1000, purchase_cost_usd: 50,
      entry_market_cap_usd: 100000, entry_price_usd: 0.05,
      metrics_json: "{}"
    });
    const { appendRefreshSnapshot } = await import("../base44/shared/singleTradeStore.ts");
    const snapshot = { refreshed_at: new Date().toISOString(), current_price_usd: 0.03 };
    const results = await Promise.all(Array.from({ length: 5 }, () => appendRefreshSnapshot(mock, "trl_1", snapshot)));
    const appended = results.filter((r) => r.appended);
    const denied = results.filter((r) => !r.appended);
    expect(appended.length).toBe(1);
    expect(denied.length).toBe(4);
  });
});

// ============================================================
// 8. STRUCTURAL TESTS — legacy ceiling not used
// ============================================================

const nansenSrc = readFileSync(join(__dirname, "../base44/shared/nansen.ts"), "utf-8");
const analyzeSrc = readFileSync(join(__dirname, "../base44/functions/analyzeSingleTrade/entry.ts"), "utf-8");
const discoverSrc = readFileSync(join(__dirname, "../base44/functions/discoverTokenPurchases/entry.ts"), "utf-8");
const refreshSrc = readFileSync(join(__dirname, "../base44/functions/refreshSingleTrade/entry.ts"), "utf-8");
const usagePolicySrc = readFileSync(join(__dirname, "../base44/shared/singleTradeUsagePolicy.ts"), "utf-8");
const usageStoreSrc = readFileSync(join(__dirname, "../base44/shared/singleTradeUsageStore.ts"), "utf-8");
const featureFlagsSrc = readFileSync(join(__dirname, "../base44/shared/featureFlags.ts"), "utf-8");
const featureFlagEntity = readFileSync(join(__dirname, "../base44/entities/FeatureFlag.jsonc"), "utf-8");
const calibrationSrc = readFileSync(join(__dirname, "../base44/shared/calibration.ts"), "utf-8");

describe("Single Trade — does NOT use legacy 1,020 ceiling", () => {
  it("buildSingleTradeTelemetryContext exists in nansen.ts", () => {
    expect(nansenSrc).toContain("buildSingleTradeTelemetryContext");
  });

  it("buildSingleTradeTelemetryContext does NOT call checkCeilingBudget or getVerifiedTotal", () => {
    // Extract the function body.
    const fnStart = nansenSrc.indexOf("export function buildSingleTradeTelemetryContext");
    const fnEnd = nansenSrc.indexOf("// Orchestrates the four-endpoint pipeline");
    const fnBody = nansenSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain("checkCeilingBudget");
    expect(fnBody).not.toContain("getVerifiedTotal");
    expect(fnBody).not.toContain("CALIBRATION_CEILING");
    expect(fnBody).not.toContain("1020");
  });

  it("buildSingleTradeTelemetryContext uses reservePhysicalCall from the Single Trade usage store", () => {
    const fnStart = nansenSrc.indexOf("export function buildSingleTradeTelemetryContext");
    const fnEnd = nansenSrc.indexOf("// Orchestrates the four-endpoint pipeline");
    const fnBody = nansenSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain("reservePhysicalCall");
    expect(fnBody).toContain("singleTradeUsageStore");
  });

  it("analyzeSingleTrade uses buildSingleTradeTelemetryContext (NOT buildTelemetryContext)", () => {
    expect(analyzeSrc).toContain("buildSingleTradeTelemetryContext");
    expect(analyzeSrc).not.toContain("buildTelemetryContext");
  });

  it("discoverTokenPurchases uses buildSingleTradeTelemetryContext (NOT buildTelemetryContext)", () => {
    expect(discoverSrc).toContain("buildSingleTradeTelemetryContext");
    expect(discoverSrc).not.toContain("buildTelemetryContext");
  });

  it("refreshSingleTrade uses buildSingleTradeTelemetryContext (NOT buildTelemetryContext)", () => {
    expect(refreshSrc).toContain("buildSingleTradeTelemetryContext");
    expect(refreshSrc).not.toContain("buildTelemetryContext");
  });

  it("singleTradeUsagePolicy.ts does NOT import or reference calibration ceiling", () => {
    expect(usagePolicySrc).not.toContain("CALIBRATION_CEILING");
    expect(usagePolicySrc).not.toContain("checkCeilingBudget");
    expect(usagePolicySrc).not.toContain("getVerifiedTotal");
    expect(usagePolicySrc).not.toContain("1020");
  });

  it("singleTradeUsageStore.ts does NOT import or reference calibration ceiling", () => {
    expect(usageStoreSrc).not.toContain("CALIBRATION_CEILING");
    expect(usageStoreSrc).not.toContain("checkCeilingBudget");
    expect(usageStoreSrc).not.toContain("getVerifiedTotal");
  });
});

describe("Single Trade — calibration and Robinhood protections unchanged", () => {
  it("calibration.ts still defines CALIBRATION_CEILING = 1020", () => {
    expect(calibrationSrc).toContain("CALIBRATION_CEILING = 1020");
  });

  it("calibration.ts still defines CALIBRATION_TARGET = 1000", () => {
    expect(calibrationSrc).toContain("CALIBRATION_TARGET = 1000");
  });

  it("calibration.ts still exports checkCeilingBudget and checkCeilingBudgetWithLimit", () => {
    expect(calibrationSrc).toContain("export function checkCeilingBudget");
    expect(calibrationSrc).toContain("export function checkCeilingBudgetWithLimit");
  });

  it("nansen.ts still has the legacy buildTelemetryContext with ceiling guard for calibration", () => {
    expect(nansenSrc).toContain("export function buildTelemetryContext");
    // The legacy function still uses the ceiling.
    const legacyFnStart = nansenSrc.indexOf("export function buildTelemetryContext");
    const legacyFnEnd = nansenSrc.indexOf("export function buildSingleTradeTelemetryContext");
    const legacyFnBody = nansenSrc.slice(legacyFnStart, legacyFnEnd);
    expect(legacyFnBody).toContain("checkCeilingBudgetWithLimit");
    expect(legacyFnBody).toContain("CALIBRATION_CEILING");
  });
});

// ============================================================
// 9. FEATURE FLAG — public disabled / admin allowed
// ============================================================

describe("Single Trade — feature flag", () => {
  it("FeatureFlag entity includes single_trade_public_enabled with default false", () => {
    const schema = JSON.parse(featureFlagEntity);
    expect(schema.properties.single_trade_public_enabled).toBeTruthy();
    expect(schema.properties.single_trade_public_enabled.default).toBe(false);
  });

  it("featureFlags.ts exports isSingleTradePublicEnabled and setSingleTradePublicEnabled", () => {
    expect(featureFlagsSrc).toContain("isSingleTradePublicEnabled");
    expect(featureFlagsSrc).toContain("setSingleTradePublicEnabled");
  });

  it("isSingleTradePublicEnabled returns false when flag record is missing (safe default)", async () => {
    const mock = createMockBase44();
    const { isSingleTradePublicEnabled } = await import("../base44/shared/featureFlags.ts");
    // No FeatureFlag records in mock — but we need a FeatureFlag entity mock.
    mock.asServiceRole.entities.FeatureFlag = {
      filter: async () => []
    };
    const result = await isSingleTradePublicEnabled(mock);
    expect(result).toBe(false);
  });

  it("isSingleTradePublicEnabled returns true when flag is set", async () => {
    const mock = createMockBase44();
    mock.asServiceRole.entities.FeatureFlag = {
      filter: async () => [{ single_trade_public_enabled: true }]
    };
    const { isSingleTradePublicEnabled } = await import("../base44/shared/featureFlags.ts");
    const result = await isSingleTradePublicEnabled(mock);
    expect(result).toBe(true);
  });

  it("analyzeSingleTrade checks the feature flag and rejects non-admins when disabled", () => {
    expect(analyzeSrc).toContain("isSingleTradePublicEnabled");
    expect(analyzeSrc).toContain("FEATURE_DISABLED");
    expect(analyzeSrc).toContain("isAdmin");
  });

  it("discoverTokenPurchases checks the feature flag and rejects non-admins when disabled", () => {
    expect(discoverSrc).toContain("isSingleTradePublicEnabled");
    expect(discoverSrc).toContain("FEATURE_DISABLED");
    expect(discoverSrc).toContain("isAdmin");
  });

  it("getPublicFeatureFlags returns single_trade_public_enabled", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/getPublicFeatureFlags/entry.ts"), "utf-8");
    expect(src).toContain("single_trade_public_enabled");
  });
});

// ============================================================
// 10. REFRESH — structural tests
// ============================================================

describe("Single Trade — refresh function", () => {
  it("refreshSingleTrade function exists", () => {
    expect(refreshSrc).toContain("export default async function");
  });

  it("refreshSingleTrade requires authentication", () => {
    expect(refreshSrc).toContain("AUTH_REQUIRED");
    expect(refreshSrc).toContain("base44.auth.me");
  });

  it("refreshSingleTrade uses the Single Trade budget (not ceiling)", () => {
    expect(refreshSrc).toContain("buildSingleTradeTelemetryContext");
    expect(refreshSrc).not.toContain("buildTelemetryContext");
  });

  it("refreshSingleTrade has rate limiting (cooldown)", () => {
    expect(refreshSrc).toContain("REFRESH_COOLDOWN_MS");
    expect(refreshSrc).toContain("REFRESH_COOLDOWN");
  });

  it("refreshSingleTrade rejects non-verdict cases (dismissed/mistrial)", () => {
    expect(refreshSrc).toContain("NOT_REFRESHABLE");
    expect(refreshSrc).toContain("Dismissed and mistrial cases cannot be refreshed");
  });

  it("refreshSingleTrade does not modify verdict fields (uses appendRefreshSnapshot)", () => {
    expect(refreshSrc).toContain("appendRefreshSnapshot");
  });
});

// ============================================================
// 11. ADMIN — usage status + settings
// ============================================================

describe("Single Trade — admin endpoints", () => {
  it("getSingleTradeUsageStatus function exists and checks admin auth", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/getSingleTradeUsageStatus/entry.ts"), "utf-8");
    expect(src).toContain("admin");
    expect(src).toContain("getPolicyForAdmin");
  });

  it("saveSingleTradeUsagePolicy function exists and checks admin auth", () => {
    const src = readFileSync(join(__dirname, "../base44/functions/saveSingleTradeUsagePolicy/entry.ts"), "utf-8");
    expect(src).toContain("admin");
    expect(src).toContain("savePolicy");
  });

  it("admin page exists and is routed", () => {
    const appSrc = readFileSync(join(__dirname, "../src/App.jsx"), "utf-8");
    expect(appSrc).toContain("AdminSingleTradeUsage");
    expect(appSrc).toContain("/admin/single-trade-usage");
    const pageSrc = readFileSync(join(__dirname, "../src/pages/AdminSingleTradeUsage.jsx"), "utf-8");
    expect(pageSrc).toContain("enabled");
    expect(pageSrc).toContain("emergency_stop");
    expect(pageSrc).toContain("daily_physical_call_limit");
    expect(pageSrc).toContain("remaining_today");
  });
});

// ============================================================
// 12. FINGERPRINT — still used as dedup key (not concurrency guarantee)
// ============================================================

describe("Single Trade — fingerprint as dedup key", () => {
  it("buildTradeFingerprint produces a SHA-256 hex string", async () => {
    const fp = await buildTradeFingerprint("solana", "0xabc", "tx1");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same inputs produce the same fingerprint", async () => {
    const fp1 = await buildTradeFingerprint("solana", "0xabc", "tx1");
    const fp2 = await buildTradeFingerprint("solana", "0xabc", "tx1");
    expect(fp1).toBe(fp2);
  });

  it("different inputs produce different fingerprints", async () => {
    const fp1 = await buildTradeFingerprint("solana", "0xabc", "tx1");
    const fp2 = await buildTradeFingerprint("solana", "0xabc", "tx2");
    expect(fp1).not.toBe(fp2);
  });
});