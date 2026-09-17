// Wallet Court — admin-only re-score of saved pilot cases (Phase N2.2).
// Re-runs the EXPANDED performance verdict engine against each completed LIVE
// case's ALREADY-SAVED Nansen metrics. Makes NO Nansen API calls and does NOT
// touch the Address Labels cost guard. Permanent case slugs are preserved —
// only verdict text + severity + confidence are recomputed in place.
//
//   preview=true  → returns before/after for every eligible case, no writes.
//   preview=false → updates each WalletTrial in place with the new verdict,
//                   headline, roast, defense, sentence, severity, confidence.
//                   Metrics, evidence, sources, slug, and wallet_class are
//                   preserved unchanged.
//
// Admin-only. No external API. No secrets. No network.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { selectEntityVerdict } from "../../shared/verdicts_entity.ts";
import { computeSeverityConfidence } from "../../shared/verdicts_live.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const preview = body?.preview !== false;
    const slugs = Array.isArray(body?.case_slugs)
      ? body.case_slugs.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
      : null;

    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed", data_mode: "live" }, "-created_date", 200
    );
    let eligible = (trials || []).filter((t) => t.public_slug);
    if (slugs && slugs.length) {
      const want = new Set(slugs);
      eligible = eligible.filter((t) => want.has(t.public_slug));
    }

    const rows = eligible.map((t) => {
      const saved = safeParse(t.metrics_json, {});
      const meta = saved._meta || {};
      const metrics = { ...saved };
      delete metrics._meta;
      const partial = !!(meta.partial);
      const walletClass = t.wallet_class || "unknown";
      const verdict = selectEntityVerdict(walletClass, metrics);
      const { severity, confidence } = computeSeverityConfidence(metrics, partial);
      const addr = t.normalized_wallet_address || t.wallet_address || "";
      const short = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";
      return {
        case_slug: t.public_slug,
        id: t.id,
        address_short: short,
        network: t.network,
        wallet_class: walletClass,
        before: {
          verdict_code: t.verdict_code,
          verdict_name: t.verdict_name,
          severity_score: t.severity_score,
          confidence_score: t.confidence_score
        },
        after: {
          verdict_code: verdict.code,
          verdict_name: verdict.display_name,
          severity_score: severity,
          confidence_score: confidence
        },
        changed: (verdict.code !== t.verdict_code)
          || (t.severity_score !== severity)
          || (t.confidence_score !== confidence)
      };
    });

    if (preview) {
      return Response.json({
        preview: true,
        nansen_calls_made: 0,
        eligible: rows.length,
        rows
      });
    }

    // APPLY: update each trial in place. No Nansen calls. Slugs preserved.
    const results = [];
    for (const r of rows) {
      const t = eligible.find((x) => x.public_slug === r.case_slug);
      if (!t) continue;
      const verdict = selectEntityVerdict(r.wallet_class, safeParse(t.metrics_json, {}));
      // recompute to get the object (already have r.after scores)
      await base44.asServiceRole.entities.WalletTrial.update(t.id, {
        verdict_code: r.after.verdict_code,
        verdict_name: r.after.verdict_name,
        headline: verdict.headline,
        roast: verdict.roast,
        defense_statement: verdict.defense,
        sentence: verdict.sentence,
        severity_score: r.after.severity_score,
        confidence_score: r.after.confidence_score
      });
      results.push({
        case_slug: r.case_slug,
        status: "rescored",
        before: r.before,
        after: r.after,
        changed: r.changed
      });
    }

    return Response.json({
      preview: false,
      nansen_calls_made: 0,
      rescored: results.length,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message || "Re-score failed." }, { status: 500 });
  }
}

function safeParse(s, fallback) {
  try { return JSON.parse(s) || fallback; } catch { return fallback; }
}