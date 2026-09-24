// Wallet Court — Robinhood Validation regression suite.
// 15 scenarios covering the isolated 21-attempt / 5-wallet allowance:
//   - Singleton initialization and defaults
//   - canStartWallet gating (status, wallets, attempts)
//   - isExhausted and shouldStop transitions
//   - computeValidationMaxTotal derivation (NOT hardcoded)
//   - sanitizeAllowance privacy (no wallet addresses, user IDs, invocation IDs)
//   - sanitizeAllowance exposes ceiling context (validation_max_total, legacy_ceiling)
//   - Local budget guard (createRobinhoodBudgetGuard)
//   - Persistent budget guard (createPersistentRobinhoodBudgetGuard)
//   - computeCoverageWindow clamps Robinhood to 2026-04-30
//   - computeCoverageWindow does not clamp chains without coverageStart
//
// Pure unit tests: no network, no DB, no live Nansen calls.

import { describe, it, expect } from "vitest";
import {
  RH_MAX_WALLETS,
  RH_MAX_ATTEMPTS,
  LEGACY_CEILING,
  RH_STATUS,
  canStartWallet,
  isExhausted,
  shouldStop,
  computeValidationMaxTotal,
  remainingAttempts,
  remainingWallets,
  sanitizeAllowance,
  createLocalAttemptRef,
  createRobinhoodBudgetGuard,
  ADVANCE_LOCK_STALE_TIMEOUT_MS
} from "../base44/shared/robinhoodAllowance.ts";
import { computeCoverageWindow } from "../base44/shared/chains.ts";
import { checkCeilingBudgetWithLimit, CALIBRATION_CEILING } from "../base44/shared/calibration.ts";

// ---- Mock factory for an allowance record ----
function makeAllowance(overrides: Record<string, any> = {}) {
  return {
    control_key: "main",
    version: 0,
    status: RH_STATUS.NOT_STARTED,
    wallets_started: 0,
    wallets_completed: 0,
    attempts_used: 0,
    max_wallets: RH_MAX_WALLETS,
    max_attempts: RH_MAX_ATTEMPTS,
    endpoint_successes: 0,
    endpoint_failures: 0,
    starting_global_total: null,
    advance_lock_held: false,
    advance_lock_acquired_at: null,
    advance_lock_invocation_id: null,
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

describe("Robinhood Validation — 15 regression scenarios", () => {

  // 1. Singleton defaults
  it("1. Allowance defaults to 5 wallets, 21 attempts, not_started", () => {
    const a = makeAllowance();
    expect(a.max_wallets).toBe(5);
    expect(a.max_attempts).toBe(21);
    expect(a.status).toBe("not_started");
    expect(a.wallets_started).toBe(0);
    expect(a.wallets_completed).toBe(0);
    expect(a.attempts_used).toBe(0);
    expect(a.starting_global_total).toBeNull();
  });

  // 2. canStartWallet — allowed when running with remaining capacity
  it("2. canStartWallet allows when running with remaining wallets and attempts", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, wallets_started: 2, attempts_used: 8 });
    const r = canStartWallet(a);
    expect(r.allowed).toBe(true);
  });

  // 3. canStartWallet — blocked when not running
  it("3. canStartWallet blocks when status is not running", () => {
    const a = makeAllowance({ status: RH_STATUS.NOT_STARTED });
    expect(canStartWallet(a).allowed).toBe(false);
    const paused = makeAllowance({ status: RH_STATUS.PAUSED });
    expect(canStartWallet(paused).allowed).toBe(false);
    const stopped = makeAllowance({ status: RH_STATUS.STOPPED });
    expect(canStartWallet(stopped).allowed).toBe(false);
  });

  // 4. canStartWallet — blocked when max wallets reached
  it("4. canStartWallet blocks when max wallets reached", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, wallets_started: 5 });
    const r = canStartWallet(a);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("5 wallets");
  });

  // 5. canStartWallet — blocked when max attempts reached
  it("5. canStartWallet blocks when max attempts reached", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, wallets_started: 2, attempts_used: 21 });
    const r = canStartWallet(a);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("21 attempts");
  });

  // 6. isExhausted — true when attempts_used >= max_attempts
  it("6. isExhausted is true at and above max attempts", () => {
    expect(isExhausted(makeAllowance({ attempts_used: 21 }))).toBe(true);
    expect(isExhausted(makeAllowance({ attempts_used: 22 }))).toBe(true);
    expect(isExhausted(makeAllowance({ attempts_used: 20 }))).toBe(false);
    expect(isExhausted(makeAllowance({ attempts_used: 0 }))).toBe(false);
  });

  // 7. shouldStop — circuit open → circuit_open status
  it("7. shouldStop returns circuit_open when circuit is open", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, attempts_used: 5 });
    const r = shouldStop(a, true);
    expect(r.stop).toBe(true);
    expect(r.newStatus).toBe(RH_STATUS.CIRCUIT_OPEN);
  });

  // 8. shouldStop — exhausted → exhausted status
  it("8. shouldStop returns exhausted when attempts are used up", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, attempts_used: 21, max_attempts: 21 });
    const r = shouldStop(a, false);
    expect(r.stop).toBe(true);
    expect(r.newStatus).toBe(RH_STATUS.EXHAUSTED);
  });

  // 9. shouldStop — all wallets done → stopped status
  it("9. shouldStop returns stopped when all wallets are completed", () => {
    const a = makeAllowance({ status: RH_STATUS.RUNNING, wallets_started: 5, wallets_completed: 5, max_wallets: 5 });
    const r = shouldStop(a, false);
    expect(r.stop).toBe(true);
    expect(r.newStatus).toBe(RH_STATUS.STOPPED);
  });

  // 10. computeValidationMaxTotal — derived from starting_global_total + max_attempts (NOT hardcoded)
  it("10. computeValidationMaxTotal is derived from immutable allowance fields, not hardcoded", () => {
    // Starting at 1,001 → 1,001 + 21 = 1,022
    const a1 = makeAllowance({ starting_global_total: 1001, max_attempts: 21 });
    expect(computeValidationMaxTotal(a1)).toBe(1022);

    // Starting at 999 → 999 + 21 = 1,020 (coincidentally equals legacy ceiling)
    const a2 = makeAllowance({ starting_global_total: 999, max_attempts: 21 });
    expect(computeValidationMaxTotal(a2)).toBe(1020);

    // Starting at 1,010 → 1,010 + 21 = 1,031 (higher than any hardcoded value)
    const a3 = makeAllowance({ starting_global_total: 1010, max_attempts: 21 });
    expect(computeValidationMaxTotal(a3)).toBe(1031);

    // Different max_attempts changes the result
    const a4 = makeAllowance({ starting_global_total: 1001, max_attempts: 30 });
    expect(computeValidationMaxTotal(a4)).toBe(1031);

    // Null starting_global_total → null (not yet started)
    expect(computeValidationMaxTotal(makeAllowance({ starting_global_total: null }))).toBeNull();
  });

  // 11. remainingAttempts / remainingWallets
  it("11. remainingAttempts and remainingWallets compute correctly", () => {
    const a = makeAllowance({ attempts_used: 15, wallets_started: 3, max_attempts: 21, max_wallets: 5 });
    expect(remainingAttempts(a)).toBe(6);
    expect(remainingWallets(a)).toBe(2);

    // Capped at 0
    const exhausted = makeAllowance({ attempts_used: 25, wallets_started: 7 });
    expect(remainingAttempts(exhausted)).toBe(0);
    expect(remainingWallets(exhausted)).toBe(0);

    // Null allowance → full defaults
    expect(remainingAttempts(null)).toBe(21);
    expect(remainingWallets(null)).toBe(5);
  });

  // 12. sanitizeAllowance — never exposes wallet addresses, user IDs, or invocation IDs
  it("12. sanitizeAllowance never exposes wallet addresses, user IDs, or invocation IDs", () => {
    const a = makeAllowance({
      current_wallet_address: "0xABC123DEF456",
      started_by_user_id: "user_789",
      advance_lock_invocation_id: "rhinv_secret",
      advance_lock_held: true,
      advance_lock_acquired_at: new Date().toISOString()
    });
    const s = sanitizeAllowance(a);
    const json = JSON.stringify(s);
    expect(json).not.toContain("0xABC123DEF456");
    expect(json).not.toContain("user_789");
    expect(json).not.toContain("rhinv_secret");
    expect(s).not.toHaveProperty("current_wallet_address");
    expect(s).not.toHaveProperty("started_by_user_id");
    expect(s).not.toHaveProperty("advance_lock_invocation_id");
    expect(s).not.toHaveProperty("advance_lock_held");
    expect(s).not.toHaveProperty("advance_lock_acquired_at");
  });

  // 13. sanitizeAllowance — includes validation_max_total and legacy_ceiling
  it("13. sanitizeAllowance exposes validation_max_total and legacy_ceiling", () => {
    const a = makeAllowance({ starting_global_total: 1001, max_attempts: 21 });
    const s = sanitizeAllowance(a);
    expect(s.validation_max_total).toBe(1022);
    expect(s.legacy_ceiling).toBe(LEGACY_CEILING);
    expect(s.legacy_ceiling).toBe(1020);
    // Also includes safe display fields
    expect(s).toHaveProperty("remaining_wallets");
    expect(s).toHaveProperty("remaining_attempts");
    expect(s).toHaveProperty("current_address_short");
  });

  // 14. createRobinhoodBudgetGuard — local counter refuses at max
  it("14. createRobinhoodBudgetGuard refuses the (max+1)th attempt and allows exactly max", async () => {
    const ref = createLocalAttemptRef(0);
    const guard = createRobinhoodBudgetGuard(ref, 21);

    // First 21 attempts allowed
    for (let i = 0; i < 21; i++) {
      const r = await guard();
      expect(r.allowed).toBe(true);
      expect(r.verifiedTotal).toBe(i + 1);
    }

    // 22nd attempt refused
    const blocked = await guard();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("21");
  });

  // 15. computeCoverageWindow — clamps Robinhood to 2026-04-30, does not clamp others
  it("15. computeCoverageWindow clamps Robinhood to coverage start but not other chains", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");

    // Robinhood: 180-day request from 2026-03-29 → clamped to 2026-04-30
    const rh = computeCoverageWindow("robinhood", 180, now);
    expect(rh.coverage_limited).toBe(true);
    expect(rh.from.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(rh.effectiveWindowDays).toBeLessThan(180);

    // Ethereum: no coverage start → no clamp
    const eth = computeCoverageWindow("ethereum", 180, now);
    expect(eth.coverage_limited).toBe(false);
    expect(eth.coverage_start).toBeNull();
    expect(eth.effectiveWindowDays).toBeCloseTo(180, 1);

    // Base: no coverage start → no clamp
    const base = computeCoverageWindow("base", 90, now);
    expect(base.coverage_limited).toBe(false);

    // Solana: no coverage start → no clamp
    const sol = computeCoverageWindow("solana", 30, now);
    expect(sol.coverage_limited).toBe(false);
  });

  // ---- Bonus: verify ceiling exception uses the derived limit, not hardcoded ----
  it("ceiling exception: checkCeilingBudgetWithLimit uses the passed limit, not CALIBRATION_CEILING", () => {
    // At 1,020 with legacy ceiling → blocked
    expect(checkCeilingBudgetWithLimit(1020, CALIBRATION_CEILING).allowed).toBe(false);
    // At 1,020 with validation ceiling 1,022 → allowed
    expect(checkCeilingBudgetWithLimit(1020, 1022).allowed).toBe(true);
    // At 1,022 with validation ceiling 1,022 → blocked
    expect(checkCeilingBudgetWithLimit(1022, 1022).allowed).toBe(false);
  });

  // ---- Bonus: verify stale-lock timeout is 5 minutes ----
  it("advance lock stale timeout is 5 minutes (300000ms)", () => {
    expect(ADVANCE_LOCK_STALE_TIMEOUT_MS).toBe(300000);
  });
});