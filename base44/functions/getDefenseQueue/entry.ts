// Wallet Court — admin-only Official Defense moderation queue. Lists pending
// defenses with claim context for admin review. Never exposes owner PII.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const statusFilter = body?.status || "pending";

    const query = {};
    if (statusFilter !== "all") query.moderation_status = statusFilter;

    const defenses = await base44.asServiceRole.entities.OfficialDefense.filter(
      query, "-submitted_at", 100
    );
    return Response.json({ defenses: defenses || [] });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load defenses." }, { status: 500 });
  }
}