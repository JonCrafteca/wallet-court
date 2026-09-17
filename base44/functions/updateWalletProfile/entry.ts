// Wallet Court — owner-only profile update. Confirms claim ownership server-side,
// validates alias and privacy fields, and only ever writes the allowed profile
// fields. Ownership, wallet address, network, verification timestamps, and the
// claim slug are never accepted from the request and cannot be changed here.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateAlias, sanitizeClaim } from "../../shared/walletClaim.ts";

const VISIBILITIES = ["private", "unlisted", "public"];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try {
      body = await req.json();
    } catch {
      // allow empty body
    }
    const claim_slug = body?.claim_slug;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" },
      "-verified_at",
      5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) {
      return Response.json({ error: "You do not own this claim." }, { status: 403 });
    }

    const update = {};
    if (body?.public_alias !== undefined) {
      const v = validateAlias(body.public_alias);
      if (!v.ok) return Response.json({ error: v.error }, { status: 422 });
      update.public_alias = v.value;
    }
    if (body?.profile_visibility !== undefined) {
      if (!VISIBILITIES.includes(body.profile_visibility)) {
        return Response.json({ error: "Invalid visibility." }, { status: 422 });
      }
      update.profile_visibility = body.profile_visibility;
    }
    if (body?.show_trial_history !== undefined) {
      update.show_trial_history = !!body.show_trial_history;
    }
    if (body?.show_badges !== undefined) {
      update.show_badges = !!body.show_badges;
    }
    // No other fields are accepted — ownership/address/network/timestamps/slug
    // are intentionally immutable here.

    const updated = await base44.asServiceRole.entities.WalletClaim.update(claim.id, update);
    return Response.json({ claim: sanitizeClaim(updated, { isOwner: true }) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not update profile." }, { status: 500 });
  }
}