// Client-side summons helpers. Mirrors the pure functions from
// base44/shared/summons.ts for client-side use. Cannot import from base44/
// (server-side only). Kept in sync with the backend logic.

export const X_POST_CHAR_LIMIT = 280;

// X URL domains accepted for handle extraction
const X_DOMAINS = ["x.com", "twitter.com"];

// X handle regex: letters, numbers, underscores, 1-15 chars
const X_HANDLE_REGEX = /^[a-zA-Z0-9_]{1,15}$/;

// Sanitize a raw handle input: strip @, URL prefixes, paths, HTML, control chars.
function sanitizeHandle(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/^https?:\/\/(www\.)?/i, "");
  s = s.replace(/^(x\.com|twitter\.com)\//i, "");
  if (s.startsWith("@")) s = s.slice(1);
  s = s.split(/[/?#]/)[0];
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "");
  return s;
}

// Parse raw X handle input. Accepts @handle, handle, and X profile URLs.
// Returns { ok, handle, error }.
export function normalizeXHandleInput(raw) {
  if (!raw) return { ok: true, handle: null };
  const s = String(raw).trim();
  if (s === "") return { ok: true, handle: null };

  // If it looks like a URL, validate it's an X domain
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) {
    const lower = s.toLowerCase();
    const isXDomain = X_DOMAINS.some((d) => lower.includes(d));
    if (!isXDomain) {
      return { ok: false, error: "Only X (x.com or twitter.com) profile URLs are accepted." };
    }
  }

  // Normalize www. prefix so sanitizeHandle can strip it as a URL
  let cleaned = s;
  if (/^www\./i.test(cleaned)) {
    cleaned = "https://" + cleaned;
  }

  const sanitized = sanitizeHandle(cleaned);
  if (!sanitized) return { ok: false, error: "X handle cannot be empty." };
  if (sanitized.length > 15) {
    return { ok: false, error: "X handle must be at most 15 characters." };
  }
  if (!X_HANDLE_REGEX.test(sanitized)) {
    return { ok: false, error: "X handle may contain only letters, numbers, and underscores." };
  }

  return { ok: true, handle: sanitized };
}

// Build the summons X post text.
export function buildSummonsPost(displayHandle, verdictName, caseUrl) {
  if (!displayHandle) return null;
  const handle = displayHandle.startsWith("@") ? displayHandle : `@${displayHandle}`;
  const vname = (verdictName || "GUILTY").toUpperCase();
  return [
    "🚨 SUMMONS",
    "",
    `Hey ${handle} — someone put this wallet on trial and nominated you as the defendant.`,
    "",
    `Verdict: ${vname}`,
    "",
    "Is it yours? Verify ownership and file your defense:",
    caseUrl,
  ].join("\n");
}

// Build the verdict share X post text (for Court Receipt sharing).
export function buildVerdictSharePost(verdictName, severityScore, caseUrl) {
  const vname = (verdictName || "GUILTY").toUpperCase();
  const sev = Math.round(severityScore || 0);
  return [
    "🚨 WALLET COURT VERDICT",
    vname,
    `Severity: ${sev}/100`,
    "",
    `Put your wallet on trial: ${caseUrl}`,
  ].join("\n");
}

// Truncate post text to fit X's character limit. Truncates at line/word boundary
// with ellipsis. Never cuts a word in the middle.
export function truncateForX(text, limit = X_POST_CHAR_LIMIT) {
  if (!text || text.length <= limit) return text;
  const lines = text.split("\n");
  let result = "";
  for (const line of lines) {
    const candidate = result ? result + "\n" + line : line;
    if (candidate.length > limit) {
      if (!result) {
        return truncateLine(line, limit);
      }
      const remaining = limit - result.length - 1;
      if (remaining > 3) {
        result += "\n" + truncateLine(line, remaining);
      }
      break;
    }
    result = candidate;
  }
  return result || truncateLine(text, limit);
}

function truncateLine(line, maxLen) {
  if (line.length <= maxLen) return line;
  const ellipsis = "…";
  const target = maxLen - ellipsis.length;
  const truncated = line.slice(0, target);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > target * 0.5) {
    return truncated.slice(0, lastSpace).trimEnd() + ellipsis;
  }
  return truncated.trimEnd() + ellipsis;
}

// Resolve the truthful display state for a case identity panel.
// Ownership verification and defense states override the playful summons state.
export function resolveIdentityState({ summons, claimStatus, defenseStatus }) {
  if (claimStatus?.claimed) {
    if (defenseStatus?.hasPublicDefense || claimStatus?.official_defense) {
      return { state: "official_defense_filed", label: "Official Defense Filed" };
    }
    return { state: "verified_wallet_owner", label: "Verified Wallet Owner" };
  }

  if (summons) {
    if (summons.status === "summons_served_self_reported") {
      return { state: "summons_served", label: "Summons Served — Self-reported" };
    }
    if (summons.status === "share_opened") {
      return { state: "share_opened", label: "Share Opened" };
    }
    if (summons.status === "summons_ready") {
      return { state: "summons_ready", label: "Summons Ready" };
    }
  }

  return { state: "anonymous_defendant", label: "Anonymous Defendant" };
}