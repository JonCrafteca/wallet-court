// Wallet Court — update a summons status or edit the intended handle.
// Authorization: authenticated creator OR valid anonymous management capability
// token OR admin (for deactivation). Validates status transitions to ensure
// truthful states. Records immutable history for handle changes and
// deactivations. Never auto-confirms publication. Never allows status rollback.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  isValidStatusTransition,
  sanitizeSummonsPublic,
  normalizeXHandleInput,
  canEditHandle,
  appendHandleHistory,
  verifyManagementToken,
} from "../../shared/summons.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch {}
    const {
      summons_id,
      status,
      share_method,
      confirmed_post_url,
      display_handle,
      management_token,
      admin_action,
      admin_reason,
    } = body || {};

    if (!summons_id) {
      return Response.json({ error: "summons_id is required." }, { status: 400 });
    }

    // Find the summons
    const results = await base44.asServiceRole.entities.Summons.filter(
      { summons_id },
      "-created_at",
      1
    );
    const summons = results && results[0];
    if (!summons) return Response.json({ error: "Summons not found." }, { status: 404 });

    // Try to get authenticated user (optional — may use management token instead)
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      // not authenticated — may still be authorized via management token
    }

    const isCreator = user && summons.creator_user_id === user.id;
    const isAdmin = user?.role === "admin";

    // --- Admin deactivation ---
    if (admin_action === "deactivate") {
      if (!isAdmin) {
        return Response.json({ error: "Admin access required to deactivate a summons." }, { status: 403 });
      }
      if (!admin_reason || !String(admin_reason).trim()) {
        return Response.json({ error: "A moderation reason is required to deactivate a summons." }, { status: 400 });
      }
      const historyJson = appendHandleHistory(summons.handle_history_json, {
        action: "deactivated",
        from: summons.display_handle || null,
        to: null,
        reason: String(admin_reason).trim(),
        at: new Date().toISOString(),
        by: user.id,
      });
      const updated = await base44.asServiceRole.entities.Summons.update(summons.id, {
        abuse_status: "blocked",
        handle_history_json: historyJson,
        updated_at: new Date().toISOString(),
      });
      return Response.json({ summons: sanitizeSummonsPublic(updated) });
    }

    // --- Authorization: authenticated creator OR management capability token ---
    let authorized = isCreator;
    if (!authorized && management_token && summons.management_token_hash) {
      authorized = await verifyManagementToken(management_token, summons.management_token_hash);
      if (!authorized) {
        return Response.json({ error: "Invalid or expired management capability." }, { status: 403 });
      }
    }
    if (!authorized) {
      return Response.json({ error: "You do not have permission to update this summons." }, { status: 403 });
    }

    // --- Handle editing (before summons is served) ---
    if (display_handle !== undefined && display_handle !== null) {
      if (!canEditHandle(summons)) {
        return Response.json({ error: "Cannot edit the handle after the summons is served." }, { status: 400 });
      }
      const result = normalizeXHandleInput(display_handle);
      if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
      if (!result.handle) {
        return Response.json({ error: "A valid handle is required." }, { status: 400 });
      }

      const historyJson = appendHandleHistory(summons.handle_history_json, {
        action: "handle_changed",
        from: summons.display_handle || null,
        to: result.handle,
        reason: null,
        at: new Date().toISOString(),
        by: user?.id || "anonymous",
      });

      const updated = await base44.asServiceRole.entities.Summons.update(summons.id, {
        display_handle: result.handle,
        normalized_target_handle: result.normalized,
        handle_history_json: historyJson,
        updated_at: new Date().toISOString(),
      });
      return Response.json({ summons: sanitizeSummonsPublic(updated) });
    }

    // --- Status update ---
    if (!status) {
      return Response.json({ error: "status or display_handle is required." }, { status: 400 });
    }

    if (!isValidStatusTransition(summons.status, status)) {
      return Response.json({
        error: `Cannot transition from "${summons.status}" to "${status}".`,
      }, { status: 400 });
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (share_method) updateData.share_method = share_method;
    if (confirmed_post_url && status === "summons_served_self_reported") {
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