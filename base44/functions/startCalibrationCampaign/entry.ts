// Wallet Court — admin-only Calibration Campaign Runner: start.
// Creates a persistent CalibrationRun, checks budget/circuit/kill-switch,
// and claims the first pending docket item. Returns the run state + first item.
//
// The frontend drives sequential wallet processing by calling
// processCalibrationWallet for each claimed item, then advanceCalibrationCampaign
// to update progress and claim the next item.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  validateCampaignSize,
  sanitizeCampaignRun,
  containsForbiddenCampaignData,
  newCampaignId,
  CAMPAIGN_STATUS,
  AVG_CALLS_PER_WALLET,
  CAMPAIGN_SIZES
} from "../../shared/calibrationCampaign.ts";
import { hasActiveCampaign, createCampaign, updateCampaignCAS } from "../../shared/campaignStore.ts";
import {
  sanitizeDocketItem,
  containsForbiddenDocketData,
  checkBudget,
  ITEM_STATUS,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING,
  claimFilter
} from "../../shared/calibration.ts";
import { getControl, getVerifiedTotal, acquireCampaignLock, releaseCampaignLock, getTelemetryHealth } from "../../shared/calibrationStore.ts";
import { getCircuit } from "../../shared/circuitStore.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { shouldHaltForTelemetry } from "../../shared/calibrationCampaign.ts";

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

    // Validate campaign size (5, 10, 25, 50, or null for all)
    const sizeValidation = validateCampaignSize(body.max_wallets);
    if (!sizeValidation.ok) return Response.json({ error: sizeValidation.reason }, { status: 400 });
    const maxWallets = sizeValidation.value;

    // Require explicit confirmation
    if (!body.confirmed) {
      return Response.json({ error: "Confirmation checkbox is required." }, { status: 400 });
    }

    // Check kill switch
    const control = await getControl(base44);
    if (control && !control.calibration_enabled) {
      return Response.json({ error: "Calibration is paused.", paused: true, reason: control.paused_reason }, { status: 423 });
    }

    // Check telemetry health — halt if audit persistence is unhealthy
    if (control && shouldHaltForTelemetry(control)) {
      return Response.json({
        error: "Telemetry persistence is unhealthy. Campaign cannot start until audit writes succeed.",
        telemetry_unhealthy: true,
        telemetry_warning: control.telemetry_warning || "Telemetry persistence failed."
      }, { status: 423 });
    }

    // Check budget (verified total)
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      return Response.json({ error: budget.reason, budget, verified_total: verifiedTotal }, { status: 423 });
    }

    // Check circuit breaker
    const circuit = await getCircuit(base44, PROVIDER);
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ error: "Provider is in Court Recess. Try again later.", court_recess: true }, { status: 423 });
    }

    // One-active-run guarantee: no active campaign exists (non-atomic precheck)
    const activeExists = await hasActiveCampaign(base44);
    if (activeExists) {
      return Response.json({ error: "A campaign is already in progress. Resume or stop it first.", active_campaign: true }, { status: 409 });
    }

    // Count pending items to estimate calls
    const pendingItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { status: ITEM_STATUS.PENDING }, "queued_at", 500
    );
    const pendingCount = pendingItems?.length || 0;
    if (pendingCount === 0) {
      return Response.json({ error: "No pending items in the queue. Approve candidates or import wallets first.", empty: true }, { status: 404 });
    }

    // Determine how many wallets to process
    const walletsToProcess = maxWallets !== null ? Math.min(maxWallets, pendingCount) : pendingCount;
    const estimatedCalls = walletsToProcess * AVG_CALLS_PER_WALLET;

    // Create the campaign run
    const now = new Date().toISOString();
    const runId = newCampaignId();

    // Atomically acquire the singleton campaign lock. This is the atomic
    // one-active-campaign guarantee: two concurrent start requests cannot
    // both succeed because the CAS filter (campaign_lock_run_id = null)
    // only matches one. If the lock is already held, reject.
    const lockAcquired = await acquireCampaignLock(base44, runId);
    if (!lockAcquired) {
      return Response.json({
        error: "Another campaign is already starting or running. The singleton lock is held.",
        active_campaign: true
      }, { status: 409 });
    }

    const run = await createCampaign(base44, {
      run_id: runId,
      status: CAMPAIGN_STATUS.RUNNING,
      max_wallets: maxWallets,
      wallets_selected: 0,
      wallets_completed: 0,
      wallets_succeeded: 0,
      wallets_dismissed: 0,
      wallets_mistrial: 0,
      wallets_failed: 0,
      campaign_calls_used: 0,
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: null,
      current_calls_used: null,
      stop_reason: null,
      version: 0,
      started_at: now,
      updated_at: now,
      completed_at: null,
      started_by_user_id: user.id
    });

    // Claim the first pending item
    const firstItem = pendingItems[0];
    const claimResult = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
      claimFilter(firstItem.docket_item_id, firstItem.version),
      {
        $set: {
          status: ITEM_STATUS.PROCESSING,
          version: firstItem.version + 1,
          started_at: now,
          run_id: runId,
          correlation_id: runId,
          attempt_count: (firstItem.attempt_count || 0) + 1
        }
      }
    );

    let firstItemSanitized = null;
    if (claimResult && claimResult.updated === 1) {
      // Re-read the claimed item
      const claimedItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
        { docket_item_id: firstItem.docket_item_id }, "-queued_at", 1
      );
      if (claimedItems && claimedItems[0]) {
        firstItemSanitized = sanitizeDocketItem(claimedItems[0]);
        // Update run with current item info
        await updateCampaignCAS(base44, runId, 0, {
          wallets_selected: 1,
          current_item_id: firstItem.docket_item_id,
          current_address_short: firstItemSanitized.address_short,
          current_network: firstItemSanitized.network
        });
      }
    } else {
      // CAS failed — another run claimed it. Mark campaign as error and release lock.
      await updateCampaignCAS(base44, runId, 0, {
        status: CAMPAIGN_STATUS.ERROR,
        stop_reason: "Failed to claim the first wallet. It may have been claimed by another run.",
        completed_at: now
      });
      await releaseCampaignLock(base44, runId);
      return Response.json({ error: "Failed to claim the first wallet. Try again.", run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    // Privacy guards
    if (firstItemSanitized && containsForbiddenDocketData(firstItemSanitized)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }
    const sanitizedRun = sanitizeCampaignRun(
      await base44.asServiceRole.entities.CalibrationRun.filter({ run_id: runId }, "-started_at", 1).then((r) => r?.[0] || run)
    );
    if (containsForbiddenCampaignData(sanitizedRun)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }

    trackSafe(base44, "calibration_campaign_started", {
      run_id: runId,
      max_wallets: maxWallets,
      wallets_to_process: walletsToProcess,
      estimated_calls: estimatedCalls,
      verified_total: verifiedTotal
    });

    return Response.json({
      run: sanitizedRun,
      first_item: firstItemSanitized,
      estimated_calls: estimatedCalls,
      wallets_to_process: walletsToProcess,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      budget
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign start failed." }, { status: 500 });
  }
}