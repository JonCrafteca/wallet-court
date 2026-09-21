import { describe, it, expect } from "vitest";
import {
  buildApprovalPreview,
  formatRecentDiscovery,
  MAX_BULK_APPROVE,
  sourceQueryFingerprint,
  validateDiscoveryRequest,
  DEFAULT_TIMEFRAME,
  DEFAULT_DISCOVERY_LIMIT,
  COHORTS
} from "../base44/shared/candidateDiscovery.ts";

// ---- Bulk approval preview ----

describe("buildApprovalPreview", () => {
  const makeCandidate = (id: string, fp: string, status: string = "discovered", network: string = "ethereum", address: string = "0x1234567890abcdef1234567890abcdef12345678") => ({
    candidate_id: id,
    wallet_fingerprint: fp,
    review_status: status,
    network,
    wallet_address: address
  });

  it("counts all eligible candidates as new unique", () => {
    const candidates = [
      makeCandidate("c1", "fp1"),
      makeCandidate("c2", "fp2"),
      makeCandidate("c3", "fp3")
    ];
    const preview = buildApprovalPreview(candidates, new Set(), new Set());
    expect(preview.selected_count).toBe(3);
    expect(preview.new_unique).toBe(3);
    expect(preview.already_queued).toBe(0);
    expect(preview.already_tried).toBe(0);
    expect(preview.existing_candidate).toBe(0);
    expect(preview.invalid_or_excluded).toBe(0);
    expect(preview.estimated_analysis_calls).toBe(12); // 3 * 4
    expect(preview.eligible_candidate_ids).toEqual(["c1", "c2", "c3"]);
  });

  it("skips already-queued candidates", () => {
    const candidates = [
      makeCandidate("c1", "fp1"),
      makeCandidate("c2", "fp2", "queued"),
      makeCandidate("c3", "fp3")
    ];
    const preview = buildApprovalPreview(candidates, new Set(), new Set());
    expect(preview.new_unique).toBe(2);
    expect(preview.existing_candidate).toBe(1);
    expect(preview.eligible_candidate_ids).toEqual(["c1", "c3"]);
  });

  it("detects already-queued by fingerprint", () => {
    const candidates = [
      makeCandidate("c1", "fp1"),
      makeCandidate("c2", "fp2")
    ];
    const existingDocket = new Set(["fp2"]);
    const preview = buildApprovalPreview(candidates, existingDocket, new Set());
    expect(preview.new_unique).toBe(1);
    expect(preview.already_queued).toBe(1);
    expect(preview.eligible_candidate_ids).toEqual(["c1"]);
  });

  it("detects already-tried by fingerprint", () => {
    const candidates = [
      makeCandidate("c1", "fp1"),
      makeCandidate("c2", "fp2")
    ];
    const existingTrials = new Set(["fp1"]);
    const preview = buildApprovalPreview(candidates, new Set(), existingTrials);
    expect(preview.new_unique).toBe(1);
    expect(preview.already_tried).toBe(1);
    expect(preview.eligible_candidate_ids).toEqual(["c2"]);
  });

  it("detects duplicates within the batch", () => {
    const candidates = [
      makeCandidate("c1", "fp1"),
      makeCandidate("c2", "fp1"), // same fingerprint
    ];
    const preview = buildApprovalPreview(candidates, new Set(), new Set());
    expect(preview.new_unique).toBe(1);
    expect(preview.invalid_or_excluded).toBe(1);
  });

  it("handles cross-deduplication: candidate, docket, and trial", () => {
    const candidates = [
      makeCandidate("c1", "fp_new"),
      makeCandidate("c2", "fp_docket"),
      makeCandidate("c3", "fp_trial"),
      makeCandidate("c4", "fp_candidate", "queued"),
    ];
    const existingDocket = new Set(["fp_docket"]);
    const existingTrials = new Set(["fp_trial"]);
    const preview = buildApprovalPreview(candidates, existingDocket, existingTrials);
    expect(preview.new_unique).toBe(1);
    expect(preview.already_queued).toBe(1);
    expect(preview.already_tried).toBe(1);
    expect(preview.existing_candidate).toBe(1);
  });

  it("MAX_BULK_APPROVE is 50", () => {
    expect(MAX_BULK_APPROVE).toBe(50);
  });

  it("handles 50 eligible candidates", () => {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      makeCandidate(`c${i}`, `fp${i}`)
    );
    const preview = buildApprovalPreview(candidates, new Set(), new Set());
    expect(preview.new_unique).toBe(50);
    expect(preview.estimated_analysis_calls).toBe(200);
  });

  it("handles empty selection", () => {
    const preview = buildApprovalPreview([], new Set(), new Set());
    expect(preview.selected_count).toBe(0);
    expect(preview.new_unique).toBe(0);
    expect(preview.estimated_analysis_calls).toBe(0);
  });
});

// ---- Discovery fingerprint stability ----

describe("sourceQueryFingerprint stability", () => {
  it("produces the same fingerprint for identical queries", async () => {
    const req = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const fp1 = await sourceQueryFingerprint(req);
    const fp2 = await sourceQueryFingerprint(req);
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different networks", async () => {
    const req1 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const req2 = { network: "solana", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const fp1 = await sourceQueryFingerprint(req1);
    const fp2 = await sourceQueryFingerprint(req2);
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints for different cohorts", async () => {
    const req1 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const req2 = { network: "ethereum", cohort: "bottom_performers" as any, timeframe: 30, limit: 20 };
    const fp1 = await sourceQueryFingerprint(req1);
    const fp2 = await sourceQueryFingerprint(req2);
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints for different timeframes", async () => {
    const req1 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const req2 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 90, limit: 20 };
    const fp1 = await sourceQueryFingerprint(req1);
    const fp2 = await sourceQueryFingerprint(req2);
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints for different limits", async () => {
    const req1 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 };
    const req2 = { network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 50 };
    const fp1 = await sourceQueryFingerprint(req1);
    const fp2 = await sourceQueryFingerprint(req2);
    expect(fp1).not.toBe(fp2);
  });

  it("produces a SHA-256 hex string", async () => {
    const fp = await sourceQueryFingerprint({ network: "ethereum", cohort: "top_performers" as any, timeframe: 30, limit: 20 });
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---- Recent discovery formatting ----

describe("formatRecentDiscovery", () => {
  it("returns found=false when no previous discovery", () => {
    const info = formatRecentDiscovery(null, "fp_test", 0, 0);
    expect(info.found).toBe(false);
    expect(info.discovered_at).toBeNull();
    expect(info.candidates_found).toBeNull();
  });

  it("returns found=true with discovery details", () => {
    const discovery = {
      discovered_at: "2026-01-01T00:00:00Z",
      candidates_found: 15,
      query_fingerprint: "fp_test",
      network: "ethereum",
      cohort: "top_performers",
      timeframe_days: 30,
      result_limit: 20
    };
    const info = formatRecentDiscovery(discovery, "fp_test", 10, 5);
    expect(info.found).toBe(true);
    expect(info.discovered_at).toBe("2026-01-01T00:00:00Z");
    expect(info.candidates_found).toBe(15);
    expect(info.remaining_eligible).toBe(10);
    expect(info.already_queued_or_tried).toBe(5);
  });
});

// ---- Discovery request validation ----

describe("Discovery request validation", () => {
  it("accepts valid requests", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(true);
    expect(r.value?.network).toBe("ethereum");
  });

  it("rejects invalid network", () => {
    const r = validateDiscoveryRequest({ network: "bitcoin", cohort: "top_performers", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid cohort", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "invalid_cohort", timeframe: 30, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid timeframe", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 45, limit: 20 });
    expect(r.ok).toBe(false);
  });

  it("rejects limit > 50", () => {
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: 30, limit: 51 });
    expect(r.ok).toBe(false);
  });

  it("accepts default timeframe and limit values", () => {
    // Defaults are applied by the caller (discoverCalibrationCandidates), not
    // by validateDiscoveryRequest itself. The function validates whatever it
    // receives.
    const r = validateDiscoveryRequest({ network: "ethereum", cohort: "top_performers", timeframe: DEFAULT_TIMEFRAME, limit: DEFAULT_DISCOVERY_LIMIT });
    expect(r.ok).toBe(true);
    expect(r.value?.timeframe).toBe(DEFAULT_TIMEFRAME);
    expect(r.value?.limit).toBe(DEFAULT_DISCOVERY_LIMIT);
  });

  it("all cohorts are valid", () => {
    for (const c of COHORTS) {
      const r = validateDiscoveryRequest({ network: "ethereum", cohort: c, timeframe: 30, limit: 20 });
      expect(r.ok).toBe(true);
    }
  });
});