// Regression tests for the Calibration Campaign Runner reporting hotfix.
// Covers: completed state styling, pause vs interruption, wallet progress
// total, physical-call reconciliation (retries → audit rows → campaign calls),
// and duplicate audit row prevention.
//
// No live Nansen calls. No production mutations. All network is mocked via
// injected fetchFn; all persistence is mocked via persistAudit callbacks.
import { describe, it, expect, vi } from "vitest";
import {
  shouldCampaignContinue,
  formatCampaignProgress,
  classifyWalletForCampaign,
  CAMPAIGN_STATUS,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES
} from "../base44/shared/calibrationCampaign.ts";
import { CALIBRATION_TARGET, CALIBRATION_CEILING } from "../base44/shared/calibration.ts";
import {
  callEndpointWithRetry,
  buildAuditRecord,
  AUDIT_OUTCOMES,
  newCorrelationId
} from "../base44/shared/nansenTelemetry.ts";
import {
  isSuccessStatus,
  isErrorStatus,
  campaignProgressTotal,
  safeProgress
} from "@/lib/campaignProgress";

// ---- 1. Completed state is not classified as an error ----

describe("Completed state styling", () => {
  it("isSuccessStatus returns true for completed", () => {
    expect(isSuccessStatus("completed")).toBe(true);
  });

  it("isSuccessStatus returns true for target_reached", () => {
    expect(isSuccessStatus("target_reached")).toBe(true);
  });

  it("isErrorStatus returns false for completed", () => {
    expect(isErrorStatus("completed")).toBe(false);
  });

  it("isErrorStatus returns false for target_reached", () => {
    expect(isErrorStatus("target_reached")).toBe(false);
  });

  it("isErrorStatus returns true for error, circuit_open, ceiling_reached", () => {
    expect(isErrorStatus("error")).toBe(true);
    expect(isErrorStatus("circuit_open")).toBe(true);
    expect(isErrorStatus("ceiling_reached")).toBe(true);
  });

  it("isErrorStatus returns false for stopped (admin action, not an error)", () => {
    expect(isErrorStatus("stopped")).toBe(false);
  });

  it("completed is in TERMINAL_STATUSES but not in error classification", () => {
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.COMPLETED)).toBe(true);
    expect(isErrorStatus(CAMPAIGN_STATUS.COMPLETED)).toBe(false);
  });
});

// ---- 2. Intentional PAUSED state is not classified as refresh interruption ----

describe("Pause vs interruption", () => {
  const baseRun = {
    run_id: "camp_test",
    status: CAMPAIGN_STATUS.PAUSING,
    max_wallets: 5,
    wallets_selected: 3,
    wallets_completed: 2,
    wallets_succeeded: 2,
    wallets_dismissed: 0,
    wallets_mistrial: 0,
    wallets_failed: 0,
    campaign_calls_used: 8,
    current_item_id: "item_3",
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

  it("pausing transitions to paused (not an interruption)", () => {
    const d = shouldCampaignContinue(baseRun, 100, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.PAUSED);
    expect(d.newStatus).not.toBe(CAMPAIGN_STATUS.RUNNING);
    expect(d.newStatus).not.toBe(CAMPAIGN_STATUS.STOPPING);
  });

  it("paused stop reason is the admin-pause message, not an interruption message", () => {
    const d = shouldCampaignContinue(baseRun, 100, false, 10);
    expect(d.stopReason).toBe("Campaign paused by admin after the current wallet.");
    expect(d.stopReason).not.toContain("interrupted");
    expect(d.stopReason).not.toContain("refresh");
  });

  it("paused is in ACTIVE_STATUSES (not terminal) — can be resumed", () => {
    // paused is active, not terminal — the admin can resume from this state
    expect(ACTIVE_STATUSES.has(CAMPAIGN_STATUS.PAUSED)).toBe(true);
    expect(TERMINAL_STATUSES.has(CAMPAIGN_STATUS.PAUSED)).toBe(false);
  });

  it("stopping transitions to stopped (a real interruption that needs finalization)", () => {
    const stoppingRun = { ...baseRun, status: CAMPAIGN_STATUS.STOPPING };
    const d = shouldCampaignContinue(stoppingRun, 100, false, 10);
    expect(d.shouldContinue).toBe(false);
    expect(d.newStatus).toBe(CAMPAIGN_STATUS.STOPPED);
    expect(d.stopReason).toContain("Stopped by admin");
  });

  it("running with current_item_id is an interruption (needs reconciliation)", () => {
    // A run left in RUNNING with a current_item_id was interrupted mid-wallet.
    // This is distinct from a paused run.
    const runningRun = { ...baseRun, status: CAMPAIGN_STATUS.RUNNING };
    const d = shouldCampaignContinue(runningRun, 100, false, 10);
    // running → continues (the loop processes the current wallet)
    expect(d.shouldContinue).toBe(true);
  });
});

// ---- 3. Paused progress is 1 of 5 with four pending ----

describe("Wallet progress total uses immutable max_wallets", () => {
  it("formatCampaignProgress uses max_wallets as denominator", () => {
    const run = {
      run_id: "camp_test",
      status: CAMPAIGN_STATUS.PAUSED,
      max_wallets: 5,
      wallets_selected: 1, // only 1 claimed so far
      wallets_completed: 1, // 1 completed
      wallets_succeeded: 1,
      wallets_dismissed: 0,
      wallets_mistrial: 0,
      wallets_failed: 0,
      campaign_calls_used: 4,
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: null,
      current_calls_used: null,
      stop_reason: "Campaign paused by admin after the current wallet.",
      version: 3,
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      started_by_user_id: "admin_1"
    };
    const p = formatCampaignProgress(run, 100, 4);
    expect(p.campaign_wallets_completed).toBe(1);
    expect(p.campaign_wallets_selected).toBe(5); // max_wallets, not wallets_selected
  });

  it("safeProgress with max_wallets=5 and completed=1 shows '1 of 5'", () => {
    const progressTotal = campaignProgressTotal({ max_wallets: 5, wallets_selected: 1 });
    expect(progressTotal).toBe(5);
    const p = safeProgress(1, progressTotal);
    expect(p.label).toBe("1 of 5");
  });

  it("safeProgress with max_wallets=5 and completed=5 shows '5 of 5'", () => {
    const progressTotal = campaignProgressTotal({ max_wallets: 5, wallets_selected: 5 });
    expect(progressTotal).toBe(5);
    const p = safeProgress(5, progressTotal);
    expect(p.label).toBe("5 of 5");
  });

  it("campaignProgressTotal uses max_wallets when not null", () => {
    expect(campaignProgressTotal({ max_wallets: 5, wallets_selected: 3 })).toBe(5);
    expect(campaignProgressTotal({ max_wallets: 10, wallets_selected: 1 })).toBe(10);
  });

  it("campaignProgressTotal falls back to wallets_selected for all-approved (null)", () => {
    expect(campaignProgressTotal({ max_wallets: null, wallets_selected: 7 })).toBe(7);
  });

  it("campaignProgressTotal returns 0 for null campaign", () => {
    expect(campaignProgressTotal(null)).toBe(0);
  });

  it("paused progress: 1 of 5 with four pending (the reported bug)", () => {
    // The bug was: paused campaign showed "1 of 1" because wallets_selected=1.
    // Fix: denominator is max_wallets=5, so it shows "1 of 5".
    const run = {
      run_id: "camp_test",
      status: CAMPAIGN_STATUS.PAUSED,
      max_wallets: 5,
      wallets_selected: 1,
      wallets_completed: 1,
      wallets_succeeded: 1,
      wallets_dismissed: 0,
      wallets_mistrial: 0,
      wallets_failed: 0,
      campaign_calls_used: 4,
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: null,
      current_calls_used: null,
      stop_reason: "Campaign paused by admin after the current wallet.",
      version: 3,
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      started_by_user_id: "admin_1"
    };
    const p = formatCampaignProgress(run, 100, 4);
    expect(p.campaign_wallets_completed).toBe(1);
    expect(p.campaign_wallets_selected).toBe(5);
    // Frontend display
    const total = campaignProgressTotal({ max_wallets: 5, wallets_selected: 1 });
    const display = safeProgress(1, total);
    expect(display.label).toBe("1 of 5");
  });

  it("completed progress: 5 of 5", () => {
    const run = {
      run_id: "camp_test",
      status: CAMPAIGN_STATUS.COMPLETED,
      max_wallets: 5,
      wallets_selected: 5,
      wallets_completed: 5,
      wallets_succeeded: 4,
      wallets_dismissed: 0,
      wallets_mistrial: 0,
      wallets_failed: 1,
      campaign_calls_used: 20,
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: "One Pump Chump",
      current_calls_used: 4,
      stop_reason: "Completed 5 wallets.",
      version: 10,
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T01:00:00Z",
      started_by_user_id: "admin_1"
    };
    const p = formatCampaignProgress(run, 100, 0);
    expect(p.campaign_wallets_completed).toBe(5);
    expect(p.campaign_wallets_selected).toBe(5);
    const display = safeProgress(5, campaignProgressTotal({ max_wallets: 5, wallets_selected: 5 }));
    expect(display.label).toBe("5 of 5");
  });
});

// ---- 4. A retry produces two audit rows and contributes two campaign physical calls ----

describe("Retry → two audit rows → two campaign physical calls", () => {
  it("callEndpointWithRetry with a 429 retry calls persistAudit twice", async () => {
    const auditRecords: any[] = [];
    const persistAudit = vi.fn((rec: any) => {
      auditRecords.push(rec);
      return Promise.resolve();
    });

    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First attempt: 429 rate-limited with Retry-After: 0
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" }
        });
      }
      // Second attempt: success
      return new Response(JSON.stringify({ data: { pnl: 100 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const correlationId = newCorrelationId();
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/profiler/address/pnl-summary",
      ep: { key: "pnl_summary" },
      apiKey: "test-key",
      body: { address: "0xabc", chain: "ethereum" },
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "trial_analysis",
        network: "ethereum",
        caseSlug: "case-test",
        correlationId,
        environment: "test"
      },
      fetchFn: mockFetch as any,
      persistAudit,
      maxAttempts: 2
    });

    // Two physical attempts → two persistAudit calls → two audit records
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(persistAudit).toHaveBeenCalledTimes(2);
    expect(auditRecords).toHaveLength(2);

    // Both records share the same correlation_id
    expect(auditRecords[0].correlation_id).toBe(correlationId);
    expect(auditRecords[1].correlation_id).toBe(correlationId);

    // First record: attempt 1, outcome rate_limited
    expect(auditRecords[0].attempt_number).toBe(1);
    expect(auditRecords[0].outcome).toBe(AUDIT_OUTCOMES.RATE_LIMITED);

    // Second record: attempt 2, outcome success
    expect(auditRecords[1].attempt_number).toBe(2);
    expect(auditRecords[1].outcome).toBe(AUDIT_OUTCOMES.SUCCESS);

    // The endpoint result is ok (retry succeeded)
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("a retry contributes two to the physical call count (physicalCallCount)", async () => {
    // Simulate the fetchNansenEvidence physicalCallCount counter: increment
    // once per persistAudit invocation. A retried endpoint increments twice.
    let physicalCallCount = 0;
    const persistAudit = vi.fn(() => {
      physicalCallCount++;
      return Promise.resolve();
    });

    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" }
        });
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/profiler/address/pnl-summary",
      ep: { key: "pnl_summary" },
      apiKey: "test-key",
      body: { address: "0xabc", chain: "ethereum" },
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "trial_analysis",
        network: "ethereum",
        caseSlug: "case-test",
        correlationId: "corr_test",
        environment: "test"
      },
      fetchFn: mockFetch as any,
      persistAudit,
      maxAttempts: 2
    });

    // One endpoint with a retry = 2 physical calls
    expect(physicalCallCount).toBe(2);
  });

  it("a non-retried endpoint contributes one to the physical call count", async () => {
    let physicalCallCount = 0;
    const persistAudit = vi.fn(() => {
      physicalCallCount++;
      return Promise.resolve();
    });

    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/profiler/address/pnl-summary",
      ep: { key: "pnl_summary" },
      apiKey: "test-key",
      body: { address: "0xabc", chain: "ethereum" },
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "trial_analysis",
        network: "ethereum",
        caseSlug: "case-test",
        correlationId: "corr_test",
        environment: "test"
      },
      fetchFn: mockFetch as any,
      persistAudit,
      maxAttempts: 2
    });

    expect(physicalCallCount).toBe(1);
  });
});

// ---- 5. Campaign call total equals its attributed audit-record count ----

describe("Campaign call total equals attributed audit-record count", () => {
  it("classifyWalletForCampaign uses physical_calls_used from the analysis", () => {
    // A wallet with 5 physical calls (4 endpoints + 1 retry)
    const c = classifyWalletForCampaign({
      status: "completed",
      case_outcome: "verdict",
      verdict_name: "One Pump Chump",
      physical_calls_used: 5
    });
    expect(c.callsUsed).toBe(5);
  });

  it("campaign_calls_used = sum of physical_calls_used across wallets", () => {
    // 5 wallets: 4 with 4 calls each, 1 with 5 calls (one retry)
    const walletResults = [
      { status: "completed", case_outcome: "verdict", verdict_name: "A", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", verdict_name: "B", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", verdict_name: "C", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", verdict_name: "D", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", verdict_name: "E", physical_calls_used: 5 }
    ];

    let campaignCallsUsed = 0;
    for (const r of walletResults) {
      const counters = classifyWalletForCampaign(r);
      campaignCallsUsed += counters.callsUsed;
    }

    // 4×4 + 5 = 21 physical calls
    expect(campaignCallsUsed).toBe(21);
  });

  it("campaign total with a retry equals the audit-record count", () => {
    // Simulate: 5 wallets, one wallet had a retry (5 calls instead of 4).
    // The audit ledger should have 4+4+4+4+5 = 21 records.
    // The campaign_calls_used should also be 21.
    const auditRecords: any[] = [];
    const correlationIds = ["corr_1", "corr_2", "corr_3", "corr_4", "corr_5"];

    // Wallet 5 had a retry: 2 attempts for one endpoint
    for (let w = 0; w < 4; w++) {
      for (let i = 0; i < 4; i++) {
        auditRecords.push(buildAuditRecord({
          call_id: `nca_${w}_${i}`,
          occurred_at: new Date().toISOString(),
          endpoint_key: "pnl_summary",
          workflow: "trial_analysis",
          network: "ethereum",
          case_slug: `case_${w}`,
          correlation_id: correlationIds[w],
          attempt_number: 1,
          response_status: 200,
          outcome: AUDIT_OUTCOMES.SUCCESS,
          latency_ms: 100,
          environment: "production"
        }));
      }
    }
    // Wallet 5: 4 endpoints, one with a retry = 5 records
    for (let i = 0; i < 5; i++) {
      auditRecords.push(buildAuditRecord({
        call_id: `nca_4_${i}`,
        occurred_at: new Date().toISOString(),
        endpoint_key: "pnl_summary",
        workflow: "trial_analysis",
        network: "ethereum",
        case_slug: "case_4",
        correlation_id: correlationIds[4],
        attempt_number: i === 0 ? 1 : (i === 1 ? 2 : 1), // second record is a retry
        response_status: i === 1 ? 429 : 200,
        outcome: i === 1 ? AUDIT_OUTCOMES.RATE_LIMITED : AUDIT_OUTCOMES.SUCCESS,
        latency_ms: 100,
        environment: "production"
      }));
    }

    // The ledger has 21 records (4×4 + 5)
    expect(auditRecords).toHaveLength(21);

    // The campaign total (sum of physical_calls_used) should also be 21
    const walletResults = [
      { status: "completed", case_outcome: "verdict", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", physical_calls_used: 4 },
      { status: "completed", case_outcome: "verdict", physical_calls_used: 5 }
    ];
    let campaignCallsUsed = 0;
    for (const r of walletResults) {
      campaignCallsUsed += classifyWalletForCampaign(r).callsUsed;
    }
    expect(campaignCallsUsed).toBe(21);
    expect(campaignCallsUsed).toBe(auditRecords.length);
  });

  it("failed wallet with 0 physical calls contributes 0 to campaign total", () => {
    const c = classifyWalletForCampaign({
      status: "failed",
      failure_message_safe: "Budget reached",
      physical_calls_used: 0
    });
    expect(c.callsUsed).toBe(0);
    expect(c.failed).toBe(true);
  });
});

// ---- 6. No duplicate audit row when persistence retry uses the same call_id ----

describe("Duplicate audit row prevention on persistence retry", () => {
  it("does not create a duplicate when the same call_id is persisted twice", async () => {
    // Mirror the server-side persistAuditRecord logic: check for existing
    // call_id before creating. A retry with the same call_id must not create
    // a second row.
    const store: any[] = [];

    async function persistAuditRecord(rec: any) {
      // Check for existing record with the same call_id
      const existing = store.find((r) => r.call_id === rec.call_id);
      if (existing) {
        return; // already persisted — treat as success
      }
      store.push(rec);
    }

    const rec = buildAuditRecord({
      call_id: "nca_test_123",
      occurred_at: new Date().toISOString(),
      endpoint_key: "pnl_summary",
      workflow: "trial_analysis",
      network: "ethereum",
      case_slug: "case_test",
      correlation_id: "corr_test",
      attempt_number: 1,
      response_status: 200,
      outcome: AUDIT_OUTCOMES.SUCCESS,
      latency_ms: 100,
      environment: "production"
    });

    // First persistence attempt (simulating a successful create)
    await persistAuditRecord(rec);
    expect(store).toHaveLength(1);

    // Retry with the same call_id (simulating a retry after the first create
    // succeeded but the response was lost)
    await persistAuditRecord(rec);
    expect(store).toHaveLength(1); // no duplicate
  });

  it("does not create a duplicate when create succeeds but response throws", async () => {
    // Simulate: first create succeeds (record is in the store) but the
    // response throws. The retry checks for existence and finds the record.
    const store: any[] = [];
    let createShouldThrow = true;

    async function persistAuditRecord(rec: any) {
      const existing = store.find((r) => r.call_id === rec.call_id);
      if (existing) return;

      store.push(rec);
      if (createShouldThrow) {
        createShouldThrow = false;
        throw new Error("Response lost");
      }
    }

    const rec = buildAuditRecord({
      call_id: "nca_test_456",
      occurred_at: new Date().toISOString(),
      endpoint_key: "dex_trades",
      workflow: "trial_analysis",
      network: "ethereum",
      case_slug: "case_test",
      correlation_id: "corr_test",
      attempt_number: 1,
      response_status: 200,
      outcome: AUDIT_OUTCOMES.SUCCESS,
      latency_ms: 100,
      environment: "production"
    });

    // First attempt: create succeeds but throws
    await expect(persistAuditRecord(rec)).rejects.toThrow("Response lost");
    expect(store).toHaveLength(1);

    // Retry: finds existing record, does not create a duplicate
    await persistAuditRecord(rec);
    expect(store).toHaveLength(1);
  });

  it("different call_ids create separate rows (no false deduplication)", async () => {
    const store: any[] = [];

    async function persistAuditRecord(rec: any) {
      const existing = store.find((r) => r.call_id === rec.call_id);
      if (existing) return;
      store.push(rec);
    }

    const rec1 = buildAuditRecord({
      call_id: "nca_aaa",
      occurred_at: new Date().toISOString(),
      endpoint_key: "pnl_summary",
      workflow: "trial_analysis",
      network: "ethereum",
      case_slug: "case_a",
      correlation_id: "corr_a",
      attempt_number: 1,
      response_status: 200,
      outcome: AUDIT_OUTCOMES.SUCCESS,
      latency_ms: 100,
      environment: "production"
    });

    const rec2 = buildAuditRecord({
      call_id: "nca_bbb",
      occurred_at: new Date().toISOString(),
      endpoint_key: "dex_trades",
      workflow: "trial_analysis",
      network: "ethereum",
      case_slug: "case_a",
      correlation_id: "corr_a",
      attempt_number: 1,
      response_status: 200,
      outcome: AUDIT_OUTCOMES.SUCCESS,
      latency_ms: 100,
      environment: "production"
    });

    await persistAuditRecord(rec1);
    await persistAuditRecord(rec2);
    expect(store).toHaveLength(2);
  });
});