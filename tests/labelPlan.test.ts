import { describe, it, expect } from "vitest";
import {
  computeLabelPlan,
  cacheKey,
  confirmSpending,
  LABEL_CREDIT_COST,
  CORE_CREDIT_COST_PER_WALLET,
  LABEL_CACHE_TTL_DAYS,
  CONFIRM_PHRASE,
  CREDIT_COSTS,
  CORE_ENDPOINT_KEYS
} from "../base44/shared/labelPlan.ts";

describe("automatic pipeline is exactly four calls (no labels)", () => {
  it("CORE_ENDPOINT_KEYS has exactly 4 endpoints", () => {
    expect(CORE_ENDPOINT_KEYS.length).toBe(4);
  });
  it("address_labels is not in the automatic pipeline", () => {
    expect(CORE_ENDPOINT_KEYS).not.toContain("address_labels");
  });
  it("core endpoints cost 1 credit each, labels cost 100", () => {
    expect(CREDIT_COSTS.pnl_summary).toBe(1);
    expect(CREDIT_COSTS.dex_trades).toBe(1);
    expect(CREDIT_COSTS.current_balance).toBe(1);
    expect(CREDIT_COSTS.transactions).toBe(1);
    expect(CREDIT_COSTS.address_labels).toBe(100);
  });
  it("documented core cost per wallet = 4, label cost = 100", () => {
    expect(CORE_CREDIT_COST_PER_WALLET).toBe(4);
    expect(LABEL_CREDIT_COST).toBe(100);
  });
});

describe("computeLabelPlan — cache + refresh", () => {
  const cases = (n) => Array.from({ length: n }, (_, i) => ({
    case_slug: `c${i}`, normalized_wallet_address: `0x${i}`, network: "ethereum"
  }));

  it("one uncached wallet → one label call, 100 credits", () => {
    const p = computeLabelPlan(cases(1), {});
    expect(p.new_label_calls).toBe(1);
    expect(p.estimated_credit_cost).toBe(100);
    expect(p.already_cached).toBe(0);
  });
  it("cached fresh wallet, refresh=false → zero calls", () => {
    const cache = { "ethereum:0x0": { labeled_at: new Date().toISOString() } };
    const p = computeLabelPlan(cases(1), cache);
    expect(p.new_label_calls).toBe(0);
    expect(p.already_cached).toBe(1);
    expect(p.estimated_credit_cost).toBe(0);
  });
  it("cached fresh wallet, refresh=true → zero calls (fresh, not re-called)", () => {
    const cache = { "ethereum:0x0": { labeled_at: new Date().toISOString() } };
    const p = computeLabelPlan(cases(1), cache, { refresh: true });
    expect(p.new_label_calls).toBe(0);
    expect(p.already_cached).toBe(1);
  });
  it("cached stale (>30d), refresh=false → zero calls", () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const cache = { "ethereum:0x0": { labeled_at: old } };
    const p = computeLabelPlan(cases(1), cache);
    expect(p.new_label_calls).toBe(0);
    expect(p.eligible_for_refresh).toBe(1);
  });
  it("cached stale (>30d), refresh=true → one call", () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const cache = { "ethereum:0x0": { labeled_at: old } };
    const p = computeLabelPlan(cases(1), cache, { refresh: true });
    expect(p.new_label_calls).toBe(1);
    expect(p.eligible_for_refresh).toBe(1);
  });
  it("two uncached wallets → two calls, 200 credits", () => {
    const p = computeLabelPlan(cases(2), {});
    expect(p.new_label_calls).toBe(2);
    expect(p.estimated_credit_cost).toBe(200);
  });
  it("mixed: one cached fresh + one uncached → one call", () => {
    const cache = { "ethereum:0x0": { labeled_at: new Date().toISOString() } };
    const p = computeLabelPlan(cases(2), cache);
    expect(p.new_label_calls).toBe(1);
    expect(p.already_cached).toBe(1);
  });
});

describe("confirmSpending — explicit admin confirmation", () => {
  it("requires the exact phrase (case-sensitive)", () => {
    expect(confirmSpending("SPEND LABEL CREDITS")).toBe(true);
    expect(confirmSpending("spend label credits")).toBe(false);
    expect(confirmSpending("")).toBe(false);
    expect(confirmSpending(null)).toBe(false);
  });
  it("trims surrounding whitespace", () => {
    expect(confirmSpending("  SPEND LABEL CREDITS  ")).toBe(true);
  });
  it("CONFIRM_PHRASE constant matches", () => {
    expect(CONFIRM_PHRASE).toBe("SPEND LABEL CREDITS");
  });
});

describe("constants", () => {
  it("label credit cost = 100, core per wallet = 4, ttl = 30 days", () => {
    expect(LABEL_CREDIT_COST).toBe(100);
    expect(CORE_CREDIT_COST_PER_WALLET).toBe(4);
    expect(LABEL_CACHE_TTL_DAYS).toBe(30);
  });
  it("cacheKey is network + address", () => {
    expect(cacheKey("0xabc", "ethereum")).toBe("ethereum:0xabc");
  });
});