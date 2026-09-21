// Wallet Court — admin-only Calibration Campaign Runner: resume.
// Resumes an interrupted campaign after a browser refresh or pause. Performs
// authoritative reconciliation of the current_item_id BEFORE any resumed
// analysis, to prevent duplicate Nansen calls and duplicate trials.
//
// Reconciliation decision tree (see reconcileCurrentItem in calibrationCampaign.ts):
// 1. Read the campaign's current_item_id and the current docket item.
// 2. Search for an existing completed WalletTrial (by case_slug, then by
//    network + normalized_wallet_address).
// 3. If the docket item is terminal (completed/failed/stopped):
//    - Account for it exactly once (campaign_accounted CAS guard).
//    - Clear current_item_id. Proceed to the next pending item.
// 4. If the docket item is PROCESSING and its lease is NOT stale:
//    - Return a "still settling" response. Do NOT reprocess.
// 5. If the docket item is PROCESSING and stale:
//    - If a completed trial exists: mark the docket item completed with the
//      trial's info, account it once, clear current_item_id. Proceed.
//    - If no trial exists: revert the docket item to PENDING (genuinely stale,
//      safe to reprocess later). Clear current_item_id. Proceed.
// 6. If the campaign was "stopping": after reconciliation, transition to
//    "stopped". Do NOT resume processing.
// 7. If the campaign was "paused": after reconciliation, check budget/circuit,
//    set to "running", and claim the next pending item.
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
  classifyWalletForCampaign,
  reconcileCurrentItem,
  CAMPAIGN_STATUS
} from "../../shared/calibrationCampaign.ts";
import {
  getCampaignById,
  updateCampaign,
  findExistingTrial,
  markDocketItemAccounted,
  updateDocketItemForReconciliation,
  revertStaleDocketItem
} from "../../shared/campaignStore.ts";
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

    // Accept paused or stopping status. "stopping" means the admin requested
    // stop and the current wallet may need reconciliation before the campaign
    // transitions to "stopped".
    if (run.status !== CAMPAIGN_STATUS.PAUSED && run.status !== CAMPAIGN_STATUS.STOPPING) {
      return Response.json({ error: `Campaign is not paused or stopping (status: ${run.status}).`, run: sanitizeCampaignRun(run) }, { status: 409 });
    }

    const wasStopping = run.status === CAMPAIGN_STATUS.STOPPING;
    const now = new Date().toISOString();

    // ---- Authoritative reconciliation of the current_item_id ----
    let reconciliationResult: any = { action: "no_current_item", accounted: false };
    const currentItemId = run.current_item_id;

    if (currentItemId) {
      // Read the current docket item
      const docketItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
        { docket_item_id: currentItemId }, "-queued_at", 1
      );
      const docketItem = (docketItems && docketItems[0]) || null;

      if (docketItem) {
        // Search for an existing completed WalletTrial
        const existingTrial = await findExistingTrial(base44, docketItem);

        // Get the reconciliation decision
        const decision = reconcileCurrentItem(docketItem, existingTrial, Date.now());

        if (decision.action === "still_settling") {
          // The analysis may still be running — do NOT reprocess.
          return Response.json({
            run: sanitizeCampaignRun(run),
            next_item: null,
            still_settling: true,
            message: "The current wallet's analysis may still be running. Wait a few minutes and try again. The wallet will not be reprocessed."
          });
        }

        if (decision.action === "revert_and_proceed") {
          // Genuinely stale PROCESSING with no trial — revert to PENDING
          await revertStaleDocketItem(base44, currentItemId, docketItem.version);
          reconciliationResult = { action: "revert_and_proceed", accounted: false };
        } else if (decision.action === "account_and_proceed") {
          // If the docket item needs to be marked completed (stale PROCESSING
          // with a trial), update it first.
          if (decision.docketItemStatus && decision.docketItemFields) {
            await updateDocketItemForReconciliation(base44, currentItemId, docketItem.version, {
              status: decision.docketItemStatus,
              ...decision.docketItemFields
            });
          }
          // CAS: mark the docket item as accounted. Returns true only if it
          // was NOT yet accounted.
          const accounted = await markDocketItemAccounted(base44, currentItemId);
          reconciliationResult = { action: "account_and_proceed", accounted, docketItem: decision.docketItemStatus ? { ...docketItem, ...decision.docketItemFields, status: decision.docketItemStatus } : docketItem };
        } else if (decision.action === "already_accounted") {
          reconciliationResult = { action: "already_accounted", accounted: false };
        } else if (decision.action === "no_current_item") {
          reconciliationResult = { action: "no_current_item", accounted: false };
        }
      }
    }

    // ---- Build counter increments from reconciliation ----
    const reconciliationFields: any = {
      current_item_id: null,
      current_address_short: null,
      current_network: null,
      current_result: null,
      current_calls_used: null
    };

    if (reconciliationResult.accounted) {
      // First time accounting for the reconciled wallet — classify and increment
      const counters = classifyWalletForCampaign(reconciliationResult.docketItem || {});
      reconciliationFields.wallets_completed = (run.wallets_completed || 0) + 1;
      reconciliationFields.campaign_calls_used = (run.campaign_calls_used || 0) + counters.callsUsed;
      reconciliationFields.current_result = counters.resultLabel;
      reconciliationFields.current_calls_used = counters.callsUsed;
      if (counters.succeeded) reconciliationFields.wallets_succeeded = (run.wallets_succeeded || 0) + 1;
      if (counters.dismissed) reconciliationFields.wallets_dismissed = (run.wallets_dismissed || 0) + 1;
      if (counters.mistrial) reconciliationFields.wallets_mistrial = (run.wallets_mistrial || 0) + 1;
      if (counters.failed) reconciliationFields.wallets_failed = (run.wallets_failed || 0) + 1;
    }

    // ---- If the campaign was stopping: reconcile, then transition to stopped ----
    if (wasStopping) {
      reconciliationFields.status = CAMPAIGN_STATUS.STOPPED;
      reconciliationFields.stop_reason = run.stop_reason || "Stopped by admin after current wallet.";
      reconciliationFields.completed_at = now;
      await updateCampaign(base44, runId, reconciliationFields);
      trackSafe(base44, "calibration_campaign_stopped_after_reconciliation", { run_id: runId, reconciliation: reconciliationResult.action, accounted: reconciliationResult.accounted });
      const stoppedRun = await getCampaignById(base44, runId);
      return Response.json({
        run: sanitizeCampaignRun(stoppedRun || { ...run, ...reconciliationFields }),
        next_item: null,
        stop_reason: reconciliationFields.stop_reason,
        reconciliation: reconciliationResult.action
      });
    }

    // ---- Campaign was paused: check budget/circuit before resuming ----
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      const finalStatus = budget.ceiling_reached ? CAMPAIGN_STATUS.CEILING_REACHED : CAMPAIGN_STATUS.TARGET_REACHED;
      reconciliationFields.status = finalStatus;
      reconciliationFields.stop_reason = budget.reason;
      reconciliationFields.completed_at = now;
      await updateCampaign(base44, runId, reconciliationFields);
      return Response.json({ error: budget.reason, budget, verified_total: verifiedTotal, reconciliation: reconciliationResult.action }, { status: 423 });
    }

    const circuit = await getCircuit(base44, PROVIDER);
    if (isCircuitOpen(circuit, Date.now())) {
      reconciliationFields.status = CAMPAIGN_STATUS.CIRCUIT_OPEN;
      reconciliationFields.stop_reason = "Provider is in Court Recess.";
      reconciliationFields.completed_at = now;
      await updateCampaign(base44, runId, reconciliationFields);
      return Response.json({ error: "Provider is in Court Recess. Try again later.", court_recess: true, reconciliation: reconciliationResult.action }, { status: 423 });
    }

    // Set status back to running
    reconciliationFields.status = CAMPAIGN_STATUS.RUNNING;
    reconciliationFields.stop_reason = null;
    await updateCampaign(base44, runId, reconciliationFields);

    // ---- Claim the next pending item ----
    const pendingItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { status: ITEM_STATUS.PENDING }, "queued_at", 1
    );

    let nextItemSanitized = null;
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
        verified_total: verifiedTotal,
        reconciliation: reconciliationResult.action
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

    trackSafe(base44, "calibration_campaign_resumed", { run_id: runId, verified_total: verifiedTotal, reconciliation: reconciliationResult.action, accounted: reconciliationResult.accounted });

    return Response.json({
      run: sanitizedRun,
      next_item: nextItemSanitized,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      reconciliation: reconciliationResult.action
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign resume failed." }, { status: 500 });
  }
}