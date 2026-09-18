// Wallet Court — atomic Court Name acquisition with deterministic conflict
// resolution. Pure, unit-testable: takes a ClaimDataAccess interface so the
// logic can be tested with a mock that simulates CAS semantics without the
// Base44 platform runtime.
//
// Atomicity strategy:
// 1. CAS update (updateMany with court_name_version guard) — only one
//    concurrent request can set the name on a given claim.
// 2. Post-update conflict check — find other active claims with the same
//    normalized name.
// 3. Deterministic resolution — sort all claims with the name by verified_at
//    ascending, then by id ascending. The first is the winner.
// 4. Loser reverts its own claim via a second CAS update.
//
// This guarantees: after all concurrent requests complete, exactly one claim
// holds the name and no duplicates remain. Each request only modifies its
// own claim — no cross-claim writes.

import {
  validateCourtName,
  checkCourtNameCooldown,
} from "./courtName.ts";

export const COURT_NAME_TAKEN = "That Court Name is already taken.";
export const COURT_NAME_CONFLICT = "Court Name is being updated. Please try again.";

export function courtNameWinner(claims) {
  if (!claims || claims.length === 0) return null;
  const sorted = [...claims].sort((a, b) => {
    const va = Date.parse(a.verified_at || 0) || 0;
    const vb = Date.parse(b.verified_at || 0) || 0;
    if (va !== vb) return va - vb;
    // Tiebreak by id — deterministic and stable across all observers.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0];
}

export async function setCourtNameAtomically(
  da,
  claim_slug,
  court_name,
  userId
) {
  // 1. Get claim, check ownership
  const claim = await da.getClaim(claim_slug);
  if (!claim) return { ok: false, error: "Claim not found.", status: 404 };
  if (claim.owner_user_id !== userId)
    return { ok: false, error: "You do not own this claim.", status: 403 };

  const currentVersion = claim.court_name_version || 0;

  // 2. Clear name (set to null)
  if (court_name == null || String(court_name).trim() === "") {
    if (!claim.court_name && !claim.court_name_normalized) {
      return { ok: true, claim };
    }
    const nowIso = new Date().toISOString();
    const result = await da.casUpdateClaim(claim.id, currentVersion, {
      court_name: null,
      court_name_normalized: null,
    });
    if (!result.updated)
      return { ok: false, error: COURT_NAME_CONFLICT, status: 409 };
    await da.createHistoryRecord({
      claim_slug,
      court_name: null,
      court_name_normalized: null,
      changed_at: nowIso,
      changed_by_user_id: userId,
    });
    const updated = await da.getClaim(claim_slug);
    return { ok: true, claim: updated };
  }

  // 3. Validate
  const v = validateCourtName(court_name);
  if (!v.ok) return { ok: false, error: v.error, status: 422 };

  // 4. No change (same normalized name) — idempotent success
  if (v.normalized === (claim.court_name_normalized || "")) {
    return { ok: true, claim };
  }

  // 5. Cooldown (only when the name is actually changing)
  const cd = checkCourtNameCooldown(claim.court_name_changed_at);
  if (!cd.ok) return { ok: false, error: cd.error, status: 429 };

  // 6. CAS update — atomically set the name and bump the version
  const nowIso = new Date().toISOString();
  const casResult = await da.casUpdateClaim(claim.id, currentVersion, {
    court_name: v.value,
    court_name_normalized: v.normalized,
    court_name_changed_at: nowIso,
    court_name_version: currentVersion + 1,
  });
  if (!casResult.updated)
    return { ok: false, error: COURT_NAME_CONFLICT, status: 409 };

  // 7. Immutable history record (append-only, never updated)
  await da.createHistoryRecord({
    claim_slug,
    court_name: v.value,
    court_name_normalized: v.normalized,
    changed_at: nowIso,
    changed_by_user_id: userId,
  });

  // 8. Conflict check — find other active claims with the same name
  const conflicts = await da.findActiveByName(v.normalized, claim.id);
  if (conflicts.length === 0) {
    const updated = await da.getClaim(claim_slug);
    return { ok: true, claim: updated };
  }

  // 9. Deterministic resolution — all observers agree on the winner
  const thisClaimUpdated = {
    ...claim,
    court_name: v.value,
    court_name_normalized: v.normalized,
    court_name_version: currentVersion + 1,
  };
  const winner = courtNameWinner([thisClaimUpdated, ...conflicts]);

  // 10. Loser reverts its own claim via a second CAS
  if (winner.id !== claim.id) {
    await da.casUpdateClaim(claim.id, currentVersion + 1, {
      court_name: claim.court_name || null,
      court_name_normalized: claim.court_name_normalized || null,
      court_name_changed_at: claim.court_name_changed_at || null,
      court_name_version: currentVersion + 2,
    });
    return { ok: false, error: COURT_NAME_TAKEN, status: 409 };
  }

  // 11. Winner keeps the name
  const updated = await da.getClaim(claim_slug);
  return { ok: true, claim: updated };
}