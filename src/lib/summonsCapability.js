// Wallet Court — Client-side anonymous summons management capability storage.
// Stores the raw management token in localStorage keyed by summons_id.
// The token is returned exactly once from createSummons and stored here so
// the anonymous creator can later update the summons status (share_opened,
// summons_served_self_reported) or edit the handle without logging in.
//
// Security: the token never leaves the browser except as a verification
// payload to updateSummonsStatus. It is never put in URLs, analytics, or logs.

const STORAGE_PREFIX = "wc_summons_cap_";

export function storeCapability(summonsId, token) {
  if (!summonsId || !token) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + summonsId, token);
  } catch {
    // localStorage may be unavailable (private mode, quota) — degrade gracefully
  }
}

export function getCapability(summonsId) {
  if (!summonsId) return null;
  try {
    return localStorage.getItem(STORAGE_PREFIX + summonsId) || null;
  } catch {
    return null;
  }
}

export function clearCapability(summonsId) {
  if (!summonsId) return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + summonsId);
  } catch {
    // ignore
  }
}