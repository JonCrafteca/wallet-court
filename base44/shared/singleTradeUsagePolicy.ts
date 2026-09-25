// Wallet Court — Single Trade Trial usage policy pure logic. No SDK, no
// network, no side effects. Imported by backend functions and unit-tested
// in isolation.
//
// This module owns: default policy values, daily-reset detection, budget
// reservation decisions, rate-limit checks, emergency-stop checks, and the
// CAS mutex-lock filters for trial creation serialization.
//
// CRITICAL: Single Trade Trial does NOT use the legacy 1,020 calibration
// ceiling. It has its own independent daily budget. The calibration and
// Robinhood validation ceilings remain unchanged and are never consulted
// by any code path in this module.

export const CONTROL_KEY = "main";

// Default policy values. The singleton is created with these when it doesn't
// exist yet. enabled defaults to FALSE — an admin must explicitly turn it on.
export function defaultUsagePolicy(): Record<string, any> {
  const today = todayUtcStr();
  return {
    control_key: CONTROL_KEY,
    version: 0,
    enabled: false,
    daily_physical_call_limit: 100,
    physical_calls_used_today: 0,
    usage_date: today,
    discoveries_per_wallet_per_hour: 3,
    analyses_per_wallet_per_day: 5,
    emergency_stop: false,
    creation_lock_id: null,
    creation_lock_acquired_at: null,
    updated_at: null
  };
}

// ---- Date helpers ----

export function todayUtcStr(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Does the policy need a daily reset? True when usage_date != today.
export function needsDailyReset(policy: any, todayStr: string = todayUtcStr()): boolean {
  if (!policy || !policy.usage_date) return true;
  return policy.usage_date !== todayStr;
}

// ---- Budget reservation ----

// Check whether a physical call can be reserved. Returns { allowed, reason }.
// Does NOT check the legacy 1,020 ceiling — Single Trade has its own budget.
export function canReserveCall(policy: any, todayStr: string = todayUtcStr()): { allowed: boolean; reason: string } {
  if (!policy) return { allowed: false, reason: "Usage policy not loaded." };
  if (!policy.enabled) return { allowed: false, reason: "Single Trade Trial is not enabled." };
  if (policy.emergency_stop) return { allowed: false, reason: "Emergency stop is active." };
  // If the date changed, the counter is stale — treat as 0 used.
  const usedToday = needsDailyReset(policy, todayStr) ? 0 : (policy.physical_calls_used_today || 0);
  const limit = policy.daily_physical_call_limit ?? 100;
  if (usedToday >= limit) {
    return { allowed: false, reason: `Daily physical call limit (${limit}) reached.` };
  }
  return { allowed: true, reason: "" };
}

// Build the CAS filter for reserving one physical call. The filter matches
// only when: the singleton key matches, emergency_stop is false, the usage
// date is current (or the counter is 0 — meaning a fresh day), and the
// counter is below the limit. The $inc atomically increments the counter.
//
// When the date has changed, the caller should first call resetDailyUsage,
// then call reserveCall. The reset is a separate CAS so the counter is
// zeroed before the reservation.
export function buildReserveCallCasFilter(policy: any, todayStr: string = todayUtcStr()): Record<string, any> | null {
  if (!policy) return null;
  const check = canReserveCall(policy, todayStr);
  if (!check.allowed) return null;
  // If the date changed, the caller must reset first.
  if (needsDailyReset(policy, todayStr)) return null;
  return {
    control_key: CONTROL_KEY,
    emergency_stop: false,
    usage_date: todayStr,
    physical_calls_used_today: { $lt: policy.daily_physical_call_limit ?? 100 }
  };
}

// Build the CAS update for reserving one physical call.
export function buildReserveCallCasUpdate(now: string): Record<string, any> {
  return {
    $inc: { physical_calls_used_today: 1, version: 1 },
    $set: { updated_at: now }
  };
}

// Build the CAS filter + update for daily reset. Resets the counter to 0
// and updates the usage_date. Uses version guard so two concurrent resets
// cannot both succeed.
export function buildDailyResetCas(policy: any, todayStr: string = todayUtcStr()): { filter: Record<string, any>; update: Record<string, any> } | null {
  if (!policy) return null;
  if (!needsDailyReset(policy, todayStr)) return null;
  return {
    filter: {
      control_key: CONTROL_KEY,
      version: policy.version
    },
    update: {
      $set: { usage_date: todayStr, physical_calls_used_today: 0, updated_at: new Date().toISOString() },
      $inc: { version: 1 }
    }
  };
}

// ---- Rate limits ----

// Check whether a discovery call is allowed for this wallet. The caller
// must count existing selections for this wallet in the last hour and pass
// the count. Returns { allowed, reason }.
export function canDiscover(policy: any, existingDiscoveriesThisHour: number): { allowed: boolean; reason: string } {
  if (!policy) return { allowed: false, reason: "Usage policy not loaded." };
  if (!policy.enabled) return { allowed: false, reason: "Single Trade Trial is not enabled." };
  if (policy.emergency_stop) return { allowed: false, reason: "Emergency stop is active." };
  const limit = policy.discoveries_per_wallet_per_hour ?? 3;
  if (existingDiscoveriesThisHour >= limit) {
    return { allowed: false, reason: `Discovery rate limit (${limit}/hour) reached for this wallet.` };
  }
  return { allowed: true, reason: "" };
}

// Check whether an analysis is allowed for this wallet. The caller must
// count existing trials for this wallet today and pass the count.
export function canAnalyze(policy: any, existingAnalysesToday: number): { allowed: boolean; reason: string } {
  if (!policy) return { allowed: false, reason: "Usage policy not loaded." };
  if (!policy.enabled) return { allowed: false, reason: "Single Trade Trial is not enabled." };
  if (policy.emergency_stop) return { allowed: false, reason: "Emergency stop is active." };
  const limit = policy.analyses_per_wallet_per_day ?? 5;
  if (existingAnalysesToday >= limit) {
    return { allowed: false, reason: `Analysis rate limit (${limit}/day) reached for this wallet.` };
  }
  return { allowed: true, reason: "" };
}

// ---- Creation mutex lock ----

export const CREATION_LOCK_STALE_TIMEOUT_MS = 120000; // 2 minutes
export const CREATION_LOCK_RETRY_DELAY_MS = 100;
export const CREATION_LOCK_MAX_ATTEMPTS = 5;

export function newCreationLockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "stl_" + crypto.randomUUID();
  }
  return "stl_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// Can the creation lock be reclaimed? True when free (null/missing) or stale.
export function canReclaimCreationLock(policy: any, now: number = Date.now()): boolean {
  if (!policy) return true;
  if (!policy.creation_lock_id) return true;
  if (!policy.creation_lock_acquired_at) return true;
  const acquiredAt = new Date(policy.creation_lock_acquired_at).getTime();
  if (isNaN(acquiredAt)) return true;
  return (now - acquiredAt) > CREATION_LOCK_STALE_TIMEOUT_MS;
}

// Build the CAS filter for acquiring the creation lock. Returns null when
// the lock is freshly held and cannot be reclaimed.
export function buildCreationLockCasFilter(policy: any, now: number = Date.now()): Record<string, any> | null {
  if (!policy) return null;
  if (!canReclaimCreationLock(policy, now)) return null;
  const filter: Record<string, any> = {
    control_key: CONTROL_KEY,
    version: policy.version
  };
  if (policy.creation_lock_id) {
    // Stale lock — reclaim by matching the specific lock value.
    filter.creation_lock_id = policy.creation_lock_id;
  }
  return filter;
}

// ---- Admin-safe serialization ----

export function sanitizePolicyForAdmin(policy: any): Record<string, any> | null {
  if (!policy) return null;
  const used = policy.physical_calls_used_today ?? 0;
  const limit = policy.daily_physical_call_limit ?? 100;
  return {
    enabled: policy.enabled ?? false,
    emergency_stop: policy.emergency_stop ?? false,
    daily_physical_call_limit: limit,
    physical_calls_used_today: used,
    usage_date: policy.usage_date || null,
    remaining_today: Math.max(0, limit - used),
    discoveries_per_wallet_per_hour: policy.discoveries_per_wallet_per_hour ?? 3,
    analyses_per_wallet_per_day: policy.analyses_per_wallet_per_day ?? 5,
    creation_lock_held: !!(policy.creation_lock_id),
    version: policy.version ?? 0,
    updated_at: policy.updated_at || null
  };
}