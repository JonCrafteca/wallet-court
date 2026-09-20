// Wallet Court — admin-only Contest Control dashboard data.
// Returns aggregate progress toward the 1,000-call target plus a paginated,
// sanitized recent-activity table from real NansenApiCallAudit records.
//
// Authorization: 401 when unauthenticated, 403 when non-admin. Authorization is
// performed BEFORE any audit record is queried. No private audit data is exposed;
// the entity never stores wallet addresses, keys, or bodies to begin with.
// Zero Nansen calls. Zero production data mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { aggregateStats, sanitizeAuditRowForExport, shortCorrelationId, CONTEST_TARGET } from "../../shared/nansenTelemetry.ts";

const MAX_RECORDS = 1000;
const DEFAULT_LIMIT = 25;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch { /* allow empty */ }
    const offset = Math.max(0, parseInt(body?.offset, 10) || 0);
    const limit = Math.min(Math.max(1, parseInt(body?.limit, 10) || DEFAULT_LIMIT), 100);

    // Read verified audit records (append-only). Cap at MAX_RECORDS for safety.
    const records = await base44.asServiceRole.entities.NansenApiCallAudit.list("-occurred_at", MAX_RECORDS);
    const all = records || [];

    // Aggregate over every verified record.
    const stats = aggregateStats(all, { target: CONTEST_TARGET });

    // Paginated, sanitized recent-activity rows (newest first).
    const page = all.slice(offset, offset + limit).map((r: any) => {
      const row = sanitizeAuditRowForExport(r);
      row.correlation_id_short = shortCorrelationId(row.correlation_id);
      return row;
    });

    return Response.json({
      stats,
      recent: page,
      total: all.length,
      offset,
      limit,
      has_more: offset + limit < all.length
    });
  } catch (error) {
    return Response.json({ error: error.message || "Contest control load failed." }, { status: 500 });
  }
}