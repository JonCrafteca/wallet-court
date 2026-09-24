// Wallet Court — admin-only Nansen Candidate Discovery.
// Calls the Smart Money PnL Leaderboard endpoint to source calibration
// candidates, screens them by label, deduplicates against existing candidates,
// docket items, and trials, and stores new candidates for admin review.
//
// Duplicate-discovery protection: before executing, checks whether the same
// query was successfully completed recently. If so, returns a warning with
// the previous discovery info instead of making another Nansen call. The admin
// must explicitly pass force=true to repeat the discovery.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query or
// Nansen call. One physical Nansen request per discovery action. All physical
// requests route through the shared telemetry transport (callEndpointWithRetry)
// and count toward the verified 1,000-call contest ledger.
//
// Discovery never automatically queues, analyzes, or creates a WalletTrial.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  validateDiscoveryRequest,
  buildDiscoveryRequest,
  parseDiscoveryResponse,
  screenCandidates,
  deduplicateCandidates,
  sourceQueryFingerprint,
  newCandidateId,
  sanitizeCandidate,
  containsForbiddenCandidateData,
  buildDiscoveryOutcome,
  formatRecentDiscovery,
  DISCOVERY_ENDPOINT_KEY,
  DISCOVERY_WORKFLOW,
  DEFAULT_TIMEFRAME,
  DEFAULT_DISCOVERY_LIMIT,
  checkBudget
} from "../../shared/candidateDiscovery.ts";
import { NANSEN_BASE, DISCOVERY_EP, getNansenApiKey } from "../../shared/nansen.ts";
import { callEndpointWithRetry, newCorrelationId, detectEnvironment } from "../../shared/nansenTelemetry.ts";
import { getControl, getVerifiedTotal } from "../../shared/calibrationStore.ts";
import { getExistingQueueFingerprints } from "../../shared/calibrationStore.ts";
import { getCandidates, createCandidates, getExistingCandidateFingerprints } from "../../shared/candidateStore.ts";
import { getRecentDiscovery, createDiscoveryRecord } from "../../shared/discoveryStore.ts";
import { walletFingerprint } from "../../shared/calibration.ts";
import { newDiscoveryId } from "../../shared/calibrationCampaign.ts";
import { getCircuit } from "../../shared/circuitStore.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { ensureAllowance, incrementAttempts, isExhausted } from "../../shared/robinhoodAllowance.ts";

const PROVIDER = "nansen";
const TIMEOUT_MS = 20000;

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

    // Validate request
    const validation = validateDiscoveryRequest({
      network: body.network,
      cohort: body.cohort,
      timeframe: body.timeframe ?? DEFAULT_TIMEFRAME,
      limit: body.limit ?? DEFAULT_DISCOVERY_LIMIT
    });
    if (!validation.ok) return Response.json({ error: validation.reason }, { status: 400 });
    const discoveryReq = validation.value!;

    // Require explicit confirmation
    if (!body.confirmed) {
      return Response.json({ error: "Confirmation is required. Discovery makes a real Nansen API request." }, { status: 400 });
    }

    // Compute the query fingerprint for duplicate-discovery detection
    const queryFp = await sourceQueryFingerprint(discoveryReq);

    // ---- Duplicate-discovery protection ----
    // Unless force=true, check if the same query was successfully completed recently.
    // If so, return the previous discovery info without making a Nansen call.
    if (!body.force) {
      const recentDiscovery = await getRecentDiscovery(base44, queryFp);
      if (recentDiscovery) {
        // Count how many candidates from this discovery are still eligible
        const allCandidates = await getCandidates(base44);
        const discoveryCandidates = allCandidates.filter((c) => c.source_query_fingerprint === queryFp);
        const remainingEligible = discoveryCandidates.filter((c) => c.review_status === "discovered").length;
        const alreadyQueuedOrTried = discoveryCandidates.filter((c) =>
          c.review_status === "queued" || c.review_status === "skipped"
        ).length;

        const recentInfo = formatRecentDiscovery(
          recentDiscovery,
          queryFp,
          remainingEligible,
          alreadyQueuedOrTried
        );

        return Response.json({
          duplicate_warning: true,
          previous_discovery: recentInfo,
          force_required: true
        });
      }
    }

    // Check kill switch
    const control = await getControl(base44);
    if (control && !control.calibration_enabled) {
      return Response.json({ error: "Calibration is paused.", paused: true, reason: control.paused_reason }, { status: 423 });
    }

    // Check budget (verified total)
    const verifiedTotal = await getVerifiedTotal(base44);
    const budget = checkBudget(verifiedTotal);
    if (!budget.allowed) {
      return Response.json({ error: budget.reason, budget, verified_total: verifiedTotal }, { status: 423 });
    }

    // Check circuit breaker
    const circuit = await getCircuit(base44, PROVIDER);
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ error: "Provider is in Court Recess. Try again later.", court_recess: true }, { status: 423 });
    }

    // ---- Robinhood allowance check ----
    // Robinhood discovery consumes 1 attempt from the isolated 21-attempt
    // allowance. If the allowance is exhausted, refuse before any Nansen call.
    // Discovery cannot start wallet analyses automatically — candidates still
    // require explicit admin approval.
    let rhAllowance = null;
    if (discoveryReq.network === "robinhood") {
      rhAllowance = await ensureAllowance(base44);
      if (isExhausted(rhAllowance)) {
        return Response.json({
          error: `Robinhood validation allowance exhausted (${rhAllowance.max_attempts} attempts used). Discovery not available.`,
          allowance_exhausted: true
        }, { status: 423 });
      }
    }

    // Resolve the Nansen API key via the shared server-side helper.
    const apiKey = getNansenApiKey();
    if (!apiKey) {
      return Response.json({ error: "Nansen API key not configured.", missing_key: true }, { status: 500 });
    }

    // Build request body
    const requestBody = buildDiscoveryRequest(discoveryReq);
    const correlationId = newCorrelationId();
    const url = NANSEN_BASE + DISCOVERY_EP.path;

    trackSafe(base44, "calibration_discovery_started", {
      network: discoveryReq.network,
      cohort: discoveryReq.cohort,
      timeframe: discoveryReq.timeframe,
      limit: discoveryReq.limit,
      endpoint_key: DISCOVERY_ENDPOINT_KEY,
      correlation_id: correlationId,
      verified_total: verifiedTotal
    });

    // Make the physical Nansen request through the instrumented transport
    const result = await callEndpointWithRetry({
      url,
      ep: { key: DISCOVERY_EP.key },
      apiKey,
      body: requestBody,
      timeoutMs: TIMEOUT_MS,
      telemetryCtx: {
        workflow: DISCOVERY_WORKFLOW,
        network: discoveryReq.network,
        caseSlug: null,
        correlationId,
        environment: detectEnvironment()
      },
      persistAudit: (rec) => waitUntil(
        base44.asServiceRole.entities.NansenApiCallAudit.create(rec).catch((e) =>
          console.error("[candidate-discovery] audit write failed:", e?.message)
        )
      )
    });

    if (!result.ok) {
      // Consume 1 attempt from the Robinhood allowance even on failure
      // (the physical Nansen call was made).
      if (discoveryReq.network === "robinhood") {
        await incrementAttempts(base44, 1).catch(() => {});
      }
      trackSafe(base44, "calibration_discovery_failed", {
        network: discoveryReq.network,
        cohort: discoveryReq.cohort,
        endpoint_key: DISCOVERY_ENDPOINT_KEY,
        correlation_id: correlationId,
        http_status: result.status,
        error_category: result.errorCategory
      });
      return Response.json({
        error: "Nansen discovery request failed.",
        http_status: result.status,
        error_category: result.errorCategory,
        court_recess: result.status === 429 || result.status >= 500,
        correlation_id: correlationId
      }, { status: result.status >= 500 ? 502 : 422 });
    }

    // Parse response
    const parsed = await parseDiscoveryResponse(result.json, discoveryReq.network, discoveryReq.cohort);
    const totalReturned = parsed.length;

    // Screen candidates by label classification
    const screening = screenCandidates(parsed);

    // Collect existing fingerprints for dedup
    const [existingCandidateFps, existingDocketFps, trialRecords] = await Promise.all([
      getExistingCandidateFingerprints(base44),
      getExistingQueueFingerprints(base44),
      base44.asServiceRole.entities.WalletTrial.list("-created_date", 500)
    ]);

    const existingTrialFps = new Set<string>();
    for (const t of trialRecords || []) {
      if (t.normalized_wallet_address && t.network) {
        const fp = await walletFingerprint(t.network, t.normalized_wallet_address);
        existingTrialFps.add(fp);
      }
    }

    // Deduplicate: combine eligible + needs_review for dedup (excluded are not stored)
    const storable = [...screening.eligible, ...screening.needs_review];
    const dedup = deduplicateCandidates(storable, existingCandidateFps, existingDocketFps, existingTrialFps);

    // Store new candidates
    const now = new Date().toISOString();
    const toCreate = dedup.unique.map((c) => ({
      candidate_id: newCandidateId(),
      wallet_address: c.wallet_address,
      normalized_wallet_address: c.normalized_wallet_address,
      wallet_fingerprint: c.wallet_fingerprint,
      address_short: c.address_short,
      network: c.network,
      source_endpoint: DISCOVERY_ENDPOINT_KEY,
      source_query_fingerprint: queryFp,
      discovery_correlation_id: correlationId,
      discovered_at: now,
      wallet_class: c.wallet_class,
      ranking_metrics_json: JSON.stringify(c.ranking_metrics),
      cohort: c.cohort,
      review_status: "discovered",
      skip_reason: null,
      version: 0,
      created_at: now,
      updated_at: now
    }));

    let stored: any[] = [];
    if (toCreate.length > 0) {
      stored = await createCandidates(base44, toCreate);
    }

    // ---- Record the successful discovery for duplicate detection ----
    await createDiscoveryRecord(base44, {
      discovery_id: newDiscoveryId(),
      query_fingerprint: queryFp,
      network: discoveryReq.network,
      cohort: discoveryReq.cohort,
      timeframe_days: discoveryReq.timeframe,
      result_limit: discoveryReq.limit,
      candidates_found: stored.length,
      correlation_id: correlationId,
      discovered_at: now
    }).catch((e) => console.error("[candidate-discovery] discovery record write failed:", e?.message));

    // Privacy guard
    for (const s of stored) {
      const sanitized = sanitizeCandidate(s);
      if (containsForbiddenCandidateData(sanitized)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    const callsAfter = await getVerifiedTotal(base44);
    const physicalCallsUsed = Math.max(0, callsAfter - verifiedTotal);

    const outcome = buildDiscoveryOutcome({
      totalReturned,
      screening,
      dedup,
      stored
    });

    trackSafe(base44, "calibration_discovery_completed", {
      network: discoveryReq.network,
      cohort: discoveryReq.cohort,
      endpoint_key: DISCOVERY_ENDPOINT_KEY,
      correlation_id: correlationId,
      total_returned: totalReturned,
      eligible: outcome.eligible,
      excluded_services: outcome.excluded_services,
      needs_review: outcome.needs_review,
      stored: outcome.stored,
      physical_calls_used: physicalCallsUsed,
      verified_total: callsAfter
    });

    return Response.json({
      ...outcome,
      correlation_id: correlationId,
      physical_calls_used: physicalCallsUsed,
      verified_total: callsAfter,
      budget: checkBudget(callsAfter)
    });
  } catch (error) {
    return Response.json({ error: error.message || "Discovery failed." }, { status: 500 });
  }
}