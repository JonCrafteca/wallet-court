// Wallet Court — Single Trade Trial: admin settings endpoint. Saves the
// usage policy settings. Admin-only. Uses CAS on the singleton.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { savePolicy, getPolicyForAdmin } from "../../shared/singleTradeUsageStore.ts";

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
    const dailyLimit = parseInt(body?.daily_physical_call_limit, 10);
    const discoveriesPerHour = parseInt(body?.discoveries_per_wallet_per_hour, 10);
    const analysesPerDay = parseInt(body?.analyses_per_wallet_per_day, 10);

    if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) {
      return Response.json({ error: "Daily call limit must be between 1 and 10,000." }, { status: 400 });
    }
    if (!Number.isFinite(discoveriesPerHour) || discoveriesPerHour < 1 || discoveriesPerHour > 100) {
      return Response.json({ error: "Discoveries per wallet per hour must be between 1 and 100." }, { status: 400 });
    }
    if (!Number.isFinite(analysesPerDay) || analysesPerDay < 1 || analysesPerDay > 100) {
      return Response.json({ error: "Analyses per wallet per day must be between 1 and 100." }, { status: 400 });
    }

    await savePolicy(base44, {
      enabled: !!body?.enabled,
      daily_physical_call_limit: dailyLimit,
      discoveries_per_wallet_per_hour: discoveriesPerHour,
      analyses_per_wallet_per_day: analysesPerDay,
      emergency_stop: !!body?.emergency_stop
    });

    const policy = await getPolicyForAdmin(base44);
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to save usage policy." }, { status: 500 });
  }
}