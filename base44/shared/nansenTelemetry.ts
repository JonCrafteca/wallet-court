// Wallet Court — Contest Control & Verified Nansen Call Ledger.
//
// PURE telemetry module: no `base44:runtime` import, no SDK, no side effects
// beyond the injected `fetchFn` and `persistAudit` callback. Every function
// here is unit-testable in the default vitest "node" environment.
//
// This module owns the SINGLE instrumented transport for outbound Nansen
// requests (`callNansenWithTelemetry`). All physical Nansen HTTP traffic must
// route through it; `base44/shared/nansen.ts` wires its retry loop to this
// function so each physical attempt produces exactly one NansenApiCallAudit
// record. A source-audit test (tests/nansenSourceAudit.test.ts) fails if a
// new direct `fetch(` to Nansen is introduced outside this module.
//
// Counting semantics (enforced here, not at multiple layers):
//   - One audit record per physical outbound HTTP attempt.
//   - A retry is a distinct physical request → its own record + attempt number.
//   - Cache hits, validation failures, demo/mock responses, page loads,
//     verdict rendering, and receipt generation produce ZERO records.
//   - `data_mode` is always "live" — a record exists only when a real request
//     physically occurred.
//   - Telemetry persistence failure never changes the wallet verdict; the
//     `persistAudit` callback swallows errors and emits a server-side log.

export const TELEMETRY_VERSION = 1;
export const CONTEST_TARGET = 1000;

export const AUDIT_OUTCOMES = {
  SUCCESS: "success",
  CLIENT_ERROR: "client_error",
  PROVIDER_ERROR: "provider_error",
  RATE_LIMITED: "rate_limited",
  TIMEOUT: "timeout",
  NETWORK_ERROR: "network_error"
} as const;

export type AuditOutcome = typeof AUDIT_OUTCOMES[keyof typeof AUDIT_OUTCOMES];

// Endpoint keys that may be persisted. Anything else is redacted to "unknown"
// so a caller typo can never leak a raw path or query string.
const ALLOWED_ENDPOINT_KEYS = new Set([
  "pnl_summary", "dex_trades", "current_balance", "transactions", "address_labels",
  "pnl_leaderboard"
]);
const ALLOWED_NETWORKS = new Set(["ethereum", "base", "solana"]);
const ALLOWED_WORKFLOWS = new Set([
  "trial_analysis", "label_enrichment", "admin_health_check", "admin_verification",
  "calibration_discovery"
]);
const ALLOWED_ENVIRONMENTS = new Set(["production", "preview", "development"]);

// Fields that must NEVER appear in an audit record, dashboard response, or
// export. Used by stripForbidden / containsForbiddenData in tests and at write
// time. This is the privacy contract for the entire ledger.
export const FORBIDDEN_AUDIT_FIELDS = [
  "wallet_address", "normalized_wallet_address", "address", "addr",
  "api_key", "apikey", "authorization", "auth",
  "body", "request_body", "response_body", "json", "payload",
  "query", "querystring", "url", "full_url", "href", "path",
  "user_id", "owner_user_id", "created_by_id", "submitted_by_user_id",
  "ip", "ip_address", "cookie", "cookies",
  "management_token", "token",
  "raw_evidence", "evidence", "evidence_items", "metrics",
  "labels", "raw_labels", "labels_json"
];

export function sanitizeEndpointKey(key: string | undefined): string {
  return ALLOWED_ENDPOINT_KEYS.has(key as string) ? (key as string) : "unknown";
}
export function sanitizeNetwork(network: string | undefined): string {
  return ALLOWED_NETWORKS.has(network as string) ? (network as string) : "unknown";
}
export function sanitizeWorkflow(workflow: string | undefined): string {
  return ALLOWED_WORKFLOWS.has(workflow as string) ? (workflow as string) : "unknown";
}
export function sanitizeEnvironment(env: string | undefined): string {
  return ALLOWED_ENVIRONMENTS.has(env as string) ? (env as string) : "production";
}

// Classify a physical attempt's HTTP outcome. status=0 means no response was
// received (network error or timeout).
export function classifyOutcome(
  status: number | null,
  errorCategory: string | null,
  isTimeout: boolean
): AuditOutcome {
  if (status != null && status >= 200 && status < 300) return AUDIT_OUTCOMES.SUCCESS;
  if (status === 429) return AUDIT_OUTCOMES.RATE_LIMITED;
  if (status == null || status === 0) {
    return isTimeout ? AUDIT_OUTCOMES.TIMEOUT : AUDIT_OUTCOMES.NETWORK_ERROR;
  }
  if (status >= 400 && status < 500) return AUDIT_OUTCOMES.CLIENT_ERROR;
  if (status >= 500) return AUDIT_OUTCOMES.PROVIDER_ERROR;
  // Defensive fallback for unexpected status ranges.
  if (errorCategory === "timeout") return AUDIT_OUTCOMES.TIMEOUT;
  if (errorCategory === "network") return AUDIT_OUTCOMES.NETWORK_ERROR;
  return AUDIT_OUTCOMES.PROVIDER_ERROR;
}

// Map a Nansen HTTP status to the legacy internal error category used by the
// pipeline (kept here so the transport does not import nansen.ts internals).
export function categorizeStatus(status: number, err: Error | null): string {
  if (status === 401) return "auth";
  if (status === 402 || status === 403) return "plan_credit";
  if (status === 429) return "rate_limit";
  if (status === 0) return err && /timeout|abort/i.test(err.message || "") ? "timeout" : "network";
  if (status >= 500) return "unknown";
  return "unknown";
}

export function utcDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function shortCorrelationId(id: string | null): string | null {
  if (!id || typeof id !== "string") return null;
  return id.length <= 12 ? id : id.slice(0, 8) + "…" + id.slice(-3);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : null;
}

function numHeader(h: Headers, names: string[]): number | null {
  for (const n of names) {
    const v = h.get(n);
    if (v != null && v !== "") {
      const p = parseFloat(v);
      if (Number.isFinite(p)) return p;
    }
  }
  return null;
}

function strHeader(h: Headers, names: string[]): string | null {
  for (const n of names) {
    const v = h.get(n);
    if (v != null && v !== "") return v;
  }
  return null;
}

export function parseRetryAfter(v: string | null): number {
  if (!v) return 0;
  const s = parseInt(v, 10);
  if (Number.isFinite(s) && s >= 0) return Math.min(s, 30) * 1000;
  const d = Date.parse(v);
  if (Number.isFinite(d)) return Math.max(0, Math.min(30000, d - Date.now()));
  return 0;
}

// Deterministic ID generators. Prefer crypto.randomUUID when available.
export function newCallId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "nca_" + crypto.randomUUID();
  }
  return "nca_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "corr_" + crypto.randomUUID();
  }
  return "corr_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function detectEnvironment(): string {
  try {
    const mode = (import.meta as any).env?.MODE;
    if (mode === "development") return "development";
  } catch {}
  return "production";
}

// Remove any forbidden field that may have leaked into a record. Returns a new
// object; never mutates the input.
export function stripForbidden(rec: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (FORBIDDEN_AUDIT_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export function containsForbiddenData(rec: Record<string, any> | null): boolean {
  if (!rec) return false;
  return FORBIDDEN_AUDIT_FIELDS.some((f) => rec[f] !== undefined);
}

// Build a sanitized, schema-valid audit record from a physical attempt result.
// All inputs are clamped/redacted to the allowed enums; forbidden fields are
// stripped. This is the single function that produces records for persistence.
export function buildAuditRecord(input: {
  call_id: string;
  occurred_at: string;
  endpoint_key: string;
  workflow: string;
  network: string;
  case_slug?: string | null;
  correlation_id: string;
  attempt_number: number;
  response_status?: number | null;
  outcome: AuditOutcome;
  latency_ms?: number | null;
  environment: string;
  provider_request_id?: string | null;
  credits_consumed?: number | null;
}): Record<string, any> {
  const rec: Record<string, any> = {
    call_id: input.call_id,
    occurred_at: input.occurred_at,
    endpoint_key: sanitizeEndpointKey(input.endpoint_key),
    workflow: sanitizeWorkflow(input.workflow),
    network: sanitizeNetwork(input.network),
    case_slug: typeof input.case_slug === "string" && input.case_slug ? input.case_slug : null,
    correlation_id: input.correlation_id,
    attempt_number: Number.isFinite(input.attempt_number) ? input.attempt_number : 1,
    response_status: Number.isFinite(input.response_status as number) ? input.response_status : null,
    outcome: input.outcome,
    latency_ms: Number.isFinite(input.latency_ms as number) ? input.latency_ms : null,
    environment: sanitizeEnvironment(input.environment),
    data_mode: "live" as const,
    provider_request_id: typeof input.provider_request_id === "string" && input.provider_request_id ? input.provider_request_id : null,
    credits_consumed: Number.isFinite(input.credits_consumed as number) ? input.credits_consumed : null,
    telemetry_version: TELEMETRY_VERSION
  };
  return stripForbidden(rec);
}

// The single instrumented transport for one physical outbound Nansen request.
// `fetchFn` is injected so tests can mock the network without touching globals.
// `persistAudit` is an optional sync callback that stores the record; it must
// never throw into the caller (telemetry failure must not change the verdict).
// Returns the per-attempt result plus the assembled audit record.
export async function callNansenWithTelemetry(args: {
  url: string;
  init: RequestInit;
  attemptNumber: number;
  telemetryCtx: {
    endpointKey: string;
    workflow: string;
    network: string;
    caseSlug?: string | null;
    correlationId: string;
    environment: string;
  };
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  persistAudit?: (record: Record<string, any>) => void;
  now?: () => Date;
}): Promise<{
  ok: boolean;
  status: number;
  errorCategory: string | null;
  json: any;
  requestId: string | null;
  creditsCost: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  rateLimitRemaining: string | null;
  retryAfterHeader: string | null;
  occurredAt: string;
  latencyMs: number;
  auditRecord: Record<string, any>;
}> {
  const { url, init, attemptNumber, telemetryCtx, fetchFn, persistAudit, now } = args;
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null as any);
  if (!f) throw new Error("No fetch implementation available for Nansen telemetry transport.");

  const callId = newCallId();
  const occurredAt = (now ? now() : new Date()).toISOString();
  const startedAt = Date.now();

  let status = 0;
  let isTimeout = false;
  let response: Response | null = null;
  let networkError: Error | null = null;
  try {
    response = await f(url, init);
    status = response.status;
  } catch (e: any) {
    isTimeout = !!(e && /timeout|abort/i.test(e.message || ""));
    status = 0;
    networkError = e;
  }
  const latencyMs = Date.now() - startedAt;

  let json: any = null;
  let malformed = false;
  let requestId: string | null = null;
  let creditsCost: number | null = null;
  let creditsUsed: number | null = null;
  let creditsRemaining: number | null = null;
  let rateLimitRemaining: string | null = null;
  let retryAfterHeader: string | null = null;
  let errorCategory: string | null = null;
  let ok = false;

  if (response) {
    const h = response.headers;
    requestId = strHeader(h, ["x-request-id", "request-id", "x-correlation-id", "x-nansen-request-id"]);
    creditsCost = numHeader(h, ["x-credits-cost", "x-credit-cost", "credits-cost"]);
    creditsUsed = numHeader(h, ["x-credits-used", "credits-used", "x-credits-spent"]);
    creditsRemaining = numHeader(h, ["x-credits-remaining", "credits-remaining", "x-credits-left"]);
    rateLimitRemaining = strHeader(h, ["x-ratelimit-remaining", "ratelimit-remaining"]);
    retryAfterHeader = h.get("retry-after");
    if (response.ok) {
      try { json = await response.json(); } catch { malformed = true; }
    }
    ok = response.ok && !malformed;
    errorCategory = ok ? null : (response.ok ? "malformed" : categorizeStatus(response.status, null));
  } else {
    errorCategory = isTimeout ? "timeout" : "network";
  }

  const outcome = classifyOutcome(status || (response ? status : null), errorCategory, isTimeout);
  const auditRecord = buildAuditRecord({
    call_id: callId,
    occurred_at: occurredAt,
    endpoint_key: telemetryCtx.endpointKey,
    workflow: telemetryCtx.workflow,
    network: telemetryCtx.network,
    case_slug: telemetryCtx.caseSlug,
    correlation_id: telemetryCtx.correlationId,
    attempt_number: attemptNumber,
    response_status: response ? status : null,
    outcome,
    latency_ms: latencyMs,
    environment: telemetryCtx.environment,
    provider_request_id: requestId,
    credits_consumed: creditsCost
  });

  if (typeof persistAudit === "function") {
    try { persistAudit(auditRecord); } catch (e) {
      // Telemetry persistence failure must never change the verdict.
      // Emit a server-side log and keep going.
      if (typeof console !== "undefined" && console.error) {
        console.error("[nansen-telemetry] audit persist failed:", (e as Error)?.message);
      }
    }
  }

  return {
    ok,
    status: response ? status : 0,
    errorCategory,
    json,
    requestId,
    creditsCost,
    creditsUsed,
    creditsRemaining,
    rateLimitRemaining,
    retryAfterHeader,
    occurredAt,
    latencyMs,
    auditRecord
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The retry loop for one logical endpoint call. Each iteration is a physical
// outbound request routed through callNansenWithTelemetry, so a retry (429
// with Retry-After) produces one audit record per attempt, all sharing the
// caller's correlation_id. `fetchFn` is injected for tests; production passes
// nothing and the global fetch is used. Returns the exact shape the pipeline
// expects, so verdict behavior is unchanged.
// Result returned when a budget guard refuses the physical attempt. No HTTP
// request is made and no audit record is written — the ceiling is enforced
// before the request leaves the process.
export const CEILING_GUARD_OUTCOME = "ceiling_reached" as const;

export interface BudgetGuardResult {
  allowed: boolean;
  verifiedTotal: number;
  reason: string;
}

// A budget guard is injected by the caller (nansen.ts wires it to
// getVerifiedTotal + checkBudget). The transport calls it before each physical
// attempt and refuses to make the HTTP request if it returns allowed=false.
export type BudgetGuard = () => Promise<BudgetGuardResult>;

export async function callEndpointWithRetry(args: {
  url: string;
  ep: { key: string };
  apiKey: string;
  body: any;
  timeoutMs: number;
  telemetryCtx: {
    workflow: string;
    network: string;
    caseSlug?: string | null;
    correlationId: string;
    environment: string;
  };
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  persistAudit?: (record: Record<string, any>) => void;
  maxAttempts?: number;
  now?: () => Date;
  budgetGuard?: BudgetGuard;
}): Promise<{
  key: string;
  ok: boolean;
  status: number;
  errorCategory: string | null;
  calledAt: string;
  json: any;
  requestId: string | null;
  creditsCost: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  rateLimitRemaining: string | null;
}> {
  const { url, ep, apiKey, body, timeoutMs, telemetryCtx, fetchFn, persistAudit, now, budgetGuard } = args;
  const maxAttempts = args.maxAttempts ?? 2;
  const initBase: RequestInit = {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  };
  let attempt = 0;
  let first: any = null;
  let last: any = null;
  if (maxAttempts <= 0) {
    return { key: ep.key, ok: false, status: 0, errorCategory: "network", calledAt: (now ? now() : new Date()).toISOString(), json: null, requestId: null, creditsCost: null, creditsUsed: null, creditsRemaining: null, rateLimitRemaining: null };
  }
  while (attempt < maxAttempts) {
    attempt++;

    // Per-physical-attempt ceiling enforcement at the transport boundary.
    // The guard is injected by the caller (nansen.ts wires it to
    // getVerifiedTotal + checkBudget). If it refuses, NO HTTP request is
    // made and NO audit record is written — the ceiling is enforced before
    // the request leaves the process. This is the last line of defense:
    // even if the campaign-level check passed, a concurrent request from
    // another workflow could have pushed the total to the ceiling between
    // the campaign check and this physical attempt.
    if (budgetGuard) {
      try {
        const guard = await budgetGuard();
        if (!guard.allowed) {
          const calledAt = (now ? now() : new Date()).toISOString();
          return {
            key: ep.key,
            ok: false,
            status: 0,
            errorCategory: CEILING_GUARD_OUTCOME,
            calledAt,
            json: null,
            requestId: null,
            creditsCost: null,
            creditsUsed: null,
            creditsRemaining: null,
            rateLimitRemaining: null
          };
        }
      } catch {
        // Guard check itself failed (e.g. DB read error). Be conservative:
        // allow the request through. The audit record will still be written
        // and the next attempt's guard will re-check.
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const result = await callNansenWithTelemetry({
      url,
      init: { ...initBase, signal: ctrl.signal },
      attemptNumber: attempt,
      telemetryCtx: {
        endpointKey: ep.key,
        workflow: telemetryCtx.workflow,
        network: telemetryCtx.network,
        caseSlug: telemetryCtx.caseSlug,
        correlationId: telemetryCtx.correlationId,
        environment: telemetryCtx.environment
      },
      fetchFn,
      persistAudit,
      now
    });
    clearTimeout(timer);
    if (!first) first = result;
    last = result;
    if (result.status === 429 && attempt < maxAttempts) {
      const ra = parseRetryAfter(result.retryAfterHeader);
      if (ra > 0) await sleep(ra);
      continue;
    }
    return assembleResult(ep, result, first.occurredAt);
  }
  return assembleResult(ep, last, first.occurredAt);
}

function assembleResult(ep: { key: string }, r: any, calledAt: string) {
  return {
    key: ep.key,
    ok: r.ok,
    status: r.status,
    errorCategory: r.errorCategory,
    calledAt,
    json: r.json,
    requestId: r.requestId,
    creditsCost: r.creditsCost,
    creditsUsed: r.creditsUsed,
    creditsRemaining: r.creditsRemaining,
    rateLimitRemaining: r.rateLimitRemaining
  };
}

// ---- Aggregation (pure) ----

export interface AuditRecordLike {
  call_id?: string;
  occurred_at?: string;
  endpoint_key?: string;
  workflow?: string;
  network?: string;
  case_slug?: string | null;
  correlation_id?: string;
  attempt_number?: number;
  response_status?: number | null;
  outcome?: string;
  latency_ms?: number | null;
  environment?: string;
  data_mode?: string;
  provider_request_id?: string | null;
  credits_consumed?: number | null;
  telemetry_version?: number;
}

function countBy(records: AuditRecordLike[], field: keyof AuditRecordLike): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of records) {
    const k = (r[field] as string) || "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function countByUtcDay(records: AuditRecordLike[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of records) {
    const day = utcDay(r.occurred_at || null);
    const k = day || "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

// Average real outbound calls per completed live case. A "case" is identified by
// a non-empty case_slug; administrative calls (null case_slug) are excluded
// from the denominator. Returns 0 when there is no case data (safe for zero).
export function averageCallsPerCase(records: AuditRecordLike[]): number {
  const byCase = new Map<string, number>();
  for (const r of records) {
    if (!r.case_slug) continue;
    byCase.set(r.case_slug, (byCase.get(r.case_slug) || 0) + 1);
  }
  if (byCase.size === 0) return 0;
  let total = 0;
  for (const c of byCase.values()) total += c;
  return total / byCase.size;
}

export function projectCasesNeeded(records: AuditRecordLike[], target: number = CONTEST_TARGET): number {
  const total = records.length;
  if (total <= 0) return target; // no data → cannot estimate; full target remains
  const remaining = Math.max(0, target - total);
  if (remaining === 0) return 0;
  const avg = averageCallsPerCase(records);
  if (!avg || avg <= 0) return target; // no per-case rate → cannot project
  return Math.ceil(remaining / avg);
}

export interface ContestStats {
  target: number;
  verified_total: number;
  remaining: number;
  percent_complete: number;
  tracking_start: string | null;
  most_recent: string | null;
  calls_today_utc: number;
  today_utc: string | null;
  successful: number;
  failed: number;
  rate_limited: number;
  timeouts_or_network: number;
  success_rate: number;
  average_latency_ms: number | null;
  by_endpoint: Record<string, number>;
  by_workflow: Record<string, number>;
  by_network: Record<string, number>;
  by_utc_day: Record<string, number>;
  by_status: Record<string, number>;
  by_correlation: { correlation_id: string; case_slug: string | null; calls: number }[];
  average_calls_per_case: number;
  estimated_cases_to_target: number;
}

export function aggregateStats(
  records: AuditRecordLike[],
  opts: { target?: number; now?: () => Date } = {}
): ContestStats {
  const target = opts.target ?? CONTEST_TARGET;
  const now = opts.now ? opts.now() : new Date();
  const todayUtc = now.toISOString().slice(0, 10);

  const all = records.slice();
  const verifiedTotal = all.length;
  const remaining = Math.max(0, target - verifiedTotal);
  const percentComplete = target > 0 ? Math.min(100, (verifiedTotal / target) * 100) : 0;

  let trackingStart: string | null = null;
  let mostRecent: string | null = null;
  for (const r of all) {
    const t = r.occurred_at;
    if (!t) continue;
    if (!trackingStart || t < trackingStart) trackingStart = t;
    if (!mostRecent || t > mostRecent) mostRecent = t;
  }

  const successful = all.filter((r) => r.outcome === AUDIT_OUTCOMES.SUCCESS).length;
  const rateLimited = all.filter((r) => r.outcome === AUDIT_OUTCOMES.RATE_LIMITED).length;
  const timeoutsOrNetwork = all.filter(
    (r) => r.outcome === AUDIT_OUTCOMES.TIMEOUT || r.outcome === AUDIT_OUTCOMES.NETWORK_ERROR
  ).length;
  const failed = verifiedTotal - successful;

  const latencies = all.map((r) => r.latency_ms).filter((v): v is number => Number.isFinite(v as number));
  const averageLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  const byStatus: Record<string, number> = {};
  for (const r of all) {
    const k = r.response_status == null ? "no_response" : String(r.response_status);
    byStatus[k] = (byStatus[k] || 0) + 1;
  }

  // Group by correlation_id with case_slug + call count.
  const corrMap = new Map<string, { correlation_id: string; case_slug: string | null; calls: number }>();
  for (const r of all) {
    const cid = r.correlation_id || "unknown";
    const existing = corrMap.get(cid);
    if (existing) existing.calls++;
    else corrMap.set(cid, { correlation_id: cid, case_slug: r.case_slug || null, calls: 1 });
  }
  const byCorrelation = Array.from(corrMap.values()).sort((a, b) => b.calls - a.calls);

  const callsToday = all.filter((r) => utcDay(r.occurred_at || null) === todayUtc).length;

  return {
    target,
    verified_total: verifiedTotal,
    remaining,
    percent_complete: percentComplete,
    tracking_start: trackingStart,
    most_recent: mostRecent,
    calls_today_utc: callsToday,
    today_utc: todayUtc,
    successful,
    failed,
    rate_limited: rateLimited,
    timeouts_or_network: timeoutsOrNetwork,
    success_rate: verifiedTotal > 0 ? successful / verifiedTotal : 0,
    average_latency_ms: averageLatency,
    by_endpoint: countBy(all, "endpoint_key"),
    by_workflow: countBy(all, "workflow"),
    by_network: countBy(all, "network"),
    by_utc_day: countByUtcDay(all),
    by_status: byStatus,
    by_correlation: byCorrelation,
    average_calls_per_case: averageCallsPerCase(all),
    estimated_cases_to_target: projectCasesNeeded(all, target)
  };
}

// Sanitize a record for display/export. Only the safe, public fields are kept.
export function sanitizeAuditRowForExport(r: AuditRecordLike): Record<string, any> {
  return stripForbidden({
    call_id: r.call_id || null,
    occurred_at: r.occurred_at || null,
    endpoint_key: sanitizeEndpointKey(r.endpoint_key),
    workflow: sanitizeWorkflow(r.workflow),
    network: sanitizeNetwork(r.network),
    case_slug: typeof r.case_slug === "string" && r.case_slug ? r.case_slug : null,
    correlation_id: r.correlation_id || null,
    attempt_number: Number.isFinite(r.attempt_number as number) ? r.attempt_number : null,
    response_status: Number.isFinite(r.response_status as number) ? r.response_status : null,
    outcome: r.outcome || null,
    latency_ms: Number.isFinite(r.latency_ms as number) ? r.latency_ms : null,
    environment: sanitizeEnvironment(r.environment),
    data_mode: "live",
    provider_request_id: typeof r.provider_request_id === "string" && r.provider_request_id ? r.provider_request_id : null,
    credits_consumed: Number.isFinite(r.credits_consumed as number) ? r.credits_consumed : null,
    telemetry_version: r.telemetry_version ?? TELEMETRY_VERSION
  });
}

export const PROOF_METHODOLOGY = [
  "Each record represents exactly one physical outbound HTTP request to a Nansen profiler endpoint.",
  "A retry is a distinct physical request and receives its own record with an incremented attempt_number, sharing the correlation_id of the original attempt.",
  "Cache hits, validation failures occurring before the request, demo/mock responses, page loads, database reads, verdict rendering, and receipt generation produce zero records.",
  "data_mode is always 'live' — a record exists only when a real provider request physically occurred.",
  "No historical backfill: existing WalletTrial records cannot prove how many physical requests occurred and are not counted. Only records created after instrumentation count toward the verified total.",
  "Records are append-only and written server-side with the service role; public/client-side entity operations are blocked by row-level security.",
  "Telemetry persistence failure does not change the wallet verdict and does not create a record; the verified count stays conservative.",
  "Forbidden data is never stored: full or normalized wallet addresses, API keys, authorization headers, request/response bodies, query-string wallet values, user/owner IDs, IP addresses, cookies, management tokens, and raw evidence.",
  "The sha256_digest is an integrity checksum over the canonical (sorted-key) JSON of the exported snapshot, excluding the digest field itself. It is NOT a digital signature and does not prove that Nansen independently verified the calls."
  ];

export interface ProofPayload {
  application: string;
  generated_at: string;
  verified_tracking_start: string | null;
  contest_target: number;
  total_tracked_physical_requests: number;
  successful: number;
  failed: number;
  rate_limited: number;
  timeouts_or_network: number;
  utc_daily_totals: Record<string, number>;
  endpoint_breakdown: Record<string, number>;
  network_breakdown: Record<string, number>;
  workflow_breakdown: Record<string, number>;
  status_breakdown: Record<string, number>;
  average_latency_ms: number | null;
  average_calls_per_case: number;
  estimated_cases_to_target: number;
  audit_rows: Record<string, any>[];
  methodology: string[];
  no_historical_backfill: boolean;
  sha256_digest: string;
}

// SHA-256 digest using runtime-native Web Crypto (crypto.subtle). Available in
// Node 18+, Deno, and browsers. Returns lowercase hexadecimal. This is an
// integrity checksum for the exported snapshot — NOT a digital signature and
// NOT proof that Nansen independently verified the calls.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const subtle = (typeof crypto !== "undefined" && crypto.subtle)
    ? crypto.subtle
    : (globalThis as any).crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 unavailable: crypto.subtle not found in runtime.");
  const buf = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: any): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

// Compute the SHA-256 integrity digest over the canonical JSON of the proof
// payload, excluding the sha256_digest field itself. The caller passes the
// payload without the digest; this function returns the digest to attach.
export async function computeProofDigest(payload: Omit<ProofPayload, "sha256_digest">): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

export async function buildProofPayload(args: {
  records: AuditRecordLike[];
  generatedAt?: string;
  target?: number;
  now?: () => Date;
}): Promise<ProofPayload> {
  const generatedAt = args.generatedAt || (args.now ? args.now() : new Date()).toISOString();
  const stats = aggregateStats(args.records, { target: args.target, now: args.now });
  const auditRows = args.records.map(sanitizeAuditRowForExport);
  const partial: Omit<ProofPayload, "sha256_digest"> = {
    application: "Wallet Court",
    generated_at: generatedAt,
    verified_tracking_start: stats.tracking_start,
    contest_target: stats.target,
    total_tracked_physical_requests: stats.verified_total,
    successful: stats.successful,
    failed: stats.failed,
    rate_limited: stats.rate_limited,
    timeouts_or_network: stats.timeouts_or_network,
    utc_daily_totals: stats.by_utc_day,
    endpoint_breakdown: stats.by_endpoint,
    network_breakdown: stats.by_network,
    workflow_breakdown: stats.by_workflow,
    status_breakdown: stats.by_status,
    average_latency_ms: stats.average_latency_ms,
    average_calls_per_case: stats.average_calls_per_case,
    estimated_cases_to_target: stats.estimated_cases_to_target,
    audit_rows: auditRows,
    methodology: PROOF_METHODOLOGY,
    no_historical_backfill: true
  };
  const sha256_digest = await computeProofDigest(partial);
  return { ...partial, sha256_digest };
}

// CSV exporter. Header row + one sanitized row per audit record. Totals are
// not embedded in the CSV body (they live in the JSON export); the CSV is the
// row-level evidence. A final comment-free structure keeps it machine-parseable.
export function proofToCsv(records: AuditRecordLike[]): string {
  const rows = records.map(sanitizeAuditRowForExport);
  const columns = [
    "call_id", "occurred_at", "endpoint_key", "workflow", "network",
    "case_slug", "correlation_id", "attempt_number", "response_status",
    "outcome", "latency_ms", "environment", "data_mode",
    "provider_request_id", "credits_consumed", "telemetry_version"
  ];
  const escape = (v: any): string => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [columns.join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => escape(r[c])).join(","));
  }
  return lines.join("\n");
}

export function proofFilename(dateIso: string, ext: "json" | "csv"): string {
  const day = (dateIso || new Date().toISOString()).slice(0, 10);
  return `wallet-court-nansen-call-proof-${day}.${ext}`;
}