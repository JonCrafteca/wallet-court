// Wallet Court — Isolated Robinhood Validation Allowance. Pure logic + DB
// helpers. Server-side only. No SDK in the pure functions; DB helpers use
// asServiceRole.
//
// This module owns the 21-attempt / 5-wallet isolated allowance for Robinhood
// chain validation. It is COMPLETELY SEPARATE from the existing 1,000-call
// calibration campaign:
//   - Uses its own entity (RobinhoodValidationAllowance), not CalibrationControl.
//   - Does NOT acquire or release the campaign lock.
//   - Does NOT mutate CalibrationRun, CalibrationDocketItem, or CalibrationControl.
//   - Robinhood calls still increment the truthful global NansenApiCallAudit
//     total (they create audit records), but do NOT change the campaign state
//     or raise the global 1,020 ceiling.
//
// The 21-attempt budget is shared between wallet analyses AND discovery.
// Each physical outbound Nansen attempt (including retries and failures)
// counts against 21. A per-physical-attempt budget guard enforces this at
// the transport boundary — the guard refuses the 22nd attempt before it
// leaves the process.

import type { BudgetGuard, BudgetGuardResult } from "./nansenTelemetry.ts";

// ---- Constants ----

export const RH_MAX_WALLETS = 5;
export const RH_MAX_ATTEMPTS = 21;

// Stale advance lock timeout: 5 minutes. A normal wallet analysis (4 endpoints,
// 20s timeout each) completes well within this window. If a serverless
// invocation crashes without releasing the lock, a new invocation can reclaim
// it after this timeout.
export const ADVANCE_LOCK_STALE_TIMEOUT_MS = 300000;

// The legacy calibration ceiling. Robinhood validation may exceed this by up to
// max_attempts (21), but only when carrying the robinhood_validation context.
export const LEGACY_CEILING = 1020;

export const RH_STATUS = {
  NOT_STARTED: "not_started",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
  EXHAUSTED: "exhausted",
  CIRCUIT_OPEN: "circuit_open",
  ERROR: "error"
} as const;

export const RH_WALLET_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped"
} as const;

export const RH_TERMINAL_STATUSES = new Set<string>([
  RH_STATUS.STOPPED,
  RH_STATUS.EXHAUSTED,
  RH_STATUS.CIRCUIT_OPEN,
  RH_STATUS.ERROR
]);

const CONTROL_KEY = "main";

// ---- Pure logic ----

// Can we start the next wallet? Checks status, wallet count, and attempt count.
export function canStartWallet(allowance: any): { allowed: boolean; reason: string } {
  if (!allowance) return { allowed: false, reason: "Allowance not initialized." };
  if (allowance.status !== RH_STATUS.RUNNING) {
    return { allowed: false, reason: `Validation is ${allowance.status}.` };
  }
  if (allowance.wallets_started >= allowance.max_wallets) {
    return { allowed: false, reason: `Maximum ${allowance.max_wallets} wallets reached.` };
  }
  if (allowance.attempts_used >= allowance.max_attempts) {
    return { allowed: false, reason: `Maximum ${allowance.max_attempts} attempts reached.` };
  }
  return { allowed: true, reason: "" };
}

// Is the allowance exhausted (attempts used >= max)?
export function isExhausted(allowance: any): boolean {
  return !!(allowance && allowance.attempts_used >= allowance.max_attempts);
}

// Should validation stop? Checks circuit, exhaustion, and wallet count.
export function shouldStop(
  allowance: any,
  circuitOpen: boolean
): { stop: boolean; reason: string; newStatus: string | null } {
  if (circuitOpen) {
    return { stop: true, reason: "Provider circuit is open (shared Nansen CircuitBreaker).", newStatus: RH_STATUS.CIRCUIT_OPEN };
  }
  if (isExhausted(allowance)) {
    return { stop: true, reason: `Allowance exhausted (${allowance.max_attempts} physical attempts).`, newStatus: RH_STATUS.EXHAUSTED };
  }
  if (allowance && allowance.wallets_started >= allowance.max_wallets && allowance.wallets_completed >= allowance.wallets_started) {
    return { stop: true, reason: `All ${allowance.max_wallets} wallets processed.`, newStatus: RH_STATUS.STOPPED };
  }
  return { stop: false, reason: "", newStatus: null };
}

// Compute the maximum authorized global total for this validation run.
// Formula: starting_global_total + max_attempts.
// With a starting value of 1,001 and 21 attempts, the absolute maximum is 1,022.
// This is HIGHER than the legacy 1,020 ceiling — the exception is authorized
// ONLY for authenticated robinhood_validation context. All other traffic remains
// bound by the 1,020 ceiling.
export function computeValidationMaxTotal(allowance: any): number | null {
  if (!allowance || allowance.starting_global_total == null) return null;
  return allowance.starting_global_total + (allowance.max_attempts || RH_MAX_ATTEMPTS);
}

// Remaining attempts in the allowance.
export function remainingAttempts(allowance: any): number {
  if (!allowance) return RH_MAX_ATTEMPTS;
  return Math.max(0, allowance.max_attempts - (allowance.attempts_used || 0));
}

// Remaining wallets in the allowance.
export function remainingWallets(allowance: any): number {
  if (!allowance) return RH_MAX_WALLETS;
  return Math.max(0, allowance.max_wallets - (allowance.wallets_started || 0));
}

// Sanitize the allowance for dashboard responses. Never includes
// current_wallet_address, started_by_user_id, or advance_lock_invocation_id.
// Includes ceiling context: legacy_ceiling (1,020) and validation_max_total
// (starting_global_total + max_attempts, e.g. 1,022 when starting at 1,001).
export function sanitizeAllowance(allowance: any): Record<string, any> {
  if (!allowance) return null;
  return {
    status: allowance.status || RH_STATUS.NOT_STARTED,
    wallets_started: allowance.wallets_started ?? 0,
    wallets_completed: allowance.wallets_completed ?? 0,
    attempts_used: allowance.attempts_used ?? 0,
    max_wallets: allowance.max_wallets ?? RH_MAX_WALLETS,
    max_attempts: allowance.max_attempts ?? RH_MAX_ATTEMPTS,
    remaining_wallets: remainingWallets(allowance),
    remaining_attempts: remainingAttempts(allowance),
    current_address_short: allowance.current_address_short || null,
    current_wallet_started_at: allowance.current_wallet_started_at || null,
    current_calls_used: allowance.current_calls_used ?? null,
    stop_reason: allowance.stop_reason || null,
    endpoint_successes: allowance.endpoint_successes ?? 0,
    endpoint_failures: allowance.endpoint_failures ?? 0,
    starting_global_total: allowance.starting_global_total ?? null,
    validation_max_total: computeValidationMaxTotal(allowance),
    legacy_ceiling: LEGACY_CEILING,
    started_at: allowance.started_at || null,
    updated_at: allowance.updated_at || null,
    robinhood_public_enabled: allowance.robinhood_public_enabled ?? false
  };
}

// ---- Per-physical-attempt budget guard ----

// A mutable container for the local attempt counter. The guard increments
// it synchronously before each allowed physical attempt.
export interface LocalAttemptRef { count: number }

export function createLocalAttemptRef(initial: number): LocalAttemptRef {
  return { count: initial };
}

// Create a budget guard that checks the local attempt count against maxAttempts.
// The guard increments the count synchronously BEFORE allowing the physical
// attempt. If the count is already at max, the guard refuses and does NOT
// increment. This ensures exactly maxAttempts physical attempts are allowed.
//
// The guard body is synchronous (no await), so the check+increment is atomic
// with respect to other guards — even with concurrent endpoints, JavaScript's
// single-threaded event loop serializes the synchronous bodies.
export function createRobinhoodBudgetGuard(ref: LocalAttemptRef, maxAttempts: number): BudgetGuard {
  return async (): Promise<BudgetGuardResult> => {
    if (ref.count >= maxAttempts) {
      return { allowed: false, verifiedTotal: 0, reason: `Robinhood allowance exhausted (${maxAttempts} attempts).` };
    }
    ref.count++;
    return { allowed: true, verifiedTotal: ref.count, reason: "" };
  };
}

// ---- ID generators ----

export function newRobinhoodWalletId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "rhv_" + crypto.randomUUID();
  }
  return "rhv_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- DB helpers ----

// Read the singleton allowance record, or null if it doesn't exist yet.
export async function getAllowance(base44): Promise<any> {
  const records = await base44.asServiceRole.entities.RobinhoodValidationAllowance.filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Ensure the allowance record exists (create with defaults if missing).
export async function ensureAllowance(base44): Promise<any> {
  const existing = await getAllowance(base44);
  if (existing) return existing;
  try {
    await base44.asServiceRole.entities.RobinhoodValidationAllowance.create({
      control_key: CONTROL_KEY,
      version: 0,
      status: RH_STATUS.NOT_STARTED,
      wallets_started: 0,
      wallets_completed: 0,
      attempts_used: 0,
      max_wallets: RH_MAX_WALLETS,
      max_attempts: RH_MAX_ATTEMPTS,
      endpoint_successes: 0,
      endpoint_failures: 0,
      updated_at: new Date().toISOString()
    });
  } catch {
    // Create failed (e.g. duplicate) — fall through to re-read.
  }
  const afterCreate = await getAllowance(base44);
  if (afterCreate) return afterCreate;
  throw new Error("Failed to ensure Robinhood validation allowance singleton.");
}

// Update the allowance record with new fields, bumping the CAS version.
export async function updateAllowance(base44, fields: Record<string, any>): Promise<any> {
  const existing = await ensureAllowance(base44);
  const newVersion = (existing?.version || 0) + 1;
  return base44.asServiceRole.entities.RobinhoodValidationAllowance.update(existing.id, {
    ...fields,
    version: newVersion,
    updated_at: new Date().toISOString()
  });
}

// Atomically increment attempts_used via CAS. Used by discovery to consume
// one attempt from the shared 21-attempt budget. Refuses if the allowance is
// already exhausted (attempts_used >= max_attempts) so discovery cannot push
// the total past 21.
export async function incrementAttempts(base44, amount: number): Promise<{ ok: boolean; allowance: any }> {
  const existing = await ensureAllowance(base44);
  const current = existing.attempts_used || 0;
  const max = existing.max_attempts || RH_MAX_ATTEMPTS;
  if (current + amount > max) {
    return { ok: false, allowance: existing };
  }
  const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
    { id: existing.id, attempts_used: current, version: existing.version },
    {
      $inc: { attempts_used: amount, version: 1 },
      $set: { updated_at: new Date().toISOString() }
    }
  );
  if (result && result.updated === 1) {
    return { ok: true, allowance: await getAllowance(base44) };
  }
  // CAS failed — re-read and return current state
  return { ok: false, allowance: await getAllowance(base44) };
}

// ---- Cross-invocation advance lock ----

// Generate a unique invocation ID for the advance lock.
export function newInvocationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "rhinv_" + crypto.randomUUID();
  }
  return "rhinv_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// Acquire the advance lock via CAS. Only one invocation can hold the lock at a
// time. If the lock is held but stale (acquired_at older than
// ADVANCE_LOCK_STALE_TIMEOUT_MS), it is reclaimed. Returns { acquired, stale }
// so the caller knows whether a stale lock was recovered.
export async function acquireAdvanceLock(
  base44,
  invocationId: string,
  now: number = Date.now()
): Promise<{ acquired: boolean; stale: boolean }> {
  const existing = await ensureAllowance(base44);

  // If lock is not held, try to acquire it
  if (!existing.advance_lock_held) {
    const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
      { id: existing.id, advance_lock_held: false, version: existing.version },
      {
        $set: {
          advance_lock_held: true,
          advance_lock_acquired_at: new Date().toISOString(),
          advance_lock_invocation_id: invocationId
        },
        $inc: { version: 1 }
      }
    );
    return { acquired: !!(result && result.updated === 1), stale: false };
  }

  // Lock is held — check if it's stale
  const acquiredAtMs = existing.advance_lock_acquired_at
    ? new Date(existing.advance_lock_acquired_at).getTime()
    : 0;
  const isStale = (now - acquiredAtMs) > ADVANCE_LOCK_STALE_TIMEOUT_MS;

  if (isStale) {
    // Reclaim the stale lock
    const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
      { id: existing.id, advance_lock_held: true, version: existing.version },
      {
        $set: {
          advance_lock_held: true,
          advance_lock_acquired_at: new Date().toISOString(),
          advance_lock_invocation_id: invocationId
        },
        $inc: { version: 1 }
      }
    );
    return { acquired: !!(result && result.updated === 1), stale: true };
  }

  return { acquired: false, stale: false };
}

// Release the advance lock. Only the invocation that holds the lock can
// release it (validated via advance_lock_invocation_id in the CAS filter).
export async function releaseAdvanceLock(base44, invocationId: string): Promise<boolean> {
  const existing = await getAllowance(base44);
  if (!existing) return false;
  const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
    { id: existing.id, advance_lock_invocation_id: invocationId },
    {
      $set: {
        advance_lock_held: false,
        advance_lock_acquired_at: null,
        advance_lock_invocation_id: null
      },
      $inc: { version: 1 }
    }
  );
  return !!(result && result.updated === 1);
}

// ---- Persistent per-attempt reservation ----

// Atomically reserve one physical attempt by incrementing attempts_used via
// CAS. The CAS filter checks that attempts_used is still the expected value,
// preventing two concurrent invocations from both reserving the same slot.
// Refuses if attempts_used is already at max_attempts. This is the persistent
// equivalent of the local counter — it survives across serverless invocations.
export async function reserveAttemptPersistently(
  base44,
  maxAttempts: number
): Promise<{ allowed: boolean; newCount: number }> {
  const existing = await ensureAllowance(base44);
  const current = existing.attempts_used || 0;
  if (current >= maxAttempts) {
    return { allowed: false, newCount: current };
  }
  // CAS: only increment if attempts_used is still `current`
  const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
    { id: existing.id, attempts_used: current },
    {
      $inc: { attempts_used: 1, version: 1 },
      $set: { updated_at: new Date().toISOString() }
    }
  );
  if (result && result.updated === 1) {
    return { allowed: true, newCount: current + 1 };
  }
  // CAS failed — re-read and check
  const refreshed = await getAllowance(base44);
  const refreshedCount = refreshed?.attempts_used || 0;
  if (refreshedCount >= maxAttempts) {
    return { allowed: false, newCount: refreshedCount };
  }
  // Retry once with the refreshed value
  const retryResult = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
    { id: refreshed.id, attempts_used: refreshedCount },
    {
      $inc: { attempts_used: 1, version: 1 },
      $set: { updated_at: new Date().toISOString() }
    }
  );
  if (retryResult && retryResult.updated === 1) {
    return { allowed: true, newCount: refreshedCount + 1 };
  }
  return { allowed: false, newCount: refreshedCount };
}

// Create a persistent budget guard that reserves each physical attempt via CAS
// before allowing the outbound Nansen request. Unlike the local-counter guard,
// this is safe across serverless invocations, multiple tabs, and double-clicks.
export function createPersistentRobinhoodBudgetGuard(base44, maxAttempts: number): BudgetGuard {
  return async (): Promise<BudgetGuardResult> => {
    const result = await reserveAttemptPersistently(base44, maxAttempts);
    if (!result.allowed) {
      return { allowed: false, verifiedTotal: result.newCount, reason: `Robinhood allowance exhausted (${maxAttempts} attempts).` };
    }
    return { allowed: true, verifiedTotal: result.newCount, reason: "" };
  };
}