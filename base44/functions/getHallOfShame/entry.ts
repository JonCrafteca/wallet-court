// Wallet Court — public Hall of Shame data. Returns only sanitized public fields
// per case (abbreviated address, network, verdict, scores, mode, date, slug,
// and a trial count). Cases are deduplicated by normalized address + network so
// the same wallet never appears more than once inside a ranking section.
// Never returns full wallet addresses, roasts, evidence, metrics, or any
// internal/private record. Public app (no auth), so the service role reads.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const records = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" },
      "-created_date",
      500
    );
    const all = records || [];

    // Count completed trials per wallet (address + network) for the "Tried X
    // times" badge, without ever exposing the full address.
    const countMap = {};
    for (const t of all) {
      const k = keyOf(t);
      if (k) countMap[k] = (countMap[k] || 0) + 1;
    }

    const bySeverity = dedupBest(all, (t) => t.severity_score || 0)
      .sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0))
      .slice(0, 8);
    const byConfidence = dedupBest(all, (t) => t.confidence_score || 0)
      .sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0))
      .slice(0, 8);
    const byRecent = dedupBest(all, ts)
      .sort((a, b) => ts(b) - ts(a))
      .slice(0, 8);
    const onePump = dedupBest(
      all.filter((t) => t.verdict_code === "one_pump_chump"),
      (t) => t.severity_score || 0
    )
      .sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0))
      .slice(0, 8);

    return Response.json({
      sections: {
        most_severe: bySeverity.map((t) => sanitize(t, countMap)),
        highest_confidence: byConfidence.map((t) => sanitize(t, countMap)),
        recently_convicted: byRecent.map((t) => sanitize(t, countMap)),
        one_pump_wonders: onePump.map((t) => sanitize(t, countMap))
      }
    });
  } catch (error) {
    return Response.json({ error: error.message || "The docket could not be loaded." }, { status: 500 });
  }
}

function keyOf(t) {
  const addr = t.normalized_wallet_address || t.wallet_address || "";
  if (!addr) return "";
  return `${addr}|${t.network || ""}`;
}

// Keep only the best-scoring case per wallet so a wallet never repeats within
// a single ranking section.
function dedupBest(list, scoreFn) {
  const best = {};
  for (const t of list) {
    const k = keyOf(t);
    if (!k) continue;
    if (!best[k] || scoreFn(t) > scoreFn(best[k])) best[k] = t;
  }
  return Object.values(best);
}

function ts(t) {
  const v = t.analyzed_at || t.created_date;
  return v ? new Date(v).getTime() : 0;
}

function sanitize(t, countMap) {
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
    address_short: short,
    trial_count: countMap[keyOf(t)] || 1
  };
}