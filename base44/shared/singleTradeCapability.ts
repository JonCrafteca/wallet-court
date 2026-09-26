// Wallet Court — Single Trade Trial capability registry. Server-authoritative.
// Defines, per network, which Single Trade capabilities are available.
//
// This registry replaces hardcoded "Solana only" checks. The analyzeSingleTrade
// and discoverTokenPurchases functions consult this registry to decide whether
// a network is supported before making any Nansen calls.
//
// VERIFICATION STATUS (as of 2026-09-26):
//   - Solana: VERIFIED by live NansenApiCallAudit records (1,024 total, all
//     solana, all 200 OK). dex-trades, token-ohlcv, and current-balance all
//     returned valid data for real wallets.
//   - Ethereum: UNVERIFIED. No live audit records exist for Single Trade on
//     ethereum. The Nansen API accepts "ethereum" as a chain identifier for
//     dex-trades and current-balance (verified by whole-wallet trials), but
//     token-ohlcv on ethereum has never been tested. Marked unavailable until
//     a live test confirms all three endpoints return valid data.
//   - Base: UNVERIFIED. No live audit records exist for Single Trade on base.
//     The Nansen API accepts "base" as a chain identifier for whole-wallet
//     trials, but token-ohlcv on base has never been tested. Marked unavailable.
//   - Robinhood: UNVERIFIED and known-limited. Robinhood coverage starts
//     2026-04-30. token-ohlcv support is unverified. Marked unavailable.
//
// Whole-wallet Robinhood support is unchanged — it uses different endpoints
// (pnl-summary, transactions) that are verified for all four chains.
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
    discoveryAvailable: false, // UNVERIFIED — no live token-ohlcv test
    ohlcvAvailable: false,      // UNVERIFIED — no live token-ohlcv test
    balanceAvailable: false,    // UNVERIFIED for Single Trade
    publicAvailable: false,
    adminPreviewAvailable: false,
  },
  {
    network: "base",
    family: "evm",
    nansenChain: "base",
    label: "Base",
    discoveryAvailable: false, // UNVERIFIED — no live token-ohlcv test
    ohlcvAvailable: false,      // UNVERIFIED — no live token-ohlcv test
    balanceAvailable: false,    // UNVERIFIED for Single Trade
    publicAvailable: false,
    adminPreviewAvailable: false,
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