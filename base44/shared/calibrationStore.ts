// Wallet Court — Calibration Docket DB helpers. Server-side only. Reads/writes
// the CalibrationControl singleton and queries the verified NansenApiCallAudit
// total via the service role (bypasses RLS). Never stores secrets or full
// addresses beyond what the entities already hold.
import { AUDIT_QUERY_LIMIT } from "./calibration.ts";

const CONTROL_KEY = "main";

// Read the singleton CalibrationControl record, or null if it doesn't exist yet.
// Returns the OLDEST record (by created_date ascending) so all processes agree
// on the canonical singleton, even if duplicate rows were created in a
// simultaneous first-use race.
export async function getControl(base44): Promise<any> {
  const records = await base44.asServiceRole.entities.CalibrationControl.filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Ensure the control record exists (create with defaults if missing). Returns
// the canonical (oldest) record. If two processes call this simultaneously when
// no control exists, both may create a row, but both then re-read and get the
// same oldest record — so subsequent CAS operations (acquireCampaignLock)
// target the same id and only one can succeed.
export async function ensureControl(base44): Promise<any> {
  const existing = await getControl(base44);
  if (existing) return existing;
  try {
    await base44.asServiceRole.entities.CalibrationControl.create({
      control_key: CONTROL_KEY,
      version: 0,
      calibration_enabled: true,
      paused_reason: null,
      paused_at: null,
      paused_by_user_id: null,
      target_reached: false,
      ceiling_reached: false,
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    // Create failed (e.g. duplicate) — fall through to re-read.
  }
  // ALWAYS re-read after create to get the canonical (oldest) record, in case
  // another process created one simultaneously.
  const afterCreate = await getControl(base44);
  if (afterCreate) return afterCreate;
  throw new Error("Failed to ensure calibration control singleton.");
}

// Update the control record with new fields, bumping the CAS version.
export async function updateControl(base44, fields): Promise<any> {
  const existing = await ensureControl(base44);
  const newVersion = (existing?.version || 0) + 1;
  return base44.asServiceRole.entities.CalibrationControl.update(existing.id, {
    ...fields,
    version: newVersion,
    updated_at: new Date().toISOString()
  });
}

// Read the verified NansenApiCallAudit total. Caps at AUDIT_QUERY_LIMIT (1021);
// if the returned length equals the cap, the true total is at least that many.
export async function getVerifiedTotal(base44): Promise<number> {
  const records = await base44.asServiceRole.entities.NansenApiCallAudit.list(
    "-occurred_at", AUDIT_QUERY_LIMIT
  );
  return records?.length || 0;
}

// Collect wallet_fingerprint values from all existing queue items.
export async function getExistingQueueFingerprints(base44): Promise<Set<string>> {
  const records = await base44.asServiceRole.entities.CalibrationDocketItem.list(500);
  const set = new Set<string>();
  for (const r of records || []) {
    if (r.wallet_fingerprint) set.add(r.wallet_fingerprint);
  }
  return set;
}

// ---- Singleton campaign lock ----

// Atomically acquire the singleton campaign lock on the CalibrationControl
// singleton. Uses CAS (updateMany with campaign_lock_run_id = null filter) so
// two concurrent start requests cannot both succeed. Returns true if the lock
// was acquired (or already held by this run_id), false if another run holds it.
export async function acquireCampaignLock(base44, runId: string): Promise<boolean> {
  const control = await ensureControl(base44);
  // If already held by this run, idempotent success
  if (control.campaign_lock_run_id === runId) return true;
  // If held by another run, fail
  if (control.campaign_lock_run_id) return false;
  // Atomic CAS on the canonical control record (by id). Both concurrent starts
  // read the same canonical record (oldest by created_date), so both target the
  // same id. The filter (campaign_lock_run_id = null + version match) ensures
  // only one update succeeds.
  const result = await base44.asServiceRole.entities.CalibrationControl.updateMany(
    { id: control.id, campaign_lock_run_id: null, version: control.version },
    {
      $set: {
        campaign_lock_run_id: runId,
        campaign_lock_acquired_at: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  );
  return !!(result && result.updated === 1);
}

// Release the campaign lock. Only releases if the lock is held by the given
// run_id (prevents a stale or non-owner run from releasing another run's lock).
// Uses CAS on the canonical record id.
export async function releaseCampaignLock(base44, runId: string): Promise<boolean> {
  const control = await getControl(base44);
  if (!control) return false;
  const result = await base44.asServiceRole.entities.CalibrationControl.updateMany(
    { id: control.id, campaign_lock_run_id: runId },
    {
      $set: {
        campaign_lock_run_id: null,
        campaign_lock_acquired_at: null
      },
      $inc: { version: 1 }
    }
  );
  return !!(result && result.updated === 1);
}

// Check if the campaign lock is currently held by the given run_id.
export async function isCampaignLockHeldBy(base44, runId: string): Promise<boolean> {
  const control = await getControl(base44);
  return control?.campaign_lock_run_id === runId;
}

// ---- Telemetry health ----

// Mark telemetry as unhealthy. Sets telemetry_health to "unhealthy" and stores
// a safe warning message. Uses CAS to avoid clobbering. Called when audit
// persistence fails after all retries.
export async function markTelemetryUnhealthy(base44, warning: string): Promise<void> {
  const control = await ensureControl(base44);
  if (control.telemetry_health === "unhealthy") return; // already unhealthy
  await base44.asServiceRole.entities.CalibrationControl.updateMany(
    { id: control.id, telemetry_health: "healthy", version: control.version },
    {
      $set: {
        telemetry_health: "unhealthy",
        telemetry_warning: warning,
        telemetry_unhealthy_since: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  );
}

// Mark telemetry as healthy again. Called when audit persistence succeeds
// after a period of failure.
export async function markTelemetryHealthy(base44): Promise<void> {
  const control = await getControl(base44);
  if (!control || control.telemetry_health === "healthy") return;
  await base44.asServiceRole.entities.CalibrationControl.updateMany(
    { id: control.id, telemetry_health: "unhealthy", version: control.version },
    {
      $set: {
        telemetry_health: "healthy",
        telemetry_warning: null,
        telemetry_unhealthy_since: null
      },
      $inc: { version: 1 }
    }
  );
}

// Check if telemetry is currently unhealthy. Returns the warning string if
// unhealthy, null if healthy.
export async function getTelemetryHealth(base44): Promise<{ healthy: boolean; warning: string | null }> {
  const control = await getControl(base44);
  if (!control) return { healthy: true, warning: null };
  return {
    healthy: control.telemetry_health !== "unhealthy",
    warning: control.telemetry_warning || null
  };
}