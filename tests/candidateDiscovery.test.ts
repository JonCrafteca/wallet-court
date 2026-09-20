import { describe, it, expect } from "vitest";
import {
  validateDiscoveryRequest,
  buildDiscoveryRequest,
  parseDiscoveryResponse,
  classifyLabelString,
  screeningForClass,
  screenCandidates,
  deduplicateCandidates,
  sanitizeCandidate,
  containsForbiddenCandidateData,
  sourceQueryFingerprint,
  cohortOrderBy,
  newCandidateId,
  DISCOVERY_ENDPOINT_KEY,
  DISCOVERY_WORKFLOW,
  MAX_DISCOVERY_LIMIT,
  MIN_DISCOVERY_LIMIT,
  DEFAULT_TIMEFRAME,
  COHORTS,
  DISCOVERY_TIMEFRAMES,
  FORBIDDEN_CANDIDATE_FIELDS
} from "../base44/shared/candidateDiscovery.ts";

const ETH_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("Candidate Discovery — request validation", () => {
  it("accepts a valid request", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
  });

  it("rejects unsupported network", () => {
    const r = validateDiscoveryRequest({ network: "bitcoin", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid cohort", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "invalid", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects unsupported timeframe", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 3, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects limit below minimum", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects limit above maximum", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 51 });
    expect(r.ok).toBe(false);
  });

  it("accepts all three required networks", () => {
    for (const n of ["ethereum", "base", "solana"]) {
      const r = validateDiscoveryRequest({ network: n, cohort: "top_performers", timeframe: 30, limit: 20 });
      expect(r.ok).toBe(true);
    }
  });
});

describe("Candidate Discovery — request contract serialization", () => {
  it("builds correct request body for top_performers", () => {
    const body = buildDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(body.chains).toEqual(["ethereum"]);
    expect(body.timeframe).toBe(30);
    expect(body.pagination).toEqual({ page: 1, per_page: 20 });
    expect(body.order_by).toEqual([{ field: "total_pnl_usd", direction: "DESC" }]);
  });

  it("builds correct request body for bottom_performers", () => {
    const body = buildDiscoveryRequest({ network: "solana", cohort: "bottom_performers", timeframe: 7, limit: 10 });
    expect(body.chains).toEqual(["solana"]);
    expect(body.order_by).toEqual([{ field: "total_pnl_usd", direction: "ASC" }]);
  });

  it("builds correct request body for high_activity", () => {
    const body = buildDiscoveryRequest({ network: "base", cohort: "high_activity", timeframe: 90, limit: 50 });
    expect(body.order_by).toEqual([{ field: "n_trades", direction: "DESC" }]);
  });

  it("builds correct request body for lower_activity", () => {
    const body = buildDiscoveryRequest({ network: "ethereum", cohort: "lower_activity", timeframe: 180, limit: 5 });
    expect(body.order_by).toEqual([{ field: "n_trades", direction: "ASC" }]);
  });

  it("does not include token_address (not required by Smart Money endpoint)", () => {
    const body = buildDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(body.token_address).toBeUndefined();
  });
});

describe("Candidate Discovery — label screening", () => {
  it("classifies exchange labels as cex_exchange", () => {
    expect(classifyLabelString("Binance 14 [0x28c6c0]")).toBe("cex_exchange");
    expect(classifyLabelString("Coinbase Hot Wallet")).toBe("cex_exchange");
    expect(classifyLabelString("OKX Deposit Wallet")).toBe("cex_exchange");
  });

  it("classifies router/protocol labels as protocol_treasury", () => {
    expect(classifyLabelString("Uniswap V3: Router 2")).toBe("protocol_treasury");
    expect(classifyLabelString("1inch Router")).toBe("protocol_treasury");
    expect(classifyLabelString("Aave Treasury")).toBe("protocol_treasury");
  });

  it("classifies MEV labels as mev_bot", () => {
    expect(classifyLabelString("MEV Bot 0x123")).toBe("mev_bot");
    expect(classifyLabelString("Sandwich Attacker")).toBe("mev_bot");
  });

  it("classifies fund labels as fund_institution", () => {
    expect(classifyLabelString("Galaxy Fund")).toBe("fund_institution");
    expect(classifyLabelString("Paradigm Venture Fund")).toBe("fund_institution");
  });

  it("classifies market maker labels as market_maker", () => {
    expect(classifyLabelString("Wintermute Market Maker")).toBe("market_maker");
    expect(classifyLabelString("Jump Trading Liquidity Provider")).toBe("market_maker");
  });

  it("classifies ENS names as trader_individual", () => {
    expect(classifyLabelString("vitalik.eth")).toBe("trader_individual");
  });

  it("classifies null/empty as unknown", () => {
    expect(classifyLabelString(null)).toBe("unknown");
    expect(classifyLabelString("")).toBe("unknown");
  });

  it("classifies generic labels as trader_individual", () => {
    expect(classifyLabelString("Some Random Trader")).toBe("trader_individual");
  });
});

describe("Candidate Discovery — screening result", () => {
  it("excluded classes: cex_exchange, protocol_treasury, mev_bot, market_maker", () => {
    expect(screeningForClass("cex_exchange")).toBe("excluded");
    expect(screeningForClass("protocol_treasury")).toBe("excluded");
    expect(screeningForClass("mev_bot")).toBe("excluded");
    expect(screeningForClass("market_maker")).toBe("excluded");
  });

  it("needs_review: fund_institution", () => {
    expect(screeningForClass("fund_institution")).toBe("needs_review");
  });

  it("eligible: trader_individual, unknown", () => {
    expect(screeningForClass("trader_individual")).toBe("eligible");
    expect(screeningForClass("unknown")).toBe("eligible");
  });
});

describe("Candidate Discovery — screenCandidates", () => {
  it("splits candidates into eligible, excluded, needs_review", () => {
    const candidates = [
      { wallet_class: "trader_individual", wallet_fingerprint: "a" },
      { wallet_class: "cex_exchange", wallet_fingerprint: "b" },
      { wallet_class: "fund_institution", wallet_fingerprint: "c" },
      { wallet_class: "unknown", wallet_fingerprint: "d" }
    ];
    const result = screenCandidates(candidates as any);
    expect(result.eligible.length).toBe(2);
    expect(result.excluded_services.length).toBe(1);
    expect(result.needs_review.length).toBe(1);
  });
});

describe("Candidate Discovery — deduplication", () => {
  it("removes duplicates within batch", () => {
    const candidates = [
      { wallet_fingerprint: "fp1" },
      { wallet_fingerprint: "fp1" },
      { wallet_fingerprint: "fp2" }
    ];
    const result = deduplicateCandidates(candidates as any, new Set(), new Set(), new Set());
    expect(result.unique.length).toBe(2);
    expect(result.duplicate_in_batch.length).toBe(1);
  });

  it("removes already-candidate fingerprints", () => {
    const candidates = [{ wallet_fingerprint: "fp1" }, { wallet_fingerprint: "fp2" }];
    const existing = new Set(["fp1"]);
    const result = deduplicateCandidates(candidates as any, existing, new Set(), new Set());
    expect(result.unique.length).toBe(1);
    expect(result.already_candidate.length).toBe(1);
  });

  it("removes already-queued fingerprints", () => {
    const candidates = [{ wallet_fingerprint: "fp1" }];
    const existingDocket = new Set(["fp1"]);
    const result = deduplicateCandidates(candidates as any, new Set(), existingDocket, new Set());
    expect(result.unique.length).toBe(0);
    expect(result.already_queued.length).toBe(1);
  });

  it("removes already-tried fingerprints", () => {
    const candidates = [{ wallet_fingerprint: "fp1" }];
    const existingTrials = new Set(["fp1"]);
    const result = deduplicateCandidates(candidates as any, new Set(), new Set(), existingTrials);
    expect(result.unique.length).toBe(0);
    expect(result.already_tried.length).toBe(1);
  });
});

describe("Candidate Discovery — response parsing", () => {
  it("parses a valid response with ethereum addresses", async () => {
    const json = {
      data: [
        { address: ETH_ADDR, address_label: null, total_pnl_usd: 5000, realized_pnl_usd: 3000, unrealized_pnl_usd: 2000, win_rate: 0.6, n_trades: 42, n_tokens: 5, open_trades: 2, held_tokens_count: 3 },
        { address: "0xinvalid", address_label: null, total_pnl_usd: 100, realized_pnl_usd: 100, unrealized_pnl_usd: 0, win_rate: 1, n_trades: 1, n_tokens: 1, open_trades: 0, held_tokens_count: 1 }
      ],
      pagination: { page: 1, per_page: 20, is_last_page: true }
    };
    const result = await parseDiscoveryResponse(json, "ethereum", "top_performers");
    expect(result.length).toBe(1);
    expect(result[0].wallet_address).toBe(ETH_ADDR);
    expect(result[0].network).toBe("ethereum");
    expect(result[0].cohort).toBe("top_performers");
    expect(result[0].ranking_metrics.total_pnl_usd).toBe(5000);
    expect(result[0].ranking_metrics.n_trades).toBe(42);
  });

  it("parses a valid response with solana addresses", async () => {
    const json = {
      data: [
        { address: SOL_ADDR, address_label: "Some Trader", total_pnl_usd: 1000, realized_pnl_usd: 800, unrealized_pnl_usd: 200, win_rate: 0.5, n_trades: 10, n_tokens: 3, open_trades: 1, held_tokens_count: 2 }
      ],
      pagination: { page: 1, per_page: 20, is_last_page: true }
    };
    const result = await parseDiscoveryResponse(json, "solana", "high_activity");
    expect(result.length).toBe(1);
    expect(result[0].network).toBe("solana");
    expect(result[0].wallet_class).toBe("trader_individual");
  });

  it("skips entries without address", async () => {
    const json = { data: [{ address_label: "No address" }], pagination: { is_last_page: true } };
    const result = await parseDiscoveryResponse(json, "ethereum", "top_performers");
    expect(result.length).toBe(0);
  });

  it("returns empty for null/invalid json", async () => {
    expect(await parseDiscoveryResponse(null, "ethereum", "top_performers")).toEqual([]);
    expect(await parseDiscoveryResponse({}, "ethereum", "top_performers")).toEqual([]);
  });
});

describe("Candidate Discovery — privacy sanitization", () => {
  it("sanitizeCandidate strips wallet_address and normalized_wallet_address", () => {
    const candidate = {
      candidate_id: "cand_123",
      wallet_address: ETH_ADDR,
      normalized_wallet_address: ETH_ADDR.toLowerCase(),
      address_short: "0x1234…5678",
      wallet_fingerprint: "fp1",
      network: "ethereum",
      source_endpoint: "pnl_leaderboard",
      wallet_class: "trader_individual",
      ranking_metrics_json: JSON.stringify({ total_pnl_usd: 5000 }),
      cohort: "top_performers",
      review_status: "discovered",
      skip_reason: null,
      version: 0
    };
    const sanitized = sanitizeCandidate(candidate);
    expect(sanitized.wallet_address).toBeUndefined();
    expect(sanitized.normalized_wallet_address).toBeUndefined();
    expect(sanitized.candidate_id).toBe("cand_123");
    expect(sanitized.address_short).toBe("0x1234…5678");
    expect(sanitized.ranking_metrics.total_pnl_usd).toBe(5000);
    expect(sanitized.screening).toBe("eligible");
  });

  it("containsForbiddenCandidateData detects wallet_address leak", () => {
    expect(containsForbiddenCandidateData({ wallet_address: "0x123" })).toBe(true);
    expect(containsForbiddenCandidateData({ candidate_id: "cand_1" })).toBe(false);
  });

  it("FORBIDDEN_CANDIDATE_FIELDS includes all sensitive fields", () => {
    expect(FORBIDDEN_CANDIDATE_FIELDS).toContain("wallet_address");
    expect(FORBIDDEN_CANDIDATE_FIELDS).toContain("normalized_wallet_address");
    expect(FORBIDDEN_CANDIDATE_FIELDS).toContain("address_label");
  });
});

describe("Candidate Discovery — query fingerprinting", () => {
  it("produces a deterministic fingerprint for the same query", async () => {
    const fp1 = await sourceQueryFingerprint({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    const fp2 = await sourceQueryFingerprint({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different queries", async () => {
    const fp1 = await sourceQueryFingerprint({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    const fp2 = await sourceQueryFingerprint({ network: "solana", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(fp1).not.toBe(fp2);
  });
});

describe("Candidate Discovery — ID generation", () => {
  it("generates candidate IDs with cand_ prefix", () => {
    const id = newCandidateId();
    expect(id.startsWith("cand_")).toBe(true);
  });

  it("generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(newCandidateId());
    expect(ids.size).toBe(100);
  });
});

describe("Candidate Discovery — constants", () => {
  it("endpoint key is pnl_leaderboard", () => {
    expect(DISCOVERY_ENDPOINT_KEY).toBe("pnl_leaderboard");
  });

  it("workflow is calibration_discovery", () => {
    expect(DISCOVERY_WORKFLOW).toBe("calibration_discovery");
  });

  it("max limit is 50", () => {
    expect(MAX_DISCOVERY_LIMIT).toBe(50);
  });

  it("min limit is 1", () => {
    expect(MIN_DISCOVERY_LIMIT).toBe(1);
  });

  it("timeframes include 1, 7, 30, 90, 180", () => {
    expect(DISCOVERY_TIMEFRAMES).toContain(1);
    expect(DISCOVERY_TIMEFRAMES).toContain(7);
    expect(DISCOVERY_TIMEFRAMES).toContain(30);
    expect(DISCOVERY_TIMEFRAMES).toContain(90);
    expect(DISCOVERY_TIMEFRAMES).toContain(180);
  });

  it("cohorts include all four", () => {
    expect(COHORTS).toContain("top_performers");
    expect(COHORTS).toContain("bottom_performers");
    expect(COHORTS).toContain("high_activity");
    expect(COHORTS).toContain("lower_activity");
  });
});
