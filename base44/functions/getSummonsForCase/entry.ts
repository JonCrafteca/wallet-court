// Wallet Court — get the public summons for a case page. Public endpoint
// (no auth required). Returns sanitized summons data only — never exposes
// creator_user_id, abuse_status, confirmed_post_url, management_token_hash,
// handle_history_json, or internal IDs. Prefers an active intended-defendant
// summons (with a handle) over anonymous-defendant ones. Includes is_creator
// for the authenticated user so the UI can show edit controls.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sanitizeSummonsPublic, findActiveIntendedDefendant } from "../../shared/summons.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch {}
    const { case_slug } = body || {};
    if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });

    // Get all clean summons for this case
    const results = await base44.asServiceRole.entities.Summons.filter(
      { case_slug, abuse_status: "clean" },
      "-created_at",
      10
    );

    // Prefer an active intended-defendant summons (with a handle)
    const summons = findActiveIntendedDefendant(results || []) || (results && results[0]) || null;

    // Check if the current user is the creator (for edit controls)
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      // not authenticated
    }

    const sanitized = summons ? sanitizeSummonsPublic(summons) : null;
    if (sanitized) {
      sanitized.is_creator = !!(user && summons.creator_user_id === user.id);
    }

    return Response.json({ summons: sanitized });
  } catch (error) {
    return Response.json({ error: error.message || "Could not load summons." }, { status: 500 });
  }
}