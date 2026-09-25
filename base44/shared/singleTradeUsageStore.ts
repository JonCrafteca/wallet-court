// Wallet Court — Single Trade Trial usage policy store. Server-side only.
// Uses base44.asServiceRole to read/write the SingleTradeUsagePolicy
// singleton. Imported by backend functions; never imported by client code.
//
// This store provides:
//   - getPolicy / ensurePolicy / savePolicy (admin settings)
//   - reservePhysicalCall (CAS per-attempt budget reservation)
//   - resetDailyUsageIfNeeded (date-rollover counter reset)
//   - acquireCreationLock / releaseCreationLock (trial-creation mutex)
//   - countRecentSelections / countRecentTrials (rate-limit checks)
//
// CRITICAL: This store NEVER calls the legacy calibration/Robinhood
// budget function. Single Trade has its own independent daily budget.

import {
  CONTROL_KEY,
  defaultUsagePolicy,
  todayUtcStr,
  needsDailyReset,
  canReserveCall,
  buildReserveCallCasFilter,
  buildReserveCallCasUpdate,
  buildDailyResetCas,
  canDiscover,
  canAnalyze,
  canReclaimCreationLock,
  buildCreationLockCasFilter,
  newCreationLockId,
  CREATION_LOCK_RETRY_DELAY_MS,
  CREATION_LOCK_MAX_ATTEMPTS,
  sanitizePolicyForAdmin
} from "./singleTradeUsagePolicy.ts";

const ENTITY = "SingleTradeUsagePolicy";

// ---- Singleton access ----

export async function getPolicy(base44): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Ensure the singleton exists. Creates with defaults if missing. NEVER
// creates when the record already exists (unlike ensureFeatureFlag, this
// does not auto-enable).
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
  throw new Error("Failed to ensure Single Trade usage policy singleton.");
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
    daily_physical_call_limit: fields.daily_physical_call_limit ?? existing.daily_physical_call_limit,
    discoveries_per_wallet_per_hour: fields.discoveries_per_wallet_per_hour ?? existing.discoveries_per_wallet_per_hour,
    analyses_per_wallet_per_day: fields.analyses_per_wallet_per_day ?? existing.analyses_per_wallet_per_day,
    emergency_stop: fields.emergency_stop ?? existing.emergency_stop,
    version: newVersion,
    updated_at: now
  });
}

// Admin-safe serialization for the admin dashboard.
export async function getPolicyForAdmin(base44): Promise<Record<string, any> | null> {
  const policy = await getPolicyOrDefault(base44);
  return sanitizePolicyForAdmin(policy);
}

// ---- Daily reset ----

// If the usage_date has changed, atomically reset the counter. Returns the
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

// Reserve one physical Nansen call. Atomically increments the daily counter
// via CAS. Returns { allowed, reason, policy }. When allowed, the counter
// was incremented. When denied, the counter was NOT incremented.
//
// This does NOT check the legacy 1,020 ceiling. Single Trade has its own
// independent daily budget.
export async function reservePhysicalCall(base44): Promise<{ allowed: boolean; reason: string; policy: any }> {
  // Ensure daily reset first.
  let policy = await resetDailyUsageIfNeeded(base44);
  if (!policy) {
    // No policy record — create with defaults (disabled).
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

// ---- Rate-limit helpers ----

// Count selections created for this wallet in the last hour.
export async function countRecentSelections(base44, normalizedWallet: string, network: string): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const records = await base44.asServiceRole.entities.SingleTradePurchaseSelection.filter(
    {
      normalized_wallet_address: normalizedWallet,
      network,
      created_at: { $gte: oneHourAgo }
    },
    "-created_date",
    100
  );
  return records ? records.length : 0;
}

// Count trials created for this wallet today.
export async function countRecentTrials(base44, normalizedWallet: string, network: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const records = await base44.asServiceRole.entities.SingleTradeTrial.filter(
    {
      normalized_wallet_address: normalizedWallet,
      network,
      created_date: { $gte: todayStart.toISOString() }
    },
    "-created_date",
    100
  );
  return records ? records.length : 0;
}

// Check discovery rate limit for a wallet.
export async function checkDiscoveryRateLimit(base44, normalizedWallet: string, network: string): Promise<{ allowed: boolean; reason: string }> {
  const policy = await getPolicyOrDefault(base44);
  const count = await countRecentSelections(base44, normalizedWallet, network);
  return canDiscover(policy, count);
}

// Check analysis rate limit for a wallet.
export async function checkAnalysisRateLimit(base44, normalizedWallet: string, network: string): Promise<{ allowed: boolean; reason: string }> {
  const policy = await getPolicyOrDefault(base44);
  const count = await countRecentTrials(base44, normalizedWallet, network);
  return canAnalyze(policy, count);
}

// ---- Trial creation mutex lock ----

// Acquire the creation mutex lock on the usage policy singleton. Returns
// { acquired, lockId, policy } or { acquired: false, policy } after retries.
// The lock is global (not per-fingerprint) but creation frequency is low
// (user-initiated), so this is acceptable.
export async function acquireCreationLock(base44): Promise<{ acquired: boolean; lockId: string | null; policy: any }> {
  const lockId = newCreationLockId();
  const now = new Date().toISOString();

  for (let attempt = 0; attempt < CREATION_LOCK_MAX_ATTEMPTS; attempt++) {
    const policy = await getPolicy(base44);
    if (!policy) {
      return { acquired: false, lockId: null, policy: null };
    }
    const casFilter = buildCreationLockCasFilter(policy, Date.now());
    if (!casFilter) {
      // Lock is freshly held — wait and retry.
      await new Promise(r => setTimeout(r, CREATION_LOCK_RETRY_DELAY_MS));
      continue;
    }
    const result = await base44.asServiceRole.entities[ENTITY].updateMany(
      casFilter,
      {
        $set: {
          creation_lock_id: lockId,
          creation_lock_acquired_at: now
        },
        $inc: { version: 1 }
      }
    );
    if (result && result.updated === 1) {
      return { acquired: true, lockId, policy };
    }
    // CAS failed — retry.
    await new Promise(r => setTimeout(r, CREATION_LOCK_RETRY_DELAY_MS));
  }
  const finalPolicy = await getPolicy(base44);
  return { acquired: false, lockId: null, policy: finalPolicy };
}

// Release the creation mutex lock. Always succeeds (best-effort).
export async function releaseCreationLock(base44, lockId: string): Promise<void> {
  if (!lockId) return;
  await base44.asServiceRole.entities[ENTITY].updateMany(
    { control_key: CONTROL_KEY, creation_lock_id: lockId },
    {
      $set: {
        creation_lock_id: null,
        creation_lock_acquired_at: null
      },
      $inc: { version: 1 }
    }
  ).catch(() => {});
}