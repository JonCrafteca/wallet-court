// Wallet Court — live Nansen evidence pipeline. Server-side only (imported by
// analyzeWalletWithNansen). The API key is passed in by the caller (which reads
// it from the secret store); this module never logs, serializes, or returns it.
// All Nansen responses are normalized defensively: missing fields are omitted,
// never invented and never treated as zero.
import { waitUntil } from "base44:runtime";

export const NANSEN_BASE = "https://api.nansen.ai";

// The four current Nansen profiler POST endpoints. required endpoints must both
// succeed for a case to be labeled live; optional failures keep live mode but
// mark the case partial.
export const NANSEN_ENDPOINTS = [
  { key: "pnl_summary", path: "/api/v1/profiler/address/pnl-summary", required: true, needsDateRange: true, dateFmt: "datetime", paginated: false },
  { key: "dex_trades", path: "/api/v1/profiler/dex-trades", required: true, needsDateRange: true, dateFmt: "date", paginated: true },
  { key: "current_balance", path: "/api/v1/profiler/address/current-balance", required: false, needsDateRange: false, dateFmt: null, paginated: true },
  { key: "transactions", path: "/api/v1/profiler/address/transactions", required: false, needsDateRange: true, dateFmt: "datetime", paginated: true }
];

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

function numHeader(h, names) {
  for (const n of names) {
    const v = h.get(n);
    if (v != null && v !== "") {
      const p = parseFloat(v);
      if (Number.isFinite(p)) return p;
    }
  }
  return null;
}

function strHeader(h, names) {
  for (const n of names) {
    const v = h.get(n);
    if (v != null && v !== "") return v;
  }
  return null;
}

function parseRetryAfter(v) {
  if (!v) return 0;
  const s = parseInt(v, 10);
  if (Number.isFinite(s) && s >= 0) return Math.min(s, 30) * 1000;
  const d = Date.parse(v);
  if (Number.isFinite(d)) return Math.max(0, Math.min(30000, d - Date.now()));
  return 0;
}

function categorize(status, err) {
  if (status === 401) return ERR.AUTH;
  if (status === 402 || status === 403) return ERR.PLAN_CREDIT;
  if (status === 429) return ERR.RATE_LIMIT;
  if (status === 0) return err && /timeout|abort/i.test(err.message || "") ? ERR.TIMEOUT : ERR.NETWORK;
  return ERR.UNKNOWN;
}

// Call one endpoint with up to 2 attempts, honoring Retry-After on 429.
async function callEndpoint(apiKey, ep, body, timeoutMs) {
  const url = NANSEN_BASE + ep.path;
  const headers = { apikey: apiKey, "Content-Type": "application/json", Accept: "application/json" };
  const calledAt = new Date().toISOString();
  let attempt = 0;
  let last = null;
  while (attempt < 2) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      return { key: ep.key, ok: false, status: 0, errorCategory: categorize(0, e), calledAt, json: null,
        requestId: null, creditsCost: null, creditsUsed: null, creditsRemaining: null, rateLimitRemaining: null };
    }
    clearTimeout(timer);
    last = res;
    if (res.status === 429 && attempt < 2) {
      const ra = parseRetryAfter(res.headers.get("retry-after"));
      if (ra > 0) await sleep(ra);
      continue;
    }
    let json = null;
    let malformed = false;
    if (res.ok) {
      try { json = await res.json(); } catch { malformed = true; }
    }
    const h = res.headers;
    return {
      key: ep.key,
      ok: res.ok && !malformed,
      status: res.status,
      errorCategory: res.ok ? (malformed ? ERR.MALFORMED : null) : categorize(res.status, null),
      calledAt,
      json,
      requestId: strHeader(h, ["x-request-id", "request-id", "x-correlation-id", "x-nansen-request-id"]),
      creditsCost: numHeader(h, ["x-credits-cost", "x-credit-cost", "credits-cost"]),
      creditsUsed: numHeader(h, ["x-credits-used", "credits-used", "x-credits-spent"]),
      creditsRemaining: numHeader(h, ["x-credits-remaining", "credits-remaining", "x-credits-left"]),
      rateLimitRemaining: strHeader(h, ["x-ratelimit-remaining", "ratelimit-remaining"])
    };
  }
  // Retries exhausted on 429.
  const h = last && last.headers;
  return { key: ep.key, ok: false, status: 429, errorCategory: ERR.RATE_LIMIT, calledAt, json: null,
    requestId: strHeader(h, ["x-request-id", "request-id"]) || null,
    creditsCost: null, creditsUsed: null,
    creditsRemaining: numHeader(h, ["x-credits-remaining", "credits-remaining"]),
    rateLimitRemaining: strHeader(h, ["x-ratelimit-remaining", "retry-after"]) || null };
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

function logUsage(base44, caseSlug, outcome, calls) {
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

function fmtPctSigned(n) {
  if (n === null || n === undefined) return null;
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}
function fmtPctPlain(n) {
  if (n === null || n === undefined) return null;
  return `${n.toFixed(0)}%`;
}
function fmtUsd(n) {
  if (n === null || n === undefined) return null;
  const s = n >= 0 ? "$" : "-$";
  return `${s}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtHold(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (typeof seconds === "string") return seconds;
  const s = Number(seconds);
  if (!Number.isFinite(s)) return null;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) { const m = Math.floor(s / 60); const r = Math.round(s % 60); return `${m}m ${r}s`; }
  if (s < 86400) { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return `${h}h ${m.toString().padStart(2, "0")}m`; }
  const d = Math.floor(s / 86400);
  if (d < 365) return `${d} days`;
  return `${(d / 365).toFixed(1)} years`;
}

function mapEvidence(calls, windowDays) {
  const pnl = calls.pnl_summary?.ok ? calls.pnl_summary.json : null;
  const dex = calls.dex_trades?.ok ? calls.dex_trades.json : null;
  const bal = calls.current_balance?.ok ? calls.current_balance.json : null;
  const tx = calls.transactions?.ok ? calls.transactions.json : null;

  const metrics = {};
  const evidence = [];

  // ---- PnL summary ----
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

  if (realizedPct !== null) evidence.push({ tag: "NANSEN · PNL", label: "Realized PnL", value: fmtPctSigned(realizedPct), detail: "Realized profit/loss over the reviewed window." });
  else if (realizedUsd !== null) evidence.push({ tag: "NANSEN · PNL", label: "Realized PnL", value: fmtUsd(realizedUsd), detail: "Realized profit/loss over the reviewed window." });
  if (winRate !== null) evidence.push({ tag: "NANSEN · PNL", label: "Win Rate", value: fmtPctPlain(winRate), detail: "Share of trades closed in profit." });
  if (tradedTimes !== null) evidence.push({ tag: "NANSEN · PNL", label: "Total Trades", value: String(tradedTimes), detail: "Closed trades recorded by Nansen." });
  if (tradedTokenCount !== null) evidence.push({ tag: "NANSEN · PNL", label: "Tokens Traded", value: String(tradedTokenCount), detail: "Distinct tokens traded in the window." });
  if (Array.isArray(top5) && top5.length) {
    const wins = top5.filter((t) => num(t.realized_pnl ?? t.realizedPnl) > 0).length;
    const losses = top5.filter((t) => num(t.realized_pnl ?? t.realizedPnl) < 0).length;
    metrics.top5_wins = wins; metrics.top5_losses = losses;
    evidence.push({ tag: "NANSEN · PNL", label: "Top-5 Token PnL", value: `${wins}W / ${losses}L`, detail: "Profitable vs unprofitable among the top 5 tokens by activity." });
  }

  // ---- DEX trades (entry behavior) ----
  const dexData = pickArr(dex, ["data", "trades"]);
  if (Array.isArray(dexData)) {
    metrics.dex_trade_count = dexData.length;
    evidence.push({ tag: "NANSEN · DEX", label: "DEX Trades", value: String(dexData.length), detail: "On-chain swaps recorded by Nansen in the window." });
    const ages = dexData.map((d) => num(d.token_bought_age_days ?? d.tokenBoughtAgeDays)).filter((x) => x !== null);
    if (ages.length) { const avg = ages.reduce((a, b) => a + b, 0) / ages.length; metrics.avg_token_bought_age_days = avg; evidence.push({ tag: "NANSEN · DEX", label: "Avg Token Age at Buy", value: `${avg.toFixed(0)} days`, detail: "Average age of tokens when purchased — lower means buying newer tokens." }); }
    const vals = dexData.map((d) => num(d.trade_value_usd ?? d.tradeValueUsd)).filter((x) => x !== null);
    if (vals.length) { const avg = vals.reduce((a, b) => a + b, 0) / vals.length; metrics.avg_trade_value_usd = avg; evidence.push({ tag: "NANSEN · DEX", label: "Avg Trade Size", value: fmtUsd(avg), detail: "Mean swap value in USD." }); }
  }

  // ---- Current balance (point-in-time snapshot) ----
  const balData = pickArr(bal, ["data", "balances", "tokenBalances"]);
  if (Array.isArray(balData)) {
    metrics.token_balance_count = balData.length;
    evidence.push({ tag: "NANSEN · BALANCE", label: "Token Balances", value: String(balData.length), detail: "Distinct tokens currently held." });
    const vals = balData.map((d) => num(d.value_usd ?? d.valueUsd)).filter((x) => x !== null);
    if (vals.length) { const total = vals.reduce((a, b) => a + b, 0); metrics.portfolio_value_usd = total; evidence.push({ tag: "NANSEN · BALANCE", label: "Current Portfolio Value", value: fmtUsd(total), detail: "Sum of token USD values from Nansen's current snapshot." }); }
  }

  // ---- Transactions (frequency) ----
  const txData = pickArr(tx, ["data", "transactions"]);
  if (Array.isArray(txData)) {
    metrics.transaction_count = txData.length;
    evidence.push({ tag: "NANSEN · TX", label: "Transaction Count", value: String(txData.length), detail: "Total transactions in the window." });
    if (windowDays > 0) { const freq = txData.length / windowDays; metrics.tx_frequency_per_day = freq; evidence.push({ tag: "NANSEN · TX", label: "Transaction Frequency", value: `${freq.toFixed(2)}/day`, detail: "Average transactions per day over the window." }); }
    const vols = txData.map((d) => num(d.volume_usd ?? d.volumeUsd)).filter((x) => x !== null);
    if (vols.length) { const avg = vols.reduce((a, b) => a + b, 0) / vols.length; metrics.avg_tx_volume_usd = avg; evidence.push({ tag: "NANSEN · TX", label: "Avg Tx Volume", value: fmtUsd(avg), detail: "Mean transaction volume in USD." }); }
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

  const tasks = NANSEN_ENDPOINTS.map((ep) => async () => {
    const body = { address, chain };
    if (ep.needsDateRange) {
      body.date = ep.dateFmt === "date"
        ? { from: dateFromDay, to: dateToDay }
        : { from: dateFromIso, to: dateToIso };
    }
    if (ep.paginated) body.pagination = { page: 1, per_page: 100 };
    if (ep.key === "current_balance" || ep.key === "transactions") body.hide_spam_token = true;
    const r = await callEndpoint(apiKey, ep, body, timeoutMs);
    r.chain = chain;
    return r;
  });

  const results = await runPool(tasks, 2);
  const calls = {};
  for (const r of results) calls[r.key] = r;

  const requiredOk = !!calls.pnl_summary?.ok && !!calls.dex_trades?.ok;
  const failedSources = NANSEN_ENDPOINTS.filter((e) => !calls[e.key]?.ok).map((e) => e.key);
  const optionalFailed = ["current_balance", "transactions"].some((k) => !calls[k]?.ok);

  let outcome;
  if (!requiredOk) outcome = "demo";
  else if (optionalFailed) outcome = "partial";
  else outcome = "live";

  const sources = NANSEN_ENDPOINTS.map((e) => `nansen:${e.key}:${calls[e.key]?.ok ? "live" : "unavailable"}`);

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
    freshness: to.toISOString()
  };

  logUsage(base44, caseSlug, outcome, Object.values(calls));

  return {
    outcome,
    errorCategory: requiredOk ? null : (calls.pnl_summary?.errorCategory || calls.dex_trades?.errorCategory || ERR.UNKNOWN),
    partial: outcome === "partial",
    failedSources,
    evidence,
    metrics,
    sources,
    meta,
    nansenCalls: 4
  };
}