// Wallet Court — Single Trade Trial capability registry. Server-authoritative.
// Defines, per network, which Single Trade capabilities are available.
//
// This registry replaces hardcoded "Solana only" checks. The analyzeSingleTrade
// and discoverTokenPurchases functions consult this registry to decide whether
// a network is supported before making any Nansen calls.
//
// Capabilities are based on a code audit of the Nansen request paths:
//   - dex-trades (purchase discovery + sells): supports ethereum, base, solana, robinhood
//   - token-ohlcv (OHLCV candles): supports solana and all other Nansen chains
//   - current-balance (holding verification): supports ethereum, base, solana, robinhood
//
// Robinhood is marked unavailable for Single Trade because token-ohlcv support
// for Robinhood is unverified (Robinhood is a recent chain with coverage starting
// 2026-04-30, and token-level OHLCV may not be available). Whole Wallet Robinhood
// support is unchanged — it uses different endpoints (pnl-summary, transactions).
//
// Adding a new chain: append an entry here AND in src/lib/singleTradeCapability.js.
// tests/singleTradeCapabilityParity.test.ts enforces synchronization.

export interface SingleTradeCapability {
  /** Internal network key. */
  network: string;
  /** Address family — determines validation. */
  family: "evm" | "solana";
  /** Nansen chain identifier sent to the API. */
  nansenChain: string;
  /** Human-readable label. */
  label: string;
  /** Purchase discovery (dex-trades with token_bought_address filter). */
  discoveryAvailable: boolean;
  /** OHLCV candle history (token-ohlcv endpoint). */
  ohlcvAvailable: boolean;
  /** Balance/holding verification (current-balance endpoint). */
  balanceAvailable: boolean;
  /** Whether Single Trade is publicly available on this chain (flag-gated). */
  publicAvailable: boolean;
  /** Whether admins can preview Single Trade on this chain. */
  adminPreviewAvailable: boolean;
}

export const SINGLE_TRADE_CAPABILITIES: SingleTradeCapability[] = [
  {
    network: "solana",
    family: "solana",
    nansenChain: "solana",
    label: "Solana",
    discoveryAvailable: true,
    ohlcvAvailable: true,
    balanceAvailable: true,
    publicAvailable: false, // flag-gated via single_trade_public_enabled
    adminPreviewAvailable: true,
  },
  {
    network: "ethereum",
    family: "evm",
    nansenChain: "ethereum",
    label: "Ethereum",
    discoveryAvailable: true,
    ohlcvAvailable: true,
    balanceAvailable: true,
    publicAvailable: false, // flag-gated
    adminPreviewAvailable: true,
  },
  {
    network: "base",
    family: "evm",
    nansenChain: "base",
    label: "Base",
    discoveryAvailable: true,
    ohlcvAvailable: true,
    balanceAvailable: true,
    publicAvailable: false, // flag-gated
    adminPreviewAvailable: true,
  },
  {
    network: "robinhood",
    family: "evm",
    nansenChain: "robinhood",
    label: "Robinhood",
    discoveryAvailable: false, // unverified for token-level OHLCV
    ohlcvAvailable: false,
    balanceAvailable: false,
    publicAvailable: false,
    adminPreviewAvailable: false,
  },
];

const byNetwork = new Map(SINGLE_TRADE_CAPABILITIES.map((c) => [c.network, c]));

/** Lookup a capability by network key. Returns undefined if unknown. */
export function getSingleTradeCapability(network: string): SingleTradeCapability | undefined {
  return byNetwork.get(network);
}

/** True if the network supports ALL required Single Trade endpoints. */
export function isSingleTradeSupported(network: string): boolean {
  const cap = byNetwork.get(network);
  if (!cap) return false;
  return cap.discoveryAvailable && cap.ohlcvAvailable && cap.balanceAvailable;
}

/** Ordered list of networks that support Single Trade (for selectors). */
export const SUPPORTED_SINGLE_TRADE_NETWORKS: string[] = SINGLE_TRADE_CAPABILITIES
  .filter((c) => c.discoveryAvailable && c.ohlcvAvailable && c.balanceAvailable)
  .map((c) => c.network);

/** All registered network keys (including unsupported, for display). */
export const ALL_SINGLE_TRADE_NETWORKS: string[] = SINGLE_TRADE_CAPABILITIES.map((c) => c.network);