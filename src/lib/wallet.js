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

// Display-safe abbreviated address. Prefers the server-provided non-reversible
// address_short (public case page via getTrialBySlug); falls back to computing
// from the full address when the trial came from the submitter's own analysis
// (Home.jsx), where the full address is the submitter's own input.
export function displayAddressShort(trial) {
  if (!trial) return "";
  if (trial.address_short) return trial.address_short;
  const a = trial.normalized_wallet_address || trial.wallet_address || "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}