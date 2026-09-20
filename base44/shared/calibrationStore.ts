// Wallet Court — Calibration Docket DB helpers. Server-side only. Reads/writes
// the CalibrationControl singleton and queries the verified NansenApiCallAudit
// total via the service role (bypasses RLS). Never stores secrets or full
// addresses beyond what the entities already hold.
import { AUDIT_QUERY_LIMIT } from "./calibration.ts";

const CONTROL_KEY = "main";

// Read the singleton CalibrationControl record, or null if it doesn't exist yet.
export async function getControl(base44): Promise<any> {
  const records = await base44.asServiceRole.entities.CalibrationControl.filter(
    { control_key: CONTROL_KEY }, "-updated_at", 1
  );
  return (records && records[0]) || null;
}

// Ensure the control record exists (create with defaults if missing). Returns it.
export async function ensureControl(base44): Promise<any> {
  const existing = await getControl(base44);
  if (existing) return existing;
  return base44.asServiceRole.entities.CalibrationControl.create({
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