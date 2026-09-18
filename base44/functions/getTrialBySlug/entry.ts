// Wallet Court — public case lookup by slug. Public app (no auth), so the
// service role reads the record and returns it to anonymous visitors.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sanitizeTrialForPublicCase } from "../../shared/caseUtils.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try {
      body = await req.json();
    } catch {
      // allow empty body
    }
    const slug = body?.slug;
    if (!slug) return Response.json({ error: "slug is required." }, { status: 400 });

    const results = await base44.asServiceRole.entities.WalletTrial.filter(
      { public_slug: slug },
      "-created_date",
      1
    );
    const trial = results && results[0];
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });

    return Response.json({ trial: sanitizeTrialForPublicCase(trial) });
  } catch (error) {
    return Response.json({ error: error.message || "Case file missing." }, { status: 500 });
  }
}