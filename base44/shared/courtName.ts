// Wallet Court — Court Name validation. Pure, unit-testable, no platform runtime.
// Court Name is an optional owner-chosen display name for a claimed wallet.
// It is NOT a URL identifier — the permanent wallet slug never changes when
// the Court Name changes.

export const COURT_NAME_MIN = 3;
export const COURT_NAME_MAX = 24;
export const COURT_NAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const RESERVED_TERMS = [
  "admin", "administrator", "moderator", "mod", "support", "staff",
  "official", "shoutit", "shoutitworld", "shout_it", "shout-it",
  "walletcourt", "wallet_court", "wallet-court", "nansen", "base44",
  "court", "verified", "system", "help", "security"
];

export const PROFANITY = [
  "fuck", "shit", "cunt", "nigger", "faggot", "retard", "bitch", "asshole",
  "dick", "pussy", "whore", "slut", "bastard", "douche", "scam", "rugpull"
];

// Allowed: ASCII letters, digits, underscore, hyphen. Must begin and end with
// a letter or digit (no leading/trailing _ or -). Length 3-24.
const COURT_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{1,22}[A-Za-z0-9]$/;

export function normalizeCourtName(name) {
  return String(name || "").trim().toLowerCase();
}

// Detect deceptive Unicode: if NFKC normalization changes the string, it
// contains compatibility characters or confusables. The regex already rejects
// all non-ASCII, but this is a belt-and-suspenders check for homoglyphs.
function hasDeceptiveUnicode(s) {
  try { return s !== s.normalize("NFKC"); } catch { return true; }
}

export function validateCourtName(name) {
  if (name == null) return { ok: false, error: "Court Name is required." };
  const trimmed = String(name).trim();
  if (trimmed === "") return { ok: false, error: "Court Name cannot be empty." };

  const codePoints = Array.from(trimmed).length;
  if (codePoints < COURT_NAME_MIN) {
    return { ok: false, error: `Court Name must be at least ${COURT_NAME_MIN} characters.` };
  }
  if (codePoints > COURT_NAME_MAX) {
    return { ok: false, error: `Court Name must be at most ${COURT_NAME_MAX} characters.` };
  }
  if (!COURT_NAME_REGEX.test(trimmed)) {
    return { ok: false, error: "Use letters, numbers, underscores, and hyphens only. Must start and end with a letter or number." };
  }
  if (hasDeceptiveUnicode(trimmed)) {
    return { ok: false, error: "Court Name contains unsupported or deceptive characters." };
  }

  const lower = trimmed.toLowerCase();
  for (const term of RESERVED_TERMS) {
    if (lower === term || lower.includes(term)) {
      return { ok: false, error: "That Court Name is reserved. Choose another." };
    }
  }
  for (const bad of PROFANITY) {
    if (lower.includes(bad)) return { ok: false, error: "That Court Name is not allowed." };
  }
  return { ok: true, value: trimmed, normalized: lower };
}

export function checkCourtNameCooldown(lastChangedAtIso) {
  if (!lastChangedAtIso) return { ok: true };
  const last = Date.parse(lastChangedAtIso);
  if (!Number.isFinite(last)) return { ok: true };
  const elapsed = Date.now() - last;
  if (elapsed < COURT_NAME_COOLDOWN_MS) {
    const remainingDays = Math.ceil((COURT_NAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
    return { ok: false, error: `Court Name can be changed again in ${remainingDays} day${remainingDays === 1 ? "" : "s"}.` };
  }
  return { ok: true };
}