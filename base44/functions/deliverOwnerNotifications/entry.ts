// Wallet Court — owner notification delivery worker. Called by the scheduled
// workflow every 5 minutes and manually by admins. Processes due events
// (pending + failed-due) and stale-processing events: atomically claims each,
// sends the email via SendEmail, and marks sent/failed/dead-letter.
//
// Does NOT touch sent or dead_letter events. Uses atomic claiming (CAS on
// status + processing_lock_id) so two concurrent workers cannot process the
// same event. Stale processing locks (older than 5 minutes) are reclaimed.
//
// Callable by the workflow engine (no user session). Uses asServiceRole.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import {
  getDueEvents, getStaleProcessingEvents, claimEvent,
  normalizeEventForClaiming, deliverOneEvent, markSent, markFailed
} from "../../shared/ownerNotificationStore.ts";
import { newLockId, NOTIFICATION_STATUS } from "../../shared/ownerNotifications.ts";

const MAX_PER_RUN = 20;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // Gather due events + stale-processing events
    const [dueEvents, staleEvents] = await Promise.all([
      getDueEvents(base44, MAX_PER_RUN),
      getStaleProcessingEvents(base44, 5)
    ]);
    const allEvents = [...(dueEvents || []), ...(staleEvents || [])];

    // Deduplicate by id
    const seen = new Set<string>();
    const events = allEvents.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    if (events.length === 0) {
      return Response.json({ processed: 0, sent: 0, failed: 0, dead_lettered: 0 });
    }

    let sent = 0, failed = 0, deadLettered = 0;
    for (const record of events) {
      // Normalize legacy events with missing lock fields before claiming.
      const normalized = await normalizeEventForClaiming(base44, record);
      const lockId = newLockId();
      // For stale-processing events, the status is "processing" — claimEvent
      // uses the record's current status in the CAS filter, so it works for
      // both pending/failed and stale-processing reclaim.
      const claimed = await claimEvent(base44, normalized, lockId);
      if (!claimed) continue; // Another worker won the race

      const result = await deliverOneEvent(base44, record);
      if (result.sent) {
        await markSent(base44, record);
        sent++;
      } else {
        const failResult = await markFailed(base44, record, result.error);
        if (failResult.dead_lettered) deadLettered++;
        else failed++;
      }
    }

    return Response.json({
      processed: events.length,
      sent,
      failed,
      dead_lettered: deadLettered
    });
  } catch (error) {
    return Response.json({ error: error.message || "Delivery failed." }, { status: 500 });
  }
}