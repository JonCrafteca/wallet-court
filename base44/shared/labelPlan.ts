// Wallet Court — label-cost guard helpers (item N2.1). Address Labels costs 100
// Nansen credits per uncached wallet, so labels are NEVER called automatically.
// This pure module computes the label-enrichment plan (which wallets need a
// call, which are cached) and validates explicit admin confirmation. No side
// effects, no network — fully unit-testable.

export const LABEL_CREDIT_COST = 100;          // address/labels: 100 credits/call
export const CORE_CREDIT_COST_PER_WALLET = 4;  // 4 performance endpoints × 1 credit
export const LABEL_CACHE_TTL_DAYS = 30;        // default refresh eligibility
export const CONFIRM_PHRASE = "SPEND LABEL CREDITS";

// Documented Nansen credit costs (official pricing, item N2.1 cost guard).
// Address Labels is NEVER called automatically — only via explicit admin
// enrichment. Estimates are never presented as actual usage.
export const CREDIT_COSTS = {
  pnl_summary: 1,
  dex_trades: 1,
  current_balance: 1,
  transactions: 1,
  address_labels: 100
};

// The four automatic performance endpoint keys. Address Labels is deliberately
// excluded — it costs 100 credits per call and is admin-triggered only.
export const CORE_ENDPOINT_KEYS = ["pnl_summary", "dex_trades", "current_balance", "transactions"];

export function cacheKey(normalizedAddress, network) {
  return `${network}:${normalizedAddress}`;
}

// Compute the label-enrichment plan for a set of eligible cases.
//   cases: [{ case_slug, normalized_wallet_address, network }]
//   cacheByKey: { [cacheKey]: { labeled_at, id? } }  (from WalletLabelSet)
//   opts: { refresh?: boolean, ttlDays?: number }
// Returns:
//   selected, already_cached (fresh ≤ ttl), eligible_for_refresh (stale > ttl),
//   new_label_calls, estimated_credit_cost, to_call, cached, stale.
//
// Cache rules (item N2.1):
//   - No cache entry → needs a call.
//   - Cached & fresh (≤ ttlDays) → skipped. Even on refresh=true, fresh entries
//     are NOT re-called (prevents accidental credit waste).
//   - Cached & stale (> ttlDays) → eligible for refresh; re-called only when
//     refresh=true (admin explicitly chose to refresh).
export function computeLabelPlan(cases, cacheByKey, opts) {
  const { refresh = false, ttlDays = LABEL_CACHE_TTL_DAYS } = opts || {};
  const toCall = [];
  const cached = [];
  const stale = [];
  for (const c of (cases || [])) {
    if (!c || !c.normalized_wallet_address || !c.network) continue;
    const key = cacheKey(c.normalized_wallet_address, c.network);
    const entry = cacheByKey[key];
    if (!entry || !entry.labeled_at) { toCall.push(c); continue; }
    const ageDays = (Date.now() - new Date(entry.labeled_at).getTime()) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > ttlDays) {
      stale.push(c);
      if (refresh) toCall.push(c);
    } else {
      cached.push(c);
    }
  }
  return {
    selected: (cases || []).length,
    already_cached: cached.length,
    eligible_for_refresh: stale.length,
    new_label_calls: toCall.length,
    estimated_credit_cost: toCall.length * LABEL_CREDIT_COST,
    to_call: toCall,
    cached,
    stale
  };
}

// Explicit admin confirmation required before spending label credits.
export function confirmSpending(phrase) {
  return typeof phrase === "string" && phrase.trim() === CONFIRM_PHRASE;
}