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
// current_wallet_address or started_by_user_id.
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
    started_at: allowance.started_at || null,
    updated_at: allowance.updated_at || null
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
// one attempt from the shared 21-attempt budget.
export async function incrementAttempts(base44, amount: number): Promise<{ ok: boolean; allowance: any }> {
  const existing = await ensureAllowance(base44);
  const result = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
    { id: existing.id, version: existing.version },
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