// Wallet Court — admin-only Calibration Docket batch claim.
// Claims N pending items via CAS (no Nansen calls). Returns the claimed items
// (sanitized, short addresses only) for the frontend to process one at a time
// via processCalibrationWallet. This split keeps each function call within
// execution time limits.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  validateBatchSize,
  checkBudget,
  claimFilter,
  sanitizeDocketItem,
  newRunId,
  ITEM_STATUS,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING,
  DEFAULT_BATCH_SIZE,
  containsForbiddenDocketData
} from "../../shared/calibration.ts";
import { getControl, getVerifiedTotal } from "../../shared/calibrationStore.ts";
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

    // Validate batch size and confirmation
    const batchValidation = validateBatchSize(body.batch_size);
    if (!batchValidation.ok) return Response.json({ error: batchValidation.reason }, { status: 400 });
    if (!body.confirmed) return Response.json({ error: "Confirmation checkbox is required." }, { status: 400 });
    const batchSize = batchValidation.value;

    // Check kill switch
    const control = await getControl(base44);
    if (control && !control.calibration_enabled) {
      return Response.json({ error: "Calibration is paused.", paused: true, reason: control.paused_reason }, { status: 423 });
    }

    // Check budget (verified total)
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      return Response.json({ error: budget.reason, budget, verified_total: verifiedTotal }, { status: 423 });
    }

    // Check circuit breaker — don't claim items if the provider is in recess
    const circuit = await getCircuit(base44, PROVIDER);
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ error: "Provider is in Court Recess. Try again later.", court_recess: true }, { status: 423 });
    }

    // Check no active batch (items in processing state)
    const processing = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { status: ITEM_STATUS.PROCESSING }, "-queued_at", 1
    );
    if (processing && processing.length > 0) {
      return Response.json({ error: "A calibration batch is already in progress.", active_batch: true }, { status: 409 });
    }

    // Find pending items (up to batch_size, oldest first)
    const pending = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { status: ITEM_STATUS.PENDING }, "queued_at", batchSize
    );
    if (!pending || pending.length === 0) {
      return Response.json({ error: "No pending items in the queue.", empty: true }, { status: 404 });
    }

    // CAS claim each item
    const runId = newRunId();
    const now = new Date().toISOString();
    const claimed: any[] = [];
    for (const item of pending) {
      const result = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
        claimFilter(item.docket_item_id, item.version),
        {
          $set: {
            status: ITEM_STATUS.PROCESSING,
            version: item.version + 1,
            started_at: now,
            run_id: runId,
            correlation_id: runId,
            attempt_count: (item.attempt_count || 0) + 1
          }
        }
      );
      if (result && result.updated === 1) {
        // Re-read the claimed item to get the updated version
        const claimedItems = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
          { docket_item_id: item.docket_item_id }, "-queued_at", 1
        );
        if (claimedItems && claimedItems[0]) {
          claimed.push(claimedItems[0]);
        }
      }
      // If CAS failed (updated !== 1), another batch claimed it — skip
    }

    if (claimed.length === 0) {
      return Response.json({ error: "No items could be claimed. They may have been claimed by another batch.", empty: true }, { status: 409 });
    }

    const sanitized = claimed.map(sanitizeDocketItem);
    for (const s of sanitized) {
      if (containsForbiddenDocketData(s)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    trackSafe(base44, "calibration_batch_started", {
      batch_size: claimed.length,
      run_id: runId,
      verified_total: verifiedTotal
    });

    return Response.json({
      run_id: runId,
      claimed: sanitized,
      batch_size: claimed.length,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      budget
    });
  } catch (error) {
    return Response.json({ error: error.message || "Batch start failed." }, { status: 500 });
  }
}