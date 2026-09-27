// Wallet Court — Whole-Wallet Production Trial: admin settings endpoint. Saves
// the usage policy settings. Admin-only. Uses CAS on the singleton.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { savePolicy, getPolicyForAdmin } from "../../shared/walletTrialUsageStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin auth check ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Sign in to access the admin dashboard." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    // Validate numeric fields.
    const dailyLimit = parseInt(body?.daily_call_limit, 10);

    if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) {
      return Response.json({ error: "Daily call limit must be between 1 and 10,000." }, { status: 400 });
    }

    await savePolicy(base44, {
      enabled: !!body?.enabled,
      daily_call_limit: dailyLimit,
      emergency_stop: !!body?.emergency_stop,
      updated_by_user_id: user.id
    });

    const policy = await getPolicyForAdmin(base44);
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to save usage policy." }, { status: 500 });
  }
}