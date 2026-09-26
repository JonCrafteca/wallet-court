// Wallet Court — Single Trade Trial: admin-safe archetype recompute.
//
// Recomputes the canonical archetype classification for a completed trial
// using ONLY stored data — zero Nansen calls. If the new archetype system
// selects a comeback archetype (ESCAPE ARTIST, COMEBACK KID, BACK FROM THE
// DEAD) or the Almost Escaped recovery archetype, the trial's verdict_code,
// verdict_name, charge, headline, roast, defense, sentence, metrics_json,
// severity_score, and confidence_score are updated in place.
//
// If no journey archetype matches, the existing verdict is left unchanged
// (severity and confidence are still recomputed from the enhanced metrics).
//
// ENHANCEMENT: For legacy cases analyzed before the comeback metrics were
// added, this function recomputes the missing comeback inputs (max_drawdown_pct,
// lowest_position_value_usd, realized_exit_value_usd, ending_value_usd, etc.)
// from the stored OHLCV price snapshot and the trial's stored purchase/sell
// data. This is still zero Nansen calls — the OHLCV snapshot is immutable
// stored evidence.
//
// RECOVERY METRICS HONESTY: Price-based recovery metrics
// (price_recovery_multiple_from_bottom, cash_flow_adjusted_recovery_pct) are
// computed from pure price ratios, not position values. This prevents capital
// injected after the trough from being counted as market recovery.
// final_return_pct uses total_cost_basis (entry + later buys). severity_score
// and confidence_score are recomputed deterministically via
// computeTradeSeverityConfidence using the enhanced metrics.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { classifyComebackFromMetrics } from "../../shared/archetypes.ts";
import { computeTradeSeverityConfidence } from "../../shared/singleTradeVerdicts.ts";
import { sanitizeSingleTrialForPublicCase, validateFieldSize } from "../../shared/singleTradeEvidence.ts";

// ---- Helper: compute comeback inputs from stored OHLCV price candles ----
//
// The stored OHLCV snapshot uses price candles (t, o, h, l, c, v). This helper
// derives the comeback metrics from those price candles + the trial's stored
// purchase/sell data. All metrics are price-based (capital-injection-honest).
function recomputeComebackMetricsFromSnapshot(
  trial: any,
  metrics: Record<string, any>
): Record<string, any> {
  const num = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // Parse OHLCV price candles
  let candles: any[] = [];
  try { candles = JSON.parse(trial.ohlcv_snapshot_json || "[]"); } catch { candles = []; }
  if (!Array.isArray(candles) || candles.length === 0) return {};

  // Parse later sells and later buys
  let laterSells: any[] = [];
  try { laterSells = JSON.parse(trial.later_sells_json || "[]"); } catch { laterSells = []; }
  let laterBuys: any[] = [];
  try { laterBuys = JSON.parse(trial.later_buys_json || "[]"); } catch { laterBuys = []; }

  const entryPrice = num(trial.entry_price_usd);
  const purchaseCost = num(trial.purchase_cost_usd) ?? num(metrics.whole_position_cost_usd);
  const tokens = num(trial.tokens_received) ?? num(metrics.whole_position_tokens);
  const conviction = metrics.conviction || null;

  if (!entryPrice || !tokens || !purchaseCost) return {};

  // Find lowest low price and its timestamp
  let lowestPrice: number | null = null;
  let lowestPriceTime: string | null = null;
  for (const c of candles) {
    const low = num(c.l);
    if (low !== null && low > 0 && (lowestPrice === null || low < lowestPrice)) {
      lowestPrice = low;
      lowestPriceTime = c.t || c.interval_start || null;
    }
  }

  // Current price = last candle close
  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle ? num(lastCandle.c) : null;

  // max_drawdown_pct (ratio, e.g., -0.851)
  const maxDrawdownPct = lowestPrice !== null
    ? (lowestPrice - entryPrice) / entryPrice
    : null;

  // trough_price: the lowest price reached after entry
  const troughPrice = lowestPrice;

  // total_tokens_sold: sum of all tokens sold
  const totalTokensSold = laterSells.reduce(
    (sum, s) => sum + (num(s.token_sold_amount) || 0), 0
  );

  // realized_exit_value_usd: total USD from all sells
  const realizedExitValueUsd = laterSells.reduce(
    (sum, s) => sum + (num(s.trade_value_usd) || 0), 0
  );

  // exit_price: for full exits, realized proceeds / total tokens sold
  const exitPrice = conviction === "full_exit" && realizedExitValueUsd > 0 && totalTokensSold > 0
    ? realizedExitValueUsd / totalTokensSold
    : currentPrice;

  // lowest_position_value_usd (entry position at trough price)
  const lowestPositionValueUsd = lowestPrice !== null
    ? lowestPrice * tokens
    : null;

  // current_value_usd (only if not full exit)
  const currentValueUsd = conviction !== "full_exit" && currentPrice !== null
    ? currentPrice * tokens
    : null;

  // ending_value_usd
  const endingValueUsd = conviction === "full_exit" && realizedExitValueUsd > 0
    ? realizedExitValueUsd
    : currentValueUsd;

  // later_buys_cost_usd: total USD cost of additional buys
  const laterBuysCostUsd = laterBuys.reduce(
    (sum, b) => sum + (num(b.trade_value_usd) || 0), 0
  );

  // total_cost_basis_usd: entry + later buys
  const totalCostBasisUsd = purchaseCost + laterBuysCostUsd;

  // price_recovery_multiple_from_bottom: pure price ratio
  const priceRecoveryMultiple = troughPrice !== null && troughPrice > 0 && exitPrice !== null && exitPrice > 0
    ? exitPrice / troughPrice
    : null;

  // realized_pnl_pct: for full exits, (realized - total_cost_basis) / total_cost_basis
  const realizedPnlPct = conviction === "full_exit" && totalCostBasisUsd > 0
    ? (realizedExitValueUsd - totalCostBasisUsd) / totalCostBasisUsd
    : null;

  // last_sell_timestamp
  let lastSellTimestamp: string | null = null;
  for (const s of laterSells) {
    const ts = s.block_timestamp || s.timestamp || null;
    if (!ts) continue;
    if (!lastSellTimestamp || new Date(ts).getTime() > new Date(lastSellTimestamp).getTime()) {
      lastSellTimestamp = ts;
    }
  }

  return {
    purchase_cost_usd: purchaseCost,
    max_drawdown_pct: maxDrawdownPct,
    lowest_position_value_usd: lowestPositionValueUsd,
    realized_exit_value_usd: realizedExitValueUsd > 0 ? realizedExitValueUsd : null,
    current_value_usd: currentValueUsd,
    ending_value_usd: endingValueUsd,
    lowest_market_cap_timestamp: lowestPriceTime,
    last_sell_timestamp: lastSellTimestamp,
    entry_price_usd: entryPrice,
    trough_price_usd: troughPrice,
    exit_price_usd: exitPrice,
    total_tokens_sold: totalTokensSold > 0 ? totalTokensSold : null,
    later_buys_cost_usd: laterBuysCostUsd > 0 ? laterBuysCostUsd : null,
    total_cost_basis_usd: totalCostBasisUsd > 0 ? totalCostBasisUsd : null,
    price_recovery_multiple_from_bottom: priceRecoveryMultiple,
    realized_pnl_pct: realizedPnlPct,
  };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin-only ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Sign in to access the admin dashboard." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body.", code: "INVALID_BODY" }, { status: 400 }); }

    const slug = body?.slug;
    if (!slug) return Response.json({ error: "Case slug is required.", code: "MISSING_FIELDS" }, { status: 400 });

    // ---- Look up the completed trial ----
    const trial = await findBySlug(base44, slug);
    if (!trial) return Response.json({ error: "Case not found.", code: "NOT_FOUND" }, { status: 404 });
    if (trial.status !== "completed") return Response.json({ error: "Only completed cases can be recomputed.", code: "NOT_COMPLETED" }, { status: 400 });

    // ---- Parse stored metrics ----
    let metrics = {};
    try { metrics = JSON.parse(trial.metrics_json || "{}"); } catch { metrics = {}; }

    // ---- Recompute missing comeback inputs from stored OHLCV snapshot ----
    const recomputedInputs = recomputeComebackMetricsFromSnapshot(trial, metrics);
    const enhancedMetrics = { ...metrics, ...recomputedInputs };

    // ---- Recompute severity and confidence from enhanced metrics ----
    // severity_score and confidence_score are recomputed deterministically
    // via computeTradeSeverityConfidence using the canonical archetype inputs.
    // This ensures they reflect the journey metrics, not a stale leftover from
    // the previous verdict.
    const { severity, confidence } = computeTradeSeverityConfidence(enhancedMetrics);

    // ---- Classify comeback from enhanced metrics (zero Nansen calls) ----
    const comebackClassification = classifyComebackFromMetrics(enhancedMetrics);

    if (!comebackClassification.result.archetype_id) {
      // No journey archetype matched — existing verdict unchanged, but
      // severity and confidence are still recomputed from the enhanced metrics.
      const updatedMetrics = { ...enhancedMetrics, _archetype: comebackClassification.result };
      const metricsJson = JSON.stringify(updatedMetrics);

      if (!validateFieldSize(metricsJson, 12000)) {
        return Response.json({ error: "Updated metrics JSON exceeds the maximum allowed size.", code: "FIELD_SIZE_ERROR" }, { status: 500 });
      }

      const updated = await base44.asServiceRole.entities.SingleTradeTrial.update(trial.id, {
        metrics_json: metricsJson,
        severity_score: severity,
        confidence_score: confidence,
      });

      return Response.json({
        recomputed: false,
        reason: comebackClassification.result.classification_reason,
        existing_verdict_code: trial.verdict_code,
        existing_verdict_name: trial.verdict_name,
        previous_severity_score: trial.severity_score,
        previous_confidence_score: trial.confidence_score,
        new_severity_score: severity,
        new_confidence_score: confidence,
        comeback_result: comebackClassification.result,
        recomputed_inputs: recomputedInputs,
        trial: sanitizeSingleTrialForPublicCase(updated),
      });
    }

    // ---- Journey archetype selected — update the trial ----
    const verdict = comebackClassification.verdict;
    const updatedMetrics = { ...enhancedMetrics, _archetype: comebackClassification.result };
    const metricsJson = JSON.stringify(updatedMetrics);

    if (!validateFieldSize(metricsJson, 12000)) {
      return Response.json({ error: "Updated metrics JSON exceeds the maximum allowed size.", code: "FIELD_SIZE_ERROR" }, { status: 500 });
    }

    const updated = await base44.asServiceRole.entities.SingleTradeTrial.update(trial.id, {
      verdict_code: verdict.code,
      verdict_name: verdict.display_name,
      charge: verdict.charge,
      headline: verdict.headline,
      roast: verdict.roast,
      defense_statement: verdict.defense,
      sentence: verdict.sentence,
      metrics_json: metricsJson,
      severity_score: severity,
      confidence_score: confidence,
    });

    return Response.json({
      recomputed: true,
      previous_verdict_code: trial.verdict_code,
      previous_verdict_name: trial.verdict_name,
      new_verdict_code: verdict.code,
      new_verdict_name: verdict.display_name,
      new_charge: verdict.charge,
      previous_severity_score: trial.severity_score,
      previous_confidence_score: trial.confidence_score,
      new_severity_score: severity,
      new_confidence_score: confidence,
      archetype: comebackClassification.result,
      recomputed_inputs: recomputedInputs,
      trial: sanitizeSingleTrialForPublicCase(updated),
    });
  } catch (error) {
    return Response.json({ error: error.message || "Recompute failed.", code: "RECOMPUTE_ERROR" }, { status: 500 });
  }
}