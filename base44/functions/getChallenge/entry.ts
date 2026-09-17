// Wallet Court — public challenge/comparison retrieval by slug. Returns the
// sanitized challenge record (only abbreviated addresses, never full ones).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}
    const challenge_slug = body?.challenge_slug;
    if (!challenge_slug) return Response.json({ error: "challenge_slug is required." }, { status: 400 });

    const results = await base44.asServiceRole.entities.WalletChallenge.filter(
      { challenge_slug },
      "-created_date",
      1
    );
    const challenge = results && results[0];
    if (!challenge) return Response.json({ error: "Challenge not found." }, { status: 404 });

    return Response.json({ challenge });
  } catch (error) {
    return Response.json({ error: error.message || "Challenge lookup failed." }, { status: 500 });
  }
}