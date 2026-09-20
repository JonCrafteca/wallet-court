// Wallet Court — update a summons status. Requires authentication (creator
// only). Validates status transitions to ensure truthful states:
// - share_opened: X composer or share sheet opened (publication NOT confirmed)
// - summons_served_self_reported: user explicitly confirmed posting (self-reported)
// Never auto-confirms publication. Never allows status rollback.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  isValidStatusTransition,
  sanitizeSummonsPublic,
} from "../../shared/summons.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { summons_id, status, share_method, confirmed_post_url } = body || {};
    if (!summons_id || !status) {
      return Response.json({ error: "summons_id and status are required." }, { status: 400 });
    }

    // Find the summons
    const results = await base44.asServiceRole.entities.Summons.filter(
      { summons_id },
      "-created_at",
      1
    );
    const summons = results && results[0];
    if (!summons) return Response.json({ error: "Summons not found." }, { status: 404 });

    // Only the creator can update
    if (summons.creator_user_id !== user.id) {
      return Response.json({ error: "You do not own this summons." }, { status: 403 });
    }

    // Validate status transition
    if (!isValidStatusTransition(summons.status, status)) {
      return Response.json({
        error: `Cannot transition from "${summons.status}" to "${status}".`,
      }, { status: 400 });
    }

    // Build update data
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (share_method) updateData.share_method = share_method;
    // confirmed_post_url is only accepted for summons_served_self_reported
    if (confirmed_post_url && status === "summons_served_self_reported") {
      // Sanitize: must look like an X URL
      const lower = String(confirmed_post_url).toLowerCase();
      if (lower.includes("x.com") || lower.includes("twitter.com")) {
        updateData.confirmed_post_url = String(confirmed_post_url).trim().slice(0, 500);
      }
    }

    const updated = await base44.asServiceRole.entities.Summons.update(summons.id, updateData);
    return Response.json({ summons: sanitizeSummonsPublic(updated) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not update summons." }, { status: 500 });
  }
}