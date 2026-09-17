// Shared helpers for Wallet Court backend functions. Server-side only.

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function randomSlug(prefix) {
  return (
    prefix +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

export function sanitizeHandle(h) {
  if (!h) return "";
  let s = String(h).trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/[^a-zA-Z0-9_]/g, "");
  return s.slice(0, 15);
}

export function isValidHandle(h) {
  if (!h) return false;
  return /^[a-zA-Z0-9_]{1,15}$/.test(h);
}

export async function findCaseBySlug(base44, slug) {
  const results = await base44.asServiceRole.entities.WalletTrial.filter(
    { public_slug: slug },
    "-created_date",
    1
  );
  return results && results[0];
}