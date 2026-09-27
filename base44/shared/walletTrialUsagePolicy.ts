// Wallet Court — Whole-Wallet Production Trial usage policy pure logic. No SDK,
// no network, no side effects. Imported by backend functions and unit-tested in
// isolation.
//
// This module owns: default policy values, daily-reset detection, budget
// reservation decisions, emergency-stop checks, and CAS filters/updates for
// atomic per-physical-call reservation, completion, and release.
//
// CRITICAL: This policy governs ONLY ordinary public/admin whole-wallet
// production trials (the analyzeWalletWithNansen endpoint when called by public
// visitors). It does NOT replace or modify:
//   - The legacy 1,020 calibration ceiling (CALIBRATION_CEILING) — still used by
//     the completed calibration campaign and calibration docket traffic.
//   - Single Trade's independent usage policy (SingleTradeUsagePolicy).
//   - Robinhood validation's isolated allowance logic.
//
// The budget is identified by an explicit server-side workflow context
// ("production_daily"), never by the network and never by a client-supplied
// value. Public clients cannot forge the calibration workflow to bypass this
// budget — forging the calibration workflow routes to the EXHAUSTED legacy
// ceiling, which blocks them.

export const CONTROL_KEY = "main";

// Default policy values. The singleton is created with these when it doesn't
// exist yet. Unlike Single Trade, production whole-wallet trials are ENABLED by
// default (enabled = true) — the product is live and needs capacity.
export function defaultUsagePolicy(): Record<string, any> {
  const today = todayUtcStr();
  return {
    control_key: CONTROL_KEY,
    version: 0,
    enabled: true,
    emergency_stop: false,
    daily_call_limit: 500,
    usage_date: today,
    calls_reserved: 0,
    calls_completed: 0,
    updated_at: null,
    updated_by_user_id: null
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
// Does NOT check the legacy 1,020 ceiling — production has its own daily budget.
export function canReserveCall(policy: any, todayStr: string = todayUtcStr()): { allowed: boolean; reason: string } {
  if (!policy) return { allowed: false, reason: "Usage policy not loaded." };
  if (!policy.enabled) return { allowed: false, reason: "Whole-wallet production trials are not enabled." };
  if (policy.emergency_stop) return { allowed: false, reason: "Emergency stop is active." };
  // If the date changed, the counter is stale — treat as 0 used.
  const usedToday = needsDailyReset(policy, todayStr) ? 0 : (policy.calls_reserved || 0);
  const limit = policy.daily_call_limit ?? 500;
  if (usedToday >= limit) {
    return { allowed: false, reason: `Daily production call limit (${limit}) reached.` };
  }
  return { allowed: true, reason: "" };
}

// Build the CAS filter for reserving one physical call. The filter matches
// only when: the singleton key matches, emergency_stop is false, enabled is
// true, the usage date is current, and calls_reserved is below the limit.
// The $inc atomically increments calls_reserved and version.
//
// When the date has changed, the caller should first call resetDailyUsage,
// then call reserveCall. The reset is a separate CAS so the counters are
// zeroed before the reservation.
export function buildReserveCallCasFilter(policy: any, todayStr: string = todayUtcStr()): Record<string, any> | null {
  if (!policy) return null;
  const check = canReserveCall(policy, todayStr);
  if (!check.allowed) return null;
  // If the date changed, the caller must reset first.
  if (needsDailyReset(policy, todayStr)) return null;
  return {
    control_key: CONTROL_KEY,
    enabled: true,
    emergency_stop: false,
    usage_date: todayStr,
    calls_reserved: { $lt: policy.daily_call_limit ?? 500 }
  };
}

// Build the CAS update for reserving one physical call.
export function buildReserveCallCasUpdate(now: string): Record<string, any> {
  return {
    $inc: { calls_reserved: 1, version: 1 },
    $set: { updated_at: now }
  };
}

// Build the CAS update for completing N physical calls (after HTTP requests).
export function buildCompleteCallsCasUpdate(count: number, now: string): Record<string, any> {
  return {
    $inc: { calls_completed: count, version: 1 },
    $set: { updated_at: now }
  };
}

// Build the CAS update for releasing N unused reservations (no HTTP request made).
export function buildReleaseCallsCasUpdate(count: number, now: string): Record<string, any> {
  return {
    $inc: { calls_reserved: -count, version: 1 },
    $set: { updated_at: now }
  };
}

// Build the CAS filter + update for daily reset. Resets both counters to 0
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
      $set: {
        usage_date: todayStr,
        calls_reserved: 0,
        calls_completed: 0,
        updated_at: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  };
}

// ---- Admin-safe serialization ----

export function sanitizePolicyForAdmin(policy: any): Record<string, any> | null {
  if (!policy) return null;
  const reserved = policy.calls_reserved ?? 0;
  const completed = policy.calls_completed ?? 0;
  const limit = policy.daily_call_limit ?? 500;
  return {
    enabled: policy.enabled ?? true,
    emergency_stop: policy.emergency_stop ?? false,
    daily_call_limit: limit,
    usage_date: policy.usage_date || null,
    calls_reserved: reserved,
    calls_completed: completed,
    remaining_today: Math.max(0, limit - reserved),
    in_flight: Math.max(0, reserved - completed),
    version: policy.version ?? 0,
    updated_at: policy.updated_at || null
  };
}