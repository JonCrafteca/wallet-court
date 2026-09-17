// Wallet Court — deterministic wallet classification from Nansen Address Labels.
// Pure (no server runtime): imported by backend functions and unit tests.
//
// Nansen's Address Labels endpoint (POST /api/v1/profiler/address/labels) returns,
// per label: { label: string, category: string|null, kind: string[] } where
// category ∈ {smart_money, behavioral, defi, social, cefi, nft, others} and
// kind ∈ {entity, name, entity-tag, ...}. Premium labels (smart money, alpha
// trader) are excluded from this endpoint by design.
//
// Classification uses documented label metadata and normalized keyword sets —
// never specific addresses or organization names. A wallet is assigned exactly
// one class by precedence. Personal/public-figure names in labels are NEVER
// exposed publicly; only the safe class label is.

export const WALLET_CLASSES = [
  "cex_exchange",
  "market_maker",
  "mev_bot",
  "protocol_treasury",
  "fund_institution",
  "trader_individual",
  "unknown"
];

// Precedence: most specific operational behavior first, then entity types, then
// individual, then unknown. When labels conflict, the highest-precedence match
// wins deterministically.
export const CLASS_PRECEDENCE = [
  "mev_bot",
  "cex_exchange",
  "market_maker",
  "protocol_treasury",
  "fund_institution",
  "trader_individual",
  "unknown"
];

// Keyword sets matched case-insensitively against the label text. Category
// matches are checked separately. These reflect Nansen's documented label
// categories (cefi = centralized finance / exchanges) and common label names.
const LABEL_KEYWORDS = {
  mev_bot: ["mev", "sandwich", "flashbot", "flashbots", "arbitrage bot", "front-run", "frontrun", "back-run", "backrun", "jit bot", "searcher", "bundle"],
  cex_exchange: ["exchange", "cex", "hot wallet", "cold wallet", "deposit", "withdrawal", "trading wallet", "operational wallet"],
  market_maker: ["market maker", "market-maker", "liquidity provider", "lp provider", "dex mm", "prop shop"],
  protocol_treasury: ["treasury", "protocol", "dao", "foundation", "ecosystem fund", "grant fund", "deployer", "team multisig", "official multisig"],
  fund_institution: ["fund", "institution", "asset manager", "asset-management", "hedge fund", "venture", "otc desk", "family office", "index fund"]
};

// Nansen category → class. cefi (centralized finance) maps to exchange.
const CATEGORY_MAP = {
  cefi: "cex_exchange"
};

function hasKeyword(text, terms) {
  const t = (text || "").toLowerCase();
  return terms.some((k) => t.includes(k));
}

// Classify a single label into a candidate class (or null).
function classifyLabel(label) {
  if (!label || typeof label !== "object") return null;
  const labelText = String(label.label || "");
  const category = label.category ? String(label.category).toLowerCase() : "";
  const kinds = Array.isArray(label.kind) ? label.kind.map((k) => String(k).toLowerCase()) : [];

  // Category-driven (highest confidence): cefi → exchange.
  if (CATEGORY_MAP[category]) return CATEGORY_MAP[category];

  // Label-text keyword matching, in precedence order.
  for (const cls of CLASS_PRECEDENCE) {
    if (cls === "unknown" || cls === "trader_individual") continue;
    const terms = LABEL_KEYWORDS[cls];
    if (terms && hasKeyword(labelText, terms)) return cls;
  }

  // kind "name" with no entity match → individual (ENS / personal name, never
  // exposed). We classify it as a trader wallet but never surface the name.
  if (kinds.includes("name") || labelText.includes(".eth") || labelText.includes(".sol")) {
    return "trader_individual";
  }

  return null;
}

// Deterministic wallet classification from a Nansen labels array. Returns one
// of WALLET_CLASSES. Conflicting labels resolve by CLASS_PRECEDENCE. An empty
// or missing labels array yields "unknown".
export function normalizeWalletClass(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return "unknown";
  const candidates = new Set();
  for (const l of labels) {
    const c = classifyLabel(l);
    if (c) candidates.add(c);
  }
  if (candidates.size === 0) return "unknown";
  for (const cls of CLASS_PRECEDENCE) {
    if (candidates.has(cls)) return cls;
  }
  return "unknown";
}

// Safe public labels — never include organization names or personal names.
export const PUBLIC_CLASS_LABELS = {
  cex_exchange: "Nansen-labeled exchange wallet",
  market_maker: "Nansen-labeled market maker",
  mev_bot: "Nansen-labeled MEV/bot",
  protocol_treasury: "Nansen-labeled protocol or treasury",
  fund_institution: "Nansen-labeled institution",
  trader_individual: "Trader wallet",
  unknown: "Unclassified wallet"
};

export function publicClassLabel(code) {
  return PUBLIC_CLASS_LABELS[code] || PUBLIC_CLASS_LABELS.unknown;
}

// Evidence card for the "WALLET CLASS" exhibit, shown near the top of Nansen
// Evidence. Only the safe class label is exposed — never raw labels or names.
export function walletClassEvidence(code) {
  if (code === "unknown") {
    return {
      tag: "NANSEN · LABELS",
      label: "Wallet Class",
      value: "Unclassified wallet",
      detail: "No reliable organizational classification was returned. Nansen's current address labels provide context for how this wallet operates. Classification is contextual evidence, not a legal or identity determination."
    };
  }
  return {
    tag: "NANSEN · LABELS",
    label: "Wallet Class",
    value: publicClassLabel(code),
    detail: "Nansen's current address labels provide context for how this wallet operates. Classification is contextual evidence, not a legal or identity determination."
  };
}