// Wallet Court → ShoutIt admin manual retry. Admin-only. Retries delivery for a
// specific event_id, regardless of its current status (including permanently
// failed). Uses the real production signing path and receiver URL.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";
import { findByEventId, deliverOneEvent } from "../../shared/attributionStore.ts";
import { sanitizeOutboxForAdmin } from "../../shared/attribution.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const secret = secrets.get("WALLET_COURT_ATTRIBUTION_SECRET");
    if (!secret || !secret.trim()) {
      return Response.json({ error: "Attribution secret not configured." }, { status: 500 });
    }

    let body = {};
    try { body = await req.json(); } catch {}
    const eventId = body.event_id;
    if (!eventId) return Response.json({ error: "event_id is required." }, { status: 400 });

    const record = await findByEventId(base44, String(eventId));
    if (!record) return Response.json({ error: "Event not found." }, { status: 404 });

    const result = await deliverOneEvent(base44, record, secret.trim());

    // Re-fetch the updated record for the response
    const updated = await findByEventId(base44, String(eventId));
    return Response.json({
      result: {
        delivered: result.delivered,
        retry: result.retry,
        permanent_failure: result.permanentFailure,
        status_code: result.statusCode,
        receiver_result: result.receiverResult,
        error_code: result.errorCode,
        error_summary: result.errorSummary,
      },
      event: updated ? sanitizeOutboxForAdmin(updated) : null,
    });
  } catch (error) {
    return Response.json({ error: error.message || "Retry failed." }, { status: 500 });
  }
}