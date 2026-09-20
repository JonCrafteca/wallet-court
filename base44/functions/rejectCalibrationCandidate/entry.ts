// Wallet Court — admin-only Candidate Discovery rejection.
// Updates a single candidate's review status to "rejected" with a safe reason.
// Uses CAS (version check) to prevent concurrent rejections from corrupting state.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { sanitizeCandidate, containsForbiddenCandidateData } from "../../shared/candidateDiscovery.ts";
import { getCandidateById, updateCandidateStatus } from "../../shared/candidateStore.ts";

function trackSafe(base44, eventName: string, props: Record<string, any>) {
  try { if (base44?.analytics?.track) waitUntil(base44.analytics.track({ eventName, properties: props })); } catch {}
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const candidateId = body.candidate_id;
    if (!candidateId) {
      return Response.json({ error: "candidate_id is required." }, { status: 400 });
    }

    const candidate = await getCandidateById(base44, candidateId);
    if (!candidate) {
      return Response.json({ error: "Candidate not found." }, { status: 404 });
    }

    // Only "discovered" candidates can be rejected
    if (candidate.review_status !== "discovered") {
      return Response.json({
        error: `Candidate is already ${candidate.review_status}.`,
        status: candidate.review_status
      }, { status: 409 });
    }

    const reason = (body.reason || "Rejected by administrator.").slice(0, 200);
    const updated = await updateCandidateStatus(base44, candidateId, candidate.version, "rejected", reason);
    if (!updated) {
      return Response.json({ error: "Candidate was modified by another process. Refresh and try again." }, { status: 409 });
    }

    const sanitized = sanitizeCandidate(updated);
    if (containsForbiddenCandidateData(sanitized)) {
      return Response.json({ error: "Internal privacy error." }, { status: 500 });
    }

    trackSafe(base44, "calibration_candidate_rejected", {
      network: candidate.network,
      cohort: candidate.cohort
    });

    return Response.json({ candidate: sanitized });
  } catch (error) {
    return Response.json({ error: error.message || "Rejection failed." }, { status: 500 });
  }
}