// Wallet Court — remove public identity when an account is deleted. Admin-only.
// Revokes all active WalletClaim records owned by the user, clears their Court
// Names, sets profile visibility to private, hides all WalletHandle records,
// hides all OfficialDefense records, and creates an immutable ClaimAuditRecord
// for each revoked claim. CourtNameHistory records are preserved (immutable
// history is never deleted).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  snapshotClaim,
  buildCleanupUpdates,
  buildCleanupAuditRecord,
} from "../../shared/claimAudit.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { user_id } = body || {};
    if (!user_id) return Response.json({ error: "user_id is required." }, { status: 400 });

    const nowIso = new Date().toISOString();
    let claimsRevoked = 0;
    let handlesHidden = 0;
    let defensesHidden = 0;

    // Revoke all active claims and clear public identity
    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { owner_user_id: user_id, status: "active" }, "-verified_at", 100
    );
    for (const claim of (claims || [])) {
      const beforeState = snapshotClaim(claim);
      const updates = buildCleanupUpdates();
      await base44.asServiceRole.entities.WalletClaim.update(claim.id, updates);
      const afterState = JSON.stringify({
        claim_slug: claim.claim_slug,
        ...updates,
      });
      const auditRecord = buildCleanupAuditRecord(
        claim, user.id, user_id, beforeState, afterState, nowIso
      );
      // Immutable audit record for each revoked claim
      await base44.asServiceRole.entities.ClaimAuditRecord.create(auditRecord);
      claimsRevoked++;
    }

    // Hide all visible handles
    const handlesResult = await base44.asServiceRole.entities.WalletHandle.updateMany(
      { owner_user_id: user_id, visibility: "visible" },
      { $set: { visibility: "hidden" } }
    );
    handlesHidden = (handlesResult && handlesResult.updated) || 0;

    // Hide all approved defenses
    const defensesResult = await base44.asServiceRole.entities.OfficialDefense.updateMany(
      { owner_user_id: user_id, moderation_status: "approved" },
      { $set: { moderation_status: "hidden" } }
    );
    defensesHidden = (defensesResult && defensesResult.updated) || 0;

    return Response.json({
      status: "cleaned",
      claims_revoked: claimsRevoked,
      handles_hidden: handlesHidden,
      defenses_hidden: defensesHidden,
    });
  } catch (error) {
    return Response.json({ error: error.message || "Account cleanup failed." }, { status: 500 });
  }
}