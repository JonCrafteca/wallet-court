// Wallet Court — admin Court Desk: list submissions with optional filters.
// Admin-only: verifies the caller is authenticated and an admin.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}

    const query = {};
    if (body?.status) query.status = body.status;
    if (body?.verdict_name) query.verdict_name = body.verdict_name;
    if (body?.data_mode) query.data_mode = body.data_mode;
    if (body?.submission_type) query.submission_type = body.submission_type;

    const records = await base44.asServiceRole.entities.CourtDispatchSubmission.filter(
      query,
      "-submitted_at",
      100
    );
    return Response.json({ submissions: records || [] });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load submissions." }, { status: 500 });
  }
}