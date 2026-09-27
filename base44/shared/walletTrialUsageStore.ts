// Wallet Court — Whole-Wallet Production Trial usage policy store. Server-side
// only. Uses base44.asServiceRole to read/write the WalletTrialUsagePolicy
// singleton. Imported by backend functions; never imported by client code.
//
// This store provides:
//   - getPolicy / ensurePolicy / getPolicyOrDefault / savePolicy (admin settings)
//   - resetDailyUsageIfNeeded (date-rollover counter reset)
//   - reserveProductionCall (CAS per-attempt budget reservation)
//   - completeProductionCalls (convert reservations to completed usage)
//   - releaseProductionCalls (refund unused reservations when no HTTP request was made)
//
// CRITICAL: This store NEVER calls the legacy calibration/Robinhood/Single Trade
// budget functions. Production whole-wallet trials have their own independent
// daily budget. The calibration ceiling (1,020), Single Trade policy, and
// Robinhood allowance remain unchanged and are never consulted by any code path
// in this module.

import {
  CONTROL_KEY,
  defaultUsagePolicy,
  todayUtcStr,
  needsDailyReset,
  canReserveCall,
  buildReserveCallCasFilter,
  buildReserveCallCasUpdate,
  buildCompleteCallsCasUpdate,
  buildReleaseCallsCasUpdate,
  buildDailyResetCas,
  sanitizePolicyForAdmin
} from "./walletTrialUsagePolicy.ts";

const ENTITY = "WalletTrialUsagePolicy";

// ---- Singleton access ----

export async function getPolicy(base44): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Ensure the singleton exists. Creates with defaults if missing.
export async function ensurePolicy(base44): Promise<any> {
  const existing = await getPolicy(base44);
  if (existing) return existing;
  try {
    await base44.asServiceRole.entities[ENTITY].create({
      ...defaultUsagePolicy(),
      updated_at: new Date().toISOString()
    });
  } catch {
    // Create failed (e.g. duplicate) — fall through to re-read.
  }
  const afterCreate = await getPolicy(base44);
  if (afterCreate) return afterCreate;
  throw new Error("Failed to ensure Wallet Trial usage policy singleton.");
}

// Read policy or return defaults. NEVER creates — viewing must not mutate.
export async function getPolicyOrDefault(base44): Promise<any> {
  const existing = await getPolicy(base44);
  if (existing) return existing;
  return defaultUsagePolicy();
}

// Save admin settings. Admin-only (caller must verify auth). Uses CAS.
export async function savePolicy(base44, fields: Record<string, any>): Promise<any> {
  const existing = await ensurePolicy(base44);
  const now = new Date().toISOString();
  const newVersion = (existing.version || 0) + 1;
  return base44.asServiceRole.entities[ENTITY].update(existing.id, {
    enabled: fields.enabled ?? existing.enabled,
    daily_call_limit: fields.daily_call_limit ?? existing.daily_call_limit,
    emergency_stop: fields.emergency_stop ?? existing.emergency_stop,
    version: newVersion,
    updated_at: now,
    updated_by_user_id: fields.updated_by_user_id ?? null
  });
}

// Admin-safe serialization for the admin dashboard.
export async function getPolicyForAdmin(base44): Promise<Record<string, any> | null> {
  const policy = await getPolicyOrDefault(base44);
  return sanitizePolicyForAdmin(policy);
}

// ---- Daily reset ----

// If the usage_date has changed, atomically reset both counters. Returns the
// updated policy (re-read after reset if needed).
export async function resetDailyUsageIfNeeded(base44): Promise<any> {
  const policy = await getPolicy(base44);
  if (!policy) return null;
  const today = todayUtcStr();
  if (!needsDailyReset(policy, today)) return policy;
  const cas = buildDailyResetCas(policy, today);
  if (!cas) return policy;
  await base44.asServiceRole.entities[ENTITY].updateMany(cas.filter, cas.update);
  // Re-read after reset.
  return getPolicy(base44);
}

// ---- Physical call reservation ----

// Reserve one physical Nansen call. Atomically increments calls_reserved via
// CAS. Returns { allowed, reason, policy }. When allowed, the counter was
// incremented. When denied, the counter was NOT incremented.
//
// This does NOT check the legacy 1,020 ceiling. Production has its own
// independent daily budget.
export async function reserveProductionCall(base44): Promise<{ allowed: boolean; reason: string; policy: any }> {
  // Ensure daily reset first.
  let policy = await resetDailyUsageIfNeeded(base44);
  if (!policy) {
    // No policy record — create with defaults (enabled).
    policy = await ensurePolicy(base44);
  }
  const today = todayUtcStr();
  const check = canReserveCall(policy, today);
  if (!check.allowed) return { allowed: false, reason: check.reason, policy };

  const filter = buildReserveCallCasFilter(policy, today);
  if (!filter) return { allowed: false, reason: "Cannot reserve call (date rollover or limit reached).", policy };

  const now = new Date().toISOString();
  const result = await base44.asServiceRole.entities[ENTITY].updateMany(
    filter,
    buildReserveCallCasUpdate(now)
  );
  if (result && result.updated === 1) {
    // Reservation succeeded. Return the updated policy (re-read for accuracy).
    const updated = await getPolicy(base44);
    return { allowed: true, reason: "", policy: updated || policy };
  }
  // CAS failed — another concurrent reservation won the slot, or the policy
  // changed between read and write. Re-read and re-check.
  const refreshed = await getPolicy(base44);
  const recheck = canReserveCall(refreshed, today);
  return { allowed: recheck.allowed, reason: recheck.reason, policy: refreshed };
}

// Complete N physical calls — convert reservations to completed usage. Called
// after N physical HTTP requests occurred (regardless of HTTP result). Never
// refunds: a physical request that was attempted (even if it failed with a
// network error) counts as completed usage. Best-effort: if the CAS fails
// (concurrent admin save or daily reset), the audit records remain the source
// of truth.
export async function completeProductionCalls(base44, count: number): Promise<boolean> {
  if (!count || count <= 0) return true;
  const policy = await getPolicy(base44);
  if (!policy) return false;
  const now = new Date().toISOString();
  const result = await base44.asServiceRole.entities[ENTITY].updateMany(
    { control_key: CONTROL_KEY, version: policy.version },
    buildCompleteCallsCasUpdate(count, now)
  );
  return !!(result && result.updated === 1);
}

// Release N unused reservations — refund reservations that did NOT result in a
// physical HTTP request. Only called when a reservation succeeded but the
// request was never made (e.g., a higher-level guard blocked after the
// reservation, or a pre-HTTP error). NEVER called after a physical request
// occurred. Best-effort: if the CAS fails, the daily reset will clean up.
export async function releaseProductionCalls(base44, count: number): Promise<boolean> {
  if (!count || count <= 0) return true;
  const policy = await getPolicy(base44);
  if (!policy) return false;
  const now = new Date().toISOString();
  const result = await base44.asServiceRole.entities[ENTITY].updateMany(
    { control_key: CONTROL_KEY, version: policy.version, calls_reserved: { $gte: count } },
    buildReleaseCallsCasUpdate(count, now)
  );
  return !!(result && result.updated === 1);
}