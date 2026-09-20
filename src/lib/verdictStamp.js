// VerdictStamp DOM helper. Re-exports canonical tokens from notGuiltyStamp.js
// and provides the Tailwind class mapping for the DOM VerdictStamp component.
// The canonical visual system lives in notGuiltyStamp.js — this file only
// adds the DOM-specific class string.

import {
  NOT_GUILTY_VERDICT_CODE,
  getStampText,
  isNotGuilty,
  getStampStyle,
  NOT_GUILTY_STYLE,
  GUILTY_STYLE,
} from "./notGuiltyStamp";

export {
  NOT_GUILTY_VERDICT_CODE,
  getStampText,
  isNotGuilty,
  getStampStyle,
  NOT_GUILTY_STYLE,
  GUILTY_STYLE,
};

// DOM Tailwind class helper for the VerdictStamp component.
// Derives classes from the canonical visual tokens so DOM and canvas
// cannot drift into different treatments.
// NOT GUILTY: bg=court-chart (#D8FF32), text=court-navy (#10142A), border=court-navy
// GUILTY: bg=court-ice (#F5F7FF), text=court-red (#FF3B30), border=court-red
export function getStampClasses(verdictCode) {
  return isNotGuilty(verdictCode)
    ? "border-court-navy bg-court-chart text-court-navy"
    : "border-court-red bg-court-ice text-court-red";
}