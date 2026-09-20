// Wallet Court — admin-only stale calibration item recovery.
// Returns a processing item to pending ONLY after confirming no completed
// WalletTrial case exists for that wallet. Prevents rerunning an item whose
// analysis actually completed but whose docket record wasn't updated (e.g.,
// the function crashed after the trial was created).
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Never deletes queue history. Never overwrites a completed
// case slug.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ITEM_STATUS, sanitizeDocketItem } from "../../shared/calibration.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const docketItemId = body.docket_item_id;
    if (!docketItemId) {
      return Response.json({ error: "docket_item_id is required." }, { status: 400 });
    }

    // Find the item
    const items = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
      { docket_item_id: docketItemId }, "-queued_at", 1
    );
    const item = items && items[0];
    if (!item) {
      return Response.json({ error: "Queue item not found." }, { status: 404 });
    }

    // Only processing items can be recovered
    if (item.status !== ITEM_STATUS.PROCESSING) {
      return Response.json({
        error: `Item is not in processing state (current: ${item.status}). Only stale processing items can be recovered.`,
        status: item.status
      }, { status: 409 });
    }

    // If a case_slug is already set, the analysis completed — do NOT rerun
    if (item.case_slug) {
      return Response.json({
        error: "A completed case already exists for this item. Cannot rerun.",
        case_slug: item.case_slug
      }, { status: 409 });
    }

    // Defensive: check if a WalletTrial exists for this wallet (in case the
    // function crashed after trial creation but before docket update)
    const existingTrials = await base44.asServiceRole.entities.WalletTrial.filter(
      { normalized_wallet_address: item.normalized_wallet_address, network: item.network, status: "completed" },
      "-created_date", 1
    );
    if (existingTrials && existingTrials.length > 0) {
      // A trial was created — mark the item as completed with the existing slug
      const trial = existingTrials[0];
      await base44.asServiceRole.entities.CalibrationDocketItem.update(item.id, {
        status: ITEM_STATUS.COMPLETED,
        completed_at: new Date().toISOString(),
        case_slug: trial.public_slug || null,
        verdict_code: trial.verdict_code || null,
        verdict_name: trial.verdict_name || null,
        case_outcome: trial.case_outcome || null,
        data_mode: trial.data_mode || null
      });
      return Response.json({
        recovered: false,
        reason: "A completed WalletTrial already exists. Item marked as completed instead of rerun.",
        case_slug: trial.public_slug || null,
        item: sanitizeDocketItem({
          ...item,
          status: ITEM_STATUS.COMPLETED,
          case_slug: trial.public_slug || null,
          completed_at: new Date().toISOString()
        })
      });
    }

    // Safe to revert to pending — CAS transition with version increment
    const newVersion = (item.version || 0) + 1;
    const result = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
      {
        docket_item_id: docketItemId,
        status: ITEM_STATUS.PROCESSING,
        version: item.version
      },
      {
        $set: {
          status: ITEM_STATUS.PENDING,
          version: newVersion,
          started_at: null,
          run_id: null,
          correlation_id: null,
          failure_category: null,
          failure_message_safe: "Recovered from stale processing state by admin."
        }
      }
    );

    if (!result || result.updated !== 1) {
      return Response.json({ error: "Item was modified by another process. Refresh and try again." }, { status: 409 });
    }

    return Response.json({
      recovered: true,
      docket_item_id: docketItemId,
      message: "Item returned to pending. It will be picked up by the next batch."
    });
  } catch (error) {
    return Response.json({ error: error.message || "Recovery failed." }, { status: 500 });
  }
}