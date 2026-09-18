import { describe, it, expect } from "vitest";
import { hasMeaningfulHoldingsEvidence, MIN_PORTFOLIO_VALUE_USD } from "../base44/shared/holdingsEvidence.ts";

// ---- The minimum threshold ----

describe("MIN_PORTFOLIO_VALUE_USD — launch default", () => {
  it("is $25 (conservative minimum for meaningful holdings)", () => {
    expect(MIN_PORTFOLIO_VALUE_USD).toBe(25);
  });
});

// ---- Meaningful holdings detection ----

describe("hasMeaningfulHoldingsEvidence — portfolio value gate", () => {
  it("portfolio value at or above the minimum → meaningful", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD })).toBe(true);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 100 })).toBe(true);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 150000 })).toBe(true);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 2.14e9 })).toBe(true);
  });
  it("portfolio value just below the minimum → NOT meaningful", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD - 0.01 })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 1 })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 0.5 })).toBe(false);
  });
  it("zero portfolio value → NOT meaningful", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: 0 })).toBe(false);
  });
  it("missing portfolio value → NOT meaningful (no fabrication)", () => {
    expect(hasMeaningfulHoldingsEvidence({})).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 30 })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence(null)).toBe(false);
    expect(hasMeaningfulHoldingsEvidence(undefined)).toBe(false);
  });
});

// ---- Token count alone is NEVER sufficient (the core N2.4 hardening) ----

describe("token count alone cannot establish meaningful holdings", () => {
  it("a large token count without portfolio value is NOT meaningful", () => {
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 1000 })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 500 })).toBe(false);
  });
  it("a single token with negligible value is NOT meaningful (dust/spam rejection)", () => {
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 1, portfolio_value_usd: 0.01 })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 1, portfolio_value_usd: 24.99 })).toBe(false);
  });
  it("a single token AT the minimum value IS meaningful", () => {
    expect(hasMeaningfulHoldingsEvidence({ token_balance_count: 1, portfolio_value_usd: MIN_PORTFOLIO_VALUE_USD })).toBe(true);
  });
});

// ---- String / numeric coercion safety ----

describe("numeric coercion — string values are parsed, invalid rejected", () => {
  it("numeric strings are accepted", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: "5000" })).toBe(true);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: "24.99" })).toBe(false);
  });
  it("empty string and non-numeric strings are rejected (no fabrication)", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: "" })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: "abc" })).toBe(false);
  });
  it("NaN and Infinity are rejected", () => {
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: NaN })).toBe(false);
    expect(hasMeaningfulHoldingsEvidence({ portfolio_value_usd: Infinity })).toBe(false);
  });
});

// ---- Pure / deterministic ----

describe("purity and determinism", () => {
  it("identical inputs always produce identical results", () => {
    const m = { portfolio_value_usd: 5000, token_balance_count: 10 };
    expect(hasMeaningfulHoldingsEvidence(m)).toBe(hasMeaningfulHoldingsEvidence(m));
    expect(hasMeaningfulHoldingsEvidence(m)).toBe(true);
  });
  it("does not mutate its input", () => {
    const m = { portfolio_value_usd: 5000 };
    const before = JSON.stringify(m);
    hasMeaningfulHoldingsEvidence(m);
    expect(JSON.stringify(m)).toBe(before);
  });
});