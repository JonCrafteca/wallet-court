// Wallet Court — admin-only Calibration Campaign Runner: get state.
// Returns the current campaign run state, progress, and campaign results
// (from docket items associated with the run). Used by the frontend to display
// live progress and to detect interrupted campaigns after a browser refresh.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  sanitizeCampaignRun,
  containsForbiddenCampaignData,
  formatCampaignProgress,
  CAMPAIGN_STATUS,
  ACTIVE_STATUSES
} from "../../shared/calibrationCampaign.ts";
import { getActiveCampaign, getMostRecentCampaign, getCampaignItems } from "../../shared/campaignStore.ts";
import { sanitizeDocketItem, containsForbiddenDocketData, ITEM_STATUS, CALIBRATION_TARGET, CALIBRATION_CEILING } from "../../shared/calibration.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    // Get the active campaign (running/pausing/paused) or the most recent one
    let run = await getActiveCampaign(base44);
    let isActive = true;
    if (!run) {
      run = await getMostRecentCampaign(base44);
      isActive = false;
    }

    if (!run) {
      const verifiedTotal = await getVerifiedTotal(base44);
      return Response.json({
        campaign: null,
        progress: null,
        results: [],
        verified_total: verifiedTotal,
        target: CALIBRATION_TARGET,
        ceiling: CALIBRATION_CEILING,
        has_active_campaign: false
      });
    }

    const verifiedTotal = await getVerifiedTotal(base44);

    // Get campaign items (docket items with this run_id)
    const campaignItems = await getCampaignItems(base44, run.run_id);
    const pendingCount = campaignItems.filter((i) => i.status === ITEM_STATUS.PENDING).length;

    // Build progress
    const progress = formatCampaignProgress(run, verifiedTotal, pendingCount);

    // Build results (completed/failed items, sanitized)
    const results = campaignItems
      .filter((i) => i.status === ITEM_STATUS.COMPLETED || i.status === ITEM_STATUS.FAILED || i.status === ITEM_STATUS.STOPPED)
      .map(sanitizeDocketItem);

    // Privacy guards
    for (const r of results) {
      if (containsForbiddenDocketData(r)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }
    const sanitizedRun = sanitizeCampaignRun(run);
    if (containsForbiddenCampaignData(sanitizedRun)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }

    return Response.json({
      campaign: sanitizedRun,
      progress,
      results,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      has_active_campaign: isActive && ACTIVE_STATUSES.has(run.status),
      is_interrupted: (run.status === CAMPAIGN_STATUS.RUNNING || run.status === CAMPAIGN_STATUS.STOPPING) && !!run.current_item_id
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign state failed." }, { status: 500 });
  }
}