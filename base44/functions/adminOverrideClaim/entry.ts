// Wallet Court — admin override for a wallet claim. Admin-only. Requires a
// non-empty reason and creates an immutable ClaimAuditRecord with before/after
// state snapshots. The audit record is append-only — it is never updated or
// deleted.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateAdminOverride, snapshotClaim } from "../../shared/claimAudit.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { claim_slug, action, reason } = body || {};
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const validation = validateAdminOverride(action, reason);
    if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });

    const nowIso = new Date().toISOString();
    const beforeState = snapshotClaim(claim);

    if (action === "revoke") {
      await base44.asServiceRole.entities.WalletClaim.update(claim.id, {
        status: "revoked",
        court_name: null,
        court_name_normalized: null,
        profile_visibility: "private",
      });
    }

    const updated = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug }, "-verified_at", 1
    );
    const afterState = snapshotClaim(updated && updated[0]);

    // Immutable audit record — append-only, never updated or deleted
    await base44.asServiceRole.entities.ClaimAuditRecord.create({
      claim_slug,
      admin_user_id: user.id,
      action: "override_revoke",
      reason: validation.reason,
      before_state_json: beforeState,
      after_state_json: afterState,
      created_at: nowIso,
    });

    return Response.json({ status: "overridden", action });
  } catch (error) {
    return Response.json({ error: error.message || "Admin override failed." }, { status: 500 });
  }
}