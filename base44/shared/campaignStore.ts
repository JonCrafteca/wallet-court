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