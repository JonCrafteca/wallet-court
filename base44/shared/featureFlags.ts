// Wallet Court — Feature Flag store. Server-side only. Reads/writes the
// FeatureFlag singleton (service-role-only RLS). Never stores secrets or
// wallet addresses.
//
// The robinhood_public_enabled flag gates PUBLIC Robinhood wallet submissions.
// When false, analyzeWalletWithNansen rejects public Robinhood requests before
// any Nansen call. Admin calibration and the isolated Robinhood validation
// allowance use separate admin-authenticated paths and are unaffected.
//
// Existing admin-created Robinhood cases remain viewable — viewing a case
// (getTrialBySlug) does not go through analyzeWalletWithNansen.

const CONTROL_KEY = "main";

// Read the singleton FeatureFlag record, or null if it doesn't exist yet.
export async function getFeatureFlag(base44): Promise<any> {
  const records = await base44.asServiceRole.entities.FeatureFlag.filter(
    { control_key: CONTROL_KEY }, "created_date", 1
  );
  return (records && records[0]) || null;
}

// Ensure the feature flag record exists (create with defaults if missing).
// Returns the canonical (oldest) record.
export async function ensureFeatureFlag(base44): Promise<any> {
  const existing = await getFeatureFlag(base44);
  if (existing) return existing;
  try {
    await base44.asServiceRole.entities.FeatureFlag.create({
      control_key: CONTROL_KEY,
      version: 0,
      robinhood_public_enabled: false,
      updated_at: new Date().toISOString()
    });
  } catch {
    // Create failed (e.g. duplicate) — fall through to re-read.
  }
  const afterCreate = await getFeatureFlag(base44);
  if (afterCreate) return afterCreate;
  throw new Error("Failed to ensure feature flag singleton.");
}

// Check if Robinhood is publicly enabled. Returns false when the flag record
// doesn't exist yet (safe default).
export async function isRobinhoodPublicEnabled(base44): Promise<boolean> {
  const flag = await getFeatureFlag(base44);
  return !!(flag && flag.robinhood_public_enabled === true);
}

// Set the robinhood_public_enabled flag. Admin-only (caller must verify auth).
// Uses CAS on the canonical record.
export async function setRobinhoodPublicEnabled(base44, enabled: boolean): Promise<any> {
  const existing = await ensureFeatureFlag(base44);
  const newVersion = (existing?.version || 0) + 1;
  return base44.asServiceRole.entities.FeatureFlag.update(existing.id, {
    robinhood_public_enabled: enabled,
    version: newVersion,
    updated_at: new Date().toISOString()
  });
}