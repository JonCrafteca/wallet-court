// Wallet Court — create a trader challenge from a completed case. Public app.
// Records the challenger's sanitized public info and the challenged X handles,
// and returns a shareable challenge slug. Never stores full wallet addresses.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { findCaseBySlug, sanitizeHandle, isValidHandle, shortAddr, randomSlug } from "../../shared/caseUtils.ts";
import { getCaseOutcome } from "../../shared/evidenceGate.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}

    const source_case_slug = body?.source_case_slug;
    let handles = Array.isArray(body?.challenged_handles) ? body.challenged_handles : [];

    if (!source_case_slug) {
      return Response.json({ error: "source_case_slug is required." }, { status: 400 });
    }

    const trial = await findCaseBySlug(base44, source_case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });

    // Dismissed/mistrial cases carry no verdict and cannot be challenged.
    const outcome = getCaseOutcome(trial);
    if (outcome === "dismissed_no_evidence" || outcome === "mistrial_insufficient_evidence") {
      return Response.json({ error: "This case has no verdict and cannot be challenged." }, { status: 422 });
    }

    handles = handles.map(sanitizeHandle).filter(Boolean).filter(isValidHandle);
    handles = [...new Set(handles)].slice(0, 3);

    const challenge_slug = randomSlug("challenge-");
    const record = await base44.asServiceRole.entities.WalletChallenge.create({
      challenge_slug,
      source_case_slug,
      challenger_address_short: shortAddr(trial.normalized_wallet_address || trial.wallet_address),
      challenger_verdict_name: trial.verdict_name,
      challenger_verdict_code: trial.verdict_code,
      challenger_severity: trial.severity_score,
      challenger_confidence: trial.confidence_score,
      challenger_network: trial.network,
      challenger_data_mode: trial.data_mode,
      challenged_handles_json: JSON.stringify(handles),
      status: "open"
    });

    return Response.json({ challenge_slug, challenge: record });
  } catch (error) {
    return Response.json({ error: error.message || "Challenge creation failed." }, { status: 500 });
  }
}