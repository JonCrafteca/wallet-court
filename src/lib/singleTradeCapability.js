// Frontend mirror of base44/shared/singleTradeCapability.ts. Pure, testable.
// Used by SingleTradeIntake to render the network selector with honest
// availability states. tests/singleTradeCapabilityParity.test.ts enforces
// synchronization with the backend registry.

export const SINGLE_TRADE_CAPABILITIES = [
  {
    network: "solana",
    family: "solana",
    nansenChain: "solana",
    label: "Solana",
    discoveryAvailable: true,
    ohlcvAvailable: true,
    balanceAvailable: true,
    publicAvailable: false,
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
    publicAvailable: false,
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
    publicAvailable: false,
    adminPreviewAvailable: true,
  },
  {
    network: "robinhood",
    family: "evm",
    nansenChain: "robinhood",
    label: "Robinhood",
    discoveryAvailable: false,
    ohlcvAvailable: false,
    balanceAvailable: false,
    publicAvailable: false,
    adminPreviewAvailable: false,
  },
];

const byNetwork = new Map(SINGLE_TRADE_CAPABILITIES.map((c) => [c.network, c]));

export function getSingleTradeCapability(network) {
  return byNetwork.get(network);
}

export function isSingleTradeSupported(network) {
  const cap = byNetwork.get(network);
  if (!cap) return false;
  return cap.discoveryAvailable && cap.ohlcvAvailable && cap.balanceAvailable;
}

export const SUPPORTED_SINGLE_TRADE_NETWORKS = SINGLE_TRADE_CAPABILITIES
  .filter((c) => c.discoveryAvailable && c.ohlcvAvailable && c.balanceAvailable)
  .map((c) => c.network);

export const ALL_SINGLE_TRADE_NETWORKS = SINGLE_TRADE_CAPABILITIES.map((c) => c.network);