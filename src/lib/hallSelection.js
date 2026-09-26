// Client-side mirror of base44/shared/hallSelection.ts. Pure functions for
// client-side tests and potential client-side use. Cannot import from base44/
// (server-side only). Kept in sync with the backend logic.

export const HALL_CATEGORIES = ["most_severe", "highest_confidence", "recent", "honor", "recovery"];

// Journey archetype IDs (comeback + recovery tiers). Mirrors archetypes.ts.
const JOURNEY_ARCHETYPE_IDS = ["escape_artist", "comeback_kid", "back_from_the_dead", "almost_escaped"];
function isJourneyArchetype(code) {
  return !!code && JOURNEY_ARCHETYPE_IDS.includes(code);
}

export const SUMMARY_LIMIT = 3;
export const CATEGORY_PAGE_SIZE = 12;
export const DAILY_AWARD_FALLBACK_DAYS = 7;

export const CATEGORY_TITLES = {
  most_severe: "Most Severe",
  highest_confidence: "Highest Confidence",
  recent: "Recent Cases",
  honor: "Hall of Honor",
  recovery: "Recovery",
};

export const CATEGORY_SEE_ALL = {
  most_severe: "SEE ALL MOST SEVERE",
  highest_confidence: "SEE ALL HIGH CONFIDENCE",
  recent: "SEE ALL RECENT CASES",
  honor: "SEE ALL HONORED WALLETS",
  recovery: "SEE ALL RECOVERY STORIES",
};

export const CATEGORY_ROUTES = {
  most_severe: "/hall/most-severe",
  highest_confidence: "/hall/highest-confidence",
  recent: "/hall/recent",
  honor: "/hall/honor",
  recovery: "/hall/recovery",
};

// Reverse mapping: URL slug → category key. Shared so frontend and backend
// agree on route resolution. Unknown slugs are absent (falsy).
export const CATEGORY_SLUG_TO_KEY = {
  "most-severe": "most_severe",
  "highest-confidence": "highest_confidence",
  "recent": "recent",
  "honor": "honor",
  "recovery": "recovery",
};

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function ts(t) {
  const v = t.analyzed_at || t.created_date;
  return v ? new Date(v).getTime() : 0;
}

function keyOf(t) {
  const addr = t.normalized_wallet_address || t.wallet_address || "";
  if (!addr) return "";
  return `${addr}|${t.network || ""}`;
}

// Backward-compatible outcome resolver (mirrors evidenceGate getCaseOutcome).
function getCaseOutcome(t) {
  if (t && t.case_outcome) return t.case_outcome;
  if (t && t.data_mode === "demo") return "demo";
  return "verdict";
}

function isNotGuilty(code) {
  return code === "suspiciously_competent";
}

function isCompletedVerdict(t) {
  const o = getCaseOutcome(t);
  return o === "verdict" || o === "demo";
}

function isLiveVerdict(t) {
  if (!isCompletedVerdict(t)) return false;
  return t.data_mode === "live";
}

function isGuiltyVerdict(t) {
  if (!isLiveVerdict(t)) return false;
  return !isNotGuilty(t.verdict_code);
}

function isPositiveVerdict(t) {
  if (!isLiveVerdict(t)) return false;
  return isNotGuilty(t.verdict_code);
}

function evidencePassedGate(t) {
  return isLiveVerdict(t) && !!t.verdict_code;
}

// ---- Sorting ----

function sortBySeverity(a, b) { return (num(b.severity_score) || 0) - (num(a.severity_score) || 0); }
function sortByConfidence(a, b) { return (num(b.confidence_score) || 0) - (num(a.confidence_score) || 0); }
function sortByNewest(a, b) { return ts(b) - ts(a); }
function sortBySlug(a, b) { return (a.public_slug || "").localeCompare(b.public_slug || ""); }

function sortMostSevere(list) {
  return list.sort((a, b) => sortBySeverity(a, b) || sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b));
}
function sortHighestConfidence(list) {
  return list.sort((a, b) => sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b));
}
function sortRecent(list) {
  return list.sort((a, b) => sortByNewest(a, b) || sortBySlug(a, b));
}
function pnlOf(t) {
  try {
    const m = JSON.parse(t.metrics_json || "{}");
    return num(m.realized_pnl_pct) ?? -Infinity;
  } catch { return -Infinity; }
}
function sortHonor(list) {
  return list.sort((a, b) => {
    const c = sortByConfidence(a, b);
    if (c !== 0) return c;
    const pa = pnlOf(a), pb = pnlOf(b);
    if (pa !== pb) return pb - pa;
    const n = sortByNewest(a, b);
    if (n !== 0) return n;
    return sortBySlug(a, b);
  });
}
function sortDump(list) {
  return list.sort((a, b) => sortBySeverity(a, b) || sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b));
}

// ---- Dedup ----

function dedupBest(list, scoreFn) {
  const best = {};
  for (const t of list) {
    const k = keyOf(t);
    if (!k) continue;
    if (!best[k] || scoreFn(t) > scoreFn(best[k])) best[k] = t;
  }
  return Object.values(best);
}

// ---- Eligibility ----

export function eligibleMostSevere(records) {
  const eligible = records.filter((t) => isGuiltyVerdict(t));
  return sortMostSevere(dedupBest(eligible, (t) => num(t.severity_score) || 0));
}
export function eligibleHighestConfidence(records) {
  const eligible = records.filter((t) => isLiveVerdict(t));
  return sortHighestConfidence(dedupBest(eligible, (t) => num(t.confidence_score) || 0));
}
export function eligibleRecent(records) {
  // Public completed live verdicts only (no demo, no dismissed/mistrial).
  const eligible = records.filter((t) => isLiveVerdict(t));
  return sortRecent(dedupBest(eligible, (t) => ts(t)));
}
export function eligibleHonor(records) {
  const eligible = records.filter((t) => isPositiveVerdict(t) && evidencePassedGate(t));
  return sortHonor(dedupBest(eligible, (t) => num(t.confidence_score) || 0));
}
export function eligibleDump(records) {
  const eligible = records.filter((t) => isGuiltyVerdict(t) && evidencePassedGate(t));
  return sortDump(dedupBest(eligible, (t) => num(t.severity_score) || 0));
}

function recoveredLossOf(t) {
  try {
    const m = JSON.parse(t.metrics_json || "{}");
    // Price recovery multiple is the honest, capital-injection-safe metric.
    const prm = num(m._archetype?.price_recovery_multiple_from_bottom);
    if (prm !== null) return prm;
    // Fallback: compute from raw price metrics
    const entryPrice = num(m.entry_price_usd);
    const dd = num(m.max_drawdown_pct);
    const conviction = m.conviction;
    const realizedExit = num(m.realized_exit_value_usd);
    const totalTokensSold = num(m.total_tokens_sold);
    const currentPrice = num(m.current_price_usd);
    if (entryPrice !== null && dd !== null) {
      const troughPrice = entryPrice * (1 + dd);
      let exitPrice = currentPrice;
      if (conviction === "full_exit" && realizedExit !== null && totalTokensSold !== null && totalTokensSold > 0) {
        exitPrice = realizedExit / totalTokensSold;
      }
      if (exitPrice !== null && troughPrice > 0) {
        return exitPrice / troughPrice;
      }
    }
    return -Infinity;
  } catch { return -Infinity; }
}

function sortRecovery(list) {
  return list.sort((a, b) => {
    const c = sortByConfidence(a, b);
    if (c !== 0) return c;
    const ra = recoveredLossOf(a), rb = recoveredLossOf(b);
    if (ra !== rb) return rb - ra;
    const n = sortByNewest(a, b);
    if (n !== 0) return n;
    return sortBySlug(a, b);
  });
}

export function eligibleRecovery(records) {
  const eligible = records.filter((t) => isLiveVerdict(t) && isJourneyArchetype(t.verdict_code));
  return sortRecovery(dedupBest(eligible, (t) => num(t.confidence_score) || 0));
}

export function getEligibleForCategory(records, category) {
  switch (category) {
    case "most_severe": return eligibleMostSevere(records);
    case "highest_confidence": return eligibleHighestConfidence(records);
    case "recent": return eligibleRecent(records);
    case "honor": return eligibleHonor(records);
    case "recovery": return eligibleRecovery(records);
    default: return [];
  }
}

// ---- Daily awards ----

export function utcMidnight(date) {
  const d = date ? new Date(date) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function selectDailyAward(records, eligible, now = new Date()) {
  const todayStart = utcMidnight(now).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - DAILY_AWARD_FALLBACK_DAYS * 86400000;
  const awardDate = new Date(todayStart).toISOString().slice(0, 10);

  let cohort = eligible.filter((t) => {
    const time = ts(t);
    return time >= yesterdayStart && time < todayStart;
  });
  if (cohort.length > 0) return { winner: cohort[0] || null, cohort: "previous_day", awardDate };

  cohort = eligible.filter((t) => {
    const time = ts(t);
    return time >= sevenDaysAgoStart && time < todayStart;
  });
  if (cohort.length > 0) return { winner: cohort[0] || null, cohort: "previous_7_days", awardDate };

  cohort = eligible.filter((t) => {
    const time = ts(t);
    return time > 0 && time < todayStart;
  });
  if (cohort.length > 0) return { winner: cohort[0] || null, cohort: "historical", awardDate };

  return { winner: null, cohort: "none", awardDate };
}

export function selectBagOfTheDay(records, now = new Date()) {
  return selectDailyAward(records, eligibleHonor(records), now);
}
export function selectDumpOfTheDay(records, now = new Date()) {
  return selectDailyAward(records, eligibleDump(records), now);
}

// ---- Sanitization ----

export function sanitizeForHall(t, countMap = {}) {
  const addr = t.normalized_wallet_address || t.wallet_address || "";
  const short = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";
  return {
    slug: t.public_slug,
    network: t.network,
    verdict_name: t.verdict_name,
    verdict_code: t.verdict_code,
    severity_score: t.severity_score,
    confidence_score: t.confidence_score,
    data_mode: t.data_mode,
    case_outcome: getCaseOutcome(t),
    analyzed_at: t.analyzed_at || t.created_date,
    address_short: short,
    wallet_class: t.wallet_class || "unknown",
    trial_count: countMap[keyOf(t)] || 1,
  };
}

export function sanitizeForHonor(t) {
  const base = sanitizeForHall(t);
  let highlight = "";
  try {
    const m = JSON.parse(t.metrics_json || "{}");
    const pnl = num(m.realized_pnl_pct);
    if (pnl !== null) highlight = `Realized P&L +${(pnl * 100).toFixed(0)}%`;
  } catch {}
  return { ...base, highlight };
}

export function assertNoPrivateFields(sanitized) {
  const forbidden = [
    "wallet_address", "normalized_wallet_address", "submitted_by_user_id",
    "owner_user_id", "moderation_note", "moderated_by", "handle_history_json",
    "management_token_hash", "creator_user_id", "rescore_audit_json",
    "labels_json", "message_hash", "nonce_hash",
  ];
  for (const f of forbidden) {
    if (f in sanitized) return f;
  }
  return null;
}