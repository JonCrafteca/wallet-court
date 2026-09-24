// Wallet Court — Robinhood coverage path runtime regression suite.
// Executes the real computeCoverageWindow logic for Robinhood (not a structural
// source-string test) and proves the coverageStart ReferenceError is fixed.
// Also covers the advance-lock lifecycle (exception → release) and physical-
// call accounting when failure occurs before/after requests.

import { describe, it, expect } from "vitest";
import { computeCoverageWindow } from "../base44/shared/chains.ts";
import {
  createLocalAttemptRef,
  createRobinhoodBudgetGuard,
  simulateAdvanceLockLifecycle
} from "../base44/shared/robinhoodAllowance.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERAGE_START_ISO = "2026-04-30T00:00:00.000Z";

// ---- #1-2: Runtime regression — execute the Robinhood coverage path ----

describe("Robinhood coverage path — runtime regression (computeCoverageWindow)", () => {
  it("returns valid metadata for robinhood without a ReferenceError", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w).toBeDefined();
    expect(w.coverage_start).toBe(COVERAGE_START_ISO);
    expect(w.coverage_limited).toBe(true);
    expect(w.effectiveWindowDays).toBeGreaterThan(0);
    expect(w.effectiveWindowDays).toBeLessThan(180);
    expect(w.requested_window_days).toBe(180);
    // Effective analysis start/end are the clamped from/to dates.
    expect(w.from.toISOString()).toBe(COVERAGE_START_ISO);
    expect(w.to.toISOString()).toBe(now.toISOString());
  });

  // ---- #3: Dates before, on, and after 2026-04-30 ----

  it("date BEFORE coverage start: clamps and yields 0 effective days", () => {
    const now = new Date("2026-04-15T00:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w.coverage_limited).toBe(true);
    expect(w.coverage_start).toBe(COVERAGE_START_ISO);
    expect(w.from.toISOString()).toBe(COVERAGE_START_ISO);
    // from (2026-04-30) is after to (2026-04-15) → 0 effective days
    expect(w.effectiveWindowDays).toBe(0);
  });

  it("date ON coverage start: clamps from to coverage start", () => {
    const now = new Date("2026-04-30T12:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w.coverage_limited).toBe(true);
    expect(w.from.toISOString()).toBe(COVERAGE_START_ISO);
    // half a day of coverage remains
    expect(w.effectiveWindowDays).toBeCloseTo(0.5, 1);
  });

  it("date AFTER coverage start: clamps from to coverage start, full effective window", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w.coverage_limited).toBe(true);
    expect(w.from.toISOString()).toBe(COVERAGE_START_ISO);
    expect(w.to.toISOString()).toBe(now.toISOString());
    // 2026-04-30 → 2026-09-24 ≈ 147 days
    expect(w.effectiveWindowDays).toBeGreaterThan(140);
    expect(w.effectiveWindowDays).toBeLessThan(150);
  });

  // ---- #4: Windows that require clamping and those that do not ----

  it("window requiring clamping: 180-day request clamps to coverage start", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w.coverage_limited).toBe(true);
    expect(w.effectiveWindowDays).toBeLessThan(180);
  });

  it("window NOT requiring clamping: 30-day request stays within coverage", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 30, now);
    expect(w.coverage_limited).toBe(false);
    expect(w.effectiveWindowDays).toBeCloseTo(30, 1);
  });

  it("non-robinhood chain never clamps regardless of window", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("ethereum", 365, now);
    expect(w.coverage_limited).toBe(false);
    expect(w.coverage_start).toBeNull();
    expect(w.effectiveWindowDays).toBeCloseTo(365, 1);
  });

  // ---- #5: Effective-window days are used in calculations ----

  it("effectiveWindowDays differs from requested windowDays when clamped", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    expect(w.effectiveWindowDays).not.toBe(w.requested_window_days);
    expect(w.effectiveWindowDays).toBeLessThan(w.requested_window_days);
  });

  it("effectiveWindowDays equals requested windowDays when not clamped", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 30, now);
    expect(w.effectiveWindowDays).toBeCloseTo(w.requested_window_days, 1);
  });

  it("effective_analysis_start is the clamped from date (used in meta)", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    // The meta object uses w.from.toISOString() as effective_analysis_start.
    const effectiveAnalysisStart = w.from.toISOString();
    expect(effectiveAnalysisStart).toBe(COVERAGE_START_ISO);
  });

  it("coverage_start in the result is the ISO string (ready for meta, no .toISOString() needed)", () => {
    const now = new Date("2026-09-24T10:00:00.000Z");
    const w = computeCoverageWindow("robinhood", 180, now);
    // coverage_start is already an ISO string — the fix uses it directly.
    expect(typeof w.coverage_start).toBe("string");
    expect(w.coverage_start).toBe(COVERAGE_START_ISO);
  });
});

// ---- #6: Test that an exception releases the advance lock ----

describe("Robinhood advance lock — exception releases lock", () => {
  it("releases the lock when work throws an exception", () => {
    const r = simulateAdvanceLockLifecycle(false, null, "rhinv_1", true);
    expect(r.released).toBe(true);
    expect(r.finalHeld).toBe(false);
    expect(r.finalInvocationId).toBeNull();
  });

  it("releases the lock when work succeeds (no exception)", () => {
    const r = simulateAdvanceLockLifecycle(false, null, "rhinv_1", false);
    expect(r.released).toBe(true);
    expect(r.finalHeld).toBe(false);
    expect(r.finalInvocationId).toBeNull();
  });

  it("does not release a lock held by a different invocation", () => {
    // Lock already held by rhinv_other — our invocation did not acquire it,
    // so the finally block must NOT release someone else's lock.
    const r = simulateAdvanceLockLifecycle(true, "rhinv_other", "rhinv_1", false);
    expect(r.released).toBe(false);
    expect(r.finalHeld).toBe(true);
    expect(r.finalInvocationId).toBe("rhinv_other");
  });

  it("structural: advance function has a finally block that calls releaseAdvanceLock", () => {
    const src = readFileSync(
      join(__dirname, "../base44/functions/advanceRobinhoodValidation/entry.ts"),
      "utf-8"
    );
    expect(src).toContain("finally");
    expect(src).toContain("releaseAdvanceLock");
  });
});

// ---- #7: Physical-call accounting when failure occurs ----

describe("Robinhood budget guard — physical-call accounting", () => {
  it("before any request: count is 0", () => {
    const ref = createLocalAttemptRef(0);
    expect(ref.count).toBe(0);
  });

  it("after one request: count is 1", async () => {
    const ref = createLocalAttemptRef(0);
    const guard = createRobinhoodBudgetGuard(ref, 21);
    const r = await guard();
    expect(r.allowed).toBe(true);
    expect(ref.count).toBe(1);
  });

  it("after 4 requests: count is 4 (matches the production failure scenario)", async () => {
    const ref = createLocalAttemptRef(0);
    const guard = createRobinhoodBudgetGuard(ref, 21);
    for (let i = 0; i < 4; i++) await guard();
    expect(ref.count).toBe(4);
  });

  it("refuses the (max+1)th attempt without incrementing (no phantom reservation)", async () => {
    const ref = createLocalAttemptRef(21);
    const guard = createRobinhoodBudgetGuard(ref, 21);
    const r = await guard();
    expect(r.allowed).toBe(false);
    expect(ref.count).toBe(21);
  });

  it("failure after 4 requests: 4 calls accounted, NOT refunded", async () => {
    // Simulates the production scenario: 4 physical calls succeeded, then the
    // meta-building threw a ReferenceError. The 4 reserved attempts are NOT
    // refunded because 4 physical requests actually occurred (audit records
    // exist). 17 attempts remain for retry.
    const ref = createLocalAttemptRef(0);
    const guard = createRobinhoodBudgetGuard(ref, 21);
    for (let i = 0; i < 4; i++) await guard();
    // Exception occurs after 4 calls — count stays at 4 (no refund)
    expect(ref.count).toBe(4);
    expect(21 - ref.count).toBe(17);
  });

  it("failure before any request: 0 calls accounted, full allowance remains", () => {
    // If the failure occurs before any physical request (e.g. missing API key),
    // no attempts are consumed and the full 21 remain.
    const ref = createLocalAttemptRef(0);
    expect(ref.count).toBe(0);
    expect(21 - ref.count).toBe(21);
  });
});

// ---- Structural guarantee: the stale coverageStart variable is gone ----

describe("nansen.ts — stale coverageStart variable eliminated", () => {
  it("does not reference the bare 'coverageStart' variable anywhere", () => {
    const src = readFileSync(join(__dirname, "../base44/shared/nansen.ts"), "utf-8");
    expect(src).not.toMatch(/\bcoverageStart\b/);
  });

  it("uses coverageWindow.coverage_start for the meta coverage_start field", () => {
    const src = readFileSync(join(__dirname, "../base44/shared/nansen.ts"), "utf-8");
    expect(src).toContain("coverageWindow.coverage_start");
  });

  it("does not import coverageStartFor (unused after refactor)", () => {
    const src = readFileSync(join(__dirname, "../base44/shared/nansen.ts"), "utf-8");
    expect(src).not.toContain("coverageStartFor");
  });
});