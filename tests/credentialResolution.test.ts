import { describe, it, expect, vi } from "vitest";
import {
  callEndpointWithRetry,
  newCorrelationId
} from "../base44/shared/nansenTelemetry.ts";

// Credential-resolution + transport tests for Candidate Discovery.
// Verifies the shared telemetry transport produces the correct audit-record
// counts when the resolved key is used — one record per physical attempt,
// two for a 429 retry, sharing one correlation_id. No live Nansen calls.

function mockResponse(status: number, body: any, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("Candidate Discovery — credential resolution & transport", () => {
  it("one successful discovery request creates exactly one audit record", async () => {
    const auditRecords: any[] = [];
    const fetchFn = vi.fn().mockResolvedValue(
      mockResponse(200, { data: [{ address: "0x1234", total_pnl_usd: 1000 }] })
    );
    const correlationId = newCorrelationId();

    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/smart-money/pnl-leaderboard",
      ep: { key: "pnl_leaderboard" },
      apiKey: "test-key-resolved-by-helper",
      body: { chains: ["ethereum"], timeframe: 30, pagination: { page: 1, per_page: 20 } },
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "calibration_discovery",
        network: "ethereum",
        caseSlug: null,
        correlationId,
        environment: "test"
      },
      fetchFn,
      persistAudit: (rec) => auditRecords.push(rec),
      maxAttempts: 2
    });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].correlation_id).toBe(correlationId);
    expect(auditRecords[0].attempt_number).toBe(1);
    expect(auditRecords[0].outcome).toBe("success");
    expect(auditRecords[0].endpoint_key).toBe("pnl_leaderboard");
    expect(auditRecords[0].workflow).toBe("calibration_discovery");
    expect(auditRecords[0].data_mode).toBe("live");
  });

  it("a 429 retry creates two physical-attempt audit records with one correlation ID", async () => {
    const auditRecords: any[] = [];
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { error: "rate limited" }, { "retry-after": "1" }))
      .mockResolvedValueOnce(mockResponse(200, { data: [] }));
    const correlationId = newCorrelationId();

    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/smart-money/pnl-leaderboard",
      ep: { key: "pnl_leaderboard" },
      apiKey: "test-key-resolved-by-helper",
      body: { chains: ["ethereum"], timeframe: 30 },
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "calibration_discovery",
        network: "ethereum",
        caseSlug: null,
        correlationId,
        environment: "test"
      },
      fetchFn,
      persistAudit: (rec) => auditRecords.push(rec),
      maxAttempts: 2
    });

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(auditRecords).toHaveLength(2);
    // Both records share the same correlation_id
    expect(auditRecords[0].correlation_id).toBe(correlationId);
    expect(auditRecords[1].correlation_id).toBe(correlationId);
    // Attempt numbers are 1 and 2
    expect(auditRecords[0].attempt_number).toBe(1);
    expect(auditRecords[1].attempt_number).toBe(2);
    // First attempt was rate-limited, second succeeded
    expect(auditRecords[0].outcome).toBe("rate_limited");
    expect(auditRecords[1].outcome).toBe("success");
  });

  it("the resolved key is passed as the apikey header to the transport", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mockResponse(200, { data: [] })
    );
    const capturedInit: any[] = [];
    fetchFn.mockImplementation((url: string, init: any) => {
      capturedInit.push(init);
      return Promise.resolve(mockResponse(200, { data: [] }));
    });

    await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/smart-money/pnl-leaderboard",
      ep: { key: "pnl_leaderboard" },
      apiKey: "resolved-key-from-helper",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "calibration_discovery",
        network: "ethereum",
        caseSlug: null,
        correlationId: "corr_test",
        environment: "test"
      },
      fetchFn,
      maxAttempts: 1
    });

    expect(capturedInit).toHaveLength(1);
    expect(capturedInit[0].headers.apikey).toBe("resolved-key-from-helper");
  });

  it("the API key never appears in the audit record (privacy)", async () => {
    const auditRecords: any[] = [];
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(200, { data: [] }));

    await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/smart-money/pnl-leaderboard",
      ep: { key: "pnl_leaderboard" },
      apiKey: "secret-key-must-not-leak",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "calibration_discovery",
        network: "ethereum",
        caseSlug: null,
        correlationId: "corr_privacy",
        environment: "test"
      },
      fetchFn,
      persistAudit: (rec) => auditRecords.push(rec),
      maxAttempts: 1
    });

    const recordStr = JSON.stringify(auditRecords[0]);
    expect(recordStr).not.toContain("secret-key-must-not-leak");
    expect(recordStr).not.toContain("api_key");
    expect(recordStr).not.toContain("apikey");
    expect(recordStr).not.toContain("authorization");
  });

  it("missing key (empty string) is handled by the caller, not the transport", async () => {
    // The transport receives whatever apiKey the caller passes. The caller
    // (discoverCalibrationCandidates) checks getNansenApiKey() === null BEFORE
    // calling the transport. This test verifies the transport does not crash
    // on an empty key — the caller's pre-check is the gate.
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(401, { error: "unauthorized" }));
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/smart-money/pnl-leaderboard",
      ep: { key: "pnl_leaderboard" },
      apiKey: "",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: {
        workflow: "calibration_discovery",
        network: "ethereum",
        caseSlug: null,
        correlationId: "corr_empty",
        environment: "test"
      },
      fetchFn,
      maxAttempts: 1
    });
    // The transport sends the empty key; Nansen returns 401 — caller's pre-check
    // prevents this path in production.
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });
});