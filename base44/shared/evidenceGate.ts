// Wallet Court — evidence-sufficiency gate (Phase N2.3, refined N2.4).
// Runs BEFORE deterministic verdict selection so the court never invents a
// verdict when saved Nansen evidence is empty or inadequate.
//
// Classifies successfully-obtained evidence as one of:
//   - dismissed_no_evidence          every endpoint needed to confirm an empty
//                                    profile SUCCEEDED and the activity profile
//                                    is collectively empty
//   - mistrial_insufficient_evidence some usable evidence was successfully
//                                    obtained but is too thin to defensibly
//                                    support any verdict
//   - verdict                        affirmative evidence supports the engine
//   - operational_failure            no usable activity AND an endpoint needed
//                                    to confirm the empty profile FAILED — the
//                                    caller (pipeline) maps this to Court Recess,
//                                    never to a verdict/dismissal/mistrial
//
// N2.4 CORRECTION: operational/provider failures are NOT mistrials. A mistrial
// means usable evidence was successfully obtained but is insufficient. An
// operational failure means the court could not obtain enough reliable evidence
// — that is a Court Recess, handled by the circuit breaker upstream. This gate
// only classifies evidence that was successfully obtained.
//
// N2.4 HOLDINGS HARDENING: a positive token count alone does NOT support a
// holder verdict (dust/spam/unsolicited tokens). Meaningful holder evidence
// requires aggregate portfolio value >= MIN_PORTFOLIO_VALUE_USD (see
// holdingsEvidence.ts). A dust-only balance routes to mistrial, not a holder
// verdict.
//
// Pure: reads only (metrics, meta). No network. Deterministic.
//
// UNIT CONTRACT: Nansen percentage fields are decimal ratios (0.84 == 84%).

import { hasMeaningfulHoldingsEvidence } from "./holdingsEvidence.ts";

export const CASE_OUTCOMES = [
  "verdict",
  "dismissed_no_evidence",
  "mistrial_insufficient_evidence",
  "demo"
];

// Internal sentinel returned by classifyOutcome when no usable activity exists
// AND an endpoint needed to confirm an empty profile failed. NOT a stored case
// outcome — the pipeline maps this to Court Recess (no WalletTrial is created).
export const OPERATIONAL_FAILURE = "operational_failure";

// Endpoints required to confirm an empty profile: PnL + DEX (no trading) and
// current_balance (no holdings). transactions is optional context — a failed
// transactions endpoint alone does not prevent confirming an empty profile.
const EMPTY_CONFIRM_SOURCES = ["pnl_summary", "dex_trades", "current_balance"];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Derive the active case outcome from a stored trial. Backward compatible:
// records without case_outcome infer "verdict" (live) or "demo" from data_mode,
// so the seven N2.2 records (case_outcome absent) remain verdicts untouched.
export function getCaseOutcome(trial) {
  if (trial && trial.case_outcome) return trial.case_outcome;
  if (trial && trial.data_mode === "demo") return "demo";
  return "verdict";
}

export function isDismissedOrMistrial(trial) {
  const o = getCaseOutcome(trial);
  return o === "dismissed_no_evidence" || o === "mistrial_insufficient_evidence";
}

export function isVerdictOutcome(trial) {
  const o = getCaseOutcome(trial);
  return o === "verdict" || o === "demo";
}

// Activity signals — any non-zero value means real qualifying onchain activity.
// token_balance_count is included (a dust balance IS some activity), but it is
// NOT sufficient for a holder verdict — see hasMeaningfulHoldingsEvidence.
const ACTIVITY_FIELDS = [
  "total_trades", "tokens_traded", "dex_trade_count", "transaction_count",
  "token_balance_count", "realized_pnl_pct", "realized_pnl_abs_usd",
  "win_rate_pct", "portfolio_value_usd", "tx_frequency_per_day",
  "avg_trade_value_usd", "avg_tx_volume_usd", "avg_token_bought_age_days"
];

function hasAnyActivity(m) {
  return ACTIVITY_FIELDS.some((k) => {
    const v = num(m[k]);
    return v !== null && v !== 0;
  });
}

// Dismissed: the endpoints needed to confirm an empty profile (pnl, dex,
// current_balance) all SUCCEEDED and no qualifying activity exists anywhere.
// A failed transactions endpoint alone does not prevent dismissal — it is
// optional context. Operational failures of pnl/dex/balance disqualify
// dismissal — those belong to Court Recess (N2.4), not Case Dismissed.
export function isDismissed(metrics, meta) {
  const failed = new Set(Array.isArray(meta?.failed_sources) ? meta.failed_sources : []);
  for (const k of EMPTY_CONFIRM_SOURCES) {
    if (failed.has(k)) return false;
  }
  return !hasAnyActivity(metrics || {});
}

// Mistrial: some usable evidence was successfully obtained but is too thin to
// defensibly support any verdict. Meaningful holdings (portfolio value >= the
// minimum) independently support a holder verdict, so a wallet with meaningful
// holdings is never a mistrial. Dust/spam-only holdings (token count > 0 but
// negligible value) do NOT support a holder verdict and route to mistrial.
export function isMistrial(metrics) {
  const m = metrics || {};
  if (hasMeaningfulHoldingsEvidence(m)) return false;

  const trades = num(m.total_trades);
  const tokens = num(m.tokens_traded);
  const dex = num(m.dex_trade_count);
  const txCount = num(m.transaction_count);
  const pnl = num(m.realized_pnl_pct);
  const pnlUsd = num(m.realized_pnl_abs_usd);
  const holdings = num(m.token_balance_count);

  // One or two isolated trades without enough context.
  if (trades !== null && trades > 0 && trades <= 2) return true;
  // Tiny DEX sample with no PnL context.
  if (dex !== null && dex > 0 && dex <= 5 && pnl === null && pnlUsd === null) return true;
  // Only transactions, with no trades/tokens/dex — no usable trading or holdings.
  if ((trades === null || trades === 0) && (tokens === null || tokens === 0) && (dex === null || dex === 0) && txCount !== null && txCount > 0) return true;
  // Dust/spam-only holdings: token count present but NOT meaningful value, and no
  // qualifying trading activity. Cannot establish a holder verdict; not empty.
  if ((trades === null || trades === 0) && (tokens === null || tokens === 0) && (dex === null || dex === 0)
      && holdings !== null && holdings > 0 && !hasMeaningfulHoldingsEvidence(m)) return true;

  return false;
}

// Classify successfully-obtained evidence. The pipeline MUST check for blocking
// operational failures (circuit breaker) BEFORE calling this — required-endpoint
// and hard-operational failures become Court Recess upstream. When this function
// sees failed_sources, they are optional-endpoint soft failures only.
export function classifyOutcome(metrics, meta) {
  const m = metrics || {};
  const metaObj = meta || {};
  const failed = new Set(Array.isArray(metaObj.failed_sources) ? metaObj.failed_sources : []);
  const activity = hasAnyActivity(m);

  if (!activity) {
    // No activity. Dismissed only if the endpoints needed to confirm an empty
    // profile (pnl, dex, current_balance) all succeeded.
    const canConfirmEmpty = !EMPTY_CONFIRM_SOURCES.some((k) => failed.has(k));
    if (canConfirmEmpty) return "dismissed_no_evidence";
    // An endpoint needed to confirm emptiness failed → cannot determine →
    // operational failure (caller maps to Court Recess).
    return OPERATIONAL_FAILURE;
  }

  // Activity present: mistrial if too thin, else verdict.
  if (isMistrial(m)) return "mistrial_insufficient_evidence";
  return "verdict";
}

// Build the field-update object for an evidence-gate migration. Returns ONLY the
// outcome classification, the verdict-output fields (nulled), and the audit note —
// never slug, wallet/network identity, evidence, metrics, or sources. This keeps
// the migration's write surface minimal and unit-testable for field safety.
export function buildOutcomeUpdate(trial, gateOutcome, migrationTag) {
  const timestamp = new Date().toISOString();
  const before = {
    case_outcome: trial?.case_outcome || null,
    verdict_code: trial?.verdict_code ?? null,
    verdict_name: trial?.verdict_name ?? null,
    severity_score: trial?.severity_score ?? null,
    confidence_score: trial?.confidence_score ?? null
  };
  const auditNote = {
    phase: migrationTag || "N2.3",
    operation: gateOutcome === "dismissed_no_evidence"
      ? "evidence-sufficiency dismissal"
      : "evidence-sufficiency mistrial",
    evidence_source: "saved metrics only — no Nansen calls",
    migration: "approved allowlist",
    timestamp,
    previous: before,
    next: { case_outcome: gateOutcome }
  };
  return {
    case_outcome: gateOutcome,
    verdict_code: null,
    verdict_name: null,
    headline: null,
    roast: null,
    defense_statement: null,
    sentence: null,
    severity_score: null,
    confidence_score: null,
    rescore_audit_json: JSON.stringify(auditNote)
  };
}