// Frontend mirror of base44/shared/singleTradeRenderable.ts. Pure, testable.
// Used by SingleTradeCase and SingleTradeIntake as a defense-in-depth safety
// net: even if the backend gate somehow returns a completed-but-incomplete
// trial, the frontend refuses to render it as a verdict.
//
// The sanitized public response from getSingleTradeBySlug does NOT include
// the raw `status` field, so this frontend check operates on the public
// fields only. The authoritative status check lives in the backend
// (getSingleTradeBySlug → isSingleTradeRenderable on the raw trial).
//
// Missing numeric values NEVER default to zero. Missing verdict fields NEVER
// default to GUILTY.

const VALID_OUTCOMES = new Set([
  "verdict",
  "dismissed_no_evidence",
  "mistrial_insufficient_evidence",
  "demo",
]);

function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function parseJsonArray(s) {
  if (!s || typeof s !== "string") return null;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObject(s) {
  if (!s || typeof s !== "string") return null;
  try {
    const parsed = JSON.parse(s);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

function hasValidMetrics(metrics) {
  if (!metrics) return false;
  const keyFields = [
    "max_drawdown_pct",
    "holding_duration_days",
    "conviction",
    "candle_count",
    "current_unrealized_pnl_pct",
    "lowest_market_cap_usd",
  ];
  return keyFields.some((k) => metrics[k] !== null && metrics[k] !== undefined);
}

function hasValidPurchaseDetails(trial) {
  return (
    (trial.purchase_cost_usd !== null && trial.purchase_cost_usd !== undefined) ||
    (trial.tokens_received !== null && trial.tokens_received !== undefined)
  );
}

export function isSingleTradeRenderable(trial) {
  if (!trial) return false;
  // The sanitized public response does not include `status`. We infer
  // completeness from case_outcome + verdict fields. A trial with no
  // case_outcome is not renderable (covers failed/pending trials which have
  // case_outcome=null).
  const outcome = trial.case_outcome;
  if (!outcome || !VALID_OUTCOMES.has(outcome)) return false;

  if (outcome !== "verdict") {
    if (trial.evidence_items_json != null && parseJsonArray(trial.evidence_items_json) === null) return false;
    if (trial.metrics_json != null && parseJsonObject(trial.metrics_json) === null) return false;
    return true;
  }

  // ---- Verdict outcome: strict field validation ----
  if (!isNonEmptyString(trial.verdict_code)) return false;
  if (!isNonEmptyString(trial.verdict_name)) return false;
  if (!isFiniteNum(trial.severity_score) || trial.severity_score < 0 || trial.severity_score > 100) return false;
  if (!isFiniteNum(trial.confidence_score) || trial.confidence_score < 0 || trial.confidence_score > 100) return false;
  if (!isNonEmptyString(trial.headline)) return false;
  if (!isNonEmptyString(trial.roast)) return false;
  if (!isNonEmptyString(trial.sentence)) return false;

  const evidence = parseJsonArray(trial.evidence_items_json);
  if (!evidence || evidence.length === 0) return false;

  const metrics = parseJsonObject(trial.metrics_json);
  if (!metrics || !hasValidMetrics(metrics)) return false;

  const sources = parseJsonArray(trial.source_endpoints_json);
  if (!sources || sources.length === 0) return false;

  if (!hasValidPurchaseDetails(trial)) return false;

  return true;
}