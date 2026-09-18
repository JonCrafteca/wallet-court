// Wallet Court — public/owner Rap Sheet. Respects private/unlisted/public
// visibility. Owners see everything regardless of visibility. Public visitors
// get sanitized fields only. Includes Court Name, social handles, and the
// latest approved Official Defense when the owner has enabled public identity.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  sanitizeClaim, sanitizeTrialPublic, sanitizeHandlePublic,
  sanitizeDefensePublic, sanitizeDefenseForOwner
} from "../../shared/walletClaim.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}
    const claim_slug = body?.claim_slug;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Rap sheet not found." }, { status: 404 });

    let isOwner = false;
    try {
      const user = await base44.auth.me();
      if (user && user.id === claim.owner_user_id) isOwner = true;
    } catch {}

    if (!isOwner && claim.profile_visibility === "private") {
      return Response.json({ sealed: true, visibility: "private" });
    }

    // Load social handles.
    const handleRecs = await base44.asServiceRole.entities.WalletHandle.filter(
      { claim_slug }, "-created_date", 20
    );
    const handles = (handleRecs || []).filter((h) => isOwner || h.visibility === "visible");
    const publicHandles = handles.map(sanitizeHandlePublic).filter(Boolean);

    // Load Official Defense versions.
    const defenseRecs = await base44.asServiceRole.entities.OfficialDefense.filter(
      { claim_slug }, "-version", 50
    );
    const allDefenses = defenseRecs || [];
    const approvedDefenses = allDefenses.filter((d) => d.moderation_status === "approved").sort((a, b) => b.version - a.version);
    const latestApproved = approvedDefenses[0] || null;
    const publicDefense = latestApproved ? sanitizeDefensePublic(latestApproved) : null;

    // Public trial history.
    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { normalized_wallet_address: claim.normalized_wallet_address, network: claim.network },
      "-created_date", 50
    );
    const trialList = trials || [];
    const showHistory = isOwner || claim.show_trial_history;
    const sanitizedTrials = trialList.map(sanitizeTrialPublic);

    const appearances = trialList.length;
    const highestSeverity = trialList.reduce((m, t) => Math.max(m, Number(t.severity_score) || 0), 0);
    const latest = trialList[0];

    const rapSheet = {
      claim_slug: claim.claim_slug,
      court_name: claim.court_name || claim.public_alias || null,
      address_short: claim.address_short,
      network: claim.network,
      verified_at: claim.verified_at,
      last_verified_at: claim.last_verified_at,
      profile_visibility: claim.profile_visibility,
      show_trial_history: !!claim.show_trial_history,
      show_badges: claim.show_badges !== false,
      latest_trial_slug: claim.latest_trial_slug || null,
      handles: publicHandles,
      official_defense: publicDefense,
      latest_verdict: latest
        ? { code: latest.verdict_code, name: latest.verdict_name, headline: latest.headline, slug: latest.public_slug }
        : null,
      counts: {
        appearances,
        highest_severity: highestSeverity,
        latest_appearance_date: latest ? latest.analyzed_at || latest.created_date : null
      },
      trials: showHistory ? sanitizedTrials : [],
      is_owner: isOwner
    };

    if (isOwner) {
      rapSheet.owner_claim = sanitizeClaim(claim, { isOwner: true });
      rapSheet.owner_defenses = allDefenses.sort((a, b) => b.version - a.version).map(sanitizeDefenseForOwner);
    }
    return Response.json(rapSheet);
  } catch (error) {
    return Response.json({ error: error.message || "Could not load rap sheet." }, { status: 500 });
  }
}