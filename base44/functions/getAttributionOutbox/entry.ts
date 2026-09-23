// Wallet Court → ShoutIt admin outbox read. Admin-only. Returns outbox stats
// (pending, delivered, retry_scheduled, permanently_failed), recent events,
// last successful delivery, and last receiver error for the admin panel.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getOutboxStats, getRecentEvents } from "../../shared/attributionStore.ts";
import { sanitizeOutboxForAdmin } from "../../shared/attribution.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const [stats, recent] = await Promise.all([
      getOutboxStats(base44),
      getRecentEvents(base44, 50),
    ]);

    return Response.json({
      stats: {
        pending: stats.pending,
        delivered: stats.delivered,
        retry_scheduled: stats.retry_scheduled,
        permanently_failed: stats.permanently_failed,
        total: stats.total,
      },
      last_delivered: stats.last_delivered ? sanitizeOutboxForAdmin(stats.last_delivered) : null,
      last_error: stats.last_error ? sanitizeOutboxForAdmin(stats.last_error) : null,
      recent: (recent || []).map(sanitizeOutboxForAdmin),
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load outbox." }, { status: 500 });
  }
}