import { describe, it, expect } from "vitest";
import {
  classifyOutcome,
  AUDIT_OUTCOMES,
  sanitizeEndpointKey,
  sanitizeNetwork,
  sanitizeWorkflow,
  sanitizeEnvironment,
  buildAuditRecord,
  stripForbidden,
  containsForbiddenData,
  FORBIDDEN_AUDIT_FIELDS,
  utcDay,
  shortCorrelationId,
  aggregateStats,
  averageCallsPerCase,
  projectCasesNeeded,
  buildProofPayload,
  proofToCsv,
  proofFilename,
  computeProofChecksum,
  fnv1aHex,
  canonicalJson,
  sanitizeAuditRowForExport,
  CONTEST_TARGET,
  TELEMETRY_VERSION
} from "../base44/shared/nansenTelemetry.ts";

// ---- Outcome classification ----

describe("classifyOutcome", () => {
  it("2xx → success", () => {
    expect(classifyOutcome(200, null, false)).toBe(AUDIT_OUTCOMES.SUCCESS);
    expect(classifyOutcome(299, null, false)).toBe(AUDIT_OUTCOMES.SUCCESS);
  });
  it("429 → rate_limited", () => {
    expect(classifyOutcome(429, "rate_limit", false)).toBe(AUDIT_OUTCOMES.RATE_LIMITED);
  });
  it("4xx (non-429) → client_error", () => {
    expect(classifyOutcome(400, null, false)).toBe(AUDIT_OUTCOMES.CLIENT_ERROR);
    expect(classifyOutcome(401, "auth", false)).toBe(AUDIT_OUTCOMES.CLIENT_ERROR);
    expect(classifyOutcome(403, "plan_credit", false)).toBe(AUDIT_OUTCOMES.CLIENT_ERROR);
    expect(classifyOutcome(404, null, false)).toBe(AUDIT_OUTCOMES.CLIENT_ERROR);
  });
  it("5xx → provider_error", () => {
    expect(classifyOutcome(500, null, false)).toBe(AUDIT_OUTCOMES.PROVIDER_ERROR);
    expect(classifyOutcome(502, null, false)).toBe(AUDIT_OUTCOMES.PROVIDER_ERROR);
    expect(classifyOutcome(503, null, false)).toBe(AUDIT_OUTCOMES.PROVIDER_ERROR);
  });
  it("null/0 status with timeout → timeout", () => {
    expect(classifyOutcome(null, "timeout", true)).toBe(AUDIT_OUTCOMES.TIMEOUT);
    expect(classifyOutcome(0, "timeout", true)).toBe(AUDIT_OUTCOMES.TIMEOUT);
  });
  it("null/0 status without timeout → network_error", () => {
    expect(classifyOutcome(null, "network", false)).toBe(AUDIT_OUTCOMES.NETWORK_ERROR);
    expect(classifyOutcome(0, "network", false)).toBe(AUDIT_OUTCOMES.NETWORK_ERROR);
  });
});

// ---- Sanitization ----

describe("sanitizers", () => {
  it("sanitizeEndpointKey allows known keys, redacts others", () => {
    expect(sanitizeEndpointKey("pnl_summary")).toBe("pnl_summary");
    expect(sanitizeEndpointKey("dex_trades")).toBe("dex_trades");
    expect(sanitizeEndpointKey("address_labels")).toBe("address_labels");
    expect(sanitizeEndpointKey("/api/v1/profiler/address/pnl-summary?x=1")).toBe("unknown");
    expect(sanitizeEndpointKey(undefined)).toBe("unknown");
  });
  it("sanitizeNetwork allows known chains", () => {
    expect(sanitizeNetwork("ethereum")).toBe("ethereum");
    expect(sanitizeNetwork("base")).toBe("base");
    expect(sanitizeNetwork("solana")).toBe("solana");
    expect(sanitizeNetwork("bitcoin")).toBe("unknown");
  });
  it("sanitizeWorkflow allows known workflows", () => {
    expect(sanitizeWorkflow("trial_analysis")).toBe("trial_analysis");
    expect(sanitizeWorkflow("label_enrichment")).toBe("label_enrichment");
    expect(sanitizeWorkflow("admin_health_check")).toBe("admin_health_check");
    expect(sanitizeWorkflow("evil_workflow")).toBe("unknown");
  });
  it("sanitizeEnvironment defaults to production", () => {
    expect(sanitizeEnvironment("production")).toBe("production");
    expect(sanitizeEnvironment("preview")).toBe("preview");
    expect(sanitizeEnvironment("development")).toBe("development");
    expect(sanitizeEnvironment("staging")).toBe("production");
    expect(sanitizeEnvironment(undefined)).toBe("production");
  });
});

// ---- Forbidden fields ----

describe("forbidden field protection", () => {
  it("stripForbidden removes all forbidden fields", () => {
    const rec = {
      call_id: "nca_1",
      wallet_address: "0xabc",
      api_key: "secret",
      authorization: "Bearer x",
      body: "leak",
      url: "https://api.nansen.ai/x?address=0xabc",
      user_id: "u1",
      ip: "1.2.3.4",
      cookie: "sess=x",
      endpoint_key: "pnl_summary"
    };
    const out = stripForbidden(rec);
    expect(out.call_id).toBe("nca_1");
    expect(out.endpoint_key).toBe("pnl_summary");
    expect(out.wallet_address).toBeUndefined();
    expect(out.api_key).toBeUndefined();
    expect(out.authorization).toBeUndefined();
    expect(out.body).toBeUndefined();
    expect(out.url).toBeUndefined();
    expect(out.user_id).toBeUndefined();
    expect(out.ip).toBeUndefined();
    expect(out.cookie).toBeUndefined();
  });
  it("containsForbiddenData detects leaks", () => {
    expect(containsForbiddenData({ wallet_address: "0x1" })).toBe(true);
    expect(containsForbiddenData({ api_key: "x" })).toBe(true);
    expect(containsForbiddenData({ call_id: "nca_1" })).toBe(false);
    expect(containsForbiddenData(null)).toBe(false);
  });
  it("FORBIDDEN_AUDIT_FIELDS covers all required categories", () => {
    const required = ["wallet_address", "normalized_wallet_address", "api_key", "authorization", "body", "url", "user_id", "owner_user_id", "ip", "cookie", "management_token", "raw_evidence"];
    for (const f of required) expect(FORBIDDEN_AUDIT_FIELDS).toContain(f);
  });
  it("buildAuditRecord never emits forbidden fields even if inputs leak", () => {
    const rec = buildAuditRecord({
      call_id: "nca_1", occurred_at: "2026-01-01T00:00:00Z",
      endpoint_key: "pnl_summary", workflow: "trial_analysis", network: "ethereum",
      case_slug: "case-1", correlation_id: "corr_1", attempt_number: 1,
      response_status: 200, outcome: AUDIT_OUTCOMES.SUCCESS, latency_ms: 50,
      environment: "production", provider_request_id: "req_1", credits_consumed: 1,
      // @ts-ignore — simulate a leak
      wallet_address: "0xleak", api_key: "secret"
    } as any);
    expect(containsForbiddenData(rec)).toBe(false);
    expect(rec.call_id).toBe("nca_1");
    expect(rec.data_mode).toBe("live");
    expect(rec.telemetry_version).toBe(TELEMETRY_VERSION);
  });
});

// ---- UTC day + correlation ----

describe("utcDay / shortCorrelationId", () => {
  it("utcDay returns YYYY-MM-DD in UTC", () => {
    expect(utcDay("2026-09-20T14:27:00Z")).toBe("2026-09-20");
    expect(utcDay("2026-09-20T23:59:00Z")).toBe("2026-09-20");
    expect(utcDay("2026-09-21T00:00:00Z")).toBe("2026-09-21");
    expect(utcDay(null)).toBe(null);
  });
  it("shortCorrelationId truncates long ids", () => {
    expect(shortCorrelationId("corr_abcdef123456")).toBe("corr_abc…456");
    expect(shortCorrelationId("corr_short")).toBe("corr_short");
    expect(shortCorrelationId(null)).toBe(null);
  });
});

// ---- Aggregation ----

function mkRecord(over: Partial<any> = {}) {
  return {
    call_id: over.call_id || "nca_" + Math.random().toString(36).slice(2, 8),
    occurred_at: over.occurred_at || "2026-09-20T12:00:00Z",
    endpoint_key: over.endpoint_key || "pnl_summary",
    workflow: over.workflow || "trial_analysis",
    network: over.network || "ethereum",
    case_slug: over.case_slug !== undefined ? over.case_slug : "case-1",
    correlation_id: over.correlation_id || "corr_1",
    attempt_number: over.attempt_number !== undefined ? over.attempt_number : 1,
    response_status: over.response_status !== undefined ? over.response_status : 200,
    outcome: over.outcome || AUDIT_OUTCOMES.SUCCESS,
    latency_ms: over.latency_ms !== undefined ? over.latency_ms : 50,
    environment: over.environment || "production",
    data_mode: "live",
    provider_request_id: over.provider_request_id !== undefined ? over.provider_request_id : null,
    credits_consumed: over.credits_consumed !== undefined ? over.credits_consumed : 1,
    telemetry_version: TELEMETRY_VERSION
  };
}

describe("aggregateStats — totals and remaining-target math", () => {
  it("empty records → zero totals, full target remaining", () => {
    const s = aggregateStats([], { now: () => new Date("2026-09-20T00:00:00Z") });
    expect(s.verified_total).toBe(0);
    expect(s.remaining).toBe(CONTEST_TARGET);
    expect(s.percent_complete).toBe(0);
    expect(s.success_rate).toBe(0);
    expect(s.average_latency_ms).toBe(null);
    expect(s.tracking_start).toBe(null);
    expect(s.calls_today_utc).toBe(0);
  });
  it("counts verified total and remaining", () => {
    const recs = [mkRecord(), mkRecord(), mkRecord()];
    const s = aggregateStats(recs);
    expect(s.verified_total).toBe(3);
    expect(s.remaining).toBe(997);
    expect(s.percent_complete).toBeCloseTo(0.3, 1);
  });
  it("remaining never goes negative", () => {
    const recs = Array.from({ length: 1005 }, (_, i) => mkRecord({ call_id: "nca_" + i }));
    const s = aggregateStats(recs);
    expect(s.verified_total).toBe(1005);
    expect(s.remaining).toBe(0);
    expect(s.percent_complete).toBe(100);
  });
  it("tracking_start = oldest, most_recent = newest", () => {
    const recs = [
      mkRecord({ occurred_at: "2026-09-20T10:00:00Z" }),
      mkRecord({ occurred_at: "2026-09-20T08:00:00Z" }),
      mkRecord({ occurred_at: "2026-09-20T15:00:00Z" })
    ];
    const s = aggregateStats(recs);
    expect(s.tracking_start).toBe("2026-09-20T08:00:00Z");
    expect(s.most_recent).toBe("2026-09-20T15:00:00Z");
  });
  it("calls_today_utc counts only today", () => {
    const recs = [
      mkRecord({ occurred_at: "2026-09-20T10:00:00Z" }),
      mkRecord({ occurred_at: "2026-09-20T23:00:00Z" }),
      mkRecord({ occurred_at: "2026-09-19T10:00:00Z" })
    ];
    const s = aggregateStats(recs, { now: () => new Date("2026-09-20T12:00:00Z") });
    expect(s.calls_today_utc).toBe(2);
    expect(s.today_utc).toBe("2026-09-20");
  });
  it("success/failed/rate_limited/timeouts classification", () => {
    const recs = [
      mkRecord({ outcome: AUDIT_OUTCOMES.SUCCESS }),
      mkRecord({ outcome: AUDIT_OUTCOMES.SUCCESS }),
      mkRecord({ outcome: AUDIT_OUTCOMES.RATE_LIMITED }),
      mkRecord({ outcome: AUDIT_OUTCOMES.TIMEOUT }),
      mkRecord({ outcome: AUDIT_OUTCOMES.NETWORK_ERROR }),
      mkRecord({ outcome: AUDIT_OUTCOMES.CLIENT_ERROR })
    ];
    const s = aggregateStats(recs);
    expect(s.successful).toBe(2);
    expect(s.failed).toBe(4);
    expect(s.rate_limited).toBe(1);
    expect(s.timeouts_or_network).toBe(2);
    expect(s.success_rate).toBeCloseTo(2 / 6, 3);
  });
  it("average latency ignores non-finite", () => {
    const recs = [
      mkRecord({ latency_ms: 100 }),
      mkRecord({ latency_ms: 200 }),
      mkRecord({ latency_ms: null })
    ];
    const s = aggregateStats(recs);
    expect(s.average_latency_ms).toBe(150);
  });
  it("status-code breakdown", () => {
    const recs = [
      mkRecord({ response_status: 200 }),
      mkRecord({ response_status: 200 }),
      mkRecord({ response_status: 429 }),
      mkRecord({ response_status: null })
    ];
    const s = aggregateStats(recs);
    expect(s.by_status["200"]).toBe(2);
    expect(s.by_status["429"]).toBe(1);
    expect(s.by_status["no_response"]).toBe(1);
  });
});

describe("UTC daily grouping is deterministic", () => {
  it("groups by UTC midnight boundary", () => {
    const recs = [
      mkRecord({ occurred_at: "2026-09-19T23:59:59Z" }),
      mkRecord({ occurred_at: "2026-09-20T00:00:01Z" }),
      mkRecord({ occurred_at: "2026-09-20T12:00:00Z" })
    ];
    const s = aggregateStats(recs, { now: () => new Date("2026-09-20T12:00:00Z") });
    expect(s.by_utc_day["2026-09-19"]).toBe(1);
    expect(s.by_utc_day["2026-09-20"]).toBe(2);
  });
});

describe("calls-per-case and projection handle zero data", () => {
  it("zero records → 0 avg, full target projection", () => {
    expect(averageCallsPerCase([])).toBe(0);
    expect(projectCasesNeeded([])).toBe(CONTEST_TARGET);
  });
  it("admin calls (null case_slug) excluded from denominator", () => {
    const recs = [
      mkRecord({ case_slug: "case-1", correlation_id: "c1" }),
      mkRecord({ case_slug: "case-1", correlation_id: "c1" }),
      mkRecord({ case_slug: "case-1", correlation_id: "c1" }),
      mkRecord({ case_slug: "case-1", correlation_id: "c1" }),
      mkRecord({ case_slug: null, correlation_id: "cAdmin" })
    ];
    expect(averageCallsPerCase(recs)).toBe(4);
  });
  it("projects remaining cases from observed average", () => {
    // 4 calls per case, 996 remaining → 249 cases
    const recs = Array.from({ length: 4 }, () => mkRecord({ case_slug: "case-1", correlation_id: "c1" }));
    expect(projectCasesNeeded(recs)).toBe(Math.ceil(996 / 4));
  });
  it("no per-case rate → full target (cannot project)", () => {
    const recs = [mkRecord({ case_slug: null, correlation_id: "cAdmin" })];
    expect(projectCasesNeeded(recs)).toBe(CONTEST_TARGET);
  });
  it("by_correlation groups attempts per analysis", () => {
    const recs = [
      mkRecord({ correlation_id: "c1", case_slug: "case-1" }),
      mkRecord({ correlation_id: "c1", case_slug: "case-1", attempt_number: 2 }),
      mkRecord({ correlation_id: "c2", case_slug: "case-2" })
    ];
    const s = aggregateStats(recs);
    expect(s.by_correlation.length).toBe(2);
    expect(s.by_correlation[0].calls).toBe(2);
    expect(s.by_correlation[0].case_slug).toBe("case-1");
  });
});

// ---- Historical trials do not contribute ----

describe("historical backfill exclusion", () => {
  it("aggregateStats only counts provided records — no inference", () => {
    // Simulate "existing trials" by NOT passing them. The ledger only sees
    // records created after instrumentation.
    const postInstrumentation = [mkRecord({ occurred_at: "2026-09-20T12:00:00Z" })];
    const s = aggregateStats(postInstrumentation);
    expect(s.verified_total).toBe(1);
    expect(s.tracking_start).toBe("2026-09-20T12:00:00Z");
  });
});

// ---- Proof payload + CSV + checksum ----

describe("proof payload + CSV agreement", () => {
  it("JSON and CSV agree on totals", () => {
    const recs = [
      mkRecord({ outcome: AUDIT_OUTCOMES.SUCCESS }),
      mkRecord({ outcome: AUDIT_OUTCOMES.RATE_LIMITED }),
      mkRecord({ outcome: AUDIT_OUTCOMES.PROVIDER_ERROR })
    ];
    const proof = buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    const csv = proofToCsv(recs);
    const csvRows = csv.trim().split("\n").length - 1; // minus header
    expect(proof.total_tracked_physical_requests).toBe(3);
    expect(proof.successful).toBe(1);
    expect(proof.rate_limited).toBe(1);
    expect(proof.failed).toBe(2);
    expect(csvRows).toBe(3);
    expect(proof.application).toBe("Wallet Court");
    expect(proof.contest_target).toBe(CONTEST_TARGET);
    expect(proof.no_historical_backfill).toBe(true);
    expect(proof.methodology.length).toBeGreaterThan(0);
  });
  it("checksum is deterministic and changes when data changes", () => {
    const recs = [mkRecord({ call_id: "nca_x", occurred_at: "2026-09-20T12:00:00Z" })];
    const p1 = buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    const p2 = buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    expect(p1.checksum).toBe(p2.checksum);
    expect(p1.checksum).toMatch(/^[0-9a-f]{8}$/);
    const recs2 = [mkRecord({ call_id: "nca_y", occurred_at: "2026-09-20T12:00:00Z" })];
    const p3 = buildProofPayload({ records: recs2, generatedAt: "2026-09-20T12:00:00Z" });
    expect(p3.checksum).not.toBe(p1.checksum);
  });
  it("fnv1a + canonicalJson are deterministic", () => {
    expect(fnv1aHex("")).toBe("811c9dc5");
    expect(fnv1aHex("a")).toBe(fnv1aHex("a"));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it("proofFilename formats date", () => {
    expect(proofFilename("2026-09-20T12:00:00Z", "json")).toBe("wallet-court-nansen-call-proof-2026-09-20.json");
    expect(proofFilename("2026-09-20T12:00:00Z", "csv")).toBe("wallet-court-nansen-call-proof-2026-09-20.csv");
  });
  it("sanitizeAuditRowForExport strips forbidden fields", () => {
    const rec = mkRecord();
    const row = sanitizeAuditRowForExport({ ...rec, wallet_address: "0xleak", api_key: "secret" });
    expect(containsForbiddenData(row)).toBe(false);
    expect(row.endpoint_key).toBe("pnl_summary");
    expect(row.data_mode).toBe("live");
  });
  it("CSV escapes commas and quotes", () => {
    const rec = mkRecord({ case_slug: "case,with,commas", correlation_id: 'corr"quote"' });
    const csv = proofToCsv([rec]);
    expect(csv).toContain('"case,with,commas"');
    expect(csv).toContain('"corr""quote""');
  });
});