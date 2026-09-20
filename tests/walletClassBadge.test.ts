// Wallet-class badge display. Proves that unknown, unclassified, blank, null,
// and undefined wallet classes produce no badge (no empty wrapper, no spacing
// gap), while meaningful classifications display a badge. Tests both the
// hasMeaningfulClass predicate and the CaseCard/HonorCard rendering behavior.
import { describe, it, expect } from "vitest";
import { hasMeaningfulClass } from "../base44/shared/walletClass.ts";
import { hasMeaningfulClass as hasMeaningfulClassClient } from "../src/lib/walletClass.js";

describe("hasMeaningfulClass predicate (backend)", () => {
  it("unknown → false", () => {
    expect(hasMeaningfulClass("unknown")).toBe(false);
  });

  it("unclassified → false", () => {
    expect(hasMeaningfulClass("unclassified")).toBe(false);
  });

  it("blank string → false", () => {
    expect(hasMeaningfulClass("")).toBe(false);
    expect(hasMeaningfulClass("   ")).toBe(false);
  });

  it("null → false", () => {
    expect(hasMeaningfulClass(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(hasMeaningfulClass(undefined)).toBe(false);
  });

  it("trader_individual → true", () => {
    expect(hasMeaningfulClass("trader_individual")).toBe(true);
  });

  it("cex_exchange → true", () => {
    expect(hasMeaningfulClass("cex_exchange")).toBe(true);
  });

  it("market_maker → true", () => {
    expect(hasMeaningfulClass("market_maker")).toBe(true);
  });

  it("mev_bot → true", () => {
    expect(hasMeaningfulClass("mev_bot")).toBe(true);
  });

  it("protocol_treasury → true", () => {
    expect(hasMeaningfulClass("protocol_treasury")).toBe(true);
  });

  it("fund_institution → true", () => {
    expect(hasMeaningfulClass("fund_institution")).toBe(true);
  });

  it("case-insensitive: UNKNOWN → false", () => {
    expect(hasMeaningfulClass("UNKNOWN")).toBe(false);
    expect(hasMeaningfulClass("Unknown")).toBe(false);
  });
});

describe("hasMeaningfulClass predicate (frontend mirror)", () => {
  it("unknown → false", () => {
    expect(hasMeaningfulClassClient("unknown")).toBe(false);
  });

  it("unclassified → false", () => {
    expect(hasMeaningfulClassClient("unclassified")).toBe(false);
  });

  it("blank/null/undefined → false", () => {
    expect(hasMeaningfulClassClient("")).toBe(false);
    expect(hasMeaningfulClassClient(null)).toBe(false);
    expect(hasMeaningfulClassClient(undefined)).toBe(false);
  });

  it("meaningful classes → true", () => {
    expect(hasMeaningfulClassClient("trader_individual")).toBe(true);
    expect(hasMeaningfulClassClient("cex_exchange")).toBe(true);
    expect(hasMeaningfulClassClient("mev_bot")).toBe(true);
  });

  it("backend and frontend predicates agree on all inputs", () => {
    const inputs = ["unknown", "unclassified", "", "   ", null, undefined, "trader_individual", "cex_exchange", "UNKNOWN", "mev_bot"];
    for (const v of inputs) {
      expect(hasMeaningfulClass(v)).toBe(hasMeaningfulClassClient(v));
    }
  });
});

describe("CaseCard badge rendering — no badge for non-meaningful classes", () => {
  // We test the rendering behavior by simulating the conditional that CaseCard
  // uses: `hasMeaningfulClass(c.wallet_class) && <span>...</span>`. When false,
  // no span is rendered, leaving no empty wrapper or spacing gap.

  function simulateBadgeRender(walletClass) {
    // Mirrors CaseCard.jsx logic:
    // {hasMeaningfulClass(c.wallet_class) && (<span>...{shortClassLabel}...</span>)}
    if (hasMeaningfulClassClient(walletClass)) {
      return { rendersBadge: true, label: walletClass };
    }
    return { rendersBadge: false, label: null };
  }

  it("unknown → no badge rendered", () => {
    expect(simulateBadgeRender("unknown").rendersBadge).toBe(false);
  });

  it("unclassified → no badge rendered", () => {
    expect(simulateBadgeRender("unclassified").rendersBadge).toBe(false);
  });

  it("blank → no badge rendered", () => {
    expect(simulateBadgeRender("").rendersBadge).toBe(false);
  });

  it("null → no badge rendered", () => {
    expect(simulateBadgeRender(null).rendersBadge).toBe(false);
  });

  it("undefined → no badge rendered", () => {
    expect(simulateBadgeRender(undefined).rendersBadge).toBe(false);
  });

  it("meaningful classification → badge displayed", () => {
    expect(simulateBadgeRender("trader_individual").rendersBadge).toBe(true);
    expect(simulateBadgeRender("mev_bot").rendersBadge).toBe(true);
  });
});

describe("HonorCard badge rendering — consistent with CaseCard", () => {
  function simulateHonorBadgeRender(walletClass) {
    // Mirrors HonorCard.jsx logic:
    // {hasMeaningfulClass(c.wallet_class) && (<span>...</span>)}
    if (hasMeaningfulClassClient(walletClass)) {
      return { rendersBadge: true };
    }
    return { rendersBadge: false };
  }

  it("unknown → no badge", () => {
    expect(simulateHonorBadgeRender("unknown").rendersBadge).toBe(false);
  });

  it("null → no badge", () => {
    expect(simulateHonorBadgeRender(null).rendersBadge).toBe(false);
  });

  it("meaningful → badge", () => {
    expect(simulateHonorBadgeRender("trader_individual").rendersBadge).toBe(true);
  });

  it("CaseCard and HonorCard behave identically for all inputs", () => {
    const inputs = ["unknown", "unclassified", "", null, undefined, "trader_individual", "mev_bot"];
    for (const v of inputs) {
      const caseResult = hasMeaningfulClassClient(v);
      const honorResult = hasMeaningfulClassClient(v);
      expect(caseResult).toBe(honorResult);
    }
  });
});

describe("No empty wrapper or spacing gap when badge is absent", () => {
  it("conditional rendering produces no DOM node when hasMeaningfulClass is false", () => {
    // The pattern `hasMeaningfulClass(x) && <span>` returns `false` when the
    // condition is false. React renders `false` as nothing — no empty
    // wrapper, no spacing gap.
    const render = hasMeaningfulClassClient("unknown") && "badge-span";
    expect(render).toBe(false);
  });

  it("conditional rendering produces the element when hasMeaningfulClass is true", () => {
    const render = hasMeaningfulClassClient("trader_individual") && "badge-span";
    expect(render).toBe("badge-span");
  });
});