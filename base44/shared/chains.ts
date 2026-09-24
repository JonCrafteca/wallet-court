// Wallet Court — centralized backend chain registry. Single source of truth
// for all supported chains' canonical metadata. Imported by every backend
// shared module and function that needs chain/network information.
//
// A parallel frontend registry lives at src/lib/chains.js. The two cannot
// safely cross-import (different build runtimes), so
// tests/chainRegistryParity.test.ts enforces that their canonical network
// keys and per-chain metadata stay synchronized.
//
// Adding a new chain: append a ChainConfig entry here AND in src/lib/chains.js.
// Entity-schema network enums must still be updated explicitly (schemas cannot
// import runtime configuration).

export type ChainFamily = "evm" | "solana";

export interface ChainConfig {
  /** Internal network key used across entities, APIs, and URLs. */
  key: string;
  /** Value sent to the Nansen `chain` request field. */
  nansenChain: string;
  /** Human-readable display name. */
  label: string;
  /** Address family — determines validation and signing scheme. */
  family: ChainFamily;
  /** EVM chain ID (null for non-EVM chains). */
  chainId: number | null;
  /** Native currency symbol. */
  nativeCurrency: string;
  /** Public RPC URL (null for chains served only through Nansen). */
  rpcUrl: string | null;
  /** Block explorer base URL. */
  explorerUrl: string | null;
  /** ISO date of the earliest Nansen data coverage. Null = no clamp. */
  coverageStart: string | null;
}

export const CHAINS: ChainConfig[] = [
  { key: "ethereum", nansenChain: "ethereum", label: "Ethereum", family: "evm", chainId: 1, nativeCurrency: "ETH", rpcUrl: null, explorerUrl: "https://etherscan.io", coverageStart: null },
  { key: "base", nansenChain: "base", label: "Base", family: "evm", chainId: 8453, nativeCurrency: "ETH", rpcUrl: null, explorerUrl: "https://basescan.org", coverageStart: null },
  { key: "solana", nansenChain: "solana", label: "Solana", family: "solana", chainId: null, nativeCurrency: "SOL", rpcUrl: null, explorerUrl: "https://solscan.io", coverageStart: null },
  { key: "robinhood", nansenChain: "robinhood", label: "Robinhood", family: "evm", chainId: 4663, nativeCurrency: "ETH", rpcUrl: "https://rpc.mainnet.chain.robinhood.com", explorerUrl: "https://robinhoodchain.blockscout.com", coverageStart: "2026-04-30" },
];

const byKey = new Map(CHAINS.map((c) => [c.key, c]));

/** Ordered list of all supported internal network keys. */
export const NETWORKS: string[] = CHAINS.map((c) => c.key);

/** Set of all supported internal network keys. */
export const ALLOWED_NETWORKS: Set<string> = new Set(NETWORKS);

/** Map of internal network key → Nansen chain value. */
export const CHAIN_BY_NETWORK: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.key, c.nansenChain])
);

/** Networks that support wallet ownership claims (all current chains). */
export const SUPPORTED_CLAIM_NETWORKS: string[] = [...NETWORKS];

/** Lookup a full chain config by internal key. Returns undefined if unknown. */
export function getChainConfig(network: string): ChainConfig | undefined {
  return byKey.get(network);
}

/** True if the network is an EVM chain (0x addresses, EIP-191 signing). */
export function isEvmNetwork(network: string): boolean {
  const cfg = byKey.get(network);
  return !!cfg && cfg.family === "evm";
}

/** Coverage start date as a UTC Date, or null when no clamp is needed. */
export function coverageStartFor(network: string): Date | null {
  const cfg = byKey.get(network);
  if (!cfg || !cfg.coverageStart) return null;
  return new Date(cfg.coverageStart + "T00:00:00.000Z");
}

/**
 * Compute the effective evidence window after coverage-start clamping.
 * Pure: no network, no DB. Extracted from fetchNansenEvidence for unit testing.
 *
 * For chains with a known Nansen coverage start date (e.g. Robinhood 2026-04-30),
 * the `from` date is clamped to the coverage start so we never request data
 * earlier than the chain's data availability.
 *
 * Returns the clamped from/to dates, the effective window in days, whether
 * the window was clamped (coverage_limited), and the coverage start ISO string.
 */
export function computeCoverageWindow(
  network: string,
  requestedWindowDays: number,
  now: Date = new Date()
): {
  from: Date;
  to: Date;
  effectiveWindowDays: number;
  coverage_limited: boolean;
  coverage_start: string | null;
  requested_window_days: number;
} {
  const to = new Date(now.getTime());
  let from = new Date(to.getTime() - requestedWindowDays * 86400000);
  const coverageStart = coverageStartFor(network);
  const originalFrom = new Date(from.getTime());
  const coverage_limited = !!(coverageStart && originalFrom < coverageStart);
  if (coverageStart && from < coverageStart) {
    from = new Date(coverageStart.getTime());
  }
  const effectiveWindowMs = Math.max(0, to.getTime() - from.getTime());
  const effectiveWindowDays = effectiveWindowMs / 86400000;
  return {
    from,
    to,
    effectiveWindowDays,
    coverage_limited,
    coverage_start: coverageStart ? coverageStart.toISOString() : null,
    requested_window_days: requestedWindowDays
  };
}