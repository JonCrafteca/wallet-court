// Wallet Court — live Nansen evidence pipeline. Server-side only (imported by
// analyzeWalletWithNansen). The API key is passed in by the caller (which reads
// it from the secret store); this module never logs, serializes, or returns it.
// All Nansen responses are normalized defensively: missing fields are omitted,
// never invented and never treated as zero.
import { waitUntil } from "base44:runtime";
import { fmtPctSigned, fmtPctPlain, fmtUsd, fmtInt, totalTradesEvidence, sampleEvidence, avgTokenAge } from "./format.ts";
import { normalizeWalletClass } from "./walletClass.ts";
// assessRecess is pure pipeline-level recess logic, extracted into its own
// module so it is unit-testable without the platform runtime. Re-exported here
// for backward compatibility with existing importers (analyzeWalletWithNansen).
export { assessRecess } from "./recessAssessment.ts";

// Contest Control telemetry: the single instrumented transport for outbound
// Nansen requests. Every physical HTTP attempt routes through
// callEndpointWithRetry → callNansenWithTelemetry, which writes one
// NansenApiCallAudit record per attempt. No raw fetch() to Nansen exists
// outside this wiring.
import {
  callEndpointWithRetry,
  detectEnvironment,
  newCorrelationId
} from "./nansenTelemetry.ts";

export const NANSEN_BASE = "https://api.nansen.ai";

// The four current Nansen profiler POST endpoints. required endpoints must both
// succeed for a case to be labeled live; optional failures keep live mode but
// mark the case partial.
// The four automatic performance endpoints. Address Labels is deliberately
// excluded — it costs 100 credits per call and is NEVER called automatically.
export const NANSEN_ENDPOINTS = [
  { key: "pnl_summary", path: "/api/v1/profiler/address/pnl-summary", required: true, needsDateRange: true, dateFmt: "datetime", paginated: false },
  { key: "dex_trades", path: "/api/v1/profiler/dex-trades", required: true, needsDateRange: true, dateFmt: "date", paginated: true },
  { key: "current_balance", path: "/api/v1/profiler/address/current-balance", required: false, needsDateRange: false, dateFmt: null, paginated: true },
  { key: "transactions", path: "/api/v1/profiler/address/transactions", required: false, needsDateRange: true, dateFmt: "datetime", paginated: true }
];

// Credit-cost constants and the core endpoint-key list live in ./labelPlan.ts
// (pure, unit-tested) to keep them importable without the platform runtime.

// The Address Labels endpoint, isolated from the automatic pipeline. Used only
// by the admin label-only backfill (enrichCasesWithLabels).
export const LABELS_EP = { key: "address_labels", path: "/api/v1/profiler/address/labels", required: false, needsDateRange: false, dateFmt: null, paginated: true };

// Fetch Address Labels for a single wallet (admin-triggered only). Returns the
// safe wallet class, raw labels, and the call result (for usage logging). Never
// called by fetchNansenEvidence or any automatic path.
export async function fetchAddressLabels(apiKey, network, address, timeoutMs = 20000, telemetryCtx) {
  const chain = CHAIN_BY_NETWORK[network];
  const r = await callEndpoint(apiKey, LABELS_EP, { address, chain, pagination: { page: 1, per_page: 1000 } }, timeoutMs, telemetryCtx);
  r.chain = chain;
  if (!r.ok) return { ok: false, walletClass: "unknown", rawLabels: [], callResult: r };
  const data = (r.json && (r.json.data || r.json.labels)) || [];
  const rawLabels = Array.isArray(data) ? data : [];
  const walletClass = normalizeWalletClass(rawLabels);
  return { ok: true, walletClass, rawLabels, callResult: r };
}

export const CHAIN_BY_NETWORK = { ethereum: "ethereum", base: "base", solana: "solana" };

export const ERR = {
  MISSING_KEY: "missing_key",
  AUTH: "auth",
  PLAN_CREDIT: "plan_credit",
  RATE_LIMIT: "rate_limit",
  TIMEOUT: "timeout",
  MALFORMED: "malformed",
  UNSUPPORTED_CHAIN: "unsupported_chain",
  NETWORK: "network",
  UNKNOWN: "unknown"
};

// Categories that should halt a corpus run immediately.
export const STOP_CATEGORIES = new Set([ERR.MISSING_KEY, ERR.AUTH, ERR.PLAN_CREDIT]);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Header parsing, retry-after parsing, and status categorization now live in
// ./nansenTelemetry.ts (pure, unit-tested) and are imported below.

// Call one endpoint with up to 2 attempts, honoring Retry-After on 429.
//
// Delegates the retry loop to callEndpointWithRetry (pure, unit-tested). Each
// physical HTTP attempt is routed through callNansenWithTelemetry, which
// writes exactly one NansenApiCallAudit record per attempt (a retry is a
// distinct physical request → its own record + attempt_number, sharing the
// correlation_id). When telemetryCtx is omitted, no audit record is written.
// The return shape is preserved exactly so verdict behavior is unchanged.
export async function callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx) {
  const url = NANSEN_BASE + ep.path;
  return callEndpointWithRetry({
    url,
    ep,
    apiKey,
    body,
    timeoutMs,
    telemetryCtx: telemetryCtx || {
      workflow: "unknown",
      network: "unknown",
      caseSlug: null,
      correlationId: "corr_unknown",
      environment: detectEnvironment()
    },
    persistAudit: telemetryCtx ? telemetryCtx.persistAudit : undefined
  });
}

// Run tasks with a bounded concurrency limit, preserving input order.
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const my = idx++;
      results[my] = await tasks[my]();
    }
  });
  await Promise.all(workers);
  return results;
}

export function logUsage(base44, caseSlug, outcome, calls) {
  for (const c of calls) {
    const rec = {
      endpoint: c.key,
      chain: c.chain,
      request_status: c.ok ? "success" : "failed",
      http_status: c.status,
      nansen_request_id: c.requestId,
      credits_cost: c.creditsCost,
      credits_used: c.creditsUsed,
      credits_remaining: c.creditsRemaining,
      rate_limit_remaining: c.rateLimitRemaining,
      called_at: c.calledAt,
      case_slug: caseSlug,
      outcome,
      error_category: c.errorCategory
    };
    waitUntil(base44.asServiceRole.entities.NansenApiUsage.create(rec).catch(() => {}));
  }
}

// Defensive field picker: matches the first key (case-insensitive) across the
// top level and a few common nested wrappers. Returns undefined when absent.
function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  const flat = { ...obj, ...(obj.data || {}), ...(obj.result || {}), ...(obj.payload || {}), ...(obj.summary || {}) };
  const lower = Object.keys(flat).map((k) => [k, k.toLowerCase()]);
  for (const want of keys) {
    const w = want.toLowerCase();
    for (const [k, lk] of lower) {
      if (lk === w) return flat[k];
    }
  }
  return undefined;
}

function pickArr(obj, keys) {
  const v = pick(obj, keys);
  return Array.isArray(v) ? v : undefined;
}

// Display + sample/total helpers live in ./format (pure, unit-tested).

function mapEvidence(calls, windowDays) {
  const pnl = calls.pnl_summary?.ok ? calls.pnl_summary.json : null;
  const dex = calls.dex_trades?.ok ? calls.dex_trades.json : null;
  const bal = calls.current_balance?.ok ? calls.current_balance.json : null;
  const tx = calls.transactions?.ok ? calls.transactions.json : null;

  const metrics = {};
  const evidence = [];

  // ---- PnL summary (totals over the evidence window) ----
  // Ratios are preserved raw internally; ×100 formatting happens in the display
  // helpers and the frontend metric formatter.
  const realizedPct = num(pick(pnl, ["realized_pnl_percent", "realizedPnlPercent", "pnl_percent"]));
  const realizedUsd = num(pick(pnl, ["realized_pnl_usd", "realizedPnlUsd", "realized_pnl_abs_usd"]));
  const winRate = num(pick(pnl, ["win_rate", "winRate", "win_rate_pct"]));
  const tradedTokenCount = num(pick(pnl, ["traded_token_count", "tradedTokenCount", "tokens_traded", "unique_tokens"]));
  const tradedTimes = num(pick(pnl, ["traded_times", "tradedTimes", "total_trades", "trade_count"]));
  const top5 = pickArr(pnl, ["top5_tokens", "top5Tokens", "top_5_tokens"]);

  if (realizedPct !== null) metrics.realized_pnl_pct = realizedPct;
  if (realizedUsd !== null) metrics.realized_pnl_abs_usd = realizedUsd;
  if (winRate !== null) metrics.win_rate_pct = winRate;
  if (tradedTokenCount !== null) metrics.tokens_traded = tradedTokenCount;
  if (tradedTimes !== null) metrics.total_trades = tradedTimes;

  if (realizedPct !== null) evidence.push({ tag: "NANSEN · PNL", label: "Realized PnL", value: fmtPctSigned(realizedPct), detail: "Realized profit/loss over the evidence window." });
  else if (realizedUsd !== null) evidence.push({ tag: "NANSEN · PNL", label: "Realized PnL", value: fmtUsd(realizedUsd), detail: "Realized profit/loss over the evidence window." });
  if (winRate !== null) evidence.push({ tag: "NANSEN · PNL", label: "Win Rate", value: fmtPctPlain(winRate), detail: "Share of sales closed above cost basis." });
  if (tradedTimes !== null) evidence.push(totalTradesEvidence(tradedTimes));
  if (tradedTokenCount !== null) evidence.push({ tag: "NANSEN · PNL", label: "Tokens Traded", value: fmtInt(tradedTokenCount), detail: "Distinct tokens bought or sold during the window." });
  if (Array.isArray(top5) && top5.length) {
    const wins = top5.filter((t) => num(t.realized_pnl ?? t.realizedPnl) > 0).length;
    const losses = top5.filter((t) => num(t.realized_pnl ?? t.realizedPnl) < 0).length;
    metrics.top5_wins = wins; metrics.top5_losses = losses;
    evidence.push({ tag: "NANSEN · PNL", label: "Top-5 Token PnL", value: `${fmtInt(wins)} wins / ${fmtInt(losses)} losses`, detail: "Profitable vs unprofitable among the top 5 tokens by realized profit." });
  }

  // ---- DEX trades (paginated SAMPLE — first 100 records, not complete history) ----
  const dexData = pickArr(dex, ["data", "trades"]);
  if (Array.isArray(dexData)) {
    metrics.dex_trade_count = dexData.length;
    evidence.push(sampleEvidence("NANSEN · DEX", "Recent DEX Trades", dexData.length, "on-chain swaps"));
    const age = avgTokenAge(dexData);
    if (age) {
      metrics.avg_token_bought_age_days = age.avg;
      metrics.avg_token_bought_age_sample = age.validCount;
      evidence.push({ tag: "NANSEN · DEX", label: "Avg Token Age at Buy", value: `${fmtInt(age.avg)} days`, detail: `Derived average token age at purchase — Wallet Court derived from Nansen evidence. Based on ${fmtInt(age.validCount)} valid trades from the recent DEX sample.` });
    }
    const vals = dexData.map((d) => num(d.trade_value_usd ?? d.tradeValueUsd)).filter((x) => x !== null);
    if (vals.length) { const avg = vals.reduce((a, b) => a + b, 0) / vals.length; metrics.avg_trade_value_usd = avg; evidence.push({ tag: "NANSEN · DEX", label: "Avg Trade Size", value: fmtUsd(avg), detail: "Mean swap value in USD (sample)." }); }
  }

  // ---- Current balance (point-in-time SNAPSHOT, no date range) ----
  const balData = pickArr(bal, ["data", "balances", "tokenBalances"]);
  if (Array.isArray(balData)) {
    metrics.token_balance_count = balData.length;
    evidence.push({ tag: "NANSEN · BALANCE", label: "Token Balances", value: fmtInt(balData.length), detail: "Distinct tokens currently held (Nansen point-in-time snapshot)." });
    const vals = balData.map((d) => num(d.value_usd ?? d.valueUsd)).filter((x) => x !== null);
    if (vals.length) { const total = vals.reduce((a, b) => a + b, 0); metrics.portfolio_value_usd = total; evidence.push({ tag: "NANSEN · BALANCE", label: "Current Portfolio Value", value: fmtUsd(total), detail: "Sum of token USD values across returned holdings (Nansen current snapshot)." }); }
  }

  // ---- Transactions (paginated SAMPLE — first 100 records, not complete history) ----
  const txData = pickArr(tx, ["data", "transactions"]);
  if (Array.isArray(txData)) {
    metrics.transaction_count = txData.length;
    evidence.push(sampleEvidence("NANSEN · TX", "Recent Transactions", txData.length, "transactions"));
    if (windowDays > 0) { const freq = txData.length / windowDays; metrics.tx_frequency_per_day = freq; evidence.push({ tag: "NANSEN · TX", label: "Transaction Frequency", value: `${freq.toFixed(2)}/day`, detail: "Average transactions per day across the examined sample." }); }
    const vols = txData.map((d) => num(d.volume_usd ?? d.volumeUsd)).filter((x) => x !== null);
    if (vols.length) { const avg = vols.reduce((a, b) => a + b, 0) / vols.length; metrics.avg_tx_volume_usd = avg; evidence.push({ tag: "NANSEN · TX", label: "Avg Tx Volume", value: fmtUsd(avg), detail: "Mean transaction volume in USD (sample)." }); }
  }

  return { metrics, evidence };
}

// Orchestrates the four-endpoint pipeline for one wallet. Returns normalized
// evidence + an honest outcome (live | partial | demo) + a sanitized error
// category. Logs one sanitized NansenApiUsage record per call (via waitUntil).
export async function fetchNansenEvidence(apiKey, network, address, opts) {
  const { windowDays = 180, caseSlug = "", base44, timeoutMs = 20000 } = opts || {};

  if (!apiKey || !apiKey.trim()) {
    return { outcome: "demo", errorCategory: ERR.MISSING_KEY, partial: false, failedSources: NANSEN_ENDPOINTS.map((e) => e.key), evidence: [], metrics: {}, sources: [], meta: null, nansenCalls: 0 };
  }
  const chain = CHAIN_BY_NETWORK[network];
  if (!chain) {
    return { outcome: "demo", errorCategory: ERR.UNSUPPORTED_CHAIN, partial: false, failedSources: NANSEN_ENDPOINTS.map((e) => e.key), evidence: [], metrics: {}, sources: [], meta: null, nansenCalls: 0 };
  }

  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86400000);
  const dateFromIso = from.toISOString();
  const dateToIso = to.toISOString();
  const dateFromDay = dateFromIso.slice(0, 10);
  const dateToDay = dateToIso.slice(0, 10);

  // One correlation_id groups all physical attempts for this analysis. Retries
  // share it; each attempt gets its own NansenApiCallAudit record.
  const correlationId = newCorrelationId();
  const telemetryCtx = {
    workflow: "trial_analysis",
    network,
    caseSlug: caseSlug || null,
    correlationId,
    environment: detectEnvironment(),
    persistAudit: base44
      ? (rec) => waitUntil(
          base44.asServiceRole.entities.NansenApiCallAudit.create(rec).catch((e) =>
            console.error("[nansen-telemetry] audit write failed:", e?.message)
          )
        )
      : undefined
  };

  const tasks = NANSEN_ENDPOINTS.map((ep) => async () => {
    const body = { address, chain };
    if (ep.needsDateRange) {
      body.date = ep.dateFmt === "date"
        ? { from: dateFromDay, to: dateToDay }
        : { from: dateFromIso, to: dateToIso };
    }
    if (ep.paginated) body.pagination = { page: 1, per_page: ep.key === "current_balance" ? 1000 : 100 };
    if (ep.key === "current_balance" || ep.key === "transactions") body.hide_spam_token = true;
    const r = await callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx);
    r.chain = chain;
    return r;
  });

  const results = await runPool(tasks, 2);
  const calls = {};
  for (const r of results) calls[r.key] = r;

  const requiredOk = !!calls.pnl_summary?.ok && !!calls.dex_trades?.ok;
  const PERF_KEYS = ["pnl_summary", "dex_trades", "current_balance", "transactions"];
  const failedSources = PERF_KEYS.filter((k) => !calls[k]?.ok);
  const optionalFailed = ["current_balance", "transactions"].some((k) => !calls[k]?.ok);
  // Per-call failure details for the circuit-breaker recess assessment (N2.4).
  const failedCalls = PERF_KEYS
    .filter((k) => !calls[k]?.ok)
    .map((k) => ({
      key: k,
      errorCategory: calls[k]?.errorCategory || ERR.UNKNOWN,
      status: calls[k]?.status ?? 0,
      requestId: calls[k]?.requestId || null
    }));

  let outcome;
  if (!requiredOk) outcome = "demo";
  else if (optionalFailed) outcome = "partial";
  else outcome = "live";

  const sources = NANSEN_ENDPOINTS.map((e) => `nansen:${e.key}:${calls[e.key]?.ok ? "live" : "unavailable"}`);

  // Address Labels are NEVER called automatically (100 credits each, item N2.1).
  // A wallet without admin-enriched labels stays "unknown" and uses retail/
  // unknown verdict logic. The case remains live if core evidence succeeded.
  // The Wallet Class evidence card is added only by the label-enrichment
  // backfill, not by the automatic pipeline.
  const walletClass = "unknown";
  const rawLabels = [];

  let evidence = [];
  let metrics = {};
  if (requiredOk) {
    const mapped = mapEvidence(calls, windowDays);
    evidence = mapped.evidence;
    metrics = mapped.metrics;
  }

  const meta = {
    partial: outcome === "partial",
    failed_sources: failedSources,
    window_days: windowDays,
    evidence_date_range: { from: dateFromIso, to: dateToIso },
    freshness: to.toISOString(),
    snapshot_note: "Current balance is a point-in-time snapshot with no date range.",
    labels_ok: false,
    wallet_class: walletClass
  };

  logUsage(base44, caseSlug, outcome, Object.values(calls));

  return {
    outcome,
    errorCategory: requiredOk ? null : (calls.pnl_summary?.errorCategory || calls.dex_trades?.errorCategory || ERR.UNKNOWN),
    partial: outcome === "partial",
    failedSources,
    failedCalls,
    evidence,
    metrics,
    sources,
    meta,
    walletClass,
    rawLabels,
    nansenCalls: NANSEN_ENDPOINTS.length
  };
}

// assessRecess now lives in ./recessAssessment.ts (pure, unit-testable) and is
// re-exported above. The blocking rules are documented there.