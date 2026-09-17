// Wallet Court — admin Court Desk: approve, reject, or mark a submission
// published (with the final X post URL). Admin-only.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const id = body?.id;
    const action = body?.action;
    if (!id || !action) return Response.json({ error: "id and action are required." }, { status: 400 });
    if (!["approve", "reject", "publish"].includes(action)) {
      return Response.json({ error: "Invalid action." }, { status: 400 });
    }

    const update = { reviewed_at: new Date().toISOString() };
    if (action === "approve") update.status = "approved";
    if (action === "reject") update.status = "rejected";
    if (action === "publish") {
      update.status = "published";
      if (body?.published_post_url) update.published_post_url = String(body.published_post_url).trim();
    }

    const updated = await base44.asServiceRole.entities.CourtDispatchSubmission.update(id, update);
    return Response.json({ submission: updated });
  } catch (error) {
    return Response.json({ error: error.message || "Update failed." }, { status: 500 });
  }
}