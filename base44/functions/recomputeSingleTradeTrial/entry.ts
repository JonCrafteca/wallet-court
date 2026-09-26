// Wallet Court — Single Trade Trial: admin-safe archetype recompute.
//
// Recomputes the canonical archetype classification for a completed trial
// using ONLY stored data — zero Nansen calls. If the new archetype system
// selects a comeback archetype (ESCAPE ARTIST, COMEBACK KID, BACK FROM THE
// DEAD), the trial's verdict_code, verdict_name, charge, headline, roast,
// defense, sentence, and metrics_json are updated in place.
//
// If no comeback archetype matches, the existing verdict is left unchanged.
//
// ENHANCEMENT: For legacy cases analyzed before the comeback metrics were
// added, this function recomputes the missing comeback inputs (max_drawdown_pct,
// lowest_position_value_usd, realized_exit_value_usd, ending_value_usd, etc.)
// from the stored OHLCV price snapshot and the trial's stored purchase/sell
// data. This is still zero Nansen calls — the OHLCV snapshot is immutable
// stored evidence.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { classifyComebackFromMetrics } from "../../shared/archetypes.ts";
import { sanitizeSingleTrialForPublicCase, validateFieldSize } from "../../shared/singleTradeEvidence.ts";

// ---- Helper: compute comeback inputs from stored OHLCV price candles ----
//
// The stored OHLCV snapshot uses price candles (t, o, h, l, c, v). This helper
// derives the comeback metrics from those price candles + the trial's stored
// purchase/sell data.
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

  // Parse later sells
  let laterSells: any[] = [];
  try { laterSells = JSON.parse(trial.later_sells_json || "[]"); } catch { laterSells = []; }

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

  // lowest_position_value_usd
  const lowestPositionValueUsd = lowestPrice !== null
    ? lowestPrice * tokens
    : null;

  // realized_exit_value_usd
  const realizedExitValueUsd = laterSells.reduce(
    (sum, s) => sum + (num(s.trade_value_usd) || 0),
    0
  );

  // current_value_usd (only if not full exit)
  const currentValueUsd = conviction !== "full_exit" && currentPrice !== null
    ? currentPrice * tokens
    : null;

  // ending_value_usd
  const endingValueUsd = conviction === "full_exit" && realizedExitValueUsd > 0
    ? realizedExitValueUsd
    : currentValueUsd;

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

    // ---- Classify comeback from enhanced metrics (zero Nansen calls) ----
    const comebackClassification = classifyComebackFromMetrics(enhancedMetrics);

    if (!comebackClassification.result.archetype_id) {
      // No comeback archetype matched — existing verdict unchanged.
      return Response.json({
        recomputed: false,
        reason: comebackClassification.result.classification_reason,
        existing_verdict_code: trial.verdict_code,
        existing_verdict_name: trial.verdict_name,
        comeback_result: comebackClassification.result,
        recomputed_inputs: recomputedInputs,
      });
    }

    // ---- Comeback archetype selected — update the trial ----
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
    });

    return Response.json({
      recomputed: true,
      previous_verdict_code: trial.verdict_code,
      previous_verdict_name: trial.verdict_name,
      new_verdict_code: verdict.code,
      new_verdict_name: verdict.display_name,
      new_charge: verdict.charge,
      archetype: comebackClassification.result,
      recomputed_inputs: recomputedInputs,
      trial: sanitizeSingleTrialForPublicCase(updated),
    });
  } catch (error) {
    return Response.json({ error: error.message || "Recompute failed.", code: "RECOMPUTE_ERROR" }, { status: 500 });
  }
}