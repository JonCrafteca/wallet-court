// Wallet Court — admin-only manual retry of a single owner notification event.
// Retries any non-sent event (pending, failed, dead_letter, or stale
// processing). Atomically claims the event, sends the email, and marks
// sent/failed/dead-letter. Does NOT touch sent events.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import {
  findByEventId, claimEvent, deliverOneEvent, markSent, markFailed
} from "../../shared/ownerNotificationStore.ts";
import { newLockId, sanitizeEventForAdmin, NOTIFICATION_STATUS } from "../../shared/ownerNotifications.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const eventId = body.event_id;
    if (!eventId) return Response.json({ error: "event_id is required." }, { status: 400 });

    const record = await findByEventId(base44, String(eventId));
    if (!record) return Response.json({ error: "Event not found." }, { status: 404 });
    if (record.status === NOTIFICATION_STATUS.SENT) {
      return Response.json({ error: "Event already sent." }, { status: 409 });
    }

    const lockId = newLockId();
    const claimed = await claimEvent(base44, record, lockId);
    if (!claimed) {
      return Response.json({ error: "Event is being processed by another worker." }, { status: 409 });
    }

    const result = await deliverOneEvent(base44, record);
    if (result.sent) {
      await markSent(base44, record);
    } else {
      await markFailed(base44, record, result.error);
    }

    const updated = await findByEventId(base44, String(eventId));
    return Response.json({
      sent: result.sent,
      error: result.error || null,
      event: updated ? sanitizeEventForAdmin(updated) : null
    });
  } catch (error) {
    return Response.json({ error: error.message || "Retry failed." }, { status: 500 });
  }
}