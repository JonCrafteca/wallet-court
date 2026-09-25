// Wallet Court — Single Trade Trial: fetch a public case by slug. Returns a
// sanitized SingleTradeTrial for the /trade/:slug case page. No Nansen calls.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { sanitizeSingleTrialForPublicCase } from "../../shared/singleTradeEvidence.ts";
import { isSingleTradeRenderable } from "../../shared/singleTradeRenderable.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const slug = body?.slug;
    if (!slug) return Response.json({ error: "slug is required." }, { status: 400 });

    const trial = await findBySlug(base44, slug);
    if (!trial) return Response.json({ error: "This trade case never made it to the docket." }, { status: 404 });

    // Renderability gate: never return a failed/pending/incomplete trial as a
    // public case. A failed trial (e.g. analysis crashed mid-way) has null
    // verdict fields and empty evidence — rendering it would fabricate a
    // generic GUILTY stamp with 0/100 severity. Return 404 instead so the
    // frontend shows "Case file not found" rather than a fake verdict.
    if (!isSingleTradeRenderable(trial)) {
      return Response.json({ error: "This trade case was not completed and is not available for public viewing." }, { status: 404 });
    }

    return Response.json({ trial: sanitizeSingleTrialForPublicCase(trial) });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load trade case." }, { status: 500 });
  }
}