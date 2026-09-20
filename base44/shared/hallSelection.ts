// Wallet Court — Hall selection, eligibility, ordering, daily-award selection,
// and sanitization. Pure + deterministic: reads only saved WalletTrial records,
// makes zero Nansen calls, and never mutates case data.
//
// Reused by getHallOfShame (summary + category views, honor, daily awards) and
// mirrored by src/lib/hallSelection.js for client-side tests.
//
// ELIGIBILITY (backward-compatible outcome resolver via getCaseOutcome):
//   - Most Severe / Highest Confidence / Recent: public completed verdicts
//     (verdict or demo outcome). Demo cases are EXCLUDED from Most Severe and
//     Highest Confidence (they are fixtures, not real evidence). Recent may
//     include demo cases but they are clearly labeled. Dismissed and mistrial
//     cases are excluded from all ranking sections.
//   - Hall of Honor / Bag of the Day: live Nansen evidence, positive/NOT GUILTY
//     outcome (verdict_code === suspiciously_competent), not dismissed/mistrial/
//     demo, evidence passed the sufficiency gate.
//   - Dump of the Day: live Nansen evidence, valid guilty verdict, not
//     dismissed/mistrial/demo, evidence passed the sufficiency gate.
//
// DAILY AWARD COHORTS (frozen at start of current UTC day):
//   1. Cases completed during the previous UTC calendar day.
//   2. If empty, cases completed during the previous 7 UTC days.
//   3. If still empty, all eligible historical cases completed before the
//      start of the current UTC day.
//   Cases created during the current UTC day become eligible the next UTC day.
//
// TIE-BREAKING (deterministic, documented):
//   - Most Severe: severity desc → confidence desc → newest → slug asc
//   - Highest Confidence: confidence desc → newest → slug asc
//   - Recent: newest → slug asc
//   - Honor / Bag: confidence desc → strongest positive-performance evidence
//     (realized_pnl_pct desc) → newest → slug asc
//   - Dump: severity desc → confidence desc → newest → slug asc

import { getCaseOutcome } from "./evidenceGate.ts";
import { isNotGuilty } from "./notGuiltyStamp.ts";

export const HALL_CATEGORIES = [
  "most_severe",
  "highest_confidence",
  "recent",
  "honor",
] as const;

export type HallCategory = (typeof HALL_CATEGORIES)[number];

export const SUMMARY_LIMIT = 3;
export const CATEGORY_PAGE_SIZE = 12;
export const DAILY_AWARD_FALLBACK_DAYS = 7;

// ---- Outcome / eligibility helpers ----

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function ts(t: any): number {
  const v = t.analyzed_at || t.created_date;
  return v ? new Date(v).getTime() : 0;
}

export function keyOf(t: any): string {
  const addr = t.normalized_wallet_address || t.wallet_address || "";
  if (!addr) return "";
  return `${addr}|${t.network || ""}`;
}

// A case is "valid" for Hall ranking if it is a completed verdict (not
// dismissed, not mistrial). Demo cases are valid for Recent but excluded from
// Most Severe / Highest Confidence / Honor / Awards.
function isCompletedVerdict(t: any): boolean {
  const o = getCaseOutcome(t);
  return o === "verdict" || o === "demo";
}

function isLiveVerdict(t: any): boolean {
  if (!isCompletedVerdict(t)) return false;
  return t.data_mode === "live";
}

function isGuiltyVerdict(t: any): boolean {
  if (!isLiveVerdict(t)) return false;
  return !isNotGuilty(t.verdict_code);
}

function isPositiveVerdict(t: any): boolean {
  if (!isLiveVerdict(t)) return false;
  return isNotGuilty(t.verdict_code);
}

// Evidence passed the sufficiency gate: the case has a verdict outcome (not
// dismissed/mistrial) with live evidence. The evidence gate already ran during
// analysis, so a completed live verdict with a verdict_code means evidence was
// sufficient.
function evidencePassedGate(t: any): boolean {
  return isLiveVerdict(t) && !!t.verdict_code;
}

// ---- Sorting ----

function sortBySeverity(a: any, b: any) {
  return (num(b.severity_score) || 0) - (num(a.severity_score) || 0);
}
function sortByConfidence(a: any, b: any) {
  return (num(b.confidence_score) || 0) - (num(a.confidence_score) || 0);
}
function sortByNewest(a: any, b: any) {
  return ts(b) - ts(a);
}
function sortBySlug(a: any, b: any) {
  return (a.public_slug || "").localeCompare(b.public_slug || "");
}

function sortMostSevere(list: any[]) {
  return list
    .sort((a, b) => sortBySeverity(a, b) || sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b));
}

function sortHighestConfidence(list: any[]) {
  return list
    .sort((a, b) => sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b));
}

function sortRecent(list: any[]) {
  return list.sort((a, b) => sortByNewest(a, b) || sortBySlug(a, b));
}

// Honor / Bag: confidence desc → realized_pnl_pct desc → newest → slug
function sortHonor(list: any[]) {
  return list.sort((a, b) => {
    const c = sortByConfidence(a, b);
    if (c !== 0) return c;
    const pa = pnlOf(a);
    const pb = pnlOf(b);
    if (pa !== pb) return pb - pa;
    const n = sortByNewest(a, b);
    if (n !== 0) return n;
    return sortBySlug(a, b);
  });
}

function pnlOf(t: any): number {
  try {
    const m = JSON.parse(t.metrics_json || "{}");
    return num(m.realized_pnl_pct) ?? -Infinity;
  } catch {
    return -Infinity;
  }
}

// Dump: severity desc → confidence desc → newest → slug
function sortDump(list: any[]) {
  return list.sort((a, b) =>
    sortBySeverity(a, b) || sortByConfidence(a, b) || sortByNewest(a, b) || sortBySlug(a, b)
  );
}

// ---- Dedup: keep best case per wallet (address + network) ----

function dedupBest(list: any[], scoreFn: (t: any) => number): any[] {
  const best: Record<string, any> = {};
  for (const t of list) {
    const k = keyOf(t);
    if (!k) continue;
    if (!best[k] || scoreFn(t) > scoreFn(best[k])) best[k] = t;
  }
  return Object.values(best);
}

// ---- Eligibility filters ----

export function eligibleMostSevere(records: any[]): any[] {
  // Public, valid, live guilty verdicts only (no demo, no dismissed/mistrial).
  const eligible = records.filter((t) => isGuiltyVerdict(t));
  return sortMostSevere(dedupBest(eligible, (t) => num(t.severity_score) || 0));
}

export function eligibleHighestConfidence(records: any[]): any[] {
  // Public, evidence-backed completed live verdicts (guilty or not-guilty).
  const eligible = records.filter((t) => isLiveVerdict(t));
  return sortHighestConfidence(dedupBest(eligible, (t) => num(t.confidence_score) || 0));
}

export function eligibleRecent(records: any[]): any[] {
  // Public completed live verdicts only (no demo, no dismissed/mistrial).
  // Demo cases are fixtures and must never appear in public Hall rankings.
  const eligible = records.filter((t) => isLiveVerdict(t));
  return sortRecent(dedupBest(eligible, (t) => ts(t)));
}

export function eligibleHonor(records: any[]): any[] {
  // Live, positive/NOT GUILTY, evidence passed gate, not dismissed/mistrial/demo.
  const eligible = records.filter((t) => isPositiveVerdict(t) && evidencePassedGate(t));
  return sortHonor(dedupBest(eligible, (t) => num(t.confidence_score) || 0));
}

export function eligibleDump(records: any[]): any[] {
  // Live, valid guilty, evidence passed gate.
  const eligible = records.filter((t) => isGuiltyVerdict(t) && evidencePassedGate(t));
  return sortDump(dedupBest(eligible, (t) => num(t.severity_score) || 0));
}

// ---- Category resolver ----

export function getEligibleForCategory(records: any[], category: HallCategory): any[] {
  switch (category) {
    case "most_severe": return eligibleMostSevere(records);
    case "highest_confidence": return eligibleHighestConfidence(records);
    case "recent": return eligibleRecent(records);
    case "honor": return eligibleHonor(records);
    default: return [];
  }
}

export const CATEGORY_TITLES: Record<HallCategory, string> = {
  most_severe: "Most Severe",
  highest_confidence: "Highest Confidence",
  recent: "Recent Cases",
  honor: "Hall of Honor",
};

export const CATEGORY_SEE_ALL: Record<HallCategory, string> = {
  most_severe: "SEE ALL MOST SEVERE",
  highest_confidence: "SEE ALL HIGH CONFIDENCE",
  recent: "SEE ALL RECENT CASES",
  honor: "SEE ALL HONORED WALLETS",
};

export const CATEGORY_ROUTES: Record<HallCategory, string> = {
  most_severe: "/hall/most-severe",
  highest_confidence: "/hall/highest-confidence",
  recent: "/hall/recent",
  honor: "/hall/honor",
};

// Reverse mapping: URL slug → category key. Shared so frontend and backend
// agree on route resolution. Unknown slugs are absent (falsy).
export const CATEGORY_SLUG_TO_KEY: Record<string, HallCategory> = {
  "most-severe": "most_severe",
  "highest-confidence": "highest_confidence",
  "recent": "recent",
  "honor": "honor",
};

// ---- Daily awards ----

// Returns the UTC midnight timestamp for the given date (or now if omitted).
export function utcMidnight(date?: Date): Date {
  const d = date ? new Date(date) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Cases completed before the start of the current UTC day are eligible for
// daily awards. Cases completed during the current UTC day become eligible
// the next UTC day.
export function eligibleForDailyAwards(records: any[], now: Date = new Date()): any[] {
  const cutoff = utcMidnight(now).getTime();
  return records.filter((t) => {
    const time = ts(t);
    return time > 0 && time < cutoff;
  });
}

// Select the daily award winner from a frozen candidate cohort.
// cohortSelector: (records, dayStart, dayEnd) => records completed in [dayStart, dayEnd)
export function selectDailyAward(
  records: any[],
  eligible: any[],
  now: Date = new Date()
): { winner: any | null; cohort: string; awardDate: string } {
  const todayStart = utcMidnight(now).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - DAILY_AWARD_FALLBACK_DAYS * 86400000;

  const awardDate = new Date(todayStart).toISOString().slice(0, 10);

  // Cohort 1: previous UTC day
  let cohort = eligible.filter((t) => {
    const time = ts(t);
    return time >= yesterdayStart && time < todayStart;
  });

  if (cohort.length > 0) {
    return { winner: cohort[0] || null, cohort: "previous_day", awardDate };
  }

  // Cohort 2: previous 7 UTC days
  cohort = eligible.filter((t) => {
    const time = ts(t);
    return time >= sevenDaysAgoStart && time < todayStart;
  });

  if (cohort.length > 0) {
    return { winner: cohort[0] || null, cohort: "previous_7_days", awardDate };
  }

  // Cohort 3: all eligible historical cases before today
  cohort = eligible.filter((t) => {
    const time = ts(t);
    return time > 0 && time < todayStart;
  });

  if (cohort.length > 0) {
    return { winner: cohort[0] || null, cohort: "historical", awardDate };
  }

  return { winner: null, cohort: "none", awardDate };
}

export function selectBagOfTheDay(records: any[], now: Date = new Date()) {
  const eligible = eligibleHonor(records);
  return selectDailyAward(records, eligible, now);
}

export function selectDumpOfTheDay(records: any[], now: Date = new Date()) {
  const eligible = eligibleDump(records);
  return selectDailyAward(records, eligible, now);
}

// ---- Sanitization (public-safe fields only) ----

export function sanitizeForHall(t: any, countMap: Record<string, number> = {}): any {
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

// Sanitize for honor/award cards — includes a positive evidence highlight
// derived from saved metrics (never raw addresses, owner IDs, or private data).
export function sanitizeForHonor(t: any): any {
  const base = sanitizeForHall(t);
  let highlight = "";
  try {
    const m = JSON.parse(t.metrics_json || "{}");
    const pnl = num(m.realized_pnl_pct);
    if (pnl !== null) {
      highlight = `Realized P&L +${(pnl * 100).toFixed(0)}%`;
    }
  } catch {
    // omit highlight
  }
  return { ...base, highlight };
}

// Assert no private fields are present in a sanitized record. Used by tests.
export function assertNoPrivateFields(sanitized: any): string | null {
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