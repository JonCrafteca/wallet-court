// Shared logic for the account dashboard (My Court). Pure functions that
// sanitize trial, claim, and defense records for the authenticated owner's
// view, and compute dashboard counts. Never exposes full wallet addresses,
// owner_user_id, submitted_by_user_id, moderation internals, or other users'
// private data. Imported by the getAccountDashboard backend function and
// unit-tested without platform runtime.

import { shortAddr } from "./caseUtils.ts";
import { sanitizeDefenseForOwner } from "./walletClaim.ts";
import { sanitizeSummonsForOwner } from "./summons.ts";

// Resolve the active case outcome, mirroring src/lib/caseOutcome.js. Backend
// records may predate N2.3 (no case_outcome field) — infer from data_mode.
export function resolveCaseOutcome(trial) {
  if (!trial) return null;
  if (trial.case_outcome) return trial.case_outcome;
  if (trial.data_mode === "demo") return "demo";
  return "verdict";
}

// Sanitize a trial for the My Trials list. Never exposes wallet_address,
// normalized_wallet_address, rescore_audit_json, submitted_by_user_id,
// metrics_json, evidence_items_json, or source_endpoints_json.
export function sanitizeTrialForAccount(trial) {
  if (!trial) return null;
  const fullAddr = trial.normalized_wallet_address || trial.wallet_address || "";
  return {
    public_slug: trial.public_slug,
    network: trial.network,
    data_mode: trial.data_mode,
    case_outcome: resolveCaseOutcome(trial),
    verdict_code: trial.verdict_code || null,
    verdict_name: trial.verdict_name || null,
    severity_score: trial.severity_score ?? null,
    confidence_score: trial.confidence_score ?? null,
    headline: trial.headline || null,
    address_short: shortAddr(fullAddr),
    analyzed_at: trial.analyzed_at || null,
    created_date: trial.created_date || null
  };
}

// Sanitize a claim for the My Verified Wallets list. Never exposes
// owner_user_id, normalized_wallet_address, court_name_version,
// court_name_history_json, public_alias, or signature data.
export function sanitizeClaimForAccount(claim) {
  if (!claim) return null;
  return {
    claim_slug: claim.claim_slug,
    network: claim.network,
    address_short: claim.address_short,
    court_name: claim.court_name || null,
    profile_visibility: claim.profile_visibility,
    status: claim.status,
    verified_at: claim.verified_at,
    last_verified_at: claim.last_verified_at || null,
    latest_trial_slug: claim.latest_trial_slug || null
  };
}

// Sanitize a defense for the owner's account view. Extends the existing owner
// sanitizer with claim_slug for linking to the associated wallet/case. Never
// exposes moderated_by, moderation_note, or owner_user_id.
export function sanitizeDefenseForAccount(defense) {
  if (!defense) return null;
  return {
    ...sanitizeDefenseForOwner(defense),
    claim_slug: defense.claim_slug
  };
}

// Sanitize a summons for the owner's account view (My Court Summons section).
// Includes case info for linking. Never exposes creator_user_id, abuse_status,
// or confirmed_post_url.
export function sanitizeSummonsForAccount(summons, trial) {
  return sanitizeSummonsForOwner(summons, trial);
}

// Compute dashboard counts from raw trial, claim, defense, and summons arrays.
// verdicts includes demo verdicts (they produce a verdict display).
// dismissals = dismissed_no_evidence. mistrials = mistrial_insufficient_evidence.
export function computeDashboardCounts(trials, wallets, defenses, summons) {
  const trialList = trials || [];
  const walletList = wallets || [];
  const defenseList = defenses || [];
  const summonsList = summons || [];

  let verdicts = 0, dismissals = 0, mistrials = 0;
  for (const t of trialList) {
    const outcome = resolveCaseOutcome(t);
    if (outcome === "verdict" || outcome === "demo") verdicts++;
    else if (outcome === "dismissed_no_evidence") dismissals++;
    else if (outcome === "mistrial_insufficient_evidence") mistrials++;
  }

  return {
    trials: trialList.length,
    verdicts,
    dismissals,
    mistrials,
    verified_wallets: walletList.filter((w) => w.status === "active").length,
    defenses: defenseList.length,
    summons: summonsList.length
  };
}