// Wallet Court — public, sanitized claim status for a case. Used by the case
// page to show CLAIMED WALLET / MANAGE RAP SHEET / CLAIM THIS WALLET. Includes
// Court Name and the latest approved Official Defense when public. Never
// returns the owner's user id, email, full address, or signature data.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { findCaseBySlug } from "../../shared/caseUtils.ts";
import { sanitizeHandlePublic, sanitizeDefensePublic } from "../../shared/walletClaim.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}
    const case_slug = body?.case_slug;
    if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });

    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { normalized_wallet_address: trial.normalized_wallet_address, network: trial.network, status: "active" },
      "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ claimed: false });

    let isOwner = false;
    try {
      const user = await base44.auth.me();
      if (user && user.id === claim.owner_user_id) isOwner = true;
    } catch {}

    if (isOwner) {
      return Response.json({
        claimed: true, is_owner: true,
        claim_slug: claim.claim_slug,
        court_name: claim.court_name || claim.public_alias || null,
        profile_visibility: claim.profile_visibility,
        linkable: true
      });
    }

    const vis = claim.profile_visibility;
    const showIdentity = vis === "public" || vis === "unlisted";

    // Load latest approved defense for public display.
    let publicDefense = null;
    if (showIdentity) {
      const defenseRecs = await base44.asServiceRole.entities.OfficialDefense.filter(
        { claim_slug: claim.claim_slug, moderation_status: "approved" }, "-version", 5
      );
      const latestApproved = (defenseRecs || [])[0];
      if (latestApproved) publicDefense = sanitizeDefensePublic(latestApproved);
    }

    return Response.json({
      claimed: true, is_owner: false,
      claim_slug: vis === "public" ? claim.claim_slug : null,
      court_name: showIdentity ? (claim.court_name || claim.public_alias || null) : null,
      official_defense: showIdentity ? publicDefense : null,
      linkable: vis === "public"
    });
  } catch (error) {
    return Response.json({ error: error.message || "Could not check claim status." }, { status: 500 });
  }
}