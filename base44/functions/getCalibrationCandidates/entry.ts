// Wallet Court — admin-only Candidate Discovery list.
// Returns sanitized candidates for dashboard display, plus recent discovery
// records for duplicate-discovery detection. Never includes full or
// normalized wallet addresses.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero production data mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sanitizeCandidate, containsForbiddenCandidateData, checkBudget } from "../../shared/candidateDiscovery.ts";
import { getCandidates } from "../../shared/candidateStore.ts";
import { getRecentDiscoveries } from "../../shared/discoveryStore.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";
import { CALIBRATION_TARGET, CALIBRATION_CEILING } from "../../shared/calibration.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const [candidates, verifiedTotal, recentDiscoveries] = await Promise.all([
      getCandidates(base44),
      getVerifiedTotal(base44),
      getRecentDiscoveries(base44)
    ]);

    const sanitized = (candidates || []).map(sanitizeCandidate);
    for (const s of sanitized) {
      if (containsForbiddenCandidateData(s)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    // Sanitize recent discoveries (safe fields only)
    const sanitizedDiscoveries = (recentDiscoveries || []).map((d) => ({
      discovery_id: d.discovery_id || "",
      query_fingerprint: d.query_fingerprint || "",
      network: d.network || "",
      cohort: d.cohort || "",
      timeframe_days: d.timeframe_days ?? 0,
      result_limit: d.result_limit ?? 0,
      candidates_found: d.candidates_found ?? 0,
      discovered_at: d.discovered_at || null
    }));

    return Response.json({
      candidates: sanitized,
      recent_discoveries: sanitizedDiscoveries,
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      budget: checkBudget(verifiedTotal)
    });
  } catch (error) {
    return Response.json({ error: error.message || "Candidate list failed." }, { status: 500 });
  }
}