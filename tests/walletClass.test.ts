import { describe, it, expect } from "vitest";
import {
  normalizeWalletClass,
  publicClassLabel,
  walletClassEvidence,
  CLASS_PRECEDENCE
} from "../base44/shared/walletClass.ts";

describe("normalizeWalletClass — exchange", () => {
  it("cefi category → cex_exchange", () => {
    expect(normalizeWalletClass([{ label: "Hot Wallet", category: "cefi", kind: ["entity"] }])).toBe("cex_exchange");
  });
  it("exchange keyword → cex_exchange", () => {
    expect(normalizeWalletClass([{ label: "Centralized Exchange", category: "others", kind: ["entity"] }])).toBe("cex_exchange");
  });
});

describe("normalizeWalletClass — market maker", () => {
  it("market maker keyword", () => {
    expect(normalizeWalletClass([{ label: "Market Maker", category: "behavioral", kind: ["entity-tag"] }])).toBe("market_maker");
  });
});

describe("normalizeWalletClass — MEV/bot", () => {
  it("mev keyword", () => {
    expect(normalizeWalletClass([{ label: "MEV Bot", category: "behavioral", kind: ["entity"] }])).toBe("mev_bot");
  });
  it("sandwich keyword", () => {
    expect(normalizeWalletClass([{ label: "Sandwich Attacker", category: "behavioral", kind: [] }])).toBe("mev_bot");
  });
});

describe("normalizeWalletClass — protocol/treasury", () => {
  it("treasury keyword", () => {
    expect(normalizeWalletClass([{ label: "Protocol Treasury", category: "defi", kind: ["entity"] }])).toBe("protocol_treasury");
  });
});

describe("normalizeWalletClass — institution", () => {
  it("hedge fund keyword", () => {
    expect(normalizeWalletClass([{ label: "Hedge Fund", category: "others", kind: ["entity"] }])).toBe("fund_institution");
  });
});

describe("normalizeWalletClass — conflicting labels + precedence", () => {
  it("mev beats cex (mev has highest precedence)", () => {
    expect(normalizeWalletClass([
      { label: "Exchange Hot Wallet", category: "cefi", kind: ["entity"] },
      { label: "MEV Bot", category: "behavioral", kind: ["entity-tag"] }
    ])).toBe("mev_bot");
  });
  it("cex beats market maker", () => {
    expect(normalizeWalletClass([
      { label: "Exchange", category: "cefi", kind: ["entity"] },
      { label: "Market Maker", category: "behavioral", kind: [] }
    ])).toBe("cex_exchange");
  });
  it("market maker beats protocol", () => {
    expect(normalizeWalletClass([
      { label: "Market Maker", category: "behavioral", kind: [] },
      { label: "Protocol Treasury", category: "defi", kind: ["entity"] }
    ])).toBe("market_maker");
  });
  it("precedence order is mev > cex > mm > protocol > fund > trader > unknown", () => {
    expect(CLASS_PRECEDENCE).toEqual([
      "mev_bot", "cex_exchange", "market_maker", "protocol_treasury",
      "fund_institution", "trader_individual", "unknown"
    ]);
  });
});

describe("normalizeWalletClass — no labels / labels failure", () => {
  it("empty array → unknown", () => {
    expect(normalizeWalletClass([])).toBe("unknown");
  });
  it("null → unknown", () => {
    expect(normalizeWalletClass(null)).toBe("unknown");
  });
  it("labels endpoint failure (no usable labels) → unknown", () => {
    expect(normalizeWalletClass([{ label: "Some Random Tag", category: "others", kind: ["entity-tag"] }])).toBe("unknown");
  });
});

describe("personal names not exposed", () => {
  it("ENS name (kind name) → trader_individual, never the name", () => {
    const cls = normalizeWalletClass([{ label: "vitalik.eth", category: "social", kind: ["name"] }]);
    expect(cls).toBe("trader_individual");
    expect(publicClassLabel(cls)).toBe("Trader wallet");
    expect(publicClassLabel(cls)).not.toContain("vitalik");
  });
  it("no public label or evidence value contains a personal name", () => {
    for (const code of ["cex_exchange", "market_maker", "mev_bot", "protocol_treasury", "fund_institution", "trader_individual", "unknown"]) {
      expect(publicClassLabel(code)).not.toContain("vitalik");
      expect(walletClassEvidence(code).value).not.toContain("vitalik");
    }
  });
});

describe("walletClassEvidence — safe public card", () => {
  it("unknown shows 'Unclassified wallet' + no-reliable-classification copy", () => {
    const e = walletClassEvidence("unknown");
    expect(e.value).toBe("Unclassified wallet");
    expect(e.detail).toContain("No reliable organizational classification was returned.");
  });
  it("classified shows safe label + contextual-evidence disclaimer", () => {
    const e = walletClassEvidence("cex_exchange");
    expect(e.value).toBe("Nansen-labeled exchange wallet");
    expect(e.detail).toContain("contextual evidence, not a legal or identity determination");
  });
});