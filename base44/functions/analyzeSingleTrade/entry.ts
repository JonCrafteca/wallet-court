// Wallet Court — Single Trade Trial: analyze one specific token purchase from
// entry through the present. Fetches the OHLCV price path, later sells, later
// buys, and current balance, then generates a trade-level verdict.
//
// Idempotent: the trade_fingerprint (SHA-256 of network:wallet:tx_hash) prevents
// duplicate trials and duplicate paid Nansen calls. Re-submitting the same
// wallet + transaction returns the existing trial with zero Nansen calls.
//
// 3-4 physical Nansen calls per trial: token-ohlcv (1) + dex-trades sells (1) +
// current-balance (1). The purchase itself is re-fetched from dex-trades (1) to
// confirm the tx_hash and capture entry market cap. All calls route through the
// instrumented telemetry transport with the global ceiling guard.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { waitUntil } from "base44:runtime";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { shortAddr } from "../../shared/walletClaim.ts";
import {
  getNansenApiKey, fetchTokenPurchases, fetchTokenSells, fetchTokenOhlcv,
  buildTelemetryContext, ERR, NANSEN_ENDPOINTS, callEndpoint, CHAIN_BY_NETWORK
} from "../../shared/nansen.ts";
import {
  normalizePurchases, extractCandles, computeTradeMetrics, buildTradeEvidence,
  buildTradeFingerprint, sanitizeSingleTrialForPublicCase
} from "../../shared/singleTradeEvidence.ts";
import { selectTradeVerdict, computeTradeSeverityConfidence } from "../../shared/singleTradeVerdicts.ts";
import { findByFingerprint, createTrial } from "../../shared/singleTradeStore.ts";
import { isCircuitOpen, sanitizeReason, recessHttpStatus, RECESS_TYPES } from "../../shared/circuitBreaker.ts";
import { getCircuit, openCircuit, closeCircuitWithVersion } from "../../shared/circuitStore.ts";
import { enqueueNotification } from "../../shared/ownerNotificationStore.ts";
import { EVENT_TYPES } from "../../shared/ownerNotifications.ts";

const PROVIDER = "nansen";

function newSlug() {
  return "trade-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let submittedByUserId = null;
    try {
      const currentUser = await base44.auth.me();
      if (currentUser && currentUser.id) submittedByUserId = currentUser.id;
    } catch {}

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const wallet_address = body?.wallet_address;
    const network = body?.network;
    const token_mint = body?.token_mint;
    const transaction_hash = body?.transaction_hash;
    const refCode = body?.ref_code || null;
    const visitorId = body?.visitor_id || null;

    if (!wallet_address || !network || !token_mint || !transaction_hash) {
      return Response.json({ error: "wallet_address, network, token_mint, and transaction_hash are required." }, { status: 400 });
    }
    if (network !== "solana") {
      return Response.json({ error: "Single Trade Trial currently supports Solana only.", code: "UNSUPPORTED_CHAIN" }, { status: 400 });
    }

    const validation = validateWalletForChain(network, wallet_address);
    if (!validation.ok) {
      return Response.json({ error: validation.message, code: validation.code }, { status: 400 });
    }

    const normalized = normalizeAddress(network, wallet_address);

    // ---- Idempotency: check for existing trial by fingerprint ----
    const fingerprint = await buildTradeFingerprint(network, normalized, transaction_hash);
    const existing = await findByFingerprint(base44, fingerprint);
    if (existing) {
      return Response.json({
        trial: sanitizeSingleTrialForPublicCase(existing),
        analysis: { outcome: "existing", nansen_calls: 0, physical_calls_made: 0, correlation_id: null }
      });
    }

    const apiKey = getNansenApiKey();
    if (!apiKey) {
      return Response.json({ error: "Nansen API key is not configured.", code: "MISSING_KEY" }, { status: 503 });
    }

    // ---- Circuit check before any paid call ----
    const circuit = await getCircuit(base44, PROVIDER);
    const circuitVersionAtStart = (circuit as any)?.circuit_version || 0;
    const now = Date.now();
    if (isCircuitOpen(circuit, now)) {
      return courtRecessResponse(circuit, now);
    }

    const public_slug = newSlug();
    const { telemetryCtx, budgetGuard, correlationId, getPhysicalCallCount } = buildTelemetryContext(base44, {
      workflow: "single_trade_analysis", network, caseSlug: public_slug
    });

    // ---- 1. Fetch the specific purchase (confirm tx_hash + entry mcap) ----
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 86400000);
    const purchaseResult = await fetchTokenPurchases(apiKey, network, normalized, token_mint, {
      from, to, timeoutMs: 20000, telemetryCtx, budgetGuard
    });

    if (!purchaseResult.ok) {
      await openCircuit(base44, PROVIDER, { recessType: RECESS_TYPES.PROVIDER, requestId: null }).catch(() => {});
      return Response.json({ error: "Failed to fetch purchase from Nansen.", code: purchaseResult.errorCategory || "unknown" }, { status: 502 });
    }

    const allPurchases = normalizePurchases(purchaseResult.json, token_mint);
    const selectedPurchase = allPurchases.find((p) => p.transaction_hash === transaction_hash);
    if (!selectedPurchase) {
      return Response.json({ error: "The specified transaction was not found among purchases of this token.", code: "TX_NOT_FOUND" }, { status: 404 });
    }

    const purchaseDate = new Date(selectedPurchase.block_timestamp);
    const purchaseTimestamp = selectedPurchase.block_timestamp;

    // ---- 2. Fetch OHLCV from purchase date to now ----
    const ohlcvResult = await fetchTokenOhlcv(apiKey, network, token_mint, {
      from: purchaseDate, to, timeframe: "1h", timeoutMs: 20000, telemetryCtx, budgetGuard
    });

    let candles: any[] = [];
    if (ohlcvResult.ok) {
      candles = extractCandles(ohlcvResult.json);
    }

    // ---- 3. Fetch later sells (after purchase date) ----
    const sellsFrom = new Date(purchaseDate.getTime() + 60000); // 1 min after purchase
    const sellsResult = await fetchTokenSells(apiKey, network, normalized, token_mint, {
      from: sellsFrom, to, timeoutMs: 20000, telemetryCtx, budgetGuard
    });
    let laterSells: any[] = [];
    if (sellsResult.ok) {
      const sellData = sellsResult.json?.data || sellsResult.json?.trades || [];
      if (Array.isArray(sellData)) laterSells = sellData;
    }

    // ---- 4. Fetch later buys (averaging down, after purchase) ----
    // Reuse the purchases list — filter to buys after the entry purchase.
    const laterBuys = allPurchases.filter((p) =>
      p.transaction_hash !== transaction_hash &&
      new Date(p.block_timestamp).getTime() > purchaseDate.getTime()
    );

    // ---- 5. Fetch current balance (filtered to this token) ----
    const balEp = NANSEN_ENDPOINTS.find((e) => e.key === "current_balance");
    const chain = CHAIN_BY_NETWORK[network];
    const balBody = { address: normalized, chain, hide_spam_token: true, pagination: { page: 1, per_page: 1000 } };
    const balResult = await callEndpoint(apiKey, balEp, balBody, 20000, telemetryCtx, budgetGuard);

    let currentPriceUsd: number | null = null;
    let currentValueUsd: number | null = null;
    let currentTokenAmount: number | null = null;
    let currentMarketCapUsd: number | null = null;
    if (balResult.ok) {
      const balData = balResult.json?.data || balResult.json?.balances || [];
      if (Array.isArray(balData)) {
        const mintLower = token_mint.toLowerCase();
        const holding = balData.find((b: any) => (b.token_address || "").toLowerCase() === mintLower);
        if (holding) {
          currentPriceUsd = holding.price_usd ? parseFloat(holding.price_usd) : null;
          currentValueUsd = holding.value_usd ? parseFloat(holding.value_usd) : null;
          currentTokenAmount = holding.token_amount ? parseFloat(holding.token_amount) : null;
        }
      }
    }

    // ---- Close circuit on success (stale-success protected) ----
    if (circuit && (circuit as any).circuit_status !== "closed") {
      await closeCircuitWithVersion(base44, PROVIDER, circuitVersionAtStart, Date.now(), { requestId: null }).catch(() => {});
    }

    // ---- Compute trade metrics ----
    const metrics = computeTradeMetrics({
      candles,
      entryMarketCapUsd: selectedPurchase.entry_market_cap_usd,
      purchaseCostUsd: selectedPurchase.purchase_cost_usd,
      tokensReceived: selectedPurchase.tokens_received,
      laterSells,
      laterBuys,
      currentPriceUsd,
      currentValueUsd,
      currentTokenAmount,
      currentMarketCapUsd,
      purchaseTimestamp
    });

    // ---- Evidence gate: need at least the entry + some OHLCV or current data ----
    const hasEntry = selectedPurchase.purchase_cost_usd !== null || selectedPurchase.entry_market_cap_usd !== null;
    const hasPricePath = candles.length > 0 || currentValueUsd !== null || currentPriceUsd !== null;
    if (!hasEntry || !hasPricePath) {
      const record = await createTrial(base44, {
        trial_type: "single_trade",
        wallet_address, normalized_wallet_address: normalized, network,
        token_mint, token_symbol: selectedPurchase.token_bought_symbol || null,
        transaction_hash, trade_fingerprint: fingerprint,
        purchase_timestamp: purchaseTimestamp,
        entry_price_usd: selectedPurchase.entry_price_usd,
        entry_market_cap_usd: selectedPurchase.entry_market_cap_usd,
        tokens_received: selectedPurchase.tokens_received,
        purchase_cost_usd: selectedPurchase.purchase_cost_usd,
        status: "completed", data_mode: "live",
        case_outcome: "mistrial_insufficient_evidence",
        verdict_code: null, verdict_name: null, headline: null, roast: null,
        defense_statement: null, sentence: null,
        severity_score: null, confidence_score: null,
        evidence_items_json: JSON.stringify([]),
        metrics_json: JSON.stringify({ ...metrics, _meta: { candle_count: candles.length } }),
        ohlcv_snapshot_json: JSON.stringify(candles),
        refresh_snapshots_json: "[]",
        source_endpoints_json: JSON.stringify([
          "nansen:dex_trades:live", `nansen:token_ohlcv:${ohlcvResult.ok ? "live" : "unavailable"}`,
          `nansen:current_balance:${balResult.ok ? "live" : "unavailable"}`
        ]),
        public_slug, submitted_by_user_id: submittedByUserId,
        later_sells_json: JSON.stringify(laterSells),
        later_buys_json: JSON.stringify(laterBuys),
        current_price_usd: currentPriceUsd, current_value_usd: currentValueUsd,
        current_token_amount: currentTokenAmount,
        analyzed_at: new Date().toISOString()
      });
      return Response.json({
        trial: sanitizeSingleTrialForPublicCase(record),
        analysis: { outcome: "mistrial", nansen_calls: 4, physical_calls_made: getPhysicalCallCount(), correlation_id: correlationId }
      });
    }

    // ---- Verdict ----
    const verdict = selectTradeVerdict(metrics);
    const { severity, confidence } = computeTradeSeverityConfidence(metrics);
    const evidence = buildTradeEvidence(metrics, selectedPurchase);

    const record = await createTrial(base44, {
      trial_type: "single_trade",
      wallet_address, normalized_wallet_address: normalized, network,
      token_mint, token_symbol: selectedPurchase.token_bought_symbol || null,
      transaction_hash, trade_fingerprint: fingerprint,
      purchase_timestamp: purchaseTimestamp,
      entry_price_usd: selectedPurchase.entry_price_usd,
      entry_market_cap_usd: selectedPurchase.entry_market_cap_usd,
      tokens_received: selectedPurchase.tokens_received,
      purchase_cost_usd: selectedPurchase.purchase_cost_usd,
      status: "completed", data_mode: "live", case_outcome: "verdict",
      verdict_code: verdict.code, verdict_name: verdict.display_name,
      severity_score: severity, confidence_score: confidence,
      headline: verdict.headline, roast: verdict.roast,
      defense_statement: verdict.defense, sentence: verdict.sentence,
      evidence_items_json: JSON.stringify(evidence),
      metrics_json: JSON.stringify({ ...metrics, _meta: { candle_count: candles.length, partial: !ohlcvResult.ok || !balResult.ok } }),
      ohlcv_snapshot_json: JSON.stringify(candles),
      refresh_snapshots_json: "[]",
      source_endpoints_json: JSON.stringify([
        "nansen:dex_trades:live", `nansen:token_ohlcv:${ohlcvResult.ok ? "live" : "unavailable"}`,
        `nansen:current_balance:${balResult.ok ? "live" : "unavailable"}`
      ]),
      public_slug, submitted_by_user_id: submittedByUserId,
      later_sells_json: JSON.stringify(laterSells),
      later_buys_json: JSON.stringify(laterBuys),
      current_price_usd: currentPriceUsd, current_value_usd: currentValueUsd,
      current_token_amount: currentTokenAmount,
      analyzed_at: new Date().toISOString()
    });

    // Enqueue owner notification (non-blocking, exactly-once).
    waitUntil(enqueueNotification(base44, {
      event_type: EVENT_TYPES.VERDICT,
      source_entity: "SingleTradeTrial",
      source_record_id: record.id,
      metadata: {
        verdict_name: record.verdict_name,
        network: record.network,
        address_short: shortAddr(record.normalized_wallet_address),
        token_symbol: record.token_symbol,
        severity_score: record.severity_score,
        confidence_score: record.confidence_score,
        physical_calls: getPhysicalCallCount(),
        public_slug: record.public_slug,
        analyzed_at: record.analyzed_at
      }
    }).catch(() => {}));

    return Response.json({
      trial: sanitizeSingleTrialForPublicCase(record),
      analysis: {
        outcome: "live", nansen_calls: 4,
        physical_calls_made: getPhysicalCallCount(), correlation_id: correlationId
      }
    });
  } catch (error) {
    return Response.json({ error: error.message || "The court failed to convene." }, { status: 500 });
  }
}

function courtRecessResponse(circuit, now) {
  const recessType = circuit?.recess_type || RECESS_TYPES.UNKNOWN;
  const retryAfterIso = circuit?.retry_after || new Date(now + 900000).toISOString();
  const status = recessHttpStatus(recessType);
  return Response.json({
    court_recess: true, recess_type: recessType,
    sanitized_reason: sanitizeReason(recessType),
    retry_after: retryAfterIso, http_status: status
  }, { status });
}