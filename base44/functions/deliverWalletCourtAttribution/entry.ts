// Wallet Court → ShoutIt attribution delivery processor. Processes pending and
// retry-scheduled outbox items: signs each payload with HMAC-SHA256 and sends
// it to the ShoutIt receiver. Called by the scheduled workflow and manually by
// admins. Does not require auth (callable by the workflow engine); only uses
// asServiceRole for outbox operations and returns only aggregate counts.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";
import { getPendingEvents, deliverOneEvent } from "../../shared/attributionStore.ts";

const MAX_PER_RUN = 20;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const secret = secrets.get("WALLET_COURT_ATTRIBUTION_SECRET");
    if (!secret || !secret.trim()) {
      return Response.json({ error: "Attribution secret not configured." }, { status: 500 });
    }

    const events = await getPendingEvents(base44, MAX_PER_RUN);
    if (!events || events.length === 0) {
      return Response.json({ processed: 0, delivered: 0, failed: 0, retried: 0 });
    }

    let delivered = 0, failed = 0, retried = 0;
    for (const record of events) {
      try {
        const result = await deliverOneEvent(base44, record, secret.trim());
        if (result.delivered) delivered++;
        else if (result.permanentFailure) failed++;
        else retried++;
      } catch {
        failed++;
      }
    }

    return Response.json({
      processed: events.length,
      delivered,
      failed,
      retried,
    });
  } catch (error) {
    return Response.json({ error: error.message || "Delivery failed." }, { status: 500 });
  }
}