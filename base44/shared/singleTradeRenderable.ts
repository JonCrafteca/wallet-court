// Wallet Court — Single Trade Trial renderability gate. Pure, testable.
// Determines whether a stored SingleTradeTrial is complete enough to be
// publicly rendered on the /trade/:slug case page or returned as a valid
// analysis result.
//
// A trial is renderable only if ALL of the following are true:
//   - status === "completed"
//   - case_outcome is a valid enum value
//   - For case_outcome === "verdict":
//       verdict_code: nonempty string
//       verdict_name: nonempty string
//       severity_score: finite number in [0, 100]
//       confidence_score: finite number in [0, 100]
//       headline: nonempty string
//       roast: nonempty string
//       sentence: nonempty string
//       evidence_items_json: parses to a non-empty array
//       metrics_json: parses to a valid object with required metric fields
//       source_endpoints_json: parses to a non-empty array
//       purchase_cost_usd OR tokens_received: non-null (valid purchase details)
//   - For dismissed/mistrial/demo: status + outcome is sufficient (verdict
//     fields are null by design). evidence_items_json and metrics_json must
//     still be valid JSON.
//
// Missing numeric values NEVER default to zero. Missing verdict fields NEVER
// default to GUILTY. A failed trial (status=failed, null fields) is NEVER
// renderable.

const VALID_OUTCOMES = new Set([
  "verdict",
  "dismissed_no_evidence",
  "mistrial_insufficient_evidence",
  "demo",
]);

function isFiniteNum(v: any): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: any): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function parseJsonArray(s: any): any[] | null {
  if (!s || typeof s !== "string") return null;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObject(s: any): Record<string, any> | null {
  if (!s || typeof s !== "string") return null;
  try {
    const parsed = JSON.parse(s);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

// Check that the metrics object has at least one meaningful computed field.
// This prevents a trial with metrics_json="{}" from being renderable as a
// verdict.
function hasValidMetrics(metrics: Record<string, any>): boolean {
  if (!metrics) return false;
  // At least one of these key metric fields must be present and non-null.
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

// Check that the trial has valid purchase details (at least cost or tokens).
function hasValidPurchaseDetails(trial: any): boolean {
  return (
    (trial.purchase_cost_usd !== null && trial.purchase_cost_usd !== undefined) ||
    (trial.tokens_received !== null && trial.tokens_received !== undefined)
  );
}

export function isSingleTradeRenderable(trial: any): boolean {
  if (!trial) return false;
  if (trial.status !== "completed") return false;

  const outcome = trial.case_outcome;
  if (!outcome || !VALID_OUTCOMES.has(outcome)) return false;

  // For dismissed/mistrial/demo: status + outcome is sufficient, but the JSON
  // fields must still be parseable (defense-in-depth).
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