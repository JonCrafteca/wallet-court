// Client-side wallet address validation/normalization. Mirrors the server-side
// rules in base44/shared/verdicts.ts without importing server code.
export const NETWORKS = ["ethereum", "base", "solana"];

export function validateAddress(network, address) {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export function normalizeAddress(network, address) {
  const a = (address || "").trim();
  if (network === "solana") return a;
  return a.toLowerCase();
}