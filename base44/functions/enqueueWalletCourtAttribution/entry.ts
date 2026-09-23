// Wallet Court → ShoutIt attribution enqueue. Public endpoint (no auth required)
// called by the client for receipt_created and receipt_shared events. Also
// usable by any lifecycle point that needs to enqueue an attribution event.
//
// Validates the ref_code, generates a stable event_id, builds the payload, and
// persists a pending outbox record. Delivery happens asynchronously via the
// scheduled delivery function. Never blocks the user journey.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { waitUntil } from "base44:runtime";
import { enqueueAttributionEvent } from "../../shared/attributionStore.ts";
import { EVENT_TYPES } from "../../shared/attribution.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}

    const { event_type, ref_code, visitor_id } = body;
    if (!event_type || !EVENT_TYPES.includes(event_type)) {
      return Response.json({ error: "Invalid event_type." }, { status: 400 });
    }
    if (!ref_code) {
      return Response.json({ enqueued: false, reason: "no_ref_code" });
    }

    const result = await enqueueAttributionEvent(base44, {
      event_type,
      ref_code,
      visitor_id: visitor_id || "",
      external_trial_id: body.external_trial_id,
      external_case_id: body.external_case_id,
      external_receipt_id: body.external_receipt_id,
      wallet_address_short: body.wallet_address_short,
      share_channel: body.share_channel,
      metadata: body.metadata || {},
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message || "Enqueue failed." }, { status: 500 });
  }
}