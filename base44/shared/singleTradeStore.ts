// Wallet Court — Single Trade Trial DB helpers. Server-side only. Uses
// asServiceRole to read/write SingleTradeTrial records. Imported by backend
// functions; never imported by client code.
//
// Trial creation uses a version-guarded CAS mutex lock on the
// SingleTradeUsagePolicy singleton (the proven Owner Notifications pattern):
//
//   1. Acquire the creation lock via CAS (version guard + lock free/stale).
//   2. While holding the lock, check for an existing trial by fingerprint.
//   3. If exists (any status) → return it (duplicate/in-progress).
//   4. If not exists → create a trial with status="analyzing".
//   5. Release the lock in a finally block.
//
// Concurrent callers return the existing/in-progress trial. Duplicate
// callers make zero additional Nansen calls. This replaces the previous
// non-atomic SHA-256 fingerprint check-then-create pattern.

import { acquireCreationLock, releaseCreationLock } from "./singleTradeUsageStore.ts";

const ENTITY = "SingleTradeTrial";

// Find an existing trial by its idempotency fingerprint. Returns null if none.
export async function findByFingerprint(base44, tradeFingerprint: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { trade_fingerprint: tradeFingerprint }, "-created_date", 1
  );
  return (records && records[0]) || null;
}

// Find an existing trial by its public slug. Returns null if none.
export async function findBySlug(base44, publicSlug: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { public_slug: publicSlug }, "-created_date", 1
  );
  return (records && records[0]) || null;
}

// Find or create a trial atomically using the CAS mutex lock pattern.
//
// Returns { created, trial, duplicate }:
//   - created=true, duplicate=false: this caller created the trial (winner)
//   - created=false, duplicate=true: an existing trial was found (loser)
//
// The winner must subsequently do the Nansen calls and update the trial to
// completed/failed. The loser returns the existing trial without making
// any Nansen calls.
//
// The creation lock is ALWAYS released in the finally block, even on error.
export async function findOrCreateTrial(base44, fields: Record<string, any>): Promise<{ created: boolean; trial: any; duplicate: boolean }> {
  const { acquired, lockId } = await acquireCreationLock(base44);
  if (!acquired) {
    // Could not acquire the lock. Check for an existing trial — another
    // invocation may have created it. If none exists, return an error-like
    // result (the caller should retry).
    const existing = await findByFingerprint(base44, fields.trade_fingerprint);
    if (existing) {
      return { created: false, trial: existing, duplicate: true };
    }
    // Lock not acquired and no existing trial — return null trial so the
    // caller can handle the contention (retry or error).
    return { created: false, trial: null, duplicate: false };
  }

  try {
    // ---- Critical section: check-then-create (safe — we hold the lock) ----
    // Double-check with a brief retry to handle read-after-write inconsistency
    // from a previous lock holder whose create may not yet be visible to our read.
    let existing = await findByFingerprint(base44, fields.trade_fingerprint);
    if (!existing) {
      await new Promise(r => setTimeout(r, 50));
      existing = await findByFingerprint(base44, fields.trade_fingerprint);
    }
    if (existing) {
      return { created: false, trial: existing, duplicate: true };
    }

    // Create the trial with status="analyzing" and lock fields.
    const now = new Date().toISOString();
    const trial = await base44.asServiceRole.entities[ENTITY].create({
      ...fields,
      status: "analyzing",
      analysis_started_at: now,
      analysis_lock_id: lockId
    });

    // ---- Post-create dedup: re-read to catch duplicates from read-after-write ----
    // If another trial with the same fingerprint was created by a previous lock
    // holder but wasn't visible in our pre-create read, we delete our duplicate
    // and return the original. The brief delay gives the database time to make
    // the prior write visible to our read.
    await new Promise(r => setTimeout(r, 100));
    const allTrials = await base44.asServiceRole.entities[ENTITY].filter(
      { trade_fingerprint: fields.trade_fingerprint }, "created_date", 10
    );
    if (allTrials && allTrials.length > 1) {
      // Keep the first (oldest by created_date ascending), delete the rest.
      const first = allTrials[0];
      for (const t of allTrials) {
        if (t.id !== first.id) {
          await base44.asServiceRole.entities[ENTITY].delete(t.id).catch(() => {});
        }
      }
      if (first.id !== trial.id) {
        return { created: false, trial: first, duplicate: true };
      }
      return { created: true, trial: first, duplicate: false };
    }

    return { created: true, trial, duplicate: false };
  } finally {
    // ---- Release the creation mutex lock ----
    await releaseCreationLock(base44, lockId);
  }
}

// Update a trial to completed with the verdict data.
export async function completeTrial(base44, trialId: string, fields: Record<string, any>): Promise<any> {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities[ENTITY].update(trialId, {
    ...fields,
    status: "completed",
    analyzed_at: now,
    analysis_lock_id: null
  });
}

// Mark a trial as failed.
export async function failTrial(base44, trialId: string, errorCode: string, errorMessage: string): Promise<any> {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities[ENTITY].update(trialId, {
    status: "failed",
    error_code: errorCode,
    error_message: errorMessage,
    analyzed_at: now,
    analysis_lock_id: null
  });
}

// Append a refresh snapshot to refresh_snapshots_json without modifying the
// original verdict or OHLCV snapshot. CAS-protected: uses version guard so
// duplicate concurrent refreshes cannot both append.
export async function appendRefreshSnapshot(base44, trialId: string, snapshot: Record<string, any>): Promise<{ appended: boolean; trial: any | null }> {
  const existing = await base44.asServiceRole.entities[ENTITY].get(trialId);
  if (!existing) return { appended: false, trial: null };

  let snapshots: any[] = [];
  try {
    snapshots = JSON.parse(existing.refresh_snapshots_json || "[]");
    if (!Array.isArray(snapshots)) snapshots = [];
  } catch { snapshots = []; }
  snapshots.push(snapshot);

  // CAS: version guard + $inc atomically increments version, preventing
  // duplicate concurrent refresh appends.
  const result = await base44.asServiceRole.entities[ENTITY].updateMany(
    { id: trialId, status: "completed", version: existing.version ?? 0 },
    {
      $set: {
        refresh_snapshots_json: JSON.stringify(snapshots),
        current_price_usd: snapshot.current_price_usd ?? existing.current_price_usd,
        current_value_usd: snapshot.current_value_usd ?? existing.current_value_usd,
        current_token_amount: snapshot.current_token_amount ?? existing.current_token_amount,
        analyzed_at: new Date().toISOString()
      },
      $inc: { version: 1 }
    }
  );

  if (!result || result.updated !== 1) {
    // CAS failed — another concurrent refresh already appended.
    const refreshed = await base44.asServiceRole.entities[ENTITY].get(trialId);
    return { appended: false, trial: refreshed };
  }

  const updated = await base44.asServiceRole.entities[ENTITY].get(trialId);
  return { appended: true, trial: updated };
}