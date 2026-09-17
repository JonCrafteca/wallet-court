// Wallet Court — admin-only pilot review. For every analyzed wallet, returns
// abbreviated address, live/partial/demo, safe wallet class, verdict, severity,
// confidence, successful + failed endpoints, and a clickable View Case slug —
// so pilot review is possible without searching Data records manually.
// Raw Nansen labels are included ONLY here (admin-only) and never reach public
// visitors. Public cases expose only the safe wallet_class code + evidence card.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

const ENDPOINT_LABELS = {
  pnl_summary: "PnL Summary",
  dex_trades: "DEX Trades",
  current_balance: "Current Balance",
  transactions: "Transactions",
  address_labels: "Address Labels"
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const trials = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" }, "-created_date", 100
    );
    const usage = await base44.asServiceRole.entities.NansenApiUsage.list("-called_at", 1000);
    const labelSets = await base44.asServiceRole.entities.WalletLabelSet.list("-labeled_at", 200);

    const usageByCase = {};
    for (const u of (usage || [])) {
      const k = u.case_slug;
      if (!k) continue;
      if (!usageByCase[k]) usageByCase[k] = [];
      usageByCase[k].push(u);
    }
    const labelsByCase = {};
    for (const l of (labelSets || [])) {
      if (l.case_slug) labelsByCase[l.case_slug] = l;
    }

    const items = (trials || []).map((t) => {
      const addr = t.normalized_wallet_address || t.wallet_address || "";
      const short = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";
      const us = usageByCase[t.public_slug] || [];
      const successful = us
        .filter((u) => u.request_status === "success")
        .map((u) => ENDPOINT_LABELS[u.endpoint] || u.endpoint);
      const failed = us
        .filter((u) => u.request_status === "failed")
        .map((u) => `${ENDPOINT_LABELS[u.endpoint] || u.endpoint}${u.error_category ? ` (${u.error_category})` : ""}`);
      const ls = labelsByCase[t.public_slug];
      return {
        case_slug: t.public_slug,
        address_short: short,
        network: t.network,
        data_mode: t.data_mode,
        wallet_class: t.wallet_class || "unknown",
        verdict_name: t.verdict_name,
        verdict_code: t.verdict_code,
        severity_score: t.severity_score,
        confidence_score: t.confidence_score,
        successful_endpoints: successful,
        failed_endpoints: failed,
        analyzed_at: t.analyzed_at || t.created_date,
        has_raw_labels: !!ls,
        label_count: ls ? ls.label_count : 0,
        raw_labels: ls ? safeParse(ls.labels_json) : null
      };
    });

    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: error.message || "Pilot review failed." }, { status: 500 });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}