// Wallet Court — owner-only hide of the current approved Official Defense.
// Sets the latest approved version's status to "hidden" so it is no longer
// public. The next latest approved version (if any) becomes public.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const claim_slug = body?.claim_slug;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });

    const defenses = await base44.asServiceRole.entities.OfficialDefense.filter(
      { claim_slug, moderation_status: "approved" }, "-version", 5
    );
    const latest = (defenses || [])[0];
    if (!latest) return Response.json({ error: "No approved defense to hide." }, { status: 404 });

    await base44.asServiceRole.entities.OfficialDefense.update(latest.id, {
      moderation_status: "hidden", moderated_at: new Date().toISOString()
    });
    return Response.json({ status: "hidden" });
  } catch (error) {
    return Response.json({ error: error.message || "Could not hide defense." }, { status: 500 });
  }
}