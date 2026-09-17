// Wallet Court — admin-only Nansen API usage audit. Returns aggregate stats and
// a sanitized recent-call log from real NansenApiUsage records. Never returns
// the API key or raw Nansen responses (those are never stored to begin with).
// Figures come only from recorded responses; nothing is fabricated or estimated.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const records = await base44.asServiceRole.entities.NansenApiUsage.list("-called_at", 1000);
    const all = records || [];
    const successful = all.filter((r) => r.request_status === "success");

    const byEndpoint = countBy(all, "endpoint");
    const byNetwork = countBy(all, "chain");
    const successTotal = successful.length;
    const failureTotal = all.length - successTotal;

    let creditsUsed = 0;
    for (const r of successful) {
      creditsUsed += r.credits_used != null ? r.credits_used : (r.credits_cost || 0);
    }
    let creditsRemainingLatest = null;
    for (const r of successful) {
      if (r.credits_remaining != null) creditsRemainingLatest = r.credits_remaining;
    }

    let liveCases = 0;
    try {
      const live = await base44.asServiceRole.entities.WalletTrial.filter({ data_mode: "live" }, "-created_date", 500);
      liveCases = (live || []).length;
    } catch {
      // non-fatal
    }

    // API-key health inferred from the most recent records.
    const recent12 = all.slice(0, 12);
    let keyHealth = "unknown";
    if (recent12.length === 0) keyHealth = "unknown";
    else if (recent12.some((r) => r.request_status === "success")) keyHealth = "healthy";
    else if (recent12.some((r) => r.error_category === "missing_key")) keyHealth = "missing";
    else if (recent12.some((r) => r.error_category === "auth")) keyHealth = "invalid";
    else keyHealth = "degraded";

    const recent = all.slice(0, 25).map((r) => ({
      endpoint: r.endpoint,
      chain: r.chain,
      request_status: r.request_status,
      http_status: r.http_status,
      nansen_request_id: r.nansen_request_id,
      credits_cost: r.credits_cost,
      credits_used: r.credits_used,
      credits_remaining: r.credits_remaining,
      called_at: r.called_at,
      case_slug: r.case_slug,
      outcome: r.outcome,
      error_category: r.error_category
    }));

    return Response.json({
      stats: {
        successful_calls: successTotal,
        total_calls: all.length,
        goal: 1000,
        by_endpoint: byEndpoint,
        by_network: byNetwork,
        success_total: successTotal,
        failure_total: failureTotal,
        live_cases: liveCases,
        credits_used: creditsUsed,
        credits_remaining_latest: creditsRemainingLatest,
        key_health: keyHealth
      },
      recent
    });
  } catch (error) {
    return Response.json({ error: error.message || "Usage load failed." }, { status: 500 });
  }
}

function countBy(list, field) {
  const m = {};
  for (const r of list) {
    const k = r[field] || "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}