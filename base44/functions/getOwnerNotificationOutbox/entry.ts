// Wallet Court — admin-only read of the owner notification outbox. Returns
// status counts, recent events (sanitized), last sent, and last error.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getOutboxStats, getRecentEvents } from "../../shared/ownerNotificationStore.ts";
import { sanitizeEventForAdmin } from "../../shared/ownerNotifications.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const [stats, recent] = await Promise.all([
      getOutboxStats(base44),
      getRecentEvents(base44, 50)
    ]);

    return Response.json({
      stats: {
        pending: stats.pending,
        processing: stats.processing,
        sent: stats.sent,
        failed: stats.failed,
        dead_letter: stats.dead_letter,
        total: stats.total
      },
      last_sent: stats.last_sent ? sanitizeEventForAdmin(stats.last_sent) : null,
      last_error: stats.last_error ? sanitizeEventForAdmin(stats.last_error) : null,
      recent: (recent || []).map(sanitizeEventForAdmin)
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load outbox." }, { status: 500 });
  }
}