// Client-side mirror of the pure ref-code validation from base44/shared/attribution.ts.
// Keeps the browser bundle free of server-side imports. Must stay in sync.

const REF_CODE_REGEX = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const REF_CODE_MAX_LEN = 32;

export function validateRefCode(raw) {
  if (!raw) return { ok: false, value: "", reason: "No ref code provided." };
  const trimmed = String(raw).trim().toLowerCase();
  if (trimmed.length === 0) return { ok: false, value: "", reason: "Empty ref code." };
  if (trimmed.length > REF_CODE_MAX_LEN) return { ok: false, value: "", reason: "Ref code too long." };
  if (!REF_CODE_REGEX.test(trimmed)) return { ok: false, value: "", reason: "Invalid ref code format." };
  return { ok: true, value: trimmed, reason: "" };
}