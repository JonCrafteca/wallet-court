// Wallet Court — authenticated account dashboard (My Court). Returns the
// signed-in user's trials, verified wallets, and official defenses, plus
// overview counts. All data is filtered server-side by the authenticated
// user's id — never by a client-supplied id. Full wallet addresses, internal
// ids, and moderation internals are never returned.
//
// Authorization: base44.auth.me() is checked first. If the visitor is not
// authenticated, a 401 is returned before any data is queried. The filter
// on submitted_by_user_id / owner_user_id guarantees one user cannot read
// another user's private account history, even if they craft a direct
// function invocation.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  sanitizeTrialForAccount,
  sanitizeClaimForAccount,
  sanitizeDefenseForAccount,
  computeDashboardCounts
} from "../../shared/accountDashboard.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    // My Trials — trials attributed to this user, newest first. Anonymous
    // trials (submitted_by_user_id = null) are never returned here.
    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { submitted_by_user_id: user.id },
      "-created_date",
      200
    );

    // My Verified Wallets — active claims cryptographically verified by this
    // user. Only wallets where the user completed ownership verification.
    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { owner_user_id: user.id, status: "active" },
      "-verified_at",
      100
    );

    // My Official Defenses — defenses authored by this user, newest first.
    const defenses = await base44.asServiceRole.entities.OfficialDefense.filter(
      { owner_user_id: user.id },
      "-submitted_at",
      200
    );

    const counts = computeDashboardCounts(trials, claims, defenses);

    return Response.json({
      user: { email: user.email || null, full_name: user.full_name || null },
      counts,
      trials: (trials || []).map(sanitizeTrialForAccount).filter(Boolean),
      wallets: (claims || []).map(sanitizeClaimForAccount).filter(Boolean),
      defenses: (defenses || []).map(sanitizeDefenseForAccount).filter(Boolean)
    });
  } catch (error) {
    return Response.json({ error: error.message || "Could not load account dashboard." }, { status: 500 });
  }
}