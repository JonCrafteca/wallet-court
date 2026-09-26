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

// Find an existing ACTIVE or COMPLETED trial by fingerprint. Returns null if
// none. "Active" = status "analyzing" or "pending". "Completed" = status
// "completed". FAILED trials are excluded — they are historical records that
// must NOT block a retry. The caller uses this to decide:
//   - completed → return idempotently (zero calls)
//   - analyzing/pending → return conflict (zero calls)
//   - null (only failed or no trials) → proceed to create a new attempt
export async function findActiveOrCompletedByFingerprint(base44, tradeFingerprint: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { trade_fingerprint: tradeFingerprint }, "-created_date", 50
  );
  if (!records || records.length === 0) return null;
  // Return the most recent non-failed trial (completed or analyzing/pending).
  for (const r of records) {
    if (r.status === "completed" || r.status === "analyzing" || r.status === "pending") {
      return r;
    }
  }
  return null;
}

// Find all non-failed trials by fingerprint, sorted oldest-first by created_date.
// Used for post-create dedup: if two concurrent creations both produced a
// non-failed trial, keep the oldest and delete the rest. Failed trials are
// historical records and are never deleted by dedup.
export async function findNonFailedByFingerprint(base44, tradeFingerprint: string): Promise<any[]> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { trade_fingerprint: tradeFingerprint }, "created_date", 50
  );
  if (!records || records.length === 0) return [];
  return records.filter((r) => r.status !== "failed");
}

// Find or create a trial atomically using the CAS mutex lock pattern.
//
// RETRY SEMANTICS (the fix for failed-trial retry):
//   - completed fingerprint → return the completed case idempotently (zero calls)
//   - active processing (analyzing/pending) fingerprint → return in-progress
//     conflict response (zero calls)
//   - failed fingerprint → allow ONE new analysis attempt (create a new trial
//     with its own slug, timestamps, and status)
//   - no existing trial → create a new trial (first attempt)
//   - concurrent retry requests → exactly one winner (CAS mutex lock)
//   - original failed record remains unchanged and hidden (never returned by
//     getSingleTradeBySlug because isSingleTradeRenderable rejects status=failed)
//
// Returns { created, trial, duplicate }:
//   - created=true, duplicate=false: this caller created the trial (winner)
//   - created=false, duplicate=true: an existing active/completed trial was
//     found (loser — return it without making Nansen calls)
//   - created=false, duplicate=false, trial=null: lock contention (caller
//     should retry or return a conflict error)
//
// The creation lock is ALWAYS released in the finally block, even on error.
export async function findOrCreateTrial(base44, fields: Record<string, any>): Promise<{ created: boolean; trial: any; duplicate: boolean }> {
  const { acquired, lockId } = await acquireCreationLock(base44);
  if (!acquired) {
    // Could not acquire the lock — another caller is creating. Check for an
    // existing active/completed trial. If one exists, return it as a duplicate.
    const existing = await findActiveOrCompletedByFingerprint(base44, fields.trade_fingerprint);
    if (existing) {
      return { created: false, trial: existing, duplicate: true };
    }
    // Lock not acquired and no active/completed trial — return null trial so
    // the caller can handle the contention (retry or conflict error).
    return { created: false, trial: null, duplicate: false };
  }

  try {
    // ---- Critical section: check-then-create (safe — we hold the lock) ----
    // Check for an existing ACTIVE or COMPLETED trial (not failed). A failed
    // trial does NOT block creation — it allows a retry.
    let existing = await findActiveOrCompletedByFingerprint(base44, fields.trade_fingerprint);
    if (!existing) {
      // Brief retry for read-after-write inconsistency.
      await new Promise(r => setTimeout(r, 50));
      existing = await findActiveOrCompletedByFingerprint(base44, fields.trade_fingerprint);
    }
    if (existing) {
      // An active/completed trial exists — return it as a duplicate. The
      // caller makes zero Nansen calls.
      return { created: false, trial: existing, duplicate: true };
    }

    // No active/completed trial exists (first attempt OR retry of a failed
    // trial). Create a NEW trial with its own slug, timestamps, and status.
    const now = new Date().toISOString();
    const trial = await base44.asServiceRole.entities[ENTITY].create({
      ...fields,
      status: "analyzing",
      analysis_started_at: now,
      analysis_lock_id: lockId
    });

    // ---- Post-create dedup: re-read non-failed trials to catch duplicates ----
    // If another non-failed trial with the same fingerprint was created by a
    // previous lock holder but wasn't visible in our pre-create read, we keep
    // the oldest non-failed trial and delete our duplicate. FAILED trials are
    // NEVER deleted — they are historical records.
    await new Promise(r => setTimeout(r, 100));
    const nonFailed = await findNonFailedByFingerprint(base44, fields.trade_fingerprint);
    if (nonFailed && nonFailed.length > 1) {
      // Keep the first (oldest by created_date ascending), delete the rest.
      const first = nonFailed[0];
      for (const t of nonFailed) {
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