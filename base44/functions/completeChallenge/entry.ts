// Wallet Court — complete a challenge by analyzing the defendant wallet and
// computing the comparison result. Public app. If a challenge_slug is supplied
// the existing open challenge is completed; otherwise a new completed challenge
// is created from the source case. Stores only sanitized public fields.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { findCaseBySlug, shortAddr, randomSlug } from "../../shared/caseUtils.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}

    const challenge_slug = body?.challenge_slug;
    const source_case_slug = body?.source_case_slug;
    const defendant_case_slug = body?.defendant_case_slug;

    if (!defendant_case_slug) {
      return Response.json({ error: "defendant_case_slug is required." }, { status: 400 });
    }

    const defendant = await findCaseBySlug(base44, defendant_case_slug);
    if (!defendant) return Response.json({ error: "Defendant case not found." }, { status: 404 });

    let challenge = null;
    if (challenge_slug) {
      const r = await base44.asServiceRole.entities.WalletChallenge.filter({ challenge_slug }, "-created_date", 1);
      challenge = r && r[0];
    }
    if (!challenge && source_case_slug) {
      const source = await findCaseBySlug(base44, source_case_slug);
      if (!source) return Response.json({ error: "Source case not found." }, { status: 404 });
      const newSlug = randomSlug("challenge-");
      challenge = await base44.asServiceRole.entities.WalletChallenge.create({
        challenge_slug: newSlug,
        source_case_slug,
        challenger_address_short: shortAddr(source.normalized_wallet_address || source.wallet_address),
        challenger_verdict_name: source.verdict_name,
        challenger_verdict_code: source.verdict_code,
        challenger_severity: source.severity_score,
        challenger_confidence: source.confidence_score,
        challenger_network: source.network,
        challenger_data_mode: source.data_mode,
        challenged_handles_json: JSON.stringify([]),
        status: "open"
      });
    }
    if (!challenge) return Response.json({ error: "Challenge not found." }, { status: 404 });

    const cSev = challenge.challenger_severity || 0;
    const dSev = defendant.severity_score || 0;
    const cConf = challenge.challenger_confidence || 0;
    const dConf = defendant.confidence_score || 0;

    let result;
    if (cSev === dSev && cConf === dConf) {
      result = "MISTRIAL — Both wallets demonstrated identical levels of financial misconduct.";
    } else {
      const challengerWins = cSev > dSev || (cSev === dSev && cConf > dConf);
      result = challengerWins
        ? "Greater Crimes Against Capital: the challenger committed the greater crimes against capital."
        : "Greater Crimes Against Capital: the defendant committed the greater crimes against capital.";
    }

    const updated = await base44.asServiceRole.entities.WalletChallenge.update(challenge.id, {
      defendant_case_slug: defendant.public_slug,
      defendant_address_short: shortAddr(defendant.normalized_wallet_address || defendant.wallet_address),
      defendant_verdict_name: defendant.verdict_name,
      defendant_verdict_code: defendant.verdict_code,
      defendant_severity: defendant.severity_score,
      defendant_confidence: defendant.confidence_score,
      defendant_network: defendant.network,
      defendant_data_mode: defendant.data_mode,
      status: "completed",
      result,
      completed_at: new Date().toISOString()
    });

    return Response.json({ challenge: updated });
  } catch (error) {
    return Response.json({ error: error.message || "Challenge completion failed." }, { status: 500 });
  }
}