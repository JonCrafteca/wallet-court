// Wallet Court — admin-only Official Defense moderation. Approve, reject, or
// hide a defense version. Produces an internal audit record (moderated_by,
// moderated_at, moderation_note). Only admins can moderate.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

const VALID_ACTIONS = ["approve", "reject", "hide"];
const ACTION_STATUS = { approve: "approved", reject: "rejected", hide: "hidden" };

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { id, action, note } = body || {};
    if (!id || !action) return Response.json({ error: "id and action are required." }, { status: 400 });
    if (!VALID_ACTIONS.includes(action)) return Response.json({ error: "Invalid action." }, { status: 400 });

    const nowIso = new Date().toISOString();
    const updated = await base44.asServiceRole.entities.OfficialDefense.update(id, {
      moderation_status: ACTION_STATUS[action],
      moderated_at: nowIso,
      moderated_by: user.id,
      moderation_note: note || null
    });
    return Response.json({ defense: updated });
  } catch (error) {
    return Response.json({ error: error.message || "Moderation failed." }, { status: 500 });
  }
}