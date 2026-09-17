// Client-side public wallet-class labels + Hall filter chips. Mirrors the safe
// labels in base44/shared/walletClass.ts without importing server code. Only
// safe classifications are ever exposed — never raw labels or personal names.
export const PUBLIC_CLASS_LABELS = {
  cex_exchange: "Nansen-labeled exchange wallet",
  market_maker: "Nansen-labeled market maker",
  mev_bot: "Nansen-labeled MEV/bot",
  protocol_treasury: "Nansen-labeled protocol or treasury",
  fund_institution: "Nansen-labeled institution",
  trader_individual: "Trader wallet",
  unknown: "Unclassified wallet"
};

// Hall filter chips (item 5). "All" shows every class.
export const HALL_CLASS_FILTERS = [
  { id: "all", label: "All" },
  { id: "trader_individual", label: "Traders" },
  { id: "cex_exchange", label: "Exchanges" },
  { id: "market_maker", label: "Market Makers" },
  { id: "mev_bot", label: "MEV / Bots" },
  { id: "protocol_treasury", label: "Protocols" },
  { id: "fund_institution", label: "Institutions" },
  { id: "unknown", label: "Unclassified" }
];

export function publicClassLabel(code) {
  return PUBLIC_CLASS_LABELS[code] || PUBLIC_CLASS_LABELS.unknown;
}

// Compact label for Hall cards.
export function shortClassLabel(code) {
  const map = {
    cex_exchange: "Exchange",
    market_maker: "Market Maker",
    mev_bot: "MEV/Bot",
    protocol_treasury: "Protocol",
    fund_institution: "Institution",
    trader_individual: "Trader",
    unknown: "Unclassified"
  };
  return map[code] || "Unclassified";
}