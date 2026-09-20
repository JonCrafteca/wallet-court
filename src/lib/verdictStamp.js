// Pure function for the VerdictStamp class treatment. Extracted so the
// high-contrast "Not Guilty" treatment is unit-testable without a DOM.

export const NOT_GUILTY_VERDICT_CODE = "suspiciously_competent";

export function getStampText(verdictCode) {
  return verdictCode === NOT_GUILTY_VERDICT_CODE ? "Not Guilty" : "Guilty";
}

// "Not Guilty": solid lime background, dark navy text, dark navy border,
// dark navy offset shadow — high contrast on both desktop and mobile.
// "Guilty": off-white background, red text, red border (unchanged).
export function getStampClasses(verdictCode) {
  const competent = verdictCode === NOT_GUILTY_VERDICT_CODE;
  return competent
    ? "border-court-navy bg-court-chart text-court-navy"
    : "border-court-red bg-court-ice text-court-red";
}