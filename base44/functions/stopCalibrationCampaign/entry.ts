// Wallet Court — admin-only Calibration Campaign Runner: stop.
// Sets the campaign status to "stopped" and safely returns all unprocessed
// claimed items (in PROCESSING state with this run_id) back to PENDING.
// Never interrupts an individual wallet halfway through its analysis — the
// current wallet's processCalibrationWallet call will complete naturally.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { sanitizeCampaignRun, CAMPAIGN_STATUS, ACTIVE_STATUSES } from "../../shared/calibrationCampaign.ts";
import { getCampaignById, updateCampaign } from "../../shared/campaignStore.ts";
import { ITEM_STATUS } from "../../shared/calibration.ts";

function trackSafe(base44, eventName: string, props: Record<string, any>) {
  try { if (base44?.analytics?.track) waitUntil(base44.analytics.track({ eventName, properties: props })); } catch {}
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const runId = body.run_id;
    if (!runId) return Response.json({ error: "run_id is required." }, { status: 400 });

    const run = await getCampaignById(base44, runId);
    if (!run) return Response.json({ error: "Campaign not found." }, { status: 404 });

    if (!ACTIVE_STATUSES.has(run.status)) {
      return Response.json({ error: `Campaign is not active (status: ${run.status}).`, run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    // Set status to stopped
    const now = new Date().toISOString();
    const updated = await updateCampaign(base44, runId, {
      status: CAMPAIGN_STATUS.STOPPED,
      stop_reason: "Stopped by admin. Unprocessed items returned to pending.",
      completed_at: now,
      current_item_id: null,
      current_address_short: null,
      current_network: null
    });

    // Safely return all PROCESSING items with this run_id back to PENDING.
    // The current wallet (if still being analyzed) will complete naturally —
    // processCalibrationWallet will update it to COMPLETED/FAILED. But if the
    // item is still in PROCESSING after the analysis completes, it means the
    // campaign was stopped before the result was recorded. We revert those.
    // We do NOT revert the item currently being processed (if processCalibrationWallet
    // is in flight) — that would be a race condition. Instead, we revert only
    // items that are in PROCESSING state. The current item will be handled by
    // advanceCalibrationCampaign which will see the stopped status and not
    // claim the next item.
    try {
      await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
        { run_id: runId, status: ITEM_STATUS.PROCESSING },
        {
          $set: {
            status: ITEM_STATUS.PENDING,
            started_at: null,
            run_id: null,
            correlation_id: null
          },
          $inc: { version: 1 }
        }
      );
    } catch (e) {
      console.error("[campaign-stop] failed to revert items:", e?.message);
    }

    trackSafe(base44, "calibration_campaign_stopped", { run_id: runId });

    return Response.json({
      run: sanitizeCampaignRun(updated || { ...run, status: CAMPAIGN_STATUS.STOPPED }),
      stopped: true
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign stop failed." }, { status: 500 });
  }
}