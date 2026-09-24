// Wallet Court — signup notification trigger. Called by the OnWalletCourtSignup
// workflow (app_user_auth trigger, events: ["signup"] only). Enqueues one
// owner notification for genuinely new accounts. Does NOT fire on login,
// token refresh, password reset, or returning users — the workflow only
// triggers on signup events.
//
// This function does NOT send an email — it only enqueues. The scheduled
// delivery worker picks up pending events and sends them. If the settings
// are disabled (master off, signup toggle off, or no recipient), the enqueue
// is a silent no-op.
//
// Callable by the workflow engine (no user session). Uses asServiceRole for
// all entity operations. Does not modify any existing data — only creates
// outbox records.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { enqueueNotification } from "../../shared/ownerNotificationStore.ts";
import { EVENT_TYPES } from "../../shared/ownerNotifications.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}
    const { user_id, email, auth_method, full_name, occurred_at } = body || {};
    if (!user_id) return Response.json({ error: "user_id is required." }, { status: 400 });

    const result = await enqueueNotification(base44, {
      event_type: EVENT_TYPES.SIGNUP,
      source_entity: "User",
      source_record_id: String(user_id),
      metadata: {
        user_email: email || "Unknown",
        user_name: full_name || "Not set",
        auth_method: auth_method || "unknown",
        occurred_at: occurred_at || new Date().toISOString()
      }
    });

    return Response.json({
      enqueued: result.ok && !result.duplicate,
      duplicate: result.duplicate,
      skipped: !result.ok,
      event_id: result.event_id || null,
      reason: result.reason || ""
    });
  } catch (error) {
    return Response.json({ error: error.message || "Signup notification failed." }, { status: 500 });
  }
}