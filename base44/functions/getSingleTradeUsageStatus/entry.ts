// Wallet Court — Single Trade Trial: admin status endpoint. Returns the
// current usage policy state for the admin dashboard. Admin-only.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getPolicyForAdmin } from "../../shared/singleTradeUsageStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin auth check ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Sign in to access the admin dashboard." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const policy = await getPolicyForAdmin(base44);
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load usage policy." }, { status: 500 });
  }
}