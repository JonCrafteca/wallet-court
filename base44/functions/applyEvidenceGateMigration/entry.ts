// Wallet Court — Phase N2.3 evidence-gate migration (admin-only).
// Migrates a explicit allowlist of completed LIVE cases to a evidence-sufficiency
// outcome (dismissed_no_evidence / mistrial_insufficient_evidence) using ONLY the
// already-saved Nansen metrics. Makes ZERO Nansen API calls. Preserves permanent
// slugs, wallet/network identity, original evidence, metrics, sources, evidence
// timestamps, partial-evidence flags, and privacy protections.
//
// For each allowlisted slug, verifies BEFORE writing:
//   - wallet/network identity matches the approved preview
//   - the evidence-gate classifies the saved profile as the expected outcome
//   - (dismissed) all performance endpoints succeeded (failed_sources empty) and
//     no affirmative activity exists
// Any precondition mismatch skips the record (no write) and is reported — the
// migration never broadens or improvises beyond the allowlist.
//
// Updated fields: case_outcome + verdict output fields (nulled) + rescore_audit_json.
// Evidence/metrics/sources/slug/identity are NEVER touched.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { classifyOutcome, buildOutcomeUpdate } from "../../shared/evidenceGate.ts";

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
    const expectedIdentity = body?.expected_identity || null;
    const expectedAfter = body?.expected_after || null; // { slug: "dismissed_no_evidence" | "mistrial_insufficient_evidence" }
    const migrationTag = typeof body?.migration_tag === "string" ? body.migration_tag : "N2.3";

    if (!slugs || !slugs.length) {
      return Response.json({ error: "case_slugs allowlist is required." }, { status: 400 });
    }

    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed", data_mode: "live" }, "-created_date", 200
    );
    const want = new Set(slugs);
    const eligible = (trials || []).filter((t) => t.public_slug && want.has(t.public_slug));

    const rows = [];
    const records_written = [];
    const mismatches = [];
    let attempted = 0, successful = 0, skipped = 0;

    for (const t of eligible) {
      attempted++;
      const slug = t.public_slug;

      // Precondition 1 — identity (network + abbreviated address).
      if (expectedIdentity && expectedIdentity[slug]) {
        const ei = expectedIdentity[slug];
        const addr = t.normalized_wallet_address || t.wallet_address || "";
        const short = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";
        if (t.network !== ei.network || short !== ei.address_short) {
          skipped++;
          mismatches.push({ case_slug: slug, reason: "identity mismatch", current: { network: t.network, address_short: short }, expected: ei });
          continue;
        }
      }

      // Parse saved metrics + meta (never re-fetch).
      let saved = {};
      try { saved = JSON.parse(t.metrics_json) || {}; } catch { saved = {}; }
      const meta = saved._meta || {};
      const metrics = { ...saved };
      delete metrics._meta;

      // Precondition 2 — gate classification matches the expected outcome.
      const gateOutcome = classifyOutcome(metrics, meta);
      const expected = expectedAfter && expectedAfter[slug] ? expectedAfter[slug] : "dismissed_no_evidence";
      if (gateOutcome !== expected) {
        skipped++;
        mismatches.push({ case_slug: slug, reason: "gate classification mismatch", computed: gateOutcome, expected });
        continue;
      }
      // Precondition 3 (dismissed only) — endpoints must have succeeded.
      if (gateOutcome === "dismissed_no_evidence") {
        const failedSources = Array.isArray(meta.failed_sources) ? meta.failed_sources : [];
        if (failedSources.length > 0) {
          skipped++;
          mismatches.push({ case_slug: slug, reason: "endpoint failures present — not a successful empty profile", failed_sources: failedSources });
          continue;
        }
      }

      const update = buildOutcomeUpdate(t, gateOutcome, migrationTag);
      const auditNote = JSON.parse(update.rescore_audit_json);

      if (preview) {
        rows.push({ case_slug: slug, status: `would_${gateOutcome}`, before: auditNote.previous, after: { case_outcome: gateOutcome }, audit_note: auditNote });
        continue;
      }

      await base44.asServiceRole.entities.WalletTrial.update(t.id, update);

      successful++;
      records_written.push({
        id: t.id,
        case_slug: slug,
        fields_written: Object.keys(update)
      });
      rows.push({ case_slug: slug, status: gateOutcome, before: auditNote.previous, after: { case_outcome: gateOutcome }, audit_note: auditNote });
    }

    return Response.json({
      preview,
      nansen_calls_made: 0,
      attempted,
      successful,
      skipped,
      mismatches,
      dismissed: successful,
      records_written,
      results: rows
    });
  } catch (error) {
    return Response.json({ error: error.message || "Migration failed." }, { status: 500 });
  }
}