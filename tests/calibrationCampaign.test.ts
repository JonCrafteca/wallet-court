import { describe, it, expect } from "vitest";
import {
  validateCampaignSize,
  canTransitionTo,
  shouldCampaignContinue,
  formatCampaignProgress,
  sanitizeCampaignRun,
  containsForbiddenCampaignData,
  classifyWalletForCampaign,
  newCampaignId,
  newDiscoveryId,
  CAMPAIGN_STATUS,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  CAMPAIGN_SIZES,
  AVG_CALLS_PER_WALLET
} from "../base44/shared/calibrationCampaign.ts";
import { CALIBRATION_TARGET, CALIBRATION_CEILING } from "../base44/shared/calibration.ts";

// ---- Campaign size validation ----

describe("Campaign size validation", () => {
  it("accepts 5, 10, 25, 50", () => {
    for (const n of CAMPAIGN_SIZES) {
      const r = validateCampaignSize(n);
      expect(r.ok).toBe(true);
      expect(r.value).toBe(n);
    }
  });

  it("accepts null (all approved)", () => {
    const r = validateCampaignSize(null);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(null);
  });

  it("accepts 'all' string", () => {
    const r = validateCampaignSize("all");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(null);
  });

  it("rejects invalid sizes", () => {
    expect(validateCampaignSize(3).ok).toBe(false);
    expect(validateCampaignSize(100).ok).toBe(false);
    expect(validateCampaignSize("abc").ok).toBe(false);
    expect(validateCampaignSize(undefined).ok).toBe(true); // undefined → null (all)
  });
});

// ---- Status transitions ----

describe("Campaign status transitions", () => {
  it("ready → running is allowed", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.READY, CAMPAIGN_STATUS.RUNNING)).toBe(true);
  });

  it("running → pausing is allowed", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.PAUSING)).toBe(true);
  });

  it("pausing → paused is allowed", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.PAUSING, CAMPAIGN_STATUS.PAUSED)).toBe(true);
  });

  it("paused → running (resume) is allowed", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.PAUSED, CAMPAIGN_STATUS.RUNNING)).toBe(true);
  });

  it("terminal statuses cannot transition (except to error)", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.RUNNING)).toBe(false);
    expect(canTransitionTo(CAMPAIGN_STATUS.STOPPED, CAMPAIGN_STATUS.RUNNING)).toBe(false);
    expect(canTransitionTo(CAMPAIGN_STATUS.TARGET_REACHED, CAMPAIGN_STATUS.RUNNING)).toBe(false);
  });

  it("running → completed/stopped/target_reached/ceiling_reached/circuit_open are allowed", () => {
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.COMPLETED)).toBe(true);
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.STOPPED)).toBe(true);
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.TARGET_REACHED)).toBe(true);
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CEILING_REACHED)).toBe(true);
    expect(canTransitionTo(CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CIRCUIT_OPEN)).toBe(true);
  });
});

// ---- Should campaign continue ----

describe("shouldCampaignContinue", () => {
  const baseRun = {
    run_id: "camp_test",
    status: CAMPAIGN_STATUS.RUNNING,
    max_wallets: 10,
    wallets_selected: 5,
    wallets_completed: 3,
    wallets_succeeded: 2,
    wallets_dismissed: 0,
    wallets_mistrial: 0,
    wallets_failed: 1,
    campaign_calls_used: 12,
    current_item_id: "item_4",
    current_address_short: "0x1234…abcd",
    current_network: "ethereum",
    current_result: null,
    current_calls_used: null,
    stop_reason: null,
    version: 5,
    started_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    started_by_user_id: "admin_1"
  };

  it("continues when budget allows, circuit closed, items pending, max not reached", () => {
    const d = shouldCampaignContinue(baseRun, 100, false, 10);
    expect(d.shouldContinue).toBe(true);
  });

  it("stops when target reached", () => {
    const d = shouldCampaignContinue(baseRun, CALIBRATION_TARGET, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.TARGET_REACHED);
  });

  it("stops when ceiling reached", () => {
    const d = shouldCampaignContinue(baseRun, CALIBRATION_CEILING, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.CEILING_REACHED);
  });

  it("stops when circuit is open", () => {
    const d = shouldCampaignContinue(baseRun, 100, true, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.CIRCUIT_OPEN);
  });

  it("stops when max_wallets reached", () => {
    const run = { ...baseRun, wallets_completed: 10, max_wallets: 10 };
    const d = shouldCampaignContinue(run, 100, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.COMPLETED);
  });

  it("stops when no pending items", () => {
    const d = shouldCampaignContinue(baseRun, 100, false, 0);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.COMPLETED);
  });

  it("stops when pausing (admin requested pause)", () => {
    const run = { ...baseRun, status: CAMPAIGN_STATUS.PAUSING };
    const d = shouldCampaignContinue(run, 100, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.PAUSED);
  });

  it("stops when already stopped", () => {
    const run = { ...baseRun, status: CAMPAIGN_STATUS.STOPPED };
    const d = shouldCampaignContinue(run, 100, false, 10);
    expect(d.shouldContinue).toBe(false);
  });

  it("continues when max_wallets is null (all) and items pending", () => {
    const run = { ...baseRun, max_wallets: null, wallets_completed: 50 };
    const d = shouldCampaignContinue(run, 100, false, 10);
    expect(d.shouldContinue).toBe(true);
  });

  it("fewer queued wallets than selected campaign size: completes when queue empties", () => {
    const run = { ...baseRun, max_wallets: 50, wallets_completed: 3 };
    const d = shouldCampaignContinue(run, 100, false, 0);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.COMPLETED);
  });
});

// ---- Progress formatting (never impossible states) ----

describe("formatCampaignProgress — never shows impossible states", () => {
  const baseRun = {
    run_id: "camp_test",
    status: CAMPAIGN_STATUS.RUNNING,
    max_wallets: 10,
    wallets_selected: 5,
    wallets_completed: 3,
    wallets_succeeded: 2,
    wallets_dismissed: 0,
    wallets_mistrial: 0,
    wallets_failed: 1,
    campaign_calls_used: 12,
    current_item_id: "item_4",
    current_address_short: "0x1234…abcd",
    current_network: "ethereum",
    current_result: null,
    current_calls_used: null,
    stop_reason: null,
    version: 5,
    started_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    started_by_user_id: "admin_1"
  };

  it("never shows completed > selected", () => {
    const run = { ...baseRun, wallets_completed: 15, wallets_selected: 10 };
    const p = formatCampaignProgress(run, 100, 5);
    expect(p.campaign_wallets_completed).toBeLessThanOrEqual(p.campaign_wallets_selected);
  });

  it("never shows negative remaining", () => {
    const p = formatCampaignProgress(baseRun, 1100, 5);
    expect(p.remaining_to_target).toBeGreaterThanOrEqual(0);
  });

  it("computes estimated calls remaining correctly for max_wallets", () => {
    const run = { ...baseRun, max_wallets: 10, wallets_completed: 3 };
    const p = formatCampaignProgress(run, 100, 50);
    expect(p.estimated_calls_remaining).toBe((10 - 3) * AVG_CALLS_PER_WALLET);
  });

  it("computes estimated calls remaining for all-approved (null max)", () => {
    const run = { ...baseRun, max_wallets: null, wallets_completed: 3 };
    const p = formatCampaignProgress(run, 100, 7);
    expect(p.estimated_calls_remaining).toBe(7 * AVG_CALLS_PER_WALLET);
  });

  it("zero-wallet queue: completed=0, selected=0", () => {
    const run = { ...baseRun, wallets_selected: 0, wallets_completed: 0, max_wallets: 5 };
    const p = formatCampaignProgress(run, 100, 0);
    expect(p.campaign_wallets_completed).toBe(0);
    expect(p.campaign_wallets_selected).toBe(0);
  });

  it("shows correct status and stop_reason", () => {
    const run = { ...baseRun, status: CAMPAIGN_STATUS.STOPPED, stop_reason: "Stopped by admin." };
    const p = formatCampaignProgress(run, 100, 5);
    expect(p.status).toBe(CAMPAIGN_STATUS.STOPPED);
    expect(p.stop_reason).toBe("Stopped by admin.");
  });
});

// ---- Wallet result classification ----

describe("classifyWalletForCampaign", () => {
  it("classifies a successful verdict", () => {
    const c = classifyWalletForCampaign({ status: "completed", case_outcome: "verdict", verdict_name: "One Pump Chump", physical_calls_used: 4 });
    expect(c.succeeded).toBe(true);
    expect(c.failed).toBe(false);
    expect(c.callsUsed).toBe(4);
    expect(c.resultLabel).toBe("One Pump Chump");
  });

  it("classifies a dismissal", () => {
    const c = classifyWalletForCampaign({ status: "completed", case_outcome: "dismissed_no_evidence", physical_calls_used: 4 });
    expect(c.dismissed).toBe(true);
    expect(c.succeeded).toBe(false);
    expect(c.resultLabel).toBe("Dismissed");
  });

  it("classifies a mistrial", () => {
    const c = classifyWalletForCampaign({ status: "completed", case_outcome: "mistrial_insufficient_evidence", physical_calls_used: 4 });
    expect(c.mistrial).toBe(true);
    expect(c.resultLabel).toBe("Mistrial");
  });

  it("classifies a failure", () => {
    const c = classifyWalletForCampaign({ status: "failed", failure_message_safe: "Provider error", physical_calls_used: 0 });
    expect(c.failed).toBe(true);
    expect(c.resultLabel).toBe("Provider error");
  });

  it("classifies a stopped item", () => {
    const c = classifyWalletForCampaign({ status: "stopped", failure_message_safe: "Budget reached", physical_calls_used: 0 });
    expect(c.failed).toBe(true);
  });
});

// ---- Sanitization ----

describe("Campaign sanitization", () => {
  it("strips started_by_user_id", () => {
    const sanitized = sanitizeCampaignRun({
      run_id: "camp_test",
      status: "running",
      started_by_user_id: "admin_123",
      version: 0,
      started_at: "2026-01-01T00:00:00Z"
    });
    expect(sanitized.run_id).toBe("camp_test");
    expect(sanitized.started_by_user_id).toBeUndefined();
    expect(containsForbiddenCampaignData(sanitized)).toBe(false);
  });

  it("containsForbiddenCampaignData detects wallet_address", () => {
    expect(containsForbiddenCampaignData({ wallet_address: "0x123..." })).toBe(true);
  });

  it("containsForbiddenCampaignData detects started_by_user_id", () => {
    expect(containsForbiddenCampaignData({ started_by_user_id: "admin_1" })).toBe(true);
  });

  it("containsForbiddenCampaignData returns false for clean objects", () => {
    expect(containsForbiddenCampaignData({ run_id: "camp_test", status: "running" })).toBe(false);
  });
});

// ---- ID generation ----

describe("Campaign and discovery ID generation", () => {
  it("generates camp_ prefixed IDs", () => {
    const id = newCampaignId();
    expect(id).toMatch(/^camp_/);
  });

  it("generates disc_ prefixed IDs", () => {
    const id = newDiscoveryId();
    expect(id).toMatch(/^disc_/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newCampaignId());
    expect(ids.size).toBe(100);
  });
});

// ---- TERMINAL and ACTIVE status sets ----

describe("Status sets", () => {
  it("TERMINAL_STATUSES contains all terminal statuses", () => {
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.COMPLETED)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.STOPPED)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.TARGET_REACHED)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.CEILING_REACHED)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.CIRCUIT_OPEN)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.ERROR)).toBe(true);
  });

  it("ACTIVE_STATUSES contains running, pausing, paused", () => {
    expect(ACTIVE_STATUSES.has(CAMPAIGN_STATUS.RUNNING)).toBe(true);
    expect(ACTIVE_STATUSES.has(CAMPAIGN_STATUS.PAUSING)).toBe(true);
    expect(ACTIVE_STATUSES.has(CAMPAIGN_STATUS.PAUSED)).toBe(true);
  });

  it("ready is NOT active or terminal", () => {
    expect(ACTIVE_STATUSES.has(CAMPAIGN_STATUS.READY)).toBe(false);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.READY)).toBe(false);
  });
});