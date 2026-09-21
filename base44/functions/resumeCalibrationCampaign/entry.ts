// Wallet Court — admin-only Calibration Campaign Runner: resume.
// Resumes an interrupted campaign after a browser refresh. Sets status back to
// "running" and claims the next pending item (or re-claims the current item
// if it's still in PROCESSING state).
//
// Never resumes physical provider calls silently — the admin must click RESUME.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  sanitizeCampaignRun,
  containsForbiddenCampaignData,
  CAMPAIGN_STATUS
} from "../../shared/calibrationCampaign.ts";
import { getCampaignById, updateCampaign } from "../../shared/campaignStore.ts";
import {
  sanitizeDocketItem,
  containsForbiddenDocketData,
  checkBudget,
  ITEM_STATUS,
  claimFilter,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING
} from "../../shared/calibration.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";
import { getCircuit } from "../../shared/circuitStore.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";

const PROVIDER = "nansen";

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

    // Require explicit confirmation
    if (!body.confirmed) {
      return Response.json({ error: "Confirmation is required to resume the campaign." }, { status: 400 });
    }

    const run = await getCampaignById(base44, runId);
    if (!run) return Response.json({ error: "Campaign not found." }, { status: 404 });

    if (run.status !== CAMPAIGN_STATUS.PAUSED) {
      return Response.json({ error: `Campaign is not paused (status: ${run.status}).`, run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    // Check budget before resuming
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      // Update the campaign to the appropriate terminal status
      const finalStatus = budget.ceiling_reached ? CAMPAIGN_STATUS.CEILING_REACHED : CAMPAIGN_STATUS.TARGET_REACHED;
      await updateCampaign(base44, runId, {
        status: finalStatus,
        stop_reason: budget.reason,
        completed_at: new Date().toISOString()
      });
      return Response.json({ error: budget.reason, budget, verified_total: verifiedTotal }, { status: 423 });
    }

    // Check circuit breaker
    const circuit = await getCircuit(base44, PROVIDER);
    if (isCircuitOpen(circuit, Date.now())) {
      await updateCampaign(base44, runId, {
        status: CAMPAIGN_STATUS.CIRCUIT_OPEN,
        stop_reason: "Provider is in Court Recess.",
        completed_at: new Date().toISOString()
      });
      return Response.json({ error: "Provider is in Court Recess. Try again later.", court_recess: true }, { status: 423 });
    }

    // Set status back to running
    await updateCampaign(base44, runId, {
      status: CAMPAIGN_STATUS.RUNNING,
      stop_reason: null,
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: null,
      current_calls_used: null
    });

    // Check if the current item (from before the refresh) is still in PROCESSING.
    // If so, re-claim it for reprocessing (the analysis was interrupted).
    // If not (it completed/failed while the page was refreshing), claim the next pending item.
    let nextItemSanitized = null;
    const now = new Date().toISOString();

    // First, check if there's a stale PROCESSING item from this run
    const staleItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { run_id: runId, status: ITEM_STATUS.PROCESSING }, "-queued_at", 1
    );

    if (staleItems && staleItems.length > 0) {
      // The item is still in PROCESSING — the analysis was interrupted.
      // Re-claim it (it's already claimed, but we need to return it to the frontend).
      nextItemSanitized = sanitizeDocketItem(staleItems[0]);
      await updateCampaign(base44, runId, {
        current_item_id: staleItems[0].docket_item_id,
        current_address_short: nextItemSanitized.address_short,
        current_network: nextItemSanitized.network
      });
    } else {
      // No stale item — claim the next pending item
      const pendingItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
        { status: ITEM_STATUS.PENDING }, "queued_at", 1
      );

      if (!pendingItems || pendingItems.length === 0) {
        // No more items — complete the campaign
        await updateCampaign(base44, runId, {
          status: CAMPAIGN_STATUS.COMPLETED,
          stop_reason: "No more pending wallets in the queue.",
          completed_at: now
        });
        const completedRun = await getCampaignById(base44, runId);
        return Response.json({
          run: sanitizeCampaignRun(completedRun || run),
          next_item: null,
          stop_reason: "No more pending wallets in the queue.",
          verified_total: verifiedTotal
        });
      }

      const nextPending = pendingItems[0];
      const claimResult = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
        claimFilter(nextPending.docket_item_id, nextPending.version),
        {
          $set: {
            status: ITEM_STATUS.PROCESSING,
            version: nextPending.version + 1,
            started_at: now,
            run_id: runId,
            correlation_id: runId,
            attempt_count: (nextPending.attempt_count || 0) + 1
          }
        }
      );

      if (claimResult && claimResult.updated === 1) {
        const claimedItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
          { docket_item_id: nextPending.docket_item_id }, "-queued_at", 1
        );
        if (claimedItems && claimedItems[0]) {
          nextItemSanitized = sanitizeDocketItem(claimedItems[0]);
          await updateCampaign(base44, runId, {
            wallets_selected: (run.wallets_selected || 0) + 1,
            current_item_id: nextPending.docket_item_id,
            current_address_short: nextItemSanitized.address_short,
            current_network: nextItemSanitized.network
          });
        }
      }
    }

    // Get the updated run
    const updatedRun = await getCampaignById(base44, runId);

    // Privacy guards
    if (nextItemSanitized && containsForbiddenDocketData(nextItemSanitized)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }
    const sanitizedRun = sanitizeCampaignRun(updatedRun || run);
    if (containsForbiddenCampaignData(sanitizedRun)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }

    trackSafe(base44, "calibration_campaign_resumed", { run_id: runId, verified_total: verifiedTotal });

    return Response.json({
      run: sanitizedRun,
      next_item: nextItemSanitized,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign resume failed." }, { status: 500 });
  }
}