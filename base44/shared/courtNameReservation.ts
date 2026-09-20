// Wallet Court — genuinely atomic Court Name reservation via a single CAS
// registry record. The normalized name is the reservation key inside a JSON
// map on one singleton registry record. Two concurrent requests for the same
// normalized name compete for the same database resource (the registry's
// version field). Exactly one CAS updateMany succeeds; the other fails
// without ever applying the name to its claim.
//
// Atomicity strategy (reservation-time exclusivity):
// 1. Reserve the normalized name in the singleton registry via CAS
//    (updateMany with version guard). Only one concurrent request can
//    increment the version and set the name. The loser's CAS fails.
// 2. Only after the reservation succeeds, update the claim with the name.
// 3. If the claim update fails, release the newly reserved name safely.
// 4. After the claim update succeeds, release the old name from the registry.
//
// No post-hoc duplicate search, deterministic winner selection, cleanup, or
// loser rollback. The loser never applies the name to its claim.

import {
  validateCourtName,
  checkCourtNameCooldown,
} from "./courtName.ts";

export const COURT_NAME_TAKEN = "That Court Name is already taken.";
export const COURT_NAME_CONFLICT = "Court Name is being updated. Please try again.";
export const REGISTRY_UNAVAILABLE = "Name registry is unavailable. Please try again later.";

const MAX_REGISTRY_RETRIES = 5;

// Reserve a normalized name in the singleton registry via CAS. Returns
// { ok: true } on success, { ok: false, error } on failure. The name is
// the reservation key — case-insensitive variations compete for the same key.
export async function reserveName(da, normalized, claim_slug) {
  for (let i = 0; i < MAX_REGISTRY_RETRIES; i++) {
    const reg = await da.getRegistry();
    if (!reg) return { ok: false, error: REGISTRY_UNAVAILABLE };
    const names = JSON.parse(reg.names_json || "{}");
    // If the name is already reserved by THIS claim, it's already ours.
    if (names[normalized] === claim_slug) return { ok: true };
    // If the name is reserved by another claim, it's taken.
    if (names[normalized]) return { ok: false, error: COURT_NAME_TAKEN };
    // Try to reserve: CAS update with version guard. Only one concurrent
    // request can match the current version and increment it.
    const newNames = { ...names, [normalized]: claim_slug };
    const result = await da.casUpdateRegistry(reg.id, reg.version, {
      names_json: JSON.stringify(newNames),
      version: reg.version + 1,
    });
    if (result.updated) return { ok: true };
    // Version changed — another request modified the registry. Retry.
  }
  return { ok: false, error: REGISTRY_UNAVAILABLE };
}

// Release a normalized name from the registry. Only removes the name if it
// is still mapped to the given claim_slug. Safe to call multiple times.
export async function releaseName(da, normalized, claim_slug) {
  if (!normalized) return;
  for (let i = 0; i < MAX_REGISTRY_RETRIES; i++) {
    const reg = await da.getRegistry();
    if (!reg) return;
    const names = JSON.parse(reg.names_json || "{}");
    if (names[normalized] !== claim_slug) return; // Not our reservation
    const newNames = { ...names };
    delete newNames[normalized];
    const result = await da.casUpdateRegistry(reg.id, reg.version, {
      names_json: JSON.stringify(newNames),
      version: reg.version + 1,
    });
    if (result.updated) return;
    // Version changed — retry
  }
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
    const oldNormalized = claim.court_name_normalized || null;
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
    // Release the old name from the registry
    if (oldNormalized) {
      await releaseName(da, oldNormalized, claim_slug);
    }
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

  const nowIso = new Date().toISOString();
  const oldNormalized = claim.court_name_normalized || null;

  // 6. Reserve the new name in the registry BEFORE updating the claim.
  // Two concurrent requests for the same name compete for the same
  // registry version. Exactly one succeeds.
  const reserveResult = await reserveName(da, v.normalized, claim_slug);
  if (!reserveResult.ok) {
    return { ok: false, error: reserveResult.error, status: 409 };
  }

  // 7. Update the claim with the new name (CAS)
  const casResult = await da.casUpdateClaim(claim.id, currentVersion, {
    court_name: v.value,
    court_name_normalized: v.normalized,
    court_name_changed_at: nowIso,
    court_name_version: currentVersion + 1,
  });

  if (!casResult.updated) {
    // Claim update failed — safely release the newly reserved name.
    // The existing name on the claim is untouched.
    await releaseName(da, v.normalized, claim_slug);
    return { ok: false, error: COURT_NAME_CONFLICT, status: 409 };
  }

  // 8. Immutable history record (append-only, never updated)
  await da.createHistoryRecord({
    claim_slug,
    court_name: v.value,
    court_name_normalized: v.normalized,
    changed_at: nowIso,
    changed_by_user_id: userId,
  });

  // 9. Release the old name from the registry (only after claim update succeeds)
  if (oldNormalized) {
    await releaseName(da, oldNormalized, claim_slug);
  }

  const updated = await da.getClaim(claim_slug);
  return { ok: true, claim: updated };
}