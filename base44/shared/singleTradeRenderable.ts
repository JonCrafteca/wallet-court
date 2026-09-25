// Wallet Court — Single Trade Trial renderability gate. Pure, testable.
// Determines whether a stored SingleTradeTrial is complete enough to be
// publicly rendered on the /trade/:slug case page.
//
// A trial is renderable only if:
//   - status === "completed" (not pending/analyzing/failed)
//   - case_outcome is set (verdict | dismissed_no_evidence | mistrial_insufficient_evidence | demo)
//   - For case_outcome === "verdict": verdict_code, verdict_name, severity_score,
//     confidence_score, roast, sentence are non-null AND evidence_items_json
//     is a non-empty JSON array.
//   - For dismissed/mistrial/demo: status + outcome is sufficient (verdict
//     fields are null by design for those outcomes).
//
// This gate is the authoritative check used by getSingleTradeBySlug to decide
// whether to return the trial (200) or a 404. It prevents failed/incomplete
// trials from being rendered as if they were completed verdicts.

export function isSingleTradeRenderable(trial: any): boolean {
  if (!trial) return false;
  if (trial.status !== "completed") return false;
  const outcome = trial.case_outcome;
  if (!outcome) return false;
  if (outcome === "verdict") {
    if (!trial.verdict_code) return false;
    if (!trial.verdict_name) return false;
    if (trial.severity_score == null) return false;
    if (trial.confidence_score == null) return false;
    if (!trial.roast) return false;
    if (!trial.sentence) return false;
    let evidence: any[] = [];
    try {
      evidence = JSON.parse(trial.evidence_items_json || "[]");
    } catch {
      return false;
    }
    if (!Array.isArray(evidence) || evidence.length === 0) return false;
    return true;
  }
  // dismissed_no_evidence | mistrial_insufficient_evidence | demo:
  // status completed + outcome set is sufficient.
  return true;
}