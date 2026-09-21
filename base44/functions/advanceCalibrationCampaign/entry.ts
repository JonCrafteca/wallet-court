// Wallet Court — admin-only Calibration Campaign Runner: advance.
// Called by the frontend after each wallet is processed. Updates campaign
// progress counters (idempotently via campaign_accounted), checks whether the
// campaign should continue (budget, circuit, max_wallets, pause/stop), and
// claims the next pending item if so.
//
// Idempotent accounting: reads the current docket item and uses
// markDocketItemAccounted (CAS on campaign_accounted != true) to ensure the
// counters are incremented exactly once per wallet, even if the frontend
// calls advance twice or the browser refreshes and resume reconciles.
//
// Stopping handling: if the campaign is "stopping", accounts for the current
// wallet and transitions to "stopped" without claiming the next item.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  sanitizeCampaignRun,
  containsForbiddenCampaignData,
  classifyWalletForCampaign,
  shouldCampaignContinue,
  CAMPAIGN_STATUS,
  TERMINAL_STATUSES
} from "../../shared/calibrationCampaign.ts";
import { getCampaignById, updateCampaign, markDocketItemAccounted } from "../../shared/campaignStore.ts";
import {
  sanitizeDocketItem,
  containsForbiddenDocketData,
  checkBudget,
  ITEM_STATUS,
  claimFilter,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING
} from "../../shared/calibration.ts";
import { getVerifiedTotal, updateControl, releaseCampaignLock, getTelemetryHealth } from "../../shared/calibrationStore.ts";
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

    const runId = body.run_id;
    const itemResult = body.item_result; // the processCalibrationWallet response data
    if (!runId) return Response.json({ error: "run_id is required." }, { status: 400 });

    const run = await getCampaignById(base44, runId);
    if (!run) return Response.json({ error: "Campaign not found." }, { status: 404 });

    // If the campaign is already terminal, don't advance
    if (TERMINAL_STATUSES.has(run.status)) {
      return Response.json({
        run: sanitizeCampaignRun(run),
        next_item: null,
        stop_reason: run.stop_reason || "Campaign is in a terminal state."
      });
    }

    // ---- Idempotent accounting for the current wallet ----
    // Read the current docket item to check/set campaign_accounted. The
    // current_item_id identifies the wallet that was just processed.
    const currentItemId = run.current_item_id || itemResult?.docket_item_id;
    let accounted = false;
    let counters = classifyWalletForCampaign(itemResult || {});

    if (currentItemId) {
      // CAS: mark the docket item as accounted. Returns true only if it was
      // NOT yet accounted (false/null/undefined). This is the idempotent guard
      // — repeated advance/resume calls cannot double-count.
      accounted = await markDocketItemAccounted(base44, currentItemId);
    }

    const updatedFields: any = {
      current_item_id: null, // clear current item after processing
      current_address_short: null,
      current_network: null
    };

    if (accounted) {
      // First time accounting for this wallet — increment counters
      updatedFields.wallets_completed = (run.wallets_completed || 0) + 1;
      updatedFields.campaign_calls_used = (run.campaign_calls_used || 0) + counters.callsUsed;
      updatedFields.current_result = counters.resultLabel;
      updatedFields.current_calls_used = counters.callsUsed;
      if (counters.succeeded) updatedFields.wallets_succeeded = (run.wallets_succeeded || 0) + 1;
      if (counters.dismissed) updatedFields.wallets_dismissed = (run.wallets_dismissed || 0) + 1;
      if (counters.mistrial) updatedFields.wallets_mistrial = (run.wallets_mistrial || 0) + 1;
      if (counters.failed) updatedFields.wallets_failed = (run.wallets_failed || 0) + 1;
    } else {
      // Already accounted (idempotent skip) — don't increment counters
      updatedFields.current_result = counters.resultLabel;
      updatedFields.current_calls_used = counters.callsUsed;
    }

    // ---- Stopping handling ----
    // If the campaign is "stopping", account for the current wallet (above)
    // and transition to "stopped". Do NOT claim the next item.
    if (run.status === CAMPAIGN_STATUS.STOPPING) {
      const now = new Date().toISOString();
      updatedFields.status = CAMPAIGN_STATUS.STOPPED;
      updatedFields.stop_reason = run.stop_reason || "Stopped by admin after current wallet.";
      updatedFields.completed_at = now;
      await updateCampaign(base44, runId, updatedFields);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_stopped", { run_id: runId, accounted });
      return Response.json({
        run: sanitizeCampaignRun({ ...run, ...updatedFields }),
        next_item: null,
        stop_reason: updatedFields.stop_reason
      });
    }

    // Check if target/ceiling was reached by this wallet
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      const finalStatus = budget.ceiling_reached ? CAMPAIGN_STATUS.CEILING_REACHED : CAMPAIGN_STATUS.TARGET_REACHED;
      updatedFields.status = finalStatus;
      updatedFields.stop_reason = budget.reason;
      updatedFields.completed_at = new Date().toISOString();
      await updateControl(base44, {
        target_reached: budget.target_reached || undefined,
        ceiling_reached: budget.ceiling_reached || undefined
      });
      await updateCampaign(base44, runId, updatedFields);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_stopped", { run_id: runId, reason: budget.reason, verified_total: verifiedTotal, accounted });
      return Response.json({
        run: sanitizeCampaignRun({ ...run, ...updatedFields }),
        next_item: null,
        stop_reason: budget.reason,
        verified_total: verifiedTotal
      });
    }

    // Check if the wallet result indicates a provider stop (circuit recess)
    if (itemResult?.stop_batch && itemResult?.court_recess) {
      updatedFields.status = CAMPAIGN_STATUS.CIRCUIT_OPEN;
      updatedFields.stop_reason = itemResult?.stop_reason || "Provider is in Court Recess.";
      updatedFields.completed_at = new Date().toISOString();
      await updateCampaign(base44, runId, updatedFields);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_circuit_open", { run_id: runId, verified_total: verifiedTotal, accounted });
      return Response.json({
        run: sanitizeCampaignRun({ ...run, ...updatedFields }),
        next_item: null,
        stop_reason: updatedFields.stop_reason,
        verified_total: verifiedTotal
      });
    }

    // ---- Decide whether to continue ----
    const circuit = await getCircuit(base44, PROVIDER);
    const circuitOpen = isCircuitOpen(circuit, Date.now());

    // Count pending items
    const pendingItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { status: ITEM_STATUS.PENDING }, "queued_at", 500
    );
    const pendingCount = pendingItems?.length || 0;

    // Build a tentative updated run for the decision
    const tentativeRun = { ...run, ...updatedFields };
    const decision = shouldCampaignContinue(tentativeRun as any, verifiedTotal, circuitOpen, pendingCount);

    if (!decision.shouldContinue) {
      // Campaign is stopping
      if (decision.newStatus) {
        updatedFields.status = decision.newStatus;
        updatedFields.stop_reason = decision.stopReason;
        updatedFields.completed_at = new Date().toISOString();
      }
      await updateCampaign(base44, runId, updatedFields);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_completed", { run_id: runId, status: decision.newStatus, verified_total: verifiedTotal, accounted });
      return Response.json({
        run: sanitizeCampaignRun({ ...run, ...updatedFields }),
        next_item: null,
        stop_reason: decision.stopReason,
        verified_total: verifiedTotal
      });
    }

    // ---- Campaign continues: claim the next pending item ----

    // Telemetry health check: halt if audit persistence is unhealthy.
    // This prevents the campaign from making more Nansen calls when we can't
    // prove they happened (the audit ledger is the contest proof).
    const control = await getControl(base44);
    if (control && shouldHaltForTelemetry(control)) {
      updatedFields.status = CAMPAIGN_STATUS.ERROR;
      updatedFields.stop_reason = "Telemetry persistence is unhealthy. Campaign halted to preserve proof integrity.";
      updatedFields.completed_at = new Date().toISOString();
      await updateCampaign(base44, runId, updatedFields);
      await releaseCampaignLock(base44, runId);
      trackSafe(base44, "calibration_campaign_halted_telemetry", { run_id: runId, verified_total: verifiedTotal, accounted });
      return Response.json({
        run: sanitizeCampaignRun({ ...run, ...updatedFields }),
        next_item: null,
        stop_reason: updatedFields.stop_reason,
        telemetry_unhealthy: true,
        telemetry_warning: control.telemetry_warning || "Telemetry persistence failed.",
        verified_total: verifiedTotal
      });
    }

    const nextPending = pendingItems[0];
    const now = new Date().toISOString();
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

    let nextItemSanitized = null;
    if (claimResult && claimResult.updated === 1) {
      const claimedItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
        { docket_item_id: nextPending.docket_item_id }, "-queued_at", 1
      );
      if (claimedItems && claimedItems[0]) {
        nextItemSanitized = sanitizeDocketItem(claimedItems[0]);
        updatedFields.wallets_selected = (run.wallets_selected || 0) + 1;
        updatedFields.current_item_id = nextPending.docket_item_id;
        updatedFields.current_address_short = nextItemSanitized.address_short;
        updatedFields.current_network = nextItemSanitized.network;
        updatedFields.current_result = null;
        updatedFields.current_calls_used = null;
      }
    } else {
      // CAS failed — another run claimed it. Try to find another pending item.
      const remainingPending = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
        { status: ITEM_STATUS.PENDING }, "queued_at", 1
      );
      if (!remainingPending || remainingPending.length === 0) {
        updatedFields.status = CAMPAIGN_STATUS.COMPLETED;
        updatedFields.stop_reason = "No more pending wallets could be claimed.";
        updatedFields.completed_at = now;
        await updateCampaign(base44, runId, updatedFields);
        await releaseCampaignLock(base44, runId);
        return Response.json({
          run: sanitizeCampaignRun({ ...run, ...updatedFields }),
          next_item: null,
          stop_reason: "No more pending wallets could be claimed.",
          verified_total: verifiedTotal
        });
      }
      // Retry with the next available item
      const retryItem = remainingPending[0];
      const retryClaim = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
        claimFilter(retryItem.docket_item_id, retryItem.version),
        {
          $set: {
            status: ITEM_STATUS.PROCESSING,
            version: retryItem.version + 1,
            started_at: now,
            run_id: runId,
            correlation_id: runId,
            attempt_count: (retryItem.attempt_count || 0) + 1
          }
        }
      );
      if (retryClaim && retryClaim.updated === 1) {
        const retryItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
          { docket_item_id: retryItem.docket_item_id }, "-queued_at", 1
        );
        if (retryItems && retryItems[0]) {
          nextItemSanitized = sanitizeDocketItem(retryItems[0]);
          updatedFields.wallets_selected = (run.wallets_selected || 0) + 1;
          updatedFields.current_item_id = retryItem.docket_item_id;
          updatedFields.current_address_short = nextItemSanitized.address_short;
          updatedFields.current_network = nextItemSanitized.network;
          updatedFields.current_result = null;
          updatedFields.current_calls_used = null;
        }
      }
    }

    // Update the campaign run
    const updatedRun = await updateCampaign(base44, runId, updatedFields);

    // Privacy guards
    if (nextItemSanitized && containsForbiddenDocketData(nextItemSanitized)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }
    const sanitizedRun = sanitizeCampaignRun(updatedRun || { ...run, ...updatedFields });
    if (containsForbiddenCampaignData(sanitizedRun)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }

    return Response.json({
      run: sanitizedRun,
      next_item: nextItemSanitized,
      stop_reason: null,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING
    });
  } catch (error) {
    return Response.json({ error: error.message || "Campaign advance failed." }, { status: 500 });
  }
}