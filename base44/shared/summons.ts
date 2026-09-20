// Wallet Court — Summons shared logic. Pure, unit-testable functions for
// X handle normalization, summons copy building, truthful state resolution,
// and sanitization. Imported by backend functions; never imports server runtime.
//
// Key guarantees:
// - A nominated handle NEVER grants ownership, verified status, or case control.
// - Opening an X composer records "share_opened", NOT "summons_served".
// - "summons_served_self_reported" requires explicit user confirmation and is
//   always labeled as self-reported.
// - Public responses never expose creator_user_id, abuse_status, or internal IDs.

import { sanitizeHandle, validateHandle } from "./handles.ts";

export const SUMMONS_ID_PREFIX = "smn_";
export const SUMMONS_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const SUMMONS_RATE_LIMIT_MAX_USER = 15; // per user per hour
export const SUMMONS_RATE_LIMIT_MAX_HANDLE = 5; // per target handle per hour
export const SUMMONS_RATE_LIMIT_MAX_ANON = 5; // per anonymous session per hour
export const X_POST_CHAR_LIMIT = 280;

// X URL domains accepted for handle extraction
const X_DOMAINS = ["x.com", "twitter.com"];

// Parse raw X handle input. Accepts @handle, handle, and X profile URLs.
// Returns { ok, handle, normalized, error }.
// handle = display-cased handle; normalized = lowercased handle.
export function normalizeXHandleInput(raw) {
  if (!raw) return { ok: true, handle: null, normalized: null };
  const s = String(raw).trim();
  if (s === "") return { ok: true, handle: null, normalized: null };

  // If it looks like a URL, validate it's an X domain before extracting
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

  // Use existing sanitizeHandle to extract the handle from URL/@/plain forms
  const sanitized = sanitizeHandle(cleaned);
  if (!sanitized) return { ok: false, error: "X handle cannot be empty." };

  // Validate as X handle (length + character set)
  const result = validateHandle("x", sanitized);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, handle: result.display, normalized: result.normalized };
}

// Generate a permanent, non-address-derived summons ID.
export function generateSummonsId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return SUMMONS_ID_PREFIX + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Build the summons X post text. Always preserves: target handle, verdict,
// permanent URL, and ownership uncertainty. Stays within X's character limit.
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

// Truncate post text to fit X's character limit. Truncates at a line boundary
// when possible, adding an ellipsis. Never cuts a word in the middle.
export function truncateForX(text, limit = X_POST_CHAR_LIMIT) {
  if (!text || text.length <= limit) return text;
  const lines = text.split("\n");
  let result = "";
  for (const line of lines) {
    const candidate = result ? result + "\n" + line : line;
    if (candidate.length > limit) {
      // This line doesn't fit entirely — truncate it
      if (!result) {
        // First line is too long — truncate with ellipsis at word boundary
        return truncateLine(line, limit);
      }
      const remaining = limit - result.length - 1; // -1 for \n
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
  // Find the last word boundary that fits
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
  // Verified wallet owner overrides summons state
  if (claimStatus?.claimed) {
    if (defenseStatus?.hasPublicDefense || claimStatus?.official_defense) {
      return { state: "official_defense_filed", label: "Official Defense Filed" };
    }
    return { state: "verified_wallet_owner", label: "Verified Wallet Owner" };
  }

  // Summons states (only if a summons exists)
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

// Sanitize summons for public consumption (case page). Never exposes
// creator_user_id, abuse_status, confirmed_post_url, or internal record IDs.
export function sanitizeSummonsPublic(summons) {
  if (!summons) return null;
  return {
    summons_id: summons.summons_id,
    display_handle: summons.display_handle || null,
    status: summons.status,
    share_method: summons.share_method,
    created_at: summons.created_at
  };
}

// Sanitize summons for owner consumption (My Court). Includes case info
// for linking. Never exposes abuse_status or confirmed_post_url to the owner
// (those are admin-only moderation fields).
export function sanitizeSummonsForOwner(summons, trial) {
  if (!summons) return null;
  return {
    summons_id: summons.summons_id,
    case_slug: summons.case_slug,
    display_handle: summons.display_handle || null,
    status: summons.status,
    share_method: summons.share_method,
    created_at: summons.created_at,
    verdict_name: trial?.verdict_name || null,
    verdict_code: trial?.verdict_code || null,
    network: trial?.network || null,
    address_short: trial?.address_short || null,
    data_mode: trial?.data_mode || null
  };
}

// Check for duplicate active summons (same case + same normalized handle).
export function isDuplicateSummons(existing, normalizedHandle) {
  if (!existing || !normalizedHandle) return false;
  return existing.some(
    (s) =>
      s.normalized_target_handle === normalizedHandle &&
      s.abuse_status !== "blocked"
  );
}

// Check rate limit for summons creation. Returns { ok, error }.
export function checkSummonsRateLimit(recentSummons, isAnonymous, targetHandle) {
  const now = Date.now();
  const windowStart = new Date(now - SUMMONS_RATE_LIMIT_WINDOW_MS).toISOString();

  const recent = (recentSummons || []).filter((s) => {
    const created = s.created_at || s.created_date;
    return created && created >= windowStart;
  });

  // Per-user or per-anonymous-session limit
  const userLimit = isAnonymous ? SUMMONS_RATE_LIMIT_MAX_ANON : SUMMONS_RATE_LIMIT_MAX_USER;
  if (recent.length >= userLimit) {
    return {
      ok: false,
      error: `You've created too many summons recently. Please try again later.`,
    };
  }

  // Per-target-handle limit
  if (targetHandle) {
    const handleCount = recent.filter(
      (s) => s.normalized_target_handle === targetHandle.toLowerCase()
    ).length;
    if (handleCount >= SUMMONS_RATE_LIMIT_MAX_HANDLE) {
      return {
        ok: false,
        error: `Too many summons for this handle recently. Please try again later.`,
      };
    }
  }

  return { ok: true };
}

// Validate status transition for summons updates.
export function isValidStatusTransition(currentStatus, newStatus) {
  const transitions = {
    anonymous_defendant: ["summons_ready", "share_opened"],
    summons_ready: ["share_opened", "summons_served_self_reported"],
    share_opened: ["summons_served_self_reported"],
    summons_served_self_reported: [],
  };
  const allowed = transitions[currentStatus] || [];
  return allowed.includes(newStatus);
}