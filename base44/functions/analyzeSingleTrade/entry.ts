// Wallet Court — Single Trade Trial: analyze one specific token purchase from
// entry through the present. Fetches the OHLCV price path, later sells, later
// buys, and current balance, then generates a trade-level verdict.
//
// HARDENED IMPLEMENTATION:
//   - Uses a version-guarded CAS mutex lock (Owner Notifications pattern) for
//     trial creation, NOT a SHA-256 fingerprint check-then-create.
//   - Resolves the authoritative purchase server-side from an opaque selection
//     token. The browser NEVER posts the transaction_hash.
//   - Uses the SEPARATE Single Trade usage policy budget, NOT the legacy 1,020
//     calibration ceiling.
//   - Implements FIFO lot accounting for later buys and sells.
//   - Public responses never expose the full wallet address, normalized
//     wallet, complete transaction hash, or raw Nansen response.
//
// Concurrent callers return the existing/in-progress trial. Duplicate
// callers make zero additional Nansen calls.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { waitUntil } from "base44:runtime";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { shortAddr } from "../../shared/walletClaim.ts";
import {
  getNansenApiKey, fetchTokenPurchases, fetchTokenSells, fetchTokenOhlcv,
  buildSingleTradeTelemetryContext, NANSEN_ENDPOINTS, callEndpoint, CHAIN_BY_NETWORK
} from "../../shared/nansen.ts";
import {
  normalizePurchases, extractCandles, computeTradeMetrics, buildTradeEvidence,
  buildTradeFingerprint, sanitizeSingleTrialForPublicCase
} from "../../shared/singleTradeEvidence.ts";
import { selectTradeVerdict, computeTradeSeverityConfidence } from "../../shared/singleTradeVerdicts.ts";
import { findOrCreateTrial, completeTrial, failTrial, findByFingerprint } from "../../shared/singleTradeStore.ts";
import { consumeSelection, linkSelectionToTrial } from "../../shared/singleTradeSelectionStore.ts";
import { checkAnalysisRateLimit } from "../../shared/singleTradeUsageStore.ts";
import { computeFifoLotAttribution } from "../../shared/singleTradeFifo.ts";
import { isCircuitOpen, sanitizeReason, recessHttpStatus, RECESS_TYPES } from "../../shared/circuitBreaker.ts";
import { getCircuit, openCircuit, closeCircuitWithVersion } from "../../shared/circuitStore.ts";
import { enqueueNotification } from "../../shared/ownerNotificationStore.ts";
import { EVENT_TYPES } from "../../shared/ownerNotifications.ts";
import { isSingleTradePublicEnabled } from "../../shared/featureFlags.ts";

const PROVIDER = "nansen";

function newSlug() {
  return "trade-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let submittedByUserId = null;
    let isAdmin = false;
    try {
      const currentUser = await base44.auth.me();
      if (currentUser && currentUser.id) submittedByUserId = currentUser.id;
      if (currentUser && currentUser.role === "admin") isAdmin = true;
    } catch {}

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const wallet_address = body?.wallet_address;
    const network = body?.network;
    const token_mint = body?.token_mint;
    const selection_token = body?.selection_token;

    if (!wallet_address || !network || !token_mint || !selection_token) {
      return Response.json({ error: "wallet_address, network, token_mint, and selection_token are required." }, { status: 400 });
    }
    if (network !== "solana") {
      return Response.json({ error: "Single Trade Trial currently supports Solana only.", code: "UNSUPPORTED_CHAIN" }, { status: 400 });
    }

    // ---- Feature flag check: public users blocked when flag is false ----
    const isPublic = await isSingleTradePublicEnabled(base44);
    if (!isPublic && !isAdmin) {
      return Response.json({ error: "Single Trade Trial is coming soon. Check back shortly!", code: "FEATURE_DISABLED" }, { status: 403 });
    }

    const validation = validateWalletForChain(network, wallet_address);
    if (!validation.ok) {
      return Response.json({ error: validation.message, code: validation.code }, { status: 400 });
    }

    const normalized = normalizeAddress(network, wallet_address);

    // ---- Rate limit: analyses per wallet per day ----
    const rateLimit = await checkAnalysisRateLimit(base44, normalized, network);
    if (!rateLimit.allowed) {
      return Response.json({ error: rateLimit.reason, code: "RATE_LIMITED" }, { status: 429 });
    }

    // ---- Secure purchase selection: consume the opaque token server-side ----
    const consumption = await consumeSelection(base44, selection_token, normalized, token_mint);
    if (!consumption.consumed) {
      return Response.json({ error: consumption.reason, code: "SELECTION_INVALID" }, { status: 400 });
    }
    const selection = consumption.selection;

    // The authoritative transaction hash comes from the server-side selection,
    // NOT from the browser.
    const transaction_hash = selection.transaction_hash;

    // ---- Build fingerprint for dedup ----
    const fingerprint = await buildTradeFingerprint(network, normalized, transaction_hash);

    // ---- Check for existing trial (fast path, before mutex) ----
    const existingFast = await findByFingerprint(base44, fingerprint);
    if (existingFast) {
      return Response.json({
        trial: sanitizeSingleTrialForPublicCase(existingFast),
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

    // ---- CAS mutex: find or create the trial atomically ----
    const findOrCreate = await findOrCreateTrial(base44, {
      trial_type: "single_trade",
      wallet_address, normalized_wallet_address: normalized, network,
      token_mint, token_symbol: selection.token_symbol || null,
      transaction_hash, trade_fingerprint: fingerprint,
      purchase_timestamp: selection.purchase_timestamp,
      entry_price_usd: selection.entry_price_usd,
      entry_market_cap_usd: selection.entry_market_cap_usd,
      tokens_received: selection.tokens_received,
      purchase_cost_usd: selection.purchase_cost_usd,
      data_mode: "live",
      case_outcome: null,
      public_slug, submitted_by_user_id: submittedByUserId,
      later_sells_json: "[]",
      later_buys_json: "[]",
      lot_accounting_method: "fifo",
      lot_attribution_complex: false,
      selected_lot_remaining_quantity: selection.tokens_received,
      refresh_snapshots_json: "[]",
      ohlcv_snapshot_json: "[]",
      evidence_items_json: "[]",
      metrics_json: "{}",
      source_endpoints_json: "[]"
    });

    if (!findOrCreate.created) {
      // Duplicate — another caller is analyzing or has already analyzed this trade.
      // Link the selection to the existing trial (best-effort).
      if (findOrCreate.trial) {
        await linkSelectionToTrial(base44, selection_token, findOrCreate.trial.id).catch(() => {});
        return Response.json({
          trial: sanitizeSingleTrialForPublicCase(findOrCreate.trial),
          analysis: { outcome: "existing", nansen_calls: 0, physical_calls_made: 0, correlation_id: null }
        });
      }
      // Lock contention — could not acquire lock and no existing trial.
      return Response.json({ error: "The court is busy processing this trade. Please try again in a moment.", code: "LOCK_CONTENTION" }, { status: 503 });
    }

    // ---- Winner: this caller owns the trial. Do the Nansen calls. ----
    const trial = findOrCreate.trial;
    await linkSelectionToTrial(base44, selection_token, trial.id).catch(() => {});

    const { telemetryCtx, budgetGuard, correlationId, getPhysicalCallCount } = buildSingleTradeTelemetryContext(base44, {
      workflow: "single_trade_analysis", network, caseSlug: public_slug
    });

    try {
      // ---- 1. Fetch the specific purchase (confirm tx_hash + entry mcap) ----
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - 365 * 86400000);
      const purchaseResult = await fetchTokenPurchases(apiKey, network, normalized, token_mint, {
        from: fromDate, to: toDate, timeoutMs: 20000, telemetryCtx, budgetGuard
      });

      if (!purchaseResult.ok) {
        await openCircuit(base44, PROVIDER, { recessType: RECESS_TYPES.PROVIDER, requestId: null }).catch(() => {});
        await failTrial(base44, trial.id, purchaseResult.errorCategory || "unknown", "Failed to fetch purchase from Nansen.");
        return Response.json({ error: "Failed to fetch purchase from Nansen.", code: purchaseResult.errorCategory || "unknown" }, { status: 502 });
      }

      const allPurchases = normalizePurchases(purchaseResult.json, token_mint);
      const selectedPurchase = allPurchases.find((p) => p.transaction_hash === transaction_hash);
      if (!selectedPurchase) {
        await failTrial(base44, trial.id, "TX_NOT_FOUND", "The specified transaction was not found among purchases of this token.");
        return Response.json({ error: "The specified transaction was not found among purchases of this token.", code: "TX_NOT_FOUND" }, { status: 404 });
      }

      const purchaseDate = new Date(selectedPurchase.block_timestamp);
      const purchaseTimestamp = selectedPurchase.block_timestamp;

      // ---- 2. Fetch OHLCV from purchase date to now ----
      const ohlcvResult = await fetchTokenOhlcv(apiKey, network, token_mint, {
        from: purchaseDate, to: toDate, timeframe: "1h", timeoutMs: 20000, telemetryCtx, budgetGuard
      });

      let candles: any[] = [];
      if (ohlcvResult.ok) {
        candles = extractCandles(ohlcvResult.json);
      }

      // ---- 3. Fetch later sells (after purchase date) ----
      const sellsFrom = new Date(purchaseDate.getTime() + 60000);
      const sellsResult = await fetchTokenSells(apiKey, network, normalized, token_mint, {
        from: sellsFrom, to: toDate, timeoutMs: 20000, telemetryCtx, budgetGuard
      });
      let laterSells: any[] = [];
      if (sellsResult.ok) {
        const sellData = sellsResult.json?.data || sellsResult.json?.trades || [];
        if (Array.isArray(sellData)) laterSells = sellData;
      }

      // ---- 4. Later buys (from the purchases list, after entry) ----
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

      // ---- Close circuit on success ----
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

      // ---- FIFO lot accounting ----
      const fifo = computeFifoLotAttribution({
        entryTokens: selectedPurchase.tokens_received,
        entryCostUsd: selectedPurchase.purchase_cost_usd,
        entryTimestamp: purchaseTimestamp,
        laterBuys,
        laterSells,
        currentPriceUsd
      });

      // Merge FIFO into metrics.
      const enrichedMetrics = {
        ...metrics,
        lot_accounting_method: fifo.lot_accounting_method,
        selected_lot_remaining_quantity: fifo.selected_lot_remaining_quantity,
        selected_lot_sold_quantity: fifo.selected_lot_sold_quantity,
        selected_lot_cost_basis_remaining: fifo.selected_lot_cost_basis_remaining,
        selected_lot_current_value: fifo.selected_lot_current_value,
        selected_lot_pnl_pct: fifo.selected_lot_pnl_pct,
        whole_position_tokens: fifo.whole_position_tokens,
        whole_position_cost_usd: fifo.whole_position_cost_usd,
        whole_position_remaining: fifo.whole_position_remaining,
        whole_position_current_value: fifo.whole_position_current_value,
        whole_position_pnl_pct: fifo.whole_position_pnl_pct,
        lot_attribution_complex: fifo.lot_attribution_complex,
        attribution_note: fifo.attribution_note,
        _meta: { candle_count: candles.length, partial: !ohlcvResult.ok || !balResult.ok }
      };

      // ---- Evidence gate ----
      const hasEntry = selectedPurchase.purchase_cost_usd !== null || selectedPurchase.entry_market_cap_usd !== null;
      const hasPricePath = candles.length > 0 || currentValueUsd !== null || currentPriceUsd !== null;
      if (!hasEntry || !hasPricePath) {
        const record = await completeTrial(base44, trial.id, {
          case_outcome: "mistrial_insufficient_evidence",
          verdict_code: null, verdict_name: null, headline: null, roast: null,
          defense_statement: null, sentence: null,
          severity_score: null, confidence_score: null,
          evidence_items_json: JSON.stringify([]),
          metrics_json: JSON.stringify(enrichedMetrics),
          ohlcv_snapshot_json: JSON.stringify(candles),
          source_endpoints_json: JSON.stringify([
            "nansen:dex_trades:live", `nansen:token_ohlcv:${ohlcvResult.ok ? "live" : "unavailable"}`,
            `nansen:current_balance:${balResult.ok ? "live" : "unavailable"}`
          ]),
          later_sells_json: JSON.stringify(laterSells),
          later_buys_json: JSON.stringify(laterBuys),
          current_price_usd: currentPriceUsd, current_value_usd: currentValueUsd,
          current_token_amount: currentTokenAmount,
          lot_attribution_complex: fifo.lot_attribution_complex,
          selected_lot_remaining_quantity: fifo.selected_lot_remaining_quantity
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

      const record = await completeTrial(base44, trial.id, {
        case_outcome: "verdict",
        verdict_code: verdict.code, verdict_name: verdict.display_name,
        severity_score: severity, confidence_score: confidence,
        headline: verdict.headline, roast: verdict.roast,
        defense_statement: verdict.defense, sentence: verdict.sentence,
        evidence_items_json: JSON.stringify(evidence),
        metrics_json: JSON.stringify(enrichedMetrics),
        ohlcv_snapshot_json: JSON.stringify(candles),
        source_endpoints_json: JSON.stringify([
          "nansen:dex_trades:live", `nansen:token_ohlcv:${ohlcvResult.ok ? "live" : "unavailable"}`,
          `nansen:current_balance:${balResult.ok ? "live" : "unavailable"}`
        ]),
        later_sells_json: JSON.stringify(laterSells),
        later_buys_json: JSON.stringify(laterBuys),
        current_price_usd: currentPriceUsd, current_value_usd: currentValueUsd,
        current_token_amount: currentTokenAmount,
        lot_attribution_complex: fifo.lot_attribution_complex,
        selected_lot_remaining_quantity: fifo.selected_lot_remaining_quantity
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
    } catch (analysisError) {
      // Analysis failed — mark the trial as failed and release the lock.
      await failTrial(base44, trial.id, "analysis_error", analysisError.message || "Analysis failed.").catch(() => {});
      throw analysisError;
    }
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