// Wallet Court — Official Defense text validation. Pure, unit-testable.
// The Official Defense is a short, plain-text statement from the verified
// wallet owner. It never modifies the verdict, evidence, severity, confidence,
// case outcome, or Hall ranking.

export const DEFENSE_MAX_CODE_POINTS = 280;

// Count Unicode code points (not UTF-16 code units).
export function countCodePoints(text) {
  if (!text) return 0;
  return Array.from(String(text)).length;
}

// Strip control chars except \n and \t; strip zero-width chars.
export function sanitizeDefenseText(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  s = s.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s;
}

// Detect HTML tags. React escapes on render, but we reject server-side too.
export function containsHtml(text) {
  if (!text) return false;
  return /<\/?[a-zA-Z][^>]*>/.test(String(text)) || /<script/i.test(String(text));
}

export function validateDefenseText(raw) {
  const sanitized = sanitizeDefenseText(raw);
  if (sanitized === "") return { ok: false, error: "Defense cannot be empty." };
  const codePoints = countCodePoints(sanitized);
  if (codePoints > DEFENSE_MAX_CODE_POINTS) {
    return { ok: false, error: `Defense must be at most ${DEFENSE_MAX_CODE_POINTS} characters.` };
  }
  if (containsHtml(sanitized)) return { ok: false, error: "Defense may not contain HTML." };
  return { ok: true, value: sanitized, codePoints };
}