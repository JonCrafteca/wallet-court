// Wallet Court — admin-only label-only backfill (item N2.1 cost guard).
// Address Labels costs 100 Nansen credits per uncached wallet, so it is NEVER
// called automatically. This function is the ONLY path that calls Address
// Labels, and only for admin-selected cases.
//
// Safety:
//  - Admin-only.
//  - Preview (preview=true) returns the plan without spending credits.
//  - Run requires explicit typed confirmation: "SPEND LABEL CREDITS".
//  - Caches successful labels by normalized address + network (30-day TTL).
//  - Refresh (refresh=true) re-fetches only stale (>30d) cached entries.
//  - Calls exactly ONE endpoint (labels) per uncached/stale selected wallet.
//    Never repeats the four performance calls.
//  - Preserves permanent case slugs (updates in place).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets, waitUntil } from "base44:runtime";
import { logUsage, fetchAddressLabels } from "../../shared/nansen.ts";
import { walletClassEvidence } from "../../shared/walletClass.ts";
import { recomputeVerdictFromLabels } from "../../shared/verdicts_entity.ts";
import { computeSeverityConfidence } from "../../shared/verdicts_live.ts";
import { computeLabelPlan, cacheKey, confirmSpending, CONFIRM_PHRASE, LABEL_CREDIT_COST } from "../../shared/labelPlan.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const slugs = Array.isArray(body?.case_slugs)
      ? body.case_slugs.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
      : [];
    const preview = !!body?.preview;
    const refresh = !!body?.refresh;
    const confirm = body?.confirm;
    if (slugs.length === 0) {
      return Response.json({ error: "case_slugs is required (non-empty array)." }, { status: 400 });
    }
    // Run (non-preview) requires explicit typed confirmation to spend credits.
    if (!preview && !confirmSpending(confirm)) {
      return Response.json({ error: `Confirmation required: type "${CONFIRM_PHRASE}" to spend label credits.` }, { status: 400 });
    }

    // Fetch completed trials, match slugs in memory.
    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" }, "-created_date", 200
    );
    const bySlug = {};
    for (const t of (trials || [])) bySlug[t.public_slug] = t;

    const eligibleCases = [];
    const ineligible = [];
    for (const s of slugs) {
      const t = bySlug[s];
      if (t && t.status === "completed" && t.data_mode === "live") {
        eligibleCases.push({
          case_slug: s,
          normalized_wallet_address: t.normalized_wallet_address || t.wallet_address,
          network: t.network,
          _trial: t
        });
      } else {
        ineligible.push(s);
      }
    }

    // Build label cache by normalized address + network.
    const labelSets = await base44.asServiceRole.entities.WalletLabelSet.list("-labeled_at", 500);
    const cacheByKey = {};
    for (const ls of (labelSets || [])) {
      if (!ls.normalized_wallet_address || !ls.network) continue;
      const k = cacheKey(ls.normalized_wallet_address, ls.network);
      if (!cacheByKey[k] || new Date(ls.labeled_at || 0) > new Date(cacheByKey[k].labeled_at || 0)) {
        cacheByKey[k] = { labeled_at: ls.labeled_at, id: ls.id };
      }
    }

    const plan = computeLabelPlan(eligibleCases, cacheByKey, { refresh });

    // Credit balance: most recent non-null credits_remaining from NansenApiUsage.
    const recentUsage = await base44.asServiceRole.entities.NansenApiUsage.list("-called_at", 50);
    let creditBalance = null;
    for (const u of (recentUsage || [])) {
      if (u.credits_remaining != null) { creditBalance = u.credits_remaining; break; }
    }

    const planPayload = {
      preview: true,
      refresh,
      requested: slugs.length,
      eligible: eligibleCases.length,
      ineligible,
      selected_cases: eligibleCases.map((c) => c.case_slug),
      already_cached: plan.already_cached,
      eligible_for_refresh: plan.eligible_for_refresh,
      new_label_calls: plan.new_label_calls,
      estimated_credit_cost: plan.estimated_credit_cost,
      label_credit_cost_each: LABEL_CREDIT_COST,
      credit_balance: creditBalance,
      slugs_to_update: plan.to_call.map((c) => c.case_slug),
      cost_warning: "Address Labels costs 100 Nansen credits per uncached wallet."
    };
    if (preview) return Response.json(planPayload);

    // RUN: call labels only for plan.to_call. One labels call per wallet.
    const apiKey = secrets.get("NANSEN_API_KEY");
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: "NANSEN_API_KEY not configured.", results: [] }, { status: 503 });
    }

    const toCallSlugs = new Set(plan.to_call.map((c) => c.case_slug));
    const results = [];
    for (const c of eligibleCases) {
      if (!toCallSlugs.has(c.case_slug)) {
        results.push({
          case_slug: c.case_slug,
          status: "skipped_cached",
          reason: "Cached label result exists. Use Refresh Labels to re-fetch stale (>30d) entries."
        });
        continue;
      }
      const t = c._trial;
      const lr = await fetchAddressLabels(apiKey, c.network, c.normalized_wallet_address, 20000);
      logUsage(base44, c.case_slug, "live", [lr.callResult]);

      if (!lr.ok) {
        results.push({ case_slug: c.case_slug, status: "labels_failed", error_category: lr.callResult.errorCategory, http_status: lr.callResult.status });
        continue;
      }

      // Recompute verdict + scores from saved performance metrics + new class.
      const parsed = safeParse(t.metrics_json, {});
      const meta = parsed._meta || {};
      meta.wallet_class = lr.walletClass;
      meta.labels_ok = true;
      const savedMetrics = { ...parsed };
      delete savedMetrics._meta;
      const partial = !!(meta.partial);
      const verdict = recomputeVerdictFromLabels(lr.walletClass, savedMetrics);
      const { severity, confidence } = computeSeverityConfidence(savedMetrics, partial);

      const savedEvidence = safeParse(t.evidence_items_json, []);
      const withoutClass = savedEvidence.filter((e) => e.tag !== "NANSEN · LABELS");
      const newEvidence = [walletClassEvidence(lr.walletClass), ...withoutClass];

      const savedSources = safeParse(t.source_endpoints_json, []);
      const newSources = savedSources.map((s) => s.startsWith("nansen:address_labels:") ? "nansen:address_labels:live" : s);
      if (!newSources.some((s) => s.startsWith("nansen:address_labels:"))) {
        newSources.push("nansen:address_labels:live");
      }

      const before = {
        wallet_class: t.wallet_class || "unknown",
        verdict_name: t.verdict_name,
        verdict_code: t.verdict_code,
        severity_score: t.severity_score,
        confidence_score: t.confidence_score
      };

      await base44.asServiceRole.entities.WalletTrial.update(t.id, {
        wallet_class: lr.walletClass,
        verdict_code: verdict.code,
        verdict_name: verdict.display_name,
        headline: verdict.headline,
        roast: verdict.roast,
        defense_statement: verdict.defense,
        sentence: verdict.sentence,
        severity_score: severity,
        confidence_score: confidence,
        evidence_items_json: JSON.stringify(newEvidence),
        metrics_json: JSON.stringify({ ...savedMetrics, _meta: meta }),
        source_endpoints_json: JSON.stringify(newSources)
      });

      // Upsert WalletLabelSet (cache by normalized address + network).
      const ck = cacheKey(c.normalized_wallet_address, c.network);
      const existingId = cacheByKey[ck]?.id;
      const labelRec = {
        case_slug: c.case_slug,
        normalized_wallet_address: c.normalized_wallet_address,
        network: c.network,
        wallet_class: lr.walletClass,
        labels_json: JSON.stringify(lr.rawLabels),
        label_count: lr.rawLabels.length,
        labeled_at: new Date().toISOString()
      };
      if (existingId) {
        waitUntil(base44.asServiceRole.entities.WalletLabelSet.update(existingId, labelRec).catch(() => {}));
      } else {
        waitUntil(base44.asServiceRole.entities.WalletLabelSet.create(labelRec).catch(() => {}));
      }

      results.push({
        case_slug: c.case_slug,
        status: "enriched",
        before,
        after: {
          wallet_class: lr.walletClass,
          verdict_name: verdict.display_name,
          verdict_code: verdict.code,
          severity_score: severity,
          confidence_score: confidence
        },
        labels_count: lr.rawLabels.length
      });
    }

    return Response.json({
      results,
      calls_made: results.filter((r) => r.status === "enriched").length
    });
  } catch (error) {
    return Response.json({ error: error.message || "Backfill failed." }, { status: 500 });
  }
}

function safeParse(s, fallback) {
  try { return JSON.parse(s) || fallback; } catch { return fallback; }
}