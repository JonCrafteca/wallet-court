// Wallet Court — CalibrationDiscovery DB helpers. Server-side only. Reads/writes
// the CalibrationDiscovery entity via the service role (bypasses RLS). Used for
// duplicate-discovery detection.

const MAX_DISCOVERIES = 50;

// Get the most recent discovery record matching a query fingerprint.
export async function getRecentDiscovery(base44, queryFingerprint: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities.CalibrationDiscovery.filter(
    { query_fingerprint: queryFingerprint }, "-discovered_at", 1
  );
  return (records && records[0]) || null;
}

// Create a new discovery record after a successful physical Nansen discovery.
export async function createDiscoveryRecord(base44, fields: any): Promise<any> {
  return base44.asServiceRole.entities.CalibrationDiscovery.create(fields);
}

// List recent discoveries for dashboard display.
export async function getRecentDiscoveries(base44): Promise<any[]> {
  const records = await base44.asServiceRole.entities.CalibrationDiscovery.list("-discovered_at", MAX_DISCOVERIES);
  return records || [];
}