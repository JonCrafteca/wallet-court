// Wallet Court — CalibrationRun DB helpers. Server-side only. Reads/writes the
// CalibrationRun entity via the service role (bypasses RLS). Never stores
// secrets or full wallet addresses.

import { TERMINAL_STATUSES, ACTIVE_STATUSES } from "./calibrationCampaign.ts";

const MAX_RUNS = 50;

// Get the single active (non-terminal) campaign run, or null if none exists.
// "Active" means running, pausing, or paused — not completed/stopped/etc.
export async function getActiveCampaign(base44): Promise<any | null> {
  const records = await base44.asServiceRole.entities.CalibrationRun.list("-started_at", MAX_RUNS);
  for (const r of records || []) {
    if (ACTIVE_STATUSES.has(r.status)) return r;
  }
  return null;
}

// Check if any active campaign exists (for the one-active-run guarantee).
export async function hasActiveCampaign(base44): Promise<boolean> {
  const run = await getActiveCampaign(base44);
  return run !== null;
}

// Get a campaign run by run_id.
export async function getCampaignById(base44, runId: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities.CalibrationRun.filter(
    { run_id: runId }, "-started_at", 1
  );
  return (records && records[0]) || null;
}

// Get the most recent run (active or terminal), for dashboard display.
export async function getMostRecentCampaign(base44): Promise<any | null> {
  const records = await base44.asServiceRole.entities.CalibrationRun.list("-started_at", 1);
  return (records && records[0]) || null;
}

// Create a new campaign run.
export async function createCampaign(base44, fields: any): Promise<any> {
  return base44.asServiceRole.entities.CalibrationRun.create(fields);
}

// CAS update of a campaign run. Returns the updated record or null if the CAS
// failed (version mismatch — another request modified the run).
export async function updateCampaignCAS(
  base44,
  runId: string,
  expectedVersion: number,
  fields: any
): Promise<any | null> {
  const result = await base44.asServiceRole.entities.CalibrationRun.updateMany(
    {
      run_id: runId,
      version: expectedVersion
    },
    {
      $set: {
        ...fields,
        updated_at: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  );
  if (!result || result.updated !== 1) return null;
  const records = await base44.asServiceRole.entities.CalibrationRun.filter(
    { run_id: runId }, "-started_at", 1
  );
  return (records && records[0]) || null;
}

// Plain update (non-CAS). Bumps version. Use when you've already verified the
// run state and don't need optimistic concurrency.
export async function updateCampaign(base44, runId: string, fields: any): Promise<any | null> {
  const existing = await getCampaignById(base44, runId);
  if (!existing) return null;
  return base44.asServiceRole.entities.CalibrationRun.update(existing.id, {
    ...fields,
    version: (existing.version || 0) + 1,
    updated_at: new Date().toISOString()
  });
}

// Get all docket items associated with a campaign run (by run_id).
export async function getCampaignItems(base44, runId: string): Promise<any[]> {
  const records = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
    { run_id: runId }, "-queued_at", 500
  );
  return records || [];
}

// ---- Interrupted-campaign reconciliation helpers ----

// Search for an existing completed WalletTrial for a docket item. Tries the
// strongest identifiers first: case_slug (the trial's public_slug), then
// network + normalized_wallet_address. Returns the most recent completed
// trial, or null. Never makes Nansen calls — reads WalletTrial records only.
export async function findExistingTrial(base44, docketItem: any): Promise<any | null> {
  // 1. By case_slug (strongest identifier — the trial's public_slug)
  if (docketItem?.case_slug) {
    try {
      const trials = await base44.asServiceRole.entities.WalletTrial.filter(
        { public_slug: docketItem.case_slug }, "-created_date", 1
      );
      if (trials && trials[0]) return trials[0];
    } catch {}
  }
  // 2. By network + normalized_wallet_address
  if (docketItem?.normalized_wallet_address && docketItem?.network) {
    try {
      const trials = await base44.asServiceRole.entities.WalletTrial.filter(
        { network: docketItem.network, normalized_wallet_address: docketItem.normalized_wallet_address },
        "-created_date", 5
      );
      const arr = trials || [];
      // Prefer a completed trial
      const completed = arr.filter((t) => t.status === "completed");
      if (completed.length > 0) return completed[0];
      if (arr.length > 0) return arr[0];
    } catch {}
  }
  return null;
}

// Idempotent CAS: mark a docket item as campaign-accounted. Returns true if the
// CAS succeeded (the item was NOT yet accounted → caller should increment
// counters). Returns false if the item was already accounted (counters must
// NOT be incremented again). Uses campaign_accounted != true as the CAS filter
// so it works for false/null/undefined.
export async function markDocketItemAccounted(base44, docketItemId: string): Promise<boolean> {
  const result = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
    { docket_item_id: docketItemId, campaign_accounted: { $ne: true } },
    { $set: { campaign_accounted: true }, $inc: { version: 1 } }
  );
  return !!(result && result.updated === 1);
}

// Update a docket item's status and fields (for reconciliation: marking a
// stale-PROCESSING item as completed with trial info, or reverting to PENDING).
// Uses CAS on version to prevent concurrent modifications.
export async function updateDocketItemForReconciliation(
  base44,
  docketItemId: string,
  expectedVersion: number,
  fields: Record<string, any>
): Promise<any | null> {
  const result = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
    { docket_item_id: docketItemId, version: expectedVersion },
    { $set: fields, $inc: { version: 1 } }
  );
  if (!result || result.updated !== 1) return null;
  const records = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
    { docket_item_id: docketItemId }, "-queued_at", 1
  );
  return (records && records[0]) || null;
}

// Revert a stale PROCESSING docket item back to PENDING (genuinely stale, no
// trial exists — safe to reprocess later). Clears run_id, correlation_id,
// started_at so the item returns to the general pending queue.
export async function revertStaleDocketItem(
  base44,
  docketItemId: string,
  expectedVersion: number
): Promise<any | null> {
  return updateDocketItemForReconciliation(base44, docketItemId, expectedVersion, {
    status: "pending",
    started_at: null,
    run_id: null,
    correlation_id: null
  });
}

// Revert all PROCESSING items for a run EXCEPT the current_item_id. Used by
// stopCalibrationCampaign to return non-current claimed items to the pending
// queue without touching the in-flight wallet.
export async function revertNonCurrentProcessingItems(
  base44,
  runId: string,
  currentItemIds: string[]
): Promise<number> {
  if (!currentItemIds || currentItemIds.length === 0) {
    // No current items — revert all PROCESSING items for this run
    const result = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
      { run_id: runId, status: "processing" },
      {
        $set: { status: "pending", started_at: null, run_id: null, correlation_id: null },
        $inc: { version: 1 }
      }
    );
    return result?.updated || 0;
  }
  // Revert PROCESSING items that are NOT in the current_item_ids list.
  // Since updateMany doesn't support $nin directly, we list the items first
  // and revert each one individually with CAS.
  const items = await base44.asServiceRole.entities.CalibrationDocketItem.filter(
    { run_id: runId, status: "processing" }, "-queued_at", 50
  );
  const toRevert = (items || []).filter((i) => !currentItemIds.includes(i.docket_item_id));
  let count = 0;
  for (const item of toRevert) {
    try {
      const r = await base44.asServiceRole.entities.CalibrationDocketItem.updateMany(
        { docket_item_id: item.docket_item_id, version: item.version, status: "processing" },
        {
          $set: { status: "pending", started_at: null, run_id: null, correlation_id: null },
          $inc: { version: 1 }
        }
      );
      if (r?.updated === 1) count++;
    } catch {}
  }
  return count;
}