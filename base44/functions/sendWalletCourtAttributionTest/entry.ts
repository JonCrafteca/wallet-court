// Wallet Court → ShoutIt admin signed test. Admin-only. Enqueues one signed
// test event using a caller-provided ref code, delivers it immediately via the
// real production signing path and receiver URL, and returns the sanitized
// receiver response. Never requires a real wallet, never invokes Nansen, and
// never creates a real public trial. The event is marked with test_event=true
// in metadata so the receiver can distinguish it.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";
import { waitUntil } from "base44:runtime";
import { enqueueAttributionEvent, findByEventId, deliverOneEvent } from "../../shared/attributionStore.ts";
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
    const refCode = body.ref_code;
    if (!refCode) return Response.json({ error: "ref_code is required for the test." }, { status: 400 });

    // Enqueue a test event (trial_started with test metadata)
    const enqueueResult = await enqueueAttributionEvent(base44, {
      event_type: "trial_started",
      ref_code: refCode,
      visitor_id: "test_visitor_" + Date.now().toString(36),
      metadata: {
        test_event: true,
        source: "wallet_court_e2e_test",
      },
    });

    if (!enqueueResult.ok) {
      return Response.json({ error: enqueueResult.reason || "Could not enqueue test event." }, { status: 400 });
    }

    // Immediately deliver it
    const record = await findByEventId(base44, enqueueResult.event_id);
    if (!record) return Response.json({ error: "Test event was not persisted." }, { status: 500 });

    const deliveryResult = await deliverOneEvent(base44, record, secret.trim());
    const updated = await findByEventId(base44, enqueueResult.event_id);

    return Response.json({
      event_id: enqueueResult.event_id,
      delivery: {
        delivered: deliveryResult.delivered,
        retry: deliveryResult.retry,
        permanent_failure: deliveryResult.permanentFailure,
        status_code: deliveryResult.statusCode,
        receiver_result: deliveryResult.receiverResult,
        error_code: deliveryResult.errorCode,
        error_summary: deliveryResult.errorSummary,
      },
      event: updated ? sanitizeOutboxForAdmin(updated) : null,
    });
  } catch (error) {
    return Response.json({ error: error.message || "Test failed." }, { status: 500 });
  }
}