// Wallet Court — admin override and account cleanup helpers. Pure,
// unit-testable: no platform-runtime dependency. Used by the
// adminOverrideClaim and cleanupDeletedAccount backend functions.

export function validateAdminOverride(action, reason) {
  if (!action) return { ok: false, error: "action is required." };
  if (!reason || !String(reason).trim()) {
    return { ok: false, error: "A reason is required for admin override." };
  }
  if (action !== "revoke") return { ok: false, error: "Unknown action." };
  return { ok: true, reason: String(reason).trim() };
}

export function snapshotClaim(claim) {
  if (!claim) return "{}";
  return JSON.stringify({
    claim_slug: claim.claim_slug,
    owner_user_id: claim.owner_user_id,
    network: claim.network,
    status: claim.status,
    court_name: claim.court_name || null,
    court_name_normalized: claim.court_name_normalized || null,
    profile_visibility: claim.profile_visibility,
    verified_at: claim.verified_at,
  });
}

export function buildCleanupUpdates() {
  return {
    status: "revoked",
    court_name: null,
    court_name_normalized: null,
    profile_visibility: "private",
  };
}

export function buildCleanupAuditRecord(
  claim,
  adminUserId,
  targetUserId,
  beforeState,
  afterState,
  nowIso
) {
  return {
    claim_slug: claim.claim_slug,
    admin_user_id: adminUserId,
    action: "account_cleanup",
    reason: `Account cleanup for deleted user ${targetUserId}`,
    before_state_json: beforeState,
    after_state_json: afterState,
    created_at: nowIso,
  };
}