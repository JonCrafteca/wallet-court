// Wallet Court — live Nansen evidence pipeline. Server-side only (imported by
// analyzeWalletWithNansen). The API key is passed in by the caller (which reads
// it from the secret store); this module never logs, serializes, or returns it.
// All Nansen responses are normalized defensively: missing fields are omitted,
// never invented and never treated as zero.
import { waitUntil, secrets } from "base44:runtime";
import { fmtPctSigned, fmtPctPlain, fmtUsd, fmtInt, totalTradesEvidence, sampleEvidence, avgTokenAge } from "./format.ts";

// Shared server-side Nansen API key resolution. Every backend function that
// needs the key MUST call this helper — never access `secrets` directly. This
// guarantees one consistent credential path and prevents the property-access
// vs. .get() mistake that broke Candidate Discovery. The key is never logged,
// returned, stored on an entity, or included in telemetry.
export function getNansenApiKey(): string | null {
  const key = secrets.get("NANSEN_API_KEY");
  if (!key || !key.trim()) return null;
  return key;
}
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
import { persistWithRetry, buildTelemetryWarning } from "./telemetryRetry.ts";
import { checkCeilingBudget, checkCeilingBudgetWithLimit, CALIBRATION_CEILING } from "./calibration.ts";
import { getVerifiedTotal } from "./calibrationStore.ts";

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

// The Smart Money PnL Leaderboard endpoint, used only by admin Candidate
// Discovery (calibration_discovery workflow). Does NOT require a token address.
// Supports ethereum, base, solana, and robinhood. Returns ranked wallets by PnL
// over a selectable timeframe (1, 7, 30, 90, 180 days).
export const DISCOVERY_EP = { key: "pnl_leaderboard", path: "/api/v1/smart-money/pnl-leaderboard" };

// The Token OHLCV endpoint, used by Single Trade Trial. Returns historical
// OHLCV candles WITH market cap (open/high/low/close) for one token over a
// date range at a selectable timeframe (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M).
// Supports solana and all other Nansen chains. History goes back to the first
// price Nansen recorded for the token.
export const TOKEN_OHLCV_EP = { key: "token_ohlcv", path: "/api/v1/tgm/token-ohlcv", paginated: false };

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

// Canonical chain → Nansen-chain mapping is centralized in ./chains.ts.
import { CHAIN_BY_NETWORK, computeCoverageWindow } from "./chains.ts";
export { CHAIN_BY_NETWORK };

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
export async function callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx, budgetGuard) {
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
    persistAudit: telemetryCtx ? telemetryCtx.persistAudit : undefined,
    budgetGuard
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

// Exactly-once audit persistence: checks for an existing call_id before
// creating, preventing duplicate rows when the first create succeeded but its
// response threw or timed out. Duplicate-key errors are treated as success.
// This function is server-side only (uses asServiceRole); never exported.
async function persistAuditRecord(base44, rec) {
  const existing = await base44.asServiceRole.entities.NansenApiCallAudit.filter(
    { call_id: rec.call_id }, "-occurred_at", 1
  );
  if (existing && existing.length > 0) {
    return; // already persisted — treat as success, do not create another row
  }
  try {
    await base44.asServiceRole.entities.NansenApiCallAudit.create(rec);
  } catch (e) {
    const msg = (e?.message || "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("e11000")) {
      return; // duplicate key = another attempt already persisted this call_id
    }
    throw e;
  }
}

// Build a telemetry context with the global ceiling budget guard + audit
// persistence. Used by Single Trade Trial functions (and reusable by any future
// Nansen-calling function). Returns { telemetryCtx, budgetGuard, correlationId,
// getPhysicalCallCount }. The ceiling guard blocks at CALIBRATION_CEILING (1,020).
export function buildTelemetryContext(base44, opts) {
  const { workflow, network, caseSlug, durableTelemetry = false } = opts || {};
  const correlationId = newCorrelationId();
  let physicalCallCount = 0;

  const budgetGuard = base44
    ? async () => {
        try {
          const total = await getVerifiedTotal(base44);
          const budget = checkCeilingBudgetWithLimit(total, CALIBRATION_CEILING);
          if (!budget.allowed) return { allowed: false, verifiedTotal: total, reason: budget.reason };
        } catch {}
        return { allowed: true, verifiedTotal: 0, reason: "" };
      }
    : undefined;

  const telemetryCtx = {
    workflow,
    network,
    caseSlug: caseSlug || null,
    correlationId,
    environment: detectEnvironment(),
    persistAudit: base44
      ? (rec) => {
          physicalCallCount++;
          const persistPromise = (async () => {
            const outcome = await persistWithRetry(rec, (r) => persistAuditRecord(base44, r));
            if (!outcome.succeeded) {
              console.error("[nansen-telemetry] audit persist failed:", outcome.finalError);
            }
          })();
          if (durableTelemetry) return persistPromise;
          waitUntil(persistPromise);
        }
      : undefined
  };

  return { telemetryCtx, budgetGuard, correlationId, getPhysicalCallCount: () => physicalCallCount };
}

// Build a telemetry context for Single Trade Trial that uses the SEPARATE
// Single Trade usage policy budget guard instead of the legacy 1,020
// calibration ceiling. Physical calls still write NansenApiCallAudit records
// (the audit is shared), but the budget is governed by the Single Trade
// daily limit, NOT by checkCeilingBudget or getVerifiedTotal.
//
// The budget guard calls reservePhysicalCall BEFORE each physical request.
// If the daily limit is reached or emergency stop is active, the request is
// blocked. The counter is incremented atomically via CAS — if the CAS fails
// (concurrent reservation), the request is blocked (conservative).
export function buildSingleTradeTelemetryContext(base44, opts) {
  const { workflow, network, caseSlug } = opts || {};
  const correlationId = newCorrelationId();
  let physicalCallCount = 0;

  const budgetGuard = base44
    ? async () => {
        try {
          const { reservePhysicalCall } = await import("./singleTradeUsageStore.ts");
          const reservation = await reservePhysicalCall(base44);
          if (!reservation.allowed) {
            return { allowed: false, verifiedTotal: 0, reason: reservation.reason };
          }
        } catch (e) {
          // If the usage store fails, be conservative and block the request.
          return { allowed: false, verifiedTotal: 0, reason: "Usage policy check failed." };
        }
        return { allowed: true, verifiedTotal: 0, reason: "" };
      }
    : undefined;

  const telemetryCtx = {
    workflow: workflow || "single_trade_analysis",
    network,
    caseSlug: caseSlug || null,
    correlationId,
    environment: detectEnvironment(),
    persistAudit: base44
      ? (rec) => {
          physicalCallCount++;
          const persistPromise = (async () => {
            const outcome = await persistWithRetry(rec, (r) => persistAuditRecord(base44, r));
            if (!outcome.succeeded) {
              console.error("[nansen-telemetry] single-trade audit persist failed:", outcome.finalError);
            }
          })();
          waitUntil(persistPromise);
        }
      : undefined
  };

  return { telemetryCtx, budgetGuard, correlationId, getPhysicalCallCount: () => physicalCallCount };
}

// Orchestrates the four-endpoint pipeline for one wallet. Returns normalized
// evidence + an honest outcome (live | partial | demo) + a sanitized error
// category. Logs one sanitized NansenApiUsage record per call (via waitUntil).
// When durableTelemetry is true (campaign traffic), audit persistence is
// awaited before returning so the campaign cannot advance until telemetry
// health is confirmed.
export async function fetchNansenEvidence(apiKey, network, address, opts) {
  const { windowDays = 180, caseSlug = "", base44, timeoutMs = 20000, durableTelemetry = false, extraBudgetGuard = null, onPhysicalCall = null, ceilingException = null } = opts || {};

  if (!apiKey || !apiKey.trim()) {
    return { outcome: "demo", errorCategory: ERR.MISSING_KEY, partial: false, failedSources: NANSEN_ENDPOINTS.map((e) => e.key), evidence: [], metrics: {}, sources: [], meta: null, nansenCalls: 0 };
  }
  const chain = CHAIN_BY_NETWORK[network];
  if (!chain) {
    return { outcome: "demo", errorCategory: ERR.UNSUPPORTED_CHAIN, partial: false, failedSources: NANSEN_ENDPOINTS.map((e) => e.key), evidence: [], metrics: {}, sources: [], meta: null, nansenCalls: 0 };
  }

  // Coverage-start clamp: for chains with a known Nansen coverage start date
  // (e.g. Robinhood, 2026-04-30), never request data earlier than that date.
  // Uses the pure computeCoverageWindow helper (extracted for unit testing).
  const coverageWindow = computeCoverageWindow(network, windowDays);
  const from = coverageWindow.from;
  const to = coverageWindow.to;
  const effectiveWindowDays = coverageWindow.effectiveWindowDays;
  const coverage_limited = coverageWindow.coverage_limited;
  const dateFromIso = from.toISOString();
  const dateToIso = to.toISOString();
  const dateFromDay = dateFromIso.slice(0, 10);
  const dateToDay = dateToIso.slice(0, 10);

  // One correlation_id groups all physical attempts for this analysis. Retries
  // share it; each attempt gets its own NansenApiCallAudit record.
  const correlationId = newCorrelationId();

  // Authoritative physical-call counter. Incremented once per persistAudit
  // invocation, which corresponds to exactly one callNansenWithTelemetry call,
  // which is exactly one physical outbound HTTP attempt (including 429/network
  // retries). This count is returned to the caller as physical_calls_made,
  // replacing the callsAfter - callsBefore delta which can be skewed by
  // concurrent audit writes from other workflows landing in the gap between
  // wallets.
  let physicalCallCount = 0;

  // Per-physical-attempt ceiling guard. Injected into the transport so every
  // physical request checks the verified total before leaving the process.
  // This is the last line of defense: even if the campaign-level check passed,
  // a concurrent request from another workflow could have pushed the total to
  // the ceiling between the campaign check and this physical attempt.
  // Per-physical-attempt ceiling guard. Uses checkCeilingBudget (blocks only at
  // 1,020), NOT checkBudget (which blocks at 1,000). This allows a wallet
  // already in progress to finish its remaining physical requests even after
  // the verified total crosses 1,000, as long as it stays below 1,020. New
  // wallets are blocked at 1,000 by the campaign-level shouldCampaignContinue
  // check, not by this per-attempt guard.
  const budgetGuard = base44
    ? async () => {
        // 1. Global ceiling check. Uses the legacy 1,020 ceiling for all ordinary
        //    traffic. When ceilingException is present (authenticated
        //    robinhood_validation context only), uses the per-validation ceiling
        //    of (starting_global_total + max_attempts) instead, allowing the
        //    Robinhood validation to exceed 1,020 up to a maximum of 1,022.
        try {
          const total = await getVerifiedTotal(base44);
          const ceilingLimit = ceilingException?.maxTotal ?? CALIBRATION_CEILING;
          const budget = checkCeilingBudgetWithLimit(total, ceilingLimit);
          if (!budget.allowed) {
            return { allowed: false, verifiedTotal: total, reason: budget.reason };
          }
        } catch {
          // Guard check failed — be conservative and allow the request. The
          // audit record will still be written and the next attempt re-checks.
        }
        // 2. Extra budget guard (e.g. Robinhood 21-attempt allowance).
        //    Composed after the global ceiling so both limits are enforced.
        if (extraBudgetGuard) {
          try {
            const extra = await extraBudgetGuard();
            if (!extra.allowed) {
              return extra;
            }
          } catch {
            // Extra guard failed — be conservative and allow the request.
          }
        }
        return { allowed: true, verifiedTotal: 0, reason: "" };
      }
    : undefined;

  const telemetryCtx = {
    workflow: "trial_analysis",
    network,
    caseSlug: caseSlug || null,
    correlationId,
    environment: detectEnvironment(),
    persistAudit: base44
      ? (rec) => {
          physicalCallCount++;
          if (typeof onPhysicalCall === "function") {
            try { onPhysicalCall(physicalCallCount); } catch {}
          }
          const persistPromise = (async () => {
            const outcome = await persistWithRetry(rec, (r) => persistAuditRecord(base44, r));
            if (!outcome.succeeded) {
              console.error("[nansen-telemetry] audit persist failed after retries:", outcome.finalError);
              // Mark telemetry unhealthy so the campaign halts with a visible warning.
              try {
                const { markTelemetryUnhealthy } = await import("./calibrationStore.ts");
                await markTelemetryUnhealthy(base44, buildTelemetryWarning(outcome));
              } catch (e) {
                console.error("[nansen-telemetry] failed to mark telemetry unhealthy:", e?.message);
              }
            }
          })();
          if (durableTelemetry) {
            // Durable: return the Promise so callNansenWithTelemetry awaits it.
            // The campaign cannot advance until persistence settles.
            return persistPromise;
          }
          // Non-durable: fire and forget with waitUntil (public visitor traffic).
          waitUntil(persistPromise);
        }
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
    const r = await callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx, budgetGuard);
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
    const mapped = mapEvidence(calls, effectiveWindowDays);
    evidence = mapped.evidence;
    metrics = mapped.metrics;
  }

  const meta = {
    partial: outcome === "partial",
    failed_sources: failedSources,
    window_days: windowDays,
    effective_window_days: effectiveWindowDays,
    evidence_date_range: { from: dateFromIso, to: dateToIso },
    requested_window_days: windowDays,
    effective_analysis_start: dateFromIso,
    effective_analysis_end: dateToIso,
    coverage_limited,
    coverage_start: coverageWindow.coverage_start,
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
    nansenCalls: NANSEN_ENDPOINTS.length,
    physicalCallCount,
    correlationId
  };
}

// assessRecess now lives in ./recessAssessment.ts (pure, unit-testable) and is
// re-exported above. The blocking rules are documented there.

// ---- Single Trade Trial: token-filtered DEX trades + token OHLCV ----

// Fetch purchases of a specific token by a wallet. Calls the dex-trades
// endpoint with filters.token_bought_address = tokenMint. Returns the raw
// call result (caller normalizes via singleTradeEvidence.normalizePurchases).
// All physical attempts route through the instrumented telemetry transport.
export async function fetchTokenPurchases(apiKey, network, address, tokenMint, opts) {
  const { from, to, timeoutMs = 20000, telemetryCtx, budgetGuard } = opts || {};
  const chain = CHAIN_BY_NETWORK[network];
  if (!chain) return { ok: false, status: 0, errorCategory: ERR.UNSUPPORTED_CHAIN, json: null, requestId: null, key: "dex_trades" };
  const ep = NANSEN_ENDPOINTS.find((e) => e.key === "dex_trades");
  const body = { address, chain };
  if (from && to) {
    body.date = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  body.filters = { token_bought_address: tokenMint };
  body.pagination = { page: 1, per_page: 100 };
  const r = await callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx, budgetGuard);
  r.chain = chain;
  return r;
}

// Fetch sells of a specific token by a wallet (after the entry purchase). Calls
// dex-trades with filters.token_sold_address = tokenMint.
export async function fetchTokenSells(apiKey, network, address, tokenMint, opts) {
  const { from, to, timeoutMs = 20000, telemetryCtx, budgetGuard } = opts || {};
  const chain = CHAIN_BY_NETWORK[network];
  if (!chain) return { ok: false, status: 0, errorCategory: ERR.UNSUPPORTED_CHAIN, json: null, requestId: null, key: "dex_trades" };
  const ep = NANSEN_ENDPOINTS.find((e) => e.key === "dex_trades");
  const body = { address, chain };
  if (from && to) {
    body.date = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  body.filters = { token_sold_address: tokenMint };
  body.pagination = { page: 1, per_page: 100 };
  const r = await callEndpoint(apiKey, ep, body, timeoutMs, telemetryCtx, budgetGuard);
  r.chain = chain;
  return r;
}

// Fetch historical OHLCV candles (with market cap) for one token. Calls the
// token-ohlcv endpoint. timeframe: "1m"|"5m"|"15m"|"30m"|"1h"|"4h"|"1d"|"1w"|"1M".
// Returns the raw call result (caller normalizes via singleTradeEvidence.extractCandles).
export async function fetchTokenOhlcv(apiKey, network, tokenMint, opts) {
  const { from, to, timeframe = "1h", timeoutMs = 20000, telemetryCtx, budgetGuard } = opts || {};
  const chain = CHAIN_BY_NETWORK[network];
  if (!chain) return { ok: false, status: 0, errorCategory: ERR.UNSUPPORTED_CHAIN, json: null, requestId: null, key: "token_ohlcv" };
  const body = {
    chain,
    token_address: tokenMint,
    date: { from: from.toISOString(), to: to.toISOString() },
    timeframe
  };
  const r = await callEndpoint(apiKey, TOKEN_OHLCV_EP, body, timeoutMs, telemetryCtx, budgetGuard);
  r.chain = chain;
  return r;
}