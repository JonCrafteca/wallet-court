// Wallet Court — Canonical NOT GUILTY stamp visual system.
// Single source of truth for every NOT GUILTY renderer in the product.
// Both DOM (VerdictStamp) and canvas (Court Receipt, Verdict Card) consume
// these exact tokens so treatments cannot drift.
//
// Rules (mandatory everywhere NOT GUILTY appears):
// - Solid court-lime rectangular background (no transparency)
// - Very dark navy/near-black uppercase text
// - Bold condensed Wallet Court typography (Anton)
// - Thick dark navy/near-black border
// - Pronounced dark offset shadow down and to the right
// - Slight upward-to-the-right rotation
// - Strong readable contrast
// - No outline-only treatment
// - No lime text on white, blue, purple, or transparent backgrounds
//
// NOT GUILTY is a valid verdict-class stamp. It must never be confused with
// CASE DISMISSED or MISTRIAL.

export const NOT_GUILTY_VERDICT_CODE = "suspiciously_competent";

// Canonical visual tokens for the NOT GUILTY stamp.
export const NOT_GUILTY_STYLE = {
  bg: "#D8FF32",         // solid court-lime rectangular background
  text: "#10142A",       // very dark navy/near-black uppercase text
  border: "#10142A",     // thick dark navy/near-black border
  shadow: "#10142A",     // pronounced dark offset shadow down and to the right
  shadowOffsetX: 5,      // shadow offset in design pixels (canvas scales this)
  shadowOffsetY: 5,
  borderWidth: 4,        // border width in design pixels
  rotationDeg: -6,       // slight upward-to-the-right rotation
  fontFamily: "Anton",   // bold condensed Wallet Court typography
  label: "NOT GUILTY",   // uppercase stamp text
};

// GUILTY stamp visual tokens (red on ice — unchanged from original).
export const GUILTY_STYLE = {
  bg: "#F5F7FF",         // ice white background
  text: "#FF3B30",       // siren red text
  border: "#FF3B30",     // siren red border
  shadow: "#10142A",     // dark navy offset shadow
  shadowOffsetX: 5,
  shadowOffsetY: 5,
  borderWidth: 4,
  rotationDeg: -6,
  fontFamily: "Anton",
  label: "GUILTY",
};

export function isNotGuilty(verdictCode: string | null | undefined): boolean {
  return verdictCode === NOT_GUILTY_VERDICT_CODE;
}

export function getStampText(verdictCode: string | null | undefined): string {
  return isNotGuilty(verdictCode) ? NOT_GUILTY_STYLE.label : GUILTY_STYLE.label;
}

export function getStampStyle(verdictCode: string | null | undefined) {
  return isNotGuilty(verdictCode) ? NOT_GUILTY_STYLE : GUILTY_STYLE;
}