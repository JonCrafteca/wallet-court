// Frontend mirror of base44/shared/evidenceGate getCaseOutcome (Phase N2.3).
// Kept in sync with the backend helper. Used by case-page surfaces to branch
// the public presentation on the active case outcome. Backend-only logic
// (classifyOutcome) is NOT duplicated here — it lives in base44/shared.
export function getCaseOutcome(trial) {
  if (trial && trial.case_outcome) return trial.case_outcome;
  if (trial && trial.data_mode === "demo") return "demo";
  return "verdict";
}

export function isDismissedOrMistrial(trial) {
  const o = getCaseOutcome(trial);
  return o === "dismissed_no_evidence" || o === "mistrial_insufficient_evidence";
}