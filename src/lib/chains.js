// Wallet Court — centralized frontend chain registry. Mirrors the backend
// registry at base44/shared/chains.ts. The two cannot safely cross-import
// (different build runtimes); tests/chainRegistryParity.test.ts enforces
// that their canonical network keys and per-chain metadata stay synchronized.
//
// Adding a new chain: append an entry here AND in base44/shared/chains.ts.
// Entity-schema network enums must still be updated explicitly.

export const CHAINS = [
  { key: "ethereum", label: "Ethereum", family: "evm", chainId: 1, nativeCurrency: "ETH", explorerUrl: "https://etherscan.io", coverageStart: null },
  { key: "base", label: "Base", family: "evm", chainId: 8453, nativeCurrency: "ETH", explorerUrl: "https://basescan.org", coverageStart: null },
  { key: "solana", label: "Solana", family: "solana", chainId: null, nativeCurrency: "SOL", explorerUrl: "https://solscan.io", coverageStart: null },
  { key: "robinhood", label: "Robinhood", family: "evm", chainId: 4663, nativeCurrency: "ETH", explorerUrl: "https://robinhoodchain.blockscout.com", coverageStart: "2026-04-30" },
];

const byKey = new Map(CHAINS.map((c) => [c.key, c]));

/** Ordered list of all supported internal network keys. */
export const NETWORKS = CHAINS.map((c) => c.key);

/** UI-friendly selector options: [{ id, label }]. */
export const NETWORK_OPTIONS = CHAINS.map((c) => ({ id: c.key, label: c.label }));

export function getChainConfig(network) {
  return byKey.get(network);
}

export function isEvmNetwork(network) {
  const cfg = byKey.get(network);
  return !!cfg && cfg.family === "evm";
}