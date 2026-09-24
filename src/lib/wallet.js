// Client-side wallet address validation/normalization. Mirrors the server-side
// rules in base44/shared/verdicts.ts and base44/shared/walletValidation.ts.
// Solana: strict Base58 decode to 32 bytes (not just a loose regex).
// Canonical chain list is centralized in ./chains.
export { NETWORKS } from "./chains";

import { isValidSolanaAddress, isValidEvmAddress } from "./walletValidation";

export function validateAddress(network, address) {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (network === "solana") return isValidSolanaAddress(a);
  return isValidEvmAddress(a);
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