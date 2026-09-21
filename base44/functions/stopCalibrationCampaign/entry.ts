// Wallet Court — admin-only Calibration Campaign Runner: stop.
// Sets the campaign status to "stopping" (stop-after-current). The current
// wallet's analysis is allowed to complete naturally — processCalibrationWallet
// will finish and the frontend will call advanceCalibrationCampaign, which
// accounts for the current wallet and transitions the campaign to "stopped".
//
// This function does NOT revert the current_item_id while its analysis may
// still be running. It only reverts other claimed-but-not-started PROCESSING
// items (if any exist from a race condition) back to PENDING.
//
// If the browser closes during "stopping", reopening the page shows the
// interrupted/stopping state and requires an explicit reconciliation action
// (Resume → resumeCalibrationCampaign reconciles the current item, then
// transitions to stopped). The wallet is never reprocessed.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { sanitizeCampaignRun, CAMPAIGN_STATUS, ACTIVE_STATUSES } from "../../shared/calibrationCampaign.ts";
import { getCampaignById, updateCampaign, revertNonCurrentProcessingItems } from "../../shared/campaignStore.ts";
import { releaseCampaignLock } from "../../shared/calibrationStore.ts";

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

    // Allow stop from running, pausing, paused, or stopping (idempotent)
    if (!ACTIVE_STATUSES.has(run.status)) {
      return Response.json({ error: `Campaign is not active (status: ${run.status}).`, run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    // If already stopping, return idempotently
    if (run.status === CAMPAIGN_STATUS.STOPPING) {
      return Response.json({
        run: sanitizeCampaignRun(run),
        stopping: true,
        message: "Campaign is already stopping. The current wallet will settle, then the campaign transitions to stopped."
      });
    }

    const now = new Date().toISOString();

    // If there's no current wallet in flight (paused, or running between
    // wallets), transition directly to "stopped". There's nothing to wait for.
    if (!run.current_item_id) {
      const updated = await updateCampaign(base44, runId, {
        status: CAMPAIGN_STATUS.STOPPED,
        stop_reason: "Stopped by admin.",
        completed_at: now,
        current_item_id: null,
        current_address_short: null,
        current_network: null
      });
      // Revert any PROCESSING items (safety net — should be none)
      await revertNonCurrentProcessingItems(base44, runId, []);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_stopped", { run_id: runId, had_current_item: false });
      return Response.json({
        run: sanitizeCampaignRun(updated || { ...run, status: CAMPAIGN_STATUS.STOPPED }),
        stopped: true
      });
    }

    // There IS a current wallet in flight. Set status to "stopping" (NOT
    // "stopped"). The current wallet's analysis is allowed to complete.
    // advanceCalibrationCampaign will transition to "stopped" after accounting
    // for the current wallet. If the browser closes during "stopping",
    // reopening shows the interrupted state and Resume reconciles.
    const updated = await updateCampaign(base44, runId, {
      status: CAMPAIGN_STATUS.STOPPING,
      stop_reason: "Stop requested by admin. The current wallet will settle, then the campaign stops."
    });

    // Revert any PROCESSING items that are NOT the current_item_id. In the
    // sequential model there should be at most one PROCESSING item (the
    // current one), so this is a safety net for race conditions. The current
    // item is NEVER reverted here — it may still be executing.
    const currentItemIds = [run.current_item_id];
    await revertNonCurrentProcessingItems(base44, runId, currentItemIds);

    trackSafe(base44, "calibration_campaign_stopping", { run_id: runId, had_current_item: true });

    return Response.json({
      run: sanitizeCampaignRun(updated || { ...run, status: CAMPAIGN_STATUS.STOPPING }),
      stopping: true,
      message: "Campaign is stopping. The current wallet will settle, then the campaign transitions to stopped."
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign stop failed." }, { status: 500 });
  }
}