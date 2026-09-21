// Wallet Court — admin-only Calibration Docket single-wallet processing.
// Processes one claimed queue item through the EXISTING analyzeWalletWithNansen
// pipeline. Records calls_before/calls_after, verdict info, and stop conditions.
// Reverts remaining batch items to pending on a provider stop.
//
// This function is called once per wallet by the frontend (sequentially) to
// stay within backend execution time limits. The server-side delay between
// wallets is configurable via delay_ms (default 2 seconds).
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query or
// invocation. Reuses the full production pipeline — no duplicated logic.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  checkBudget,
  classifyWalletResult,
  sanitizeDocketItem,
  ITEM_STATUS,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING,
  WALLET_INTERVAL_MS,
  AUDIT_QUERY_LIMIT
} from "../../shared/calibration.ts";
import { getVerifiedTotal, updateControl } from "../../shared/calibrationStore.ts";

function trackSafe(base44, eventName: string, props: Record<string, any>) {
  try { if (base44?.analytics?.track) waitUntil(base44.analytics.track({ eventName, properties: props })); } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const docketItemId = body.docket_item_id;
    const runId = body.run_id;
    if (!docketItemId || !runId) {
      return Response.json({ error: "docket_item_id and run_id are required." }, { status: 400 });
    }

    // Server-side delay between wallets (skip for the first wallet with delay_ms=0)
    const delayMs = Math.max(0, parseInt(body.delay_ms, 10) || 0);
    if (delayMs > 0) await sleep(delayMs);

    // Find the item and verify it's claimed by this run
    const items = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { docket_item_id: docketItemId }, "-queued_at", 1
    );
    const item = items && items[0];
    if (!item) {
      return Response.json({ error: "Queue item not found." }, { status: 404 });
    }
    if (item.status !== ITEM_STATUS.PROCESSING || item.run_id !== runId) {
      return Response.json({ error: "Item is not claimed by this batch run.", status: item.status }, { status: 409 });
    }

    // ---- Per-wallet budget check ----
    const callsBefore = await getVerifiedTotal(base44);
    const walletBudget = checkBudget(callsBefore);
    if (!walletBudget.allowed) {
      // Mark as stopped (budget reached before this wallet)
      await base44.asServiceRole.entities.CalibrationDocketItem.update(item.id, {
        status: ITEM_STATUS.STOPPED,
        completed_at: new Date().toISOString(),
        calls_before: callsBefore,
        calls_after: callsBefore,
        physical_calls_used: 0,
        failure_category: walletBudget.ceiling_reached ? "ceiling_reached" : "budget_reached",
        failure_message_safe: walletBudget.reason
      });
      // Revert remaining batch items to pending
      await revertRemainingBatchItems(base44, runId);
      trackSafe(base44, "calibration_batch_stopped", { reason: walletBudget.reason, verified_total: callsBefore });
      return Response.json({
        docket_item_id: docketItemId,
        status: "stopped",
        reason: walletBudget.reason,
        stop_batch: true,
        verified_total: callsBefore,
        budget: walletBudget
      });
    }

    // ---- Invoke the existing analysis pipeline ----
    // asServiceRole.functions.invoke runs the pipeline as the service role:
    // auth.me() in the invoked function returns null → submitted_by_user_id
    // stays null → the case is anonymous (NOT attached to admin's My Court).
    let analysisResult;
    try {
      analysisResult = await base44.asServiceRole.functions.invoke("analyzeWalletWithNansen", {
        wallet_address: item.wallet_address,
        network: item.network,
        window_days: 180,
        durable_telemetry: true
      });
    } catch (e) {
      analysisResult = { status: 500, data: { error: e?.message || "Pipeline invocation failed." } };
    }

    // ---- Query calls after ----
    const callsAfter = await getVerifiedTotal(base44);
    const physicalCallsUsed = Math.max(0, callsAfter - callsBefore);

    const httpStatus = analysisResult?.status || 500;
    const data = analysisResult?.data || {};

    // ---- Classify result and check stop conditions ----
    const decision = classifyWalletResult(httpStatus, data, 0);
    const isCourtRecess = !!data?.court_recess;
    const isSuccess = httpStatus === 200 && !!data?.trial;

    if (isSuccess) {
      // Success — record verdict info
      const trial = data.trial;
      await base44.asServiceRole.entities.CalibrationDocketItem.update(item.id, {
        status: ITEM_STATUS.COMPLETED,
        completed_at: new Date().toISOString(),
        case_slug: trial.public_slug || null,
        calls_before: callsBefore,
        calls_after: callsAfter,
        physical_calls_used: physicalCallsUsed,
        verdict_code: trial.verdict_code || null,
        verdict_name: trial.verdict_name || null,
        case_outcome: trial.case_outcome || null,
        data_mode: trial.data_mode || null
      });
      trackSafe(base44, "calibration_wallet_completed", {
        network: item.network,
        verdict_code: trial.verdict_code || null,
        case_outcome: trial.case_outcome || null,
        physical_calls_used: physicalCallsUsed,
        verified_total: callsAfter
      });

      // Check if target/ceiling reached after this wallet
      const targetReached = callsAfter >= CALIBRATION_TARGET;
      const ceilingReached = callsAfter >= CALIBRATION_CEILING;
      if (targetReached || ceilingReached) {
        await updateControl(base44, {
          target_reached: targetReached || undefined,
          ceiling_reached: ceilingReached || undefined
        });
        trackSafe(base44, "calibration_target_reached", { verified_total: callsAfter, ceiling: ceilingReached });
      }

      return Response.json({
        docket_item_id: docketItemId,
        status: "completed",
        case_slug: trial.public_slug || null,
        verdict_name: trial.verdict_name || null,
        case_outcome: trial.case_outcome || null,
        calls_before: callsBefore,
        calls_after: callsAfter,
        physical_calls_used: physicalCallsUsed,
        verified_total: callsAfter,
        stop_batch: targetReached || ceilingReached,
        stop_reason: targetReached ? "Contest target reached." : (ceilingReached ? "Safety ceiling reached." : ""),
        item: sanitizeDocketItem({
          ...item,
          status: ITEM_STATUS.COMPLETED,
          case_slug: trial.public_slug || null,
          calls_before: callsBefore,
          calls_after: callsAfter,
          physical_calls_used: physicalCallsUsed,
          verdict_code: trial.verdict_code || null,
          verdict_name: trial.verdict_name || null,
          case_outcome: trial.case_outcome || null,
          data_mode: trial.data_mode || null,
          completed_at: new Date().toISOString()
        })
      });
    }

    // ---- Failure or provider stop ----
    const failureCategory = decision.failure_category || "invocation_error";
    const failureMessage = decision.reason || data?.error || data?.sanitized_reason || "Analysis failed.";

    await base44.asServiceRole.entities.CalibrationDocketItem.update(item.id, {
      status: ITEM_STATUS.FAILED,
      completed_at: new Date().toISOString(),
      calls_before: callsBefore,
      calls_after: callsAfter,
      physical_calls_used: physicalCallsUsed,
      failure_category: failureCategory,
      failure_message_safe: failureMessage
    });

    trackSafe(base44, "calibration_wallet_failed", {
      network: item.network,
      failure_category: failureCategory,
      verified_total: callsAfter
    });

    if (decision.stop || isCourtRecess) {
      // Revert remaining batch items to pending
      await revertRemainingBatchItems(base44, runId);
      trackSafe(base44, "calibration_batch_stopped", { reason: decision.reason, verified_total: callsAfter });
    }

    return Response.json({
      docket_item_id: docketItemId,
      status: "failed",
      failure_category: failureCategory,
      failure_message_safe: failureMessage,
      calls_before: callsBefore,
      calls_after: callsAfter,
      physical_calls_used: physicalCallsUsed,
      verified_total: callsAfter,
      stop_batch: decision.stop || isCourtRecess,
      stop_reason: decision.stop ? decision.reason : ""
    });
  } catch (error) {
    return Response.json({ error: error.message || "Wallet processing failed." }, { status: 500 });
  }
}

// Revert all other items in the same batch run that are still processing back to
// pending. Increments version to maintain the CAS invariant. Never deletes history.
async function revertRemainingBatchItems(base44, runId: string) {
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
  } catch {}
}