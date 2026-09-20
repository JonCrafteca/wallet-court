// Wallet Court — admin-only Candidate Discovery approval.
// Takes up to 5 candidate_ids, resolves the private wallet addresses
// server-side, revalidates and rechecks duplicates, and creates
// CalibrationDocketItem records. Never automatically starts a batch.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero WalletTrial mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { sanitizeCandidate, containsForbiddenCandidateData } from "../../shared/candidateDiscovery.ts";
import { sanitizeDocketItem, containsForbiddenDocketData, ITEM_STATUS, newDocketItemId } from "../../shared/calibration.ts";
import { getCandidateById, updateCandidateStatus } from "../../shared/candidateStore.ts";
import { getExistingQueueFingerprints } from "../../shared/calibrationStore.ts";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { walletFingerprint } from "../../shared/calibration.ts";

const MAX_APPROVE = 5;

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

    const candidateIds = Array.isArray(body.candidate_ids) ? body.candidate_ids : [];
    if (candidateIds.length === 0) {
      return Response.json({ error: "At least one candidate_id is required." }, { status: 400 });
    }
    if (candidateIds.length > MAX_APPROVE) {
      return Response.json({ error: `Maximum ${MAX_APPROVE} candidates per approval.` }, { status: 400 });
    }

    // Collect existing docket fingerprints for recheck
    const existingDocketFps = await getExistingQueueFingerprints(base44);

    // Also check existing trials
    const trialRecords = await base44.asServiceRole.entities.WalletTrial.list("-created_date", 500);
    const existingTrialFps = new Set<string>();
    for (const t of trialRecords || []) {
      if (t.normalized_wallet_address && t.network) {
        const fp = await walletFingerprint(t.network, t.normalized_wallet_address);
        existingTrialFps.add(fp);
      }
    }

    const now = new Date().toISOString();
    const results: any[] = [];
    let queued = 0;
    let skipped = 0;

    for (const candidateId of candidateIds) {
      const candidate = await getCandidateById(base44, candidateId);
      if (!candidate) {
        results.push({ candidate_id: candidateId, status: "not_found" });
        continue;
      }

      // CAS: only "discovered" candidates can be approved
      if (candidate.review_status !== "discovered") {
        results.push({
          candidate_id: candidateId,
          status: "skipped",
          reason: `Candidate is already ${candidate.review_status}.`
        });
        skipped++;
        continue;
      }

      // Revalidate address for chain
      const validation = validateWalletForChain(candidate.network, candidate.wallet_address);
      if (!validation.ok) {
        await updateCandidateStatus(base44, candidateId, candidate.version, "skipped", "Address failed revalidation.");
        results.push({ candidate_id: candidateId, status: "skipped", reason: "Address failed revalidation." });
        skipped++;
        continue;
      }

      // Recheck duplicates
      const normalized = normalizeAddress(candidate.network, candidate.wallet_address);
      const fp = await walletFingerprint(candidate.network, normalized);
      if (existingDocketFps.has(fp)) {
        await updateCandidateStatus(base44, candidateId, candidate.version, "skipped", "Already in docket queue.");
        results.push({ candidate_id: candidateId, status: "skipped", reason: "Already in docket queue." });
        skipped++;
        continue;
      }
      if (existingTrialFps.has(fp)) {
        await updateCandidateStatus(base44, candidateId, candidate.version, "skipped", "Already analyzed.");
        results.push({ candidate_id: candidateId, status: "skipped", reason: "Already analyzed." });
        skipped++;
        continue;
      }

      // Create the docket item
      const docketItem = {
        docket_item_id: newDocketItemId(),
        network: candidate.network,
        wallet_address: candidate.wallet_address,
        normalized_wallet_address: normalized,
        wallet_fingerprint: fp,
        address_short: candidate.address_short,
        source_label: "candidate_discovery",
        test_objective: `Discovered via ${candidate.cohort} on ${candidate.network}`,
        status: ITEM_STATUS.PENDING,
        version: 0,
        attempt_count: 0,
        queued_at: now
      };

      const created = await base44.asServiceRole.entities.CalibrationDocketItem.create(docketItem);

      // Update candidate status to "queued"
      await updateCandidateStatus(base44, candidateId, candidate.version, "queued", null);

      // Add the new fingerprint to the set so subsequent candidates in the same
      // approval batch can't create a duplicate
      existingDocketFps.add(fp);

      results.push({
        candidate_id: candidateId,
        status: "queued",
        docket_item: sanitizeDocketItem(created)
      });
      queued++;
    }

    // Privacy guard on all returned items
    for (const r of results) {
      if (r.docket_item && containsForbiddenDocketData(r.docket_item)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    trackSafe(base44, "calibration_candidates_queued", {
      queued,
      skipped,
      total: candidateIds.length
    });

    return Response.json({
      results,
      queued,
      skipped,
      total: candidateIds.length
    });
  } catch (error) {
    return Response.json({ error: error.message || "Approval failed." }, { status: 500 });
  }
}