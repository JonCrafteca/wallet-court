// Wallet Court — client-side referral capture and visitor-ID persistence.
// First-party cookies, 30-day expiry, SameSite=Lax. No wallet address is ever
// used as the visitor identifier. No login or wallet connection required.
//
// Last-touch attribution: a new valid ref replaces the previous ref_code.
// First-touch: preserved separately in wc_ref_first (set once, never overwritten).
// Normal visits without ?ref= continue working unchanged.

import { validateRefCode } from "./attributionShared";

const REF_COOKIE = "wc_ref";
const REF_FIRST_COOKIE = "wc_ref_first";
const VISITOR_COOKIE = "wc_vid";
const MAX_AGE_DAYS = 30;

function isBrowser() {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

function setCookie(name, value, maxAgeDays) {
  if (!isBrowser()) return;
  const maxAge = Math.floor(maxAgeDays * 86400);
  document.cookie = `${name}=${encodeURIComponent(value)};max-age=${maxAge};path=/;SameSite=Lax;Secure`;
}

function getCookie(name) {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

// Generate a privacy-safe visitor ID if none exists. Never a wallet address.
export function ensureVisitorId() {
  let vid = getCookie(VISITOR_COOKIE);
  if (vid && vid.length >= 8) return vid;
  vid = generateVisitorId();
  setCookie(VISITOR_COOKIE, vid, MAX_AGE_DAYS);
  return vid;
}

function generateVisitorId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// Capture the ?ref= query parameter on page load. Normalizes to lowercase,
// validates as a URL-safe slug, and persists via last-touch attribution.
// Preserves the first-touch ref separately (set once, never overwritten).
// Normal visits without ?ref= are left unchanged.
export function captureReferral() {
  if (!isBrowser()) return null;
  const params = new URLSearchParams(window.location.search);
  const rawRef = params.get("ref");
  if (!rawRef) return getRefCode();
  const result = validateRefCode(rawRef);
  if (!result.ok) return getRefCode();
  // Last-touch: update wc_ref
  setCookie(REF_COOKIE, result.value, MAX_AGE_DAYS);
  // First-touch: only set if not already set
  if (!getCookie(REF_FIRST_COOKIE)) {
    setCookie(REF_FIRST_COOKIE, result.value, MAX_AGE_DAYS);
  }
  return result.value;
}

// Read the current last-touch ref_code (or null if none).
export function getRefCode() {
  return getCookie(REF_COOKIE);
}

// Read the first-touch ref_code (or null if none).
export function getFirstTouchRefCode() {
  return getCookie(REF_FIRST_COOKIE);
}

// Return { ref_code, visitor_id } for passing to backend functions. ref_code
// is null if no valid ref was captured. visitor_id is always present.
export function getAttributionContext() {
  return {
    ref_code: getRefCode(),
    visitor_id: ensureVisitorId(),
  };
}

// Enqueue an attribution event via the backend function. Non-blocking: errors
// are swallowed and never break the user journey. Only enqueues if a valid
// ref_code exists.
export async function enqueueAttribution(eventType, params = {}) {
  try {
    const ctx = getAttributionContext();
    if (!ctx.ref_code) return { enqueued: false, reason: "no_ref_code" };
    const { base44 } = await import("@/api/base44Client");
    await base44.functions.invoke("enqueueWalletCourtAttribution", {
      event_type: eventType,
      ref_code: ctx.ref_code,
      visitor_id: ctx.visitor_id,
      ...params,
    });
    return { enqueued: true };
  } catch {
    // attribution must never break the user journey
    return { enqueued: false, reason: "error" };
  }
}