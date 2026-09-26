// Wallet Court — Single Trade Trial: admin-safe archetype recompute.
//
// Recomputes the canonical archetype classification for a completed trial
// using ONLY stored metrics — zero Nansen calls. If the new archetype system
// selects a comeback archetype (ESCAPE ARTIST, COMEBACK KID, BACK FROM THE
// DEAD), the trial's verdict_code, verdict_name, charge, headline, roast,
// defense, sentence, and metrics_json are updated in place.
//
// If no comeback archetype matches, the existing verdict is left unchanged.
//
// This does NOT rewrite previously published cases automatically. The admin
// must deliberately trigger the recompute for a specific case by slug.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { classifyComebackFromMetrics } from "../../shared/archetypes.ts";
import { sanitizeSingleTrialForPublicCase, validateFieldSize } from "../../shared/singleTradeEvidence.ts";

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

    // ---- Classify comeback from stored metrics (zero Nansen calls) ----
    const comebackClassification = classifyComebackFromMetrics(metrics);

    if (!comebackClassification.result.archetype_id) {
      // No comeback archetype matched — existing verdict unchanged.
      return Response.json({
        recomputed: false,
        reason: "No comeback archetype matched. Existing verdict unchanged.",
        existing_verdict_code: trial.verdict_code,
        existing_verdict_name: trial.verdict_name,
        comeback_result: comebackClassification.result,
      });
    }

    // ---- Comeback archetype selected — update the trial ----
    const verdict = comebackClassification.verdict;
    const updatedMetrics = { ...metrics, _archetype: comebackClassification.result };
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
      trial: sanitizeSingleTrialForPublicCase(updated),
    });
  } catch (error) {
    return Response.json({ error: error.message || "Recompute failed.", code: "RECOMPUTE_ERROR" }, { status: 500 });
  }
}