// Wallet Court — public/owner Rap Sheet. Respects private/unlisted/public
// visibility. Owners see everything regardless of visibility. Public visitors
// get sanitized fields only and public trial history only when the owner
// enabled it. Excludes raw metrics, source payloads, error fields, user ids,
// emails, nonce records, and signatures.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sanitizeClaim, sanitizeTrialPublic } from "../../shared/walletClaim.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
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
    if (!claim) return Response.json({ error: "Rap sheet not found." }, { status: 404 });

    let isOwner = false;
    try {
      const user = await base44.auth.me();
      if (user && user.id === claim.owner_user_id) isOwner = true;
    } catch {
      // anonymous visitor
    }

    if (!isOwner && claim.profile_visibility === "private") {
      return Response.json({ sealed: true, visibility: "private" });
    }

    // Public trial history by normalized address + network, newest first.
    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { normalized_wallet_address: claim.normalized_wallet_address, network: claim.network },
      "-created_date",
      50
    );
    const trialList = trials || [];
    const showHistory = isOwner || claim.show_trial_history;
    const sanitizedTrials = trialList.map(sanitizeTrialPublic);

    const appearances = trialList.length;
    const highestSeverity = trialList.reduce(
      (m, t) => Math.max(m, Number(t.severity_score) || 0),
      0
    );
    const latest = trialList[0];

    const rapSheet = {
      claim_slug: claim.claim_slug,
      public_alias: claim.public_alias || null,
      address_short: claim.address_short,
      network: claim.network,
      verified_at: claim.verified_at,
      last_verified_at: claim.last_verified_at,
      profile_visibility: claim.profile_visibility,
      show_trial_history: !!claim.show_trial_history,
      show_badges: claim.show_badges !== false,
      latest_trial_slug: claim.latest_trial_slug || null,
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
    }
    return Response.json(rapSheet);
  } catch (error) {
    return Response.json({ error: error.message || "Could not load rap sheet." }, { status: 500 });
  }
}