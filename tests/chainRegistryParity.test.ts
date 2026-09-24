// Parity test: enforces that the backend (base44/shared/chains.ts) and
// frontend (src/lib/chains.js) chain registries stay synchronized. The two
// cannot safely cross-import due to different build runtimes, so this test
// is the guard against drift. If a chain is added or renamed in one registry
// but not the other, this test fails.

import { describe, it, expect } from "vitest";
import {
  NETWORKS as BACKEND_NETWORKS,
  CHAINS as BACKEND_CHAINS,
  CHAIN_BY_NETWORK as BACKEND_CHAIN_BY_NETWORK,
  SUPPORTED_CLAIM_NETWORKS as BACKEND_CLAIM_NETWORKS,
  isEvmNetwork as backendIsEvm,
  coverageStartFor as backendCoverageStart,
} from "../base44/shared/chains.ts";
import {
  NETWORKS as FRONTEND_NETWORKS,
  CHAINS as FRONTEND_CHAINS,
  NETWORK_OPTIONS,
  isEvmNetwork as frontendIsEvm,
} from "../src/lib/chains.js";

describe("Chain registry parity", () => {
  it("frontend and backend expose the same network keys in the same order", () => {
    expect(FRONTEND_NETWORKS).toEqual(BACKEND_NETWORKS);
  });

  it("each chain shares the same key, label, family, chainId, and coverageStart", () => {
    const beMap = new Map(BACKEND_CHAINS.map((c) => [c.key, c]));
    expect(FRONTEND_CHAINS.length).toBe(BACKEND_CHAINS.length);
    for (const fe of FRONTEND_CHAINS) {
      const be = beMap.get(fe.key);
      expect(be, `chain "${fe.key}" must exist in the backend registry`).toBeDefined();
      expect(fe.label).toBe(be.label);
      expect(fe.family).toBe(be.family);
      expect(fe.chainId).toBe(be.chainId);
      expect(fe.coverageStart).toBe(be.coverageStart);
    }
  });

  it("NETWORK_OPTIONS matches the registry order and labels", () => {
    expect(NETWORK_OPTIONS.map((o) => o.id)).toEqual(BACKEND_NETWORKS);
    expect(NETWORK_OPTIONS.map((o) => o.label)).toEqual(BACKEND_CHAINS.map((c) => c.label));
  });

  it("isEvmNetwork agrees between registries for every chain", () => {
    for (const key of BACKEND_NETWORKS) {
      expect(frontendIsEvm(key)).toBe(backendIsEvm(key));
    }
  });

  it("includes robinhood with the correct canonical identifiers", () => {
    expect(BACKEND_NETWORKS).toContain("robinhood");
    expect(FRONTEND_NETWORKS).toContain("robinhood");
    expect(BACKEND_CHAIN_BY_NETWORK.robinhood).toBe("robinhood");
    expect(BACKEND_CLAIM_NETWORKS).toContain("robinhood");
  });

  it("robinhood has a coverage-start clamp", () => {
    const cs = backendCoverageStart("robinhood");
    expect(cs, "robinhood must define a coverageStart date").not.toBeNull();
    expect(cs.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("existing chains have no coverage-start clamp (null)", () => {
    expect(backendCoverageStart("ethereum")).toBeNull();
    expect(backendCoverageStart("base")).toBeNull();
    expect(backendCoverageStart("solana")).toBeNull();
  });

  it("preserves the original three chains in their original order", () => {
    expect(BACKEND_NETWORKS.slice(0, 3)).toEqual(["ethereum", "base", "solana"]);
  });
});