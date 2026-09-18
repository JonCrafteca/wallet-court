// Wallet Court — evidence-sufficiency gate (Phase N2.3).
// Runs BEFORE deterministic verdict selection so the court never invents a
// verdict when saved Nansen evidence is empty or inadequate.
//
// Classifies a case as one of:
//   - dismissed_no_evidence          every performance endpoint SUCCEEDED and the
//                                    resulting activity profile is collectively empty
//   - mistrial_insufficient_evidence some activity exists but is too thin to
//                                    defensibly support any verdict
//   - verdict                        affirmative evidence supports the verdict engine
//
// Pure: reads only (metrics, meta). No network. Deterministic.
//
// UNIT CONTRACT: Nansen percentage fields are decimal ratios (0.84 == 84%).
// "Successful empty response" is established by meta.failed_sources being empty —
// a field missing because an endpoint FAILED is never treated as zero evidence.

export const CASE_OUTCOMES = [
  "verdict",
  "dismissed_no_evidence",
  "mistrial_insufficient_evidence",
  "demo"
];

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

// Dismissed: every performance endpoint succeeded (failed_sources empty) AND no
// qualifying activity anywhere. Operational failures (timeout, auth, rate limit,
// missing field from a failed endpoint) disqualify dismissal — those belong to
// N2.4 Court Recess, not Case Dismissed.
export function isDismissed(metrics, meta) {
  const failedSources = Array.isArray(meta?.failed_sources) ? meta.failed_sources : [];
  if (failedSources.length > 0) return false;
  return !hasAnyActivity(metrics || {});
}

// Mistrial: some activity exists but is too thin to defensibly support any verdict.
// Holdings (token_balance_count > 0) can independently support a holder verdict,
// so a wallet with holdings is never a mistrial.
export function isMistrial(metrics) {
  const m = metrics || {};
  const holdings = num(m.token_balance_count);
  if (holdings !== null && holdings > 0) return false;

  const trades = num(m.total_trades);
  const tokens = num(m.tokens_traded);
  const dex = num(m.dex_trade_count);
  const txCount = num(m.transaction_count);
  const pnl = num(m.realized_pnl_pct);
  const pnlUsd = num(m.realized_pnl_abs_usd);

  // One or two isolated trades without enough context.
  if (trades !== null && trades > 0 && trades <= 2) return true;
  // Tiny DEX sample with no PnL context.
  if (dex !== null && dex > 0 && dex <= 5 && pnl === null && pnlUsd === null) return true;
  // Only transactions, with no trades/tokens/dex — no usable trading or holdings
  // evidence.
  if ((trades === null || trades === 0) && (tokens === null || tokens === 0) && (dex === null || dex === 0) && txCount !== null && txCount > 0) return true;

  return false;
}

export function classifyOutcome(metrics, meta) {
  const m = metrics || {};
  const metaObj = meta || {};
  const failedSources = Array.isArray(metaObj.failed_sources) ? metaObj.failed_sources : [];
  const allEndpointsOk = failedSources.length === 0;
  const activity = hasAnyActivity(m);

  // No activity + all endpoints succeeded → dismissed (successful empty profile).
  if (allEndpointsOk && !activity) return "dismissed_no_evidence";

  // No activity but some endpoint failed → cannot confirm the profile is empty.
  // Insufficient evidence (operational failure path; N2.4 will refine).
  if (!allEndpointsOk && !activity) return "mistrial_insufficient_evidence";

  // Activity present: mistrial if too thin, else verdict.
  if (activity && isMistrial(m)) return "mistrial_insufficient_evidence";
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