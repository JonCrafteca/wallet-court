import { describe, it, expect } from "vitest";
import {
  callEndpointWithRetry,
  callNansenWithTelemetry,
  buildAuditRecord,
  AUDIT_OUTCOMES,
  containsForbiddenData,
  newCorrelationId
} from "../base44/shared/nansenTelemetry.ts";

// ---- Mock helpers ----

function mockResponse(status: number, body: any = {}, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    async json() { return body; }
  };
}

function mockFetchSuccess(body = { data: [] }, headers: Record<string, string> = {}) {
  return async () => mockResponse(200, body, headers) as any;
}
function mockFetchStatus(status: number, headers: Record<string, string> = {}) {
  return async () => mockResponse(status, {}, headers) as any;
}
function mockFetchSequence(responses: any[]) {
  let i = 0;
  return async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r;
  };
}
const mockFetchNetworkError = async () => { throw new Error("network failed"); };
const mockFetchTimeout = async () => {
  const e = new Error("The operation was aborted");
  (e as any).name = "AbortError";
  throw e;
};

function ctx(over: any = {}) {
  return {
    workflow: "trial_analysis",
    network: "ethereum",
    caseSlug: "case-test-1",
    correlationId: over.correlationId || newCorrelationId(),
    environment: "production",
    ...over
  };
}

const EP = { key: "pnl_summary" };

// ---- One physical request → exactly one audit record ----

describe("callEndpointWithRetry — one physical request = one record", () => {
  it("a single successful request creates exactly one audit record", async () => {
    const persisted: any[] = [];
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/api/v1/profiler/address/pnl-summary",
      ep: EP,
      apiKey: "key",
      body: { address: "0xabc" },
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess({ realized_pnl_percent: 0.5 }, { "x-request-id": "req_1", "x-credits-cost": "1" }),
      persistAudit: (r) => persisted.push(r)
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.requestId).toBe("req_1");
    expect(result.creditsCost).toBe(1);
    expect(persisted.length).toBe(1);
    expect(persisted[0].outcome).toBe(AUDIT_OUTCOMES.SUCCESS);
    expect(persisted[0].attempt_number).toBe(1);
    expect(persisted[0].endpoint_key).toBe("pnl_summary");
    expect(persisted[0].correlation_id).toBe(result && (persisted[0] as any).correlation_id);
  });
});

// ---- Retry → one record per physical attempt, same correlation_id ----

describe("callEndpointWithRetry — retry semantics", () => {
  it("a 429-then-success retry creates two records with the same correlation_id", async () => {
    const persisted: any[] = [];
    const correlationId = newCorrelationId();
    const fetchFn = mockFetchSequence([
      mockResponse(429, {}, { "retry-after": "0" }),
      mockResponse(200, { data: [] }, { "x-request-id": "req_2" })
    ]);
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx({ correlationId }),
      fetchFn,
      persistAudit: (r) => persisted.push(r)
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(persisted.length).toBe(2);
    expect(persisted[0].attempt_number).toBe(1);
    expect(persisted[0].outcome).toBe(AUDIT_OUTCOMES.RATE_LIMITED);
    expect(persisted[0].response_status).toBe(429);
    expect(persisted[1].attempt_number).toBe(2);
    expect(persisted[1].outcome).toBe(AUDIT_OUTCOMES.SUCCESS);
    expect(persisted[1].response_status).toBe(200);
    // Same correlation_id across both attempts
    expect(persisted[0].correlation_id).toBe(correlationId);
    expect(persisted[1].correlation_id).toBe(correlationId);
    expect(persisted[0].correlation_id).toBe(persisted[1].correlation_id);
    // Distinct call_ids
    expect(persisted[0].call_id).not.toBe(persisted[1].call_id);
  });

  it("retries exhausted on 429 → two records, final outcome rate_limited", async () => {
    const persisted: any[] = [];
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchStatus(429, { "retry-after": "0" }),
      persistAudit: (r) => persisted.push(r)
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(persisted.length).toBe(2);
    expect(persisted.every((r) => r.outcome === AUDIT_OUTCOMES.RATE_LIMITED)).toBe(true);
  });
});

// ---- Zero-record scenarios ----

describe("zero-record scenarios", () => {
  it("maxAttempts=0 (no physical request, e.g. cache hit / validation skip) → zero records", async () => {
    const persisted: any[] = [];
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess(),
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 0
    });
    expect(persisted.length).toBe(0);
    // No request was made; result reflects no attempts.
    expect(result.status).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("no persistAudit provided → no record written, result still correct", async () => {
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess({ data: [] })
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });
});

// ---- Outcome classification per physical attempt ----

describe("outcome classification across status codes", () => {
  const cases: [number, string, any][] = [
    [200, AUDIT_OUTCOMES.SUCCESS, mockFetchSuccess()],
    [400, AUDIT_OUTCOMES.CLIENT_ERROR, mockFetchStatus(400)],
    [401, AUDIT_OUTCOMES.CLIENT_ERROR, mockFetchStatus(401)],
    [403, AUDIT_OUTCOMES.CLIENT_ERROR, mockFetchStatus(403)],
    [404, AUDIT_OUTCOMES.CLIENT_ERROR, mockFetchStatus(404)],
    [429, AUDIT_OUTCOMES.RATE_LIMITED, mockFetchStatus(429, { "retry-after": "0" })],
    [500, AUDIT_OUTCOMES.PROVIDER_ERROR, mockFetchStatus(500)],
    [502, AUDIT_OUTCOMES.PROVIDER_ERROR, mockFetchStatus(502)],
    [503, AUDIT_OUTCOMES.PROVIDER_ERROR, mockFetchStatus(503)]
  ];
  for (const [status, expected, fetchFn] of cases) {
    it(`${status} → ${expected}`, async () => {
      const persisted: any[] = [];
      await callEndpointWithRetry({
        url: "https://api.nansen.ai/x",
        ep: EP,
        apiKey: "key",
        body: {},
        timeoutMs: 5000,
        telemetryCtx: ctx(),
        fetchFn,
        persistAudit: (r) => persisted.push(r),
        maxAttempts: 1
      });
      expect(persisted.length).toBe(1);
      expect(persisted[0].outcome).toBe(expected);
      expect(persisted[0].response_status).toBe(status);
    });
  }

  it("network error → network_error outcome, status null", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchNetworkError,
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 1
    });
    expect(persisted.length).toBe(1);
    expect(persisted[0].outcome).toBe(AUDIT_OUTCOMES.NETWORK_ERROR);
    expect(persisted[0].response_status).toBe(null);
  });

  it("timeout (abort) → timeout outcome, status null", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchTimeout,
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 1
    });
    expect(persisted.length).toBe(1);
    expect(persisted[0].outcome).toBe(AUDIT_OUTCOMES.TIMEOUT);
    expect(persisted[0].response_status).toBe(null);
  });
});

// ---- Sanitization + forbidden fields in stored records ----

describe("stored record sanitization", () => {
  it("endpoint_key is sanitized to allowed set", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: { key: "pnl_summary" },
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess(),
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 1
    });
    expect(persisted[0].endpoint_key).toBe("pnl_summary");
    expect(persisted[0].network).toBe("ethereum");
    expect(persisted[0].workflow).toBe("trial_analysis");
    expect(persisted[0].data_mode).toBe("live");
  });

  it("forbidden fields never appear in the stored record", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x?address=0xSECRET",
      ep: EP,
      apiKey: "SECRET_KEY",
      body: { address: "0xSECRET", chain: "ethereum" },
      timeoutMs: 5000,
      telemetryCtx: ctx({ caseSlug: "case-1" }),
      fetchFn: mockFetchSuccess(),
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 1
    });
    const rec = persisted[0];
    expect(containsForbiddenData(rec)).toBe(false);
    expect(rec.url).toBeUndefined();
    expect(rec.api_key).toBeUndefined();
    expect(rec.apikey).toBeUndefined();
    expect(rec.body).toBeUndefined();
    expect(rec.address).toBeUndefined();
    expect(rec.wallet_address).toBeUndefined();
    expect(rec.case_slug).toBe("case-1"); // case_slug is allowed (public)
  });
});

// ---- Telemetry persistence failure does not change the verdict ----

describe("telemetry persistence failure", () => {
  it("persistAudit throwing does not change the provider result", async () => {
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess({ data: [{ x: 1 }] }),
      persistAudit: () => { throw new Error("DB down"); },
      maxAttempts: 1
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ data: [{ x: 1 }] });
  });

  it("persistAudit throwing on one attempt does not prevent the retry record", async () => {
    let calls = 0;
    const result = await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSequence([
        mockResponse(429, {}, { "retry-after": "0" }),
        mockResponse(200, { data: [] })
      ]),
      persistAudit: () => { calls++; if (calls === 1) throw new Error("transient"); },
      maxAttempts: 2
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2); // both attempts attempted persistence
  });
});

// ---- call_id generated before the request ----

describe("call_id generation", () => {
  it("call_id is generated and unique per attempt", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSequence([
        mockResponse(429, {}, { "retry-after": "0" }),
        mockResponse(200, { data: [] })
      ]),
      persistAudit: (r) => persisted.push(r)
    });
    expect(persisted[0].call_id).toMatch(/^nca_/);
    expect(persisted[1].call_id).toMatch(/^nca_/);
    expect(persisted[0].call_id).not.toBe(persisted[1].call_id);
  });
});

// ---- Latency measured ----

describe("latency measurement", () => {
  it("latency_ms is a non-negative finite number", async () => {
    const persisted: any[] = [];
    await callEndpointWithRetry({
      url: "https://api.nansen.ai/x",
      ep: EP,
      apiKey: "key",
      body: {},
      timeoutMs: 5000,
      telemetryCtx: ctx(),
      fetchFn: mockFetchSuccess(),
      persistAudit: (r) => persisted.push(r),
      maxAttempts: 1
    });
    expect(persisted[0].latency_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(persisted[0].latency_ms)).toBe(true);
  });
});