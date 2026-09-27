// Wallet Court — Whole-Wallet Production Trial: admin status endpoint. Returns
// the current usage policy state for the admin dashboard. Admin-only.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getPolicyForAdmin } from "../../shared/walletTrialUsageStore.ts";
import { getCountForCeilingCheck } from "../../shared/calibrationStore.ts";
import { CALIBRATION_CEILING } from "../../shared/calibration.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin auth check ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Sign in to access the admin dashboard." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const policy = await getPolicyForAdmin(base44);

    // Also report the legacy calibration ceiling as historical/completed context.
    // This is NOT available production capacity — it's a completed campaign total.
    let calibrationCeilingContext = null;
    try {
      const cappedTotal = await getCountForCeilingCheck(base44);
      calibrationCeilingContext = {
        ceiling: CALIBRATION_CEILING,
        verified_total_capped: cappedTotal,
        ceiling_exceeded: cappedTotal >= CALIBRATION_CEILING,
        note: "Historical/completed calibration campaign ceiling. NOT available production capacity."
      };
    } catch {}

    return Response.json({ policy, calibration_ceiling: calibrationCeilingContext });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load usage policy." }, { status: 500 });
  }
}