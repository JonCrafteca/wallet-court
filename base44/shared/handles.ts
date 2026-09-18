// Wallet Court — social handle validation and sanitization. Pure, unit-testable.
// Handles are self-reported by the wallet owner and always labeled
// "Self-reported · Unverified" unless backed by a real provider-authenticated
// connection (none exist in Phase N3 — no new OAuth integrations added).

export const HANDLE_PROVIDERS = ["x", "fomo", "pump_fun"];

export const PROVIDER_LABELS = {
  x: "X",
  fomo: "FOMO",
  pump_fun: "Pump.fun"
};

const PROVIDER_RULES = {
  x: { regex: /^[a-zA-Z0-9_]{1,15}$/, maxLen: 15, label: "X" },
  fomo: { regex: /^[a-zA-Z0-9_-]{1,20}$/, maxLen: 20, label: "FOMO" },
  pump_fun: { regex: /^[a-zA-Z0-9_-]{1,20}$/, maxLen: 20, label: "Pump.fun" }
};

export function isValidProvider(provider) {
  return HANDLE_PROVIDERS.includes(provider);
}

// Strip leading @, URL prefixes, paths, HTML, control chars, zero-width chars.
export function sanitizeHandle(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/^https?:\/\/(www\.)?/i, "");
  s = s.replace(/^(x\.com|twitter\.com|fomo\.fun|pump\.fun)\//i, "");
  if (s.startsWith("@")) s = s.slice(1);
  s = s.split(/[/?#]/)[0];
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "");
  return s;
}

export function validateHandle(provider, rawHandle) {
  if (!isValidProvider(provider)) return { ok: false, error: "Unknown social platform." };
  const rules = PROVIDER_RULES[provider];
  const sanitized = sanitizeHandle(rawHandle);
  if (sanitized === "") return { ok: false, error: `${rules.label} handle cannot be empty.` };
  if (sanitized.length > rules.maxLen) return { ok: false, error: `${rules.label} handle must be at most ${rules.maxLen} characters.` };
  if (!rules.regex.test(sanitized)) {
    return { ok: false, error: `${rules.label} handle may contain only letters, numbers, ${provider === "x" ? "and underscores" : "underscores, and hyphens"}.` };
  }
  return { ok: true, display: sanitized, normalized: sanitized.toLowerCase() };
}

export function sanitizeHandlePublic(h) {
  if (!h) return null;
  return {
    provider: h.provider,
    provider_label: PROVIDER_LABELS[h.provider] || h.provider,
    display_handle: h.display_handle,
    verification_state: h.verification_state || "unverified"
  };
}