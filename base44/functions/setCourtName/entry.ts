// Wallet Court — owner-only Court Name setter. Uses the atomic CAS reservation
// logic from courtNameReservation.ts: a version-guarded CAS update followed by
// a deterministic conflict resolution. The Court Name never becomes a URL
// identifier — the permanent wallet slug is unchanged. Each change creates an
// immutable CourtNameHistory record (append-only, never updated).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { setCourtNameAtomically } from "../../shared/courtNameReservation.ts";
import { makeClaimDataAccess } from "../../shared/claimDataAccess.ts";
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

    const da = makeClaimDataAccess(base44);
    const result = await setCourtNameAtomically(da, claim_slug, court_name, user.id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status || 500 });
    return Response.json({ claim: sanitizeClaim(result.claim, { isOwner: true }) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not set Court Name." }, { status: 500 });
  }
}