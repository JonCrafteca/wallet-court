// Wallet Court — owner-only Official Defense submission. Creates a new
// immutable version (never overwrites history). New versions start as
// "pending" and require admin approval before they are public. The defense
// never modifies the verdict, evidence, severity, confidence, or case outcome.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateDefenseText } from "../../shared/defense.ts";
import { sanitizeDefenseForOwner } from "../../shared/walletClaim.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const claim_slug = body?.claim_slug;
    const text = body?.text;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });

    const v = validateDefenseText(text);
    if (!v.ok) return Response.json({ error: v.error }, { status: 422 });

    // Find the latest version number.
    const existing = await base44.asServiceRole.entities.OfficialDefense.filter(
      { claim_slug }, "-version", 5
    );
    const latestVersion = (existing && existing[0]?.version) || 0;
    const newVersion = latestVersion + 1;
    const nowIso = new Date().toISOString();

    const defense = await base44.asServiceRole.entities.OfficialDefense.create({
      claim_slug, owner_user_id: user.id,
      version: newVersion, text: v.value,
      moderation_status: "pending",
      replaces_version: latestVersion > 0 ? latestVersion : null,
      submitted_at: nowIso
    });
    return Response.json({ defense: sanitizeDefenseForOwner(defense) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not submit defense." }, { status: 500 });
  }
}