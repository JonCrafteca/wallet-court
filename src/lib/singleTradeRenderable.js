// Frontend mirror of base44/shared/singleTradeRenderable.ts. Pure, testable.
// Used by SingleTradeCase as a defense-in-depth safety net: even if the
// backend gate somehow returns a completed-but-incomplete trial, the
// frontend refuses to render it as a verdict.
//
// The sanitized public response from getSingleTradeBySlug does NOT include
// the raw `status` field, so this frontend check operates on the public
// fields only. The authoritative status check lives in the backend
// (getSingleTradeBySlug → isSingleTradeRenderable on the raw trial).

export function isSingleTradeRenderable(trial) {
  if (!trial) return false;
  const outcome = trial.case_outcome;
  if (!outcome) return false;
  if (outcome === "verdict") {
    if (!trial.verdict_code) return false;
    if (!trial.verdict_name) return false;
    if (trial.severity_score == null) return false;
    if (trial.confidence_score == null) return false;
    if (!trial.roast) return false;
    if (!trial.sentence) return false;
    let evidence = [];
    try {
      evidence = JSON.parse(trial.evidence_items_json || "[]");
    } catch {
      return false;
    }
    if (!Array.isArray(evidence) || evidence.length === 0) return false;
    return true;
  }
  // dismissed_no_evidence | mistrial_insufficient_evidence | demo:
  // outcome set is sufficient for the CaseDismissed/CaseMistrial components.
  return true;
}