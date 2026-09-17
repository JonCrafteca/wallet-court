// Wallet Court — admin-only label-only backfill ("Enrich Existing Cases With
// Nansen Labels"). Calls ONLY the Address Labels endpoint per case, reuses
// saved performance evidence, recomputes classification + verdict + roast +
// sentence + severity + confidence, and preserves the existing permanent case
// slug. Never makes the four performance calls. Never runs automatically.
//
// Safety:
//  - Admin-only.
//  - Preview mode (body.preview=true) returns expected calls without running.
//  - Duplicate-simultaneous-run guard: skips cases with a labels call logged
//    in the last 60 seconds.
//  - Reports before/after per case.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets, waitUntil } from "base44:runtime";
import { callEndpoint, logUsage, CHAIN_BY_NETWORK } from "../../shared/nansen.ts";
import { normalizeWalletClass, walletClassEvidence } from "../../shared/walletClass.ts";
import { recomputeVerdictFromLabels } from "../../shared/verdicts_entity.ts";
import { computeSeverityConfidence } from "../../shared/verdicts_live.ts";

const LABELS_EP = { key: "address_labels", path: "/api/v1/profiler/address/labels", required: false, needsDateRange: false, dateFmt: null, paginated: true };

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
    if (slugs.length === 0) {
      return Response.json({ error: "case_slugs is required (non-empty array)." }, { status: 400 });
    }

    // Fetch completed trials and match the requested slugs in memory (avoids
    // relying on $in support).
    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" }, "-created_date", 200
    );
    const bySlug = {};
    for (const t of (trials || [])) bySlug[t.public_slug] = t;

    // Eligible = completed live cases with saved performance evidence.
    const eligible = slugs.filter((s) => {
      const t = bySlug[s];
      return t && t.status === "completed" && t.data_mode === "live";
    });

    if (preview) {
      return Response.json({
        preview: true,
        requested: slugs.length,
        eligible: eligible.length,
        expected_calls: eligible.length,
        eligible_slugs: eligible,
        ineligible: slugs.filter((s) => !eligible.includes(s))
      });
    }

    // Duplicate-simultaneous-run guard: skip cases with a labels call in the
    // last 60 seconds.
    const recent = await base44.asServiceRole.entities.NansenApiUsage.filter(
      { endpoint: "address_labels" }, "-called_at", 100
    );
    const now = Date.now();
    const recentSlugs = new Set();
    for (const u of (recent || [])) {
      if (u.called_at && (now - new Date(u.called_at).getTime()) < 60000 && eligible.includes(u.case_slug)) {
        recentSlugs.add(u.case_slug);
      }
    }

    const apiKey = secrets.get("NANSEN_API_KEY");
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: "NANSEN_API_KEY not configured.", results: [] }, { status: 503 });
    }

    const results = [];
    for (const slug of eligible) {
      if (recentSlugs.has(slug)) {
        results.push({ case_slug: slug, status: "skipped_recent", reason: "A labels call for this case was logged in the last 60 seconds." });
        continue;
      }
      const t = bySlug[slug];
      const chain = CHAIN_BY_NETWORK[t.network];
      if (!chain) {
        results.push({ case_slug: slug, status: "unsupported_chain" });
        continue;
      }
      const addr = t.normalized_wallet_address || t.wallet_address;

      // ONE labels call only — no performance calls.
      const r = await callEndpoint(apiKey, LABELS_EP, { address: addr, chain, pagination: { page: 1, per_page: 1000 } }, 20000);
      r.chain = chain;
      logUsage(base44, slug, "live", [r]);

      if (!r.ok) {
        results.push({ case_slug: slug, status: "labels_failed", error_category: r.errorCategory, http_status: r.status });
        continue;
      }

      const data = (r.json && (r.json.data || r.json.labels)) || [];
      const rawLabels = Array.isArray(data) ? data : [];
      const walletClass = normalizeWalletClass(rawLabels);

      // Reuse saved performance evidence; recompute verdict + scores from the
      // saved metrics + the new wallet class.
      const parsed = safeParse(t.metrics_json, {});
      const meta = parsed._meta || {};
      meta.wallet_class = walletClass;
      meta.labels_ok = true;
      const savedMetrics = { ...parsed };
      delete savedMetrics._meta;
      const partial = !!(meta.partial);
      const verdict = recomputeVerdictFromLabels(walletClass, savedMetrics);
      const { severity, confidence } = computeSeverityConfidence(savedMetrics, partial);

      // Prepend the wallet class card; drop any prior one.
      const savedEvidence = safeParse(t.evidence_items_json, []);
      const withoutClass = savedEvidence.filter((e) => e.tag !== "NANSEN · LABELS");
      const newEvidence = [walletClassEvidence(walletClass), ...withoutClass];

      // Update the labels source line; preserve all other sources.
      const savedSources = safeParse(t.source_endpoints_json, []);
      const newSources = savedSources
        .map((s) => s.startsWith("nansen:address_labels:") ? "nansen:address_labels:live" : s);
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
        wallet_class: walletClass,
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

      // Persist raw labels (admin-only).
      waitUntil(base44.asServiceRole.entities.WalletLabelSet.create({
        case_slug: slug,
        wallet_class: walletClass,
        labels_json: JSON.stringify(rawLabels),
        label_count: rawLabels.length,
        labeled_at: new Date().toISOString()
      }).catch(() => {}));

      results.push({
        case_slug: slug,
        status: "enriched",
        before,
        after: {
          wallet_class: walletClass,
          verdict_name: verdict.display_name,
          verdict_code: verdict.code,
          severity_score: severity,
          confidence_score: confidence
        },
        labels_count: rawLabels.length
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