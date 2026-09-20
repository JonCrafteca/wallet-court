// Wallet Court — get the most recent public summons for a case page. Public
// endpoint (no auth required). Returns sanitized summons data only — never
// exposes creator_user_id, abuse_status, confirmed_post_url, or internal IDs.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sanitizeSummonsPublic } from "../../shared/summons.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch {}
    const { case_slug } = body || {};
    if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });

    // Get the most recent clean summons for this case
    const results = await base44.asServiceRole.entities.Summons.filter(
      { case_slug, abuse_status: "clean" },
      "-created_at",
      1
    );
    const summons = results && results[0];

    return Response.json({
      summons: summons ? sanitizeSummonsPublic(summons) : null,
    });
  } catch (error) {
    return Response.json({ error: error.message || "Could not load summons." }, { status: 500 });
  }
}