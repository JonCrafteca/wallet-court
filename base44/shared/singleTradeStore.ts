// Wallet Court — Single Trade Trial DB helpers. Server-side only. Uses
// asServiceRole to read/write SingleTradeTrial records. Imported by backend
// functions; never imported by client code.

const ENTITY = "SingleTradeTrial";

// Find an existing trial by its idempotency fingerprint. Returns null if none.
export async function findByFingerprint(base44, tradeFingerprint: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { trade_fingerprint }, "-created_date", 1
  );
  return (records && records[0]) || null;
}

// Find an existing trial by its public slug. Returns null if none.
export async function findBySlug(base44, publicSlug: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { public_slug }, "-created_date", 1
  );
  return (records && records[0]) || null;
}

// Create a new SingleTradeTrial record.
export async function createTrial(base44, fields: Record<string, any>): Promise<any> {
  return base44.asServiceRole.entities[ENTITY].create(fields);
}

// Append a refresh snapshot to refresh_snapshots_json without modifying the
// original verdict or OHLCV snapshot.
export async function appendRefreshSnapshot(base44, trialId: string, snapshot: Record<string, any>): Promise<any> {
  const existing = await base44.asServiceRole.entities[ENTITY].get(trialId);
  if (!existing) return null;
  let snapshots: any[] = [];
  try {
    snapshots = JSON.parse(existing.refresh_snapshots_json || "[]");
    if (!Array.isArray(snapshots)) snapshots = [];
  } catch { snapshots = []; }
  snapshots.push(snapshot);
  return base44.asServiceRole.entities[ENTITY].update(trialId, {
    refresh_snapshots_json: JSON.stringify(snapshots),
    current_price_usd: snapshot.current_price_usd ?? existing.current_price_usd,
    current_value_usd: snapshot.current_value_usd ?? existing.current_value_usd,
    current_token_amount: snapshot.current_token_amount ?? existing.current_token_amount,
    analyzed_at: new Date().toISOString()
  });
}