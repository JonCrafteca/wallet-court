// Wallet Court — public Hall of Shame data. Returns only sanitized public fields
// per case (abbreviated address, network, verdict, scores, mode, date, slug).
// Never returns full wallet addresses, roasts, evidence, metrics, or any
// internal/private record. Public app (no auth), so the service role reads.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const records = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" },
      "-created_date",
      200
    );

    const list = (records || []).map(sanitize);

    const bySeverity = [...list].sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0));
    const byConfidence = [...list].sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));
    const byRecent = [...list].sort((a, b) => ts(b) - ts(a));
    const onePump = list
      .filter((c) => c.verdict_code === "one_pump_chump")
      .sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0));

    return Response.json({
      sections: {
        most_severe: bySeverity.slice(0, 8),
        highest_confidence: byConfidence.slice(0, 8),
        recently_convicted: byRecent.slice(0, 8),
        one_pump_wonders: onePump.slice(0, 8)
      }
    });
  } catch (error) {
    return Response.json({ error: error.message || "The docket could not be loaded." }, { status: 500 });
  }
}

function ts(c) {
  const t = c.analyzed_at || c.created_date;
  return t ? new Date(t).getTime() : 0;
}

function sanitize(t) {
  const addr = t.normalized_wallet_address || t.wallet_address || "";
  const short = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";
  return {
    slug: t.public_slug,
    network: t.network,
    verdict_name: t.verdict_name,
    verdict_code: t.verdict_code,
    severity_score: t.severity_score,
    confidence_score: t.confidence_score,
    data_mode: t.data_mode,
    analyzed_at: t.analyzed_at || t.created_date,
    address_short: short
  };
}