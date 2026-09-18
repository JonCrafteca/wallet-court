// Wallet Court — owner-only Court Name setter. Validates the name, enforces
// the 30-day cooldown, and checks case-insensitive uniqueness atomically with
// a check-set-recheck pattern. The Court Name never becomes a URL identifier —
// the permanent wallet slug is unchanged.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateCourtName, checkCourtNameCooldown } from "../../shared/courtName.ts";
import { sanitizeClaim } from "../../shared/walletClaim.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const claim_slug = body?.claim_slug;
    const court_name = body?.court_name;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });

    // Allow clearing the court name (set to null).
    if (court_name == null || String(court_name).trim() === "") {
      const updated = await base44.asServiceRole.entities.WalletClaim.update(claim.id, {
        court_name: null, court_name_normalized: null
      });
      return Response.json({ claim: sanitizeClaim(updated, { isOwner: true }) });
    }

    const v = validateCourtName(court_name);
    if (!v.ok) return Response.json({ error: v.error }, { status: 422 });

    // Cooldown: only enforce if the name is actually changing.
    const currentNormalized = claim.court_name_normalized || "";
    if (v.normalized !== currentNormalized) {
      const cd = checkCourtNameCooldown(claim.court_name_changed_at);
      if (!cd.ok) return Response.json({ error: cd.error }, { status: 429 });
    }

    // Uniqueness check: no other active claim with the same normalized name.
    const conflicts = await base44.asServiceRole.entities.WalletClaim.filter(
      { court_name_normalized: v.normalized, status: "active" }, "-verified_at", 10
    );
    const conflict = (conflicts || []).find((c) => c.id !== claim.id);
    if (conflict) return Response.json({ error: "That Court Name is already taken." }, { status: 409 });

    const nowIso = new Date().toISOString();
    const updated = await base44.asServiceRole.entities.WalletClaim.update(claim.id, {
      court_name: v.value, court_name_normalized: v.normalized, court_name_changed_at: nowIso
    });

    // Race-safety recheck: if another claim now has the same name, revert.
    const recheck = await base44.asServiceRole.entities.WalletClaim.filter(
      { court_name_normalized: v.normalized, status: "active" }, "-verified_at", 10
    );
    const raceConflict = (recheck || []).find((c) => c.id !== claim.id);
    if (raceConflict) {
      await base44.asServiceRole.entities.WalletClaim.update(claim.id, {
        court_name: claim.court_name || null, court_name_normalized: claim.court_name_normalized || null,
        court_name_changed_at: claim.court_name_changed_at || null
      });
      return Response.json({ error: "That Court Name is already taken." }, { status: 409 });
    }

    return Response.json({ claim: sanitizeClaim(updated, { isOwner: true }) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not set Court Name." }, { status: 500 });
  }
}