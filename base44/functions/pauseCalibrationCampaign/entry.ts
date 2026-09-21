// Wallet Court — admin-only Calibration Campaign Runner: pause.
// Sets the campaign status to "pausing". The frontend checks the status after
// each wallet and stops the loop when it sees "pausing". The backend eventually
// transitions to "paused" when advanceCalibrationCampaign detects it.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { sanitizeCampaignRun, CAMPAIGN_STATUS } from "../../shared/calibrationCampaign.ts";
import { getCampaignById, updateCampaign } from "../../shared/campaignStore.ts";

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

    if (run.status !== CAMPAIGN_STATUS.RUNNING) {
      return Response.json({ error: `Campaign is not running (status: ${run.status}).`, run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    const updated = await updateCampaign(base44, runId, {
      status: CAMPAIGN_STATUS.PAUSING,
      stop_reason: "Pause requested by admin after current wallet."
    });

    trackSafe(base44, "calibration_campaign_pausing", { run_id: runId });

    return Response.json({
      run: sanitizeCampaignRun(updated || { ...run, status: CAMPAIGN_STATUS.PAUSING }),
      paused: true
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign pause failed." }, { status: 500 });
  }
}