// Wallet Court — secure, backend-only wallet analysis.
// Reads the Nansen API key ONLY from the server secret store. The key is never
// returned to the client, stored on the trial, or placed in error messages.
//
// Phase N2.4: a persistent provider circuit breaker gates every paid Nansen
// request. Operational failures (outage, auth, rate limit, exhausted credits)
// become a Court Recess — no WalletTrial, slug, evidence record, Hall entry,
// challenge, badge, or award is created. The circuit is checked BEFORE any
// Nansen call; while open, visitor requests are blocked and make no further
// paid calls. A nonessential endpoint failure with sufficient remaining evidence
// may still proceed as a partial verdict with reduced confidence.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  validateAddress,
  normalizeAddress,
  selectDemoVerdictIndex,
  buildVerdictPayload,
  VERDICTS,
  NETWORKS,
  MANDATORY_DEMO_ADDRESS
} from "../../shared/verdicts.ts";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import {
  computeSeverityConfidence,
  buildLiveVerdictPayload
} from "../../shared/verdicts_live.ts";
import { selectEntityVerdict } from "../../shared/verdicts_entity.ts";
import { applySeverityCap } from "../../shared/verdicts_performance.ts";
import { classifyOutcome, OPERATIONAL_FAILURE } from "../../shared/evidenceGate.ts";
import { fetchNansenEvidence, assessRecess, CHAIN_BY_NETWORK, ERR, getNansenApiKey } from "../../shared/nansen.ts";
import {
  isCircuitOpen,
  sanitizeReason,
  recessHttpStatus,
  readCircuitVersion,
  RECESS_TYPES,
  CIRCUIT_STATUS,
  hasActiveProbeLease,
  isProbeLeaseExpired,
  isBudgetExhaustion
} from "../../shared/circuitBreaker.ts";
import { getCircuit, openCircuit, closeCircuitWithVersion, acquireProbeLease, reclaimProbeLease, reopenCircuitWithLease } from "../../shared/circuitStore.ts";
import { checkCeilingBudgetWithLimit, CALIBRATION_CEILING } from "../../shared/calibration.ts";
import { getCountForCeilingCheck } from "../../shared/calibrationStore.ts";
import { canReserveCall, todayUtcStr } from "../../shared/walletTrialUsagePolicy.ts";
import { getPolicyOrDefault, completeProductionCalls, releaseProductionCalls, resetDailyUsageIfNeeded } from "../../shared/walletTrialUsageStore.ts";
import { waitUntil } from "base44:runtime";
import { enqueueAttributionEvent } from "../../shared/attributionStore.ts";
import { enqueueNotification } from "../../shared/ownerNotificationStore.ts";
import { EVENT_TYPES } from "../../shared/ownerNotifications.ts";
import { shortAddr } from "../../shared/walletClaim.ts";
import { isRobinhoodPublicEnabled } from "../../shared/featureFlags.ts";

const PROVIDER = "nansen";

function newSlug() {
  return "case-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // Server-side creator attribution: if the visitor is signed in, stamp their
    // user id on the trial. Anonymous submissions get null — never a guessed or
    // client-supplied id. Used by getAccountDashboard to list My Trials.
    let submittedByUserId = null;
    try {
      const currentUser = await base44.auth.me();
      if (currentUser && currentUser.id) submittedByUserId = currentUser.id;
    } catch {}

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
    const wallet_address = body?.wallet_address;
    const network = body?.network;

    if (!wallet_address || !network) {
      return Response.json({ error: "wallet_address and network are required." }, { status: 400 });
    }

    // Chain-specific validation BEFORE any Nansen call, trial creation, demo
    // fallback, dismissal, verdict, usage record, or analytics event. Invalid
    // input consumes zero Nansen calls and creates zero trials/cases/verdicts.
    // Returns a structured 400 with code, chain, message, and suggested_chain.
    const validation = validateWalletForChain(network, wallet_address);
    if (!validation.ok) {
      return Response.json({
        error: validation.message,
        code: validation.code,
        chain: validation.chain || null,
        suggested_chain: validation.suggestedChain || null,
      }, { status: 400 });
    }

    // Pre-flight: unsupported_chain is a request-validation error, NOT a Nansen
    // provider outage. It returns a public-safe 400 before any circuit check or
    // Nansen call — no WalletTrial, no slug, no ProviderCircuit mutation, no
    // Court Recess. Only genuine provider operational failures open the circuit.
    if (!CHAIN_BY_NETWORK[network]) {
      return Response.json({ error: "The selected network is not currently supported." }, { status: 400 });
    }

    // ---- Server-enforced Robinhood public feature flag ----
    // When robinhood_public_enabled is false (the default), public Robinhood
    // wallet submissions are rejected BEFORE any Nansen call, circuit check,
    // trial creation, or demo fallback. This is the authoritative backend
    // enforcement — the frontend also hides Robinhood from the selector, but
    // a manually crafted request cannot bypass this check.
    //
    // Admin calibration and the isolated Robinhood validation allowance use
    // separate admin-authenticated paths that call fetchNansenEvidence
    // directly, NOT through this function. Existing admin-created Robinhood
    // cases remain viewable via getTrialBySlug (which does not call this
    // function).
    if (network === "robinhood") {
      const enabled = await isRobinhoodPublicEnabled(base44);
      if (!enabled) {
        return Response.json({
          error: "Robinhood chain analysis is not yet available to the public.",
          code: "ROBINHOOD_NOT_PUBLIC",
          network: "robinhood"
        }, { status: 400 });
      }
    }

    const normalized = normalizeAddress(network, wallet_address);
    const windowDays = Math.min(Math.max(parseInt(body?.window_days, 10) || 180, 7), 365);
    // Campaign traffic (processCalibrationWallet) passes durable_telemetry=true
    // so audit persistence is awaited before the analysis returns. Public
    // visitor traffic omits it and stays non-blocking (waitUntil).
    const durableTelemetry = !!body?.durable_telemetry;
  const refCode = body?.ref_code || null;
  const visitorId = body?.visitor_id || null;

    // Mandatory demo wallet: deterministic demo verdict, never spends Nansen calls
    // and never touches the circuit.
    if (normalized.toLowerCase() === MANDATORY_DEMO_ADDRESS) {
      const public_slug = newSlug();
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug, submittedByUserId);
      return Response.json({ trial, analysis: { outcome: "demo", error_category: null, partial: false, nansen_calls: 0, physical_calls_made: 0, correlation_id: null } });
    }

    const apiKey = getNansenApiKey();
    if (!apiKey) {
      // No key configured — honest demo. Not a provider outage; no circuit action.
      const public_slug = newSlug();
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug, submittedByUserId);
      return Response.json({ trial, analysis: { outcome: "demo", error_category: "missing_key", partial: false, nansen_calls: 0, physical_calls_made: 0, correlation_id: null } });
    }

    // ---- Circuit check BEFORE any paid Nansen request (N2.4) ----
    // Capture the circuit_version at the start so a stale success cannot later
    // close a newer circuit opened by another request (stale-success protection).
    const circuit = await getCircuit(base44, PROVIDER);
    const circuitVersionAtStart = readCircuitVersion(circuit);
    const now = Date.now();

    // HALF_OPEN with an active probe lease → another request is already
    // probing. Block immediately — zero Nansen calls.
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.HALF_OPEN && hasActiveProbeLease(circuit, now)) {
      return courtRecessResponse(circuit, now);
    }
    // OPEN within cooldown → block. A HALF_OPEN circuit with an EXPIRED lease
    // (crashed probe) falls through to the probe-lease acquisition below so the
    // stuck lease can be reclaimed.
    const expiredLease = circuit && circuit.circuit_status === CIRCUIT_STATUS.HALF_OPEN && isProbeLeaseExpired(circuit, now);
    if (isCircuitOpen(circuit, now) && !expiredLease) {
      return courtRecessResponse(circuit, now);
    }

    // ---- Ceiling pre-flight check ----
    // The verified NansenApiCallAudit total vs the absolute safety ceiling
    // (1,020). When the ceiling is reached, NO physical Nansen call is made
    // and NO circuit mutation occurs — the ceiling is a permanent budget
    // limit, not a transient provider failure. Returns a specific Court
    // Recess so the visitor sees "evidence limit reached," not "provider
    // error." The ceiling itself is not modified.
    const verifiedTotal = await getVerifiedTotal(base44);
    const ceilingBudget = checkCeilingBudgetWithLimit(verifiedTotal, CALIBRATION_CEILING);
    if (!ceilingBudget.allowed) {
      return courtRecessResponse({
        recess_type: RECESS_TYPES.CEILING,
        retry_after: new Date(computeRetryAfterForRecess(RECESS_TYPES.CEILING, now)).toISOString(),
        sanitized_reason: sanitizeReason(RECESS_TYPES.CEILING),
        last_request_id: null
      }, now);
    }

    // ---- Half-open probe lease (exactly one probe after cooldown) ----
    // When the circuit is OPEN and the cooldown has elapsed, atomically
    // acquire a probe lease (OPEN → HALF_OPEN) so only ONE request makes
    // Nansen calls. Concurrent requests lose the CAS and are blocked with
    // zero Nansen calls. A stuck HALF_OPEN with an expired lease is reclaimed
    // the same way.
    let probeLease = null;
    if (expiredLease) {
      probeLease = await reclaimProbeLease(base44, PROVIDER, circuitVersionAtStart, now);
      if (!probeLease) {
        return courtRecessResponse({ ...circuit, circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now);
      }
    } else if (circuit && circuit.circuit_status === CIRCUIT_STATUS.OPEN) {
      probeLease = await acquireProbeLease(base44, PROVIDER, circuitVersionAtStart, now);
      if (!probeLease) {
        return courtRecessResponse({ ...circuit, circuit_status: CIRCUIT_STATUS.HALF_OPEN }, now);
      }
    }

    // ---- Paid Nansen pipeline ----
    const public_slug = newSlug();
    const nansen = await fetchNansenEvidence(apiKey, network, normalized, {
      windowDays,
      caseSlug: public_slug,
      base44,
      timeoutMs: 20000,
      durableTelemetry
    });

    // Defensive: if the provider reported an unsupported chain (should be caught
    // by the pre-flight), return a 400 — never a Court Recess, never a trial.
    if (nansen.errorCategory === ERR.UNSUPPORTED_CHAIN) {
      return Response.json({ error: "The selected network is not currently supported." }, { status: 400 });
    }

    // Evidence-sufficiency gate on the successfully-obtained evidence.
    const gateOutcome = classifyOutcome(nansen.metrics, nansen.meta);

    // Operational-failure assessment (N2.4). A blocking failure → Court Recess.
    const recess = assessRecess(nansen, gateOutcome);
    if (recess) {
      // Open/reopen the circuit and return Court Recess. NO WalletTrial is created.
      if (probeLease) {
        await reopenCircuitWithLease(base44, PROVIDER, probeLease.newVersion, probeLease.leaseId, {
          recessType: recess.recessType,
          requestId: recess.requestId,
          consecutiveFailures: circuit?.consecutive_failures || 0
        }).catch(() => {});
      } else {
        await openCircuit(base44, PROVIDER, {
          recessType: recess.recessType,
          requestId: recess.requestId
        });
      }
      return courtRecessResponse({
        recess_type: recess.recessType,
        retry_after: new Date(computeRetryAfterForRecess(recess.recessType, now)).toISOString(),
        sanitized_reason: sanitizeReason(recess.recessType),
        last_request_id: recess.requestId || null
      }, now);
    }

    // No blocking failure. On a successful live/partial result, close the
    // circuit. If this request held a probe lease, close with the probe's
    // version (stale-success protection via CAS). Otherwise close with the
    // original version only if the circuit was not already closed.
    if (probeLease) {
      await closeCircuitWithVersion(base44, PROVIDER, probeLease.newVersion, Date.now(), { requestId: null }).catch(() => {});
    } else if (circuit && circuit.circuit_status !== "closed") {
      await closeCircuitWithVersion(base44, PROVIDER, circuitVersionAtStart, Date.now(), { requestId: null }).catch(() => {});
    }

    if (gateOutcome === "dismissed_no_evidence" || gateOutcome === "mistrial_insufficient_evidence") {
      const record = await base44.asServiceRole.entities.WalletTrial.create({
        wallet_address,
        normalized_wallet_address: normalized,
        network,
        status: "completed",
        data_mode: "live",
        submitted_by_user_id: submittedByUserId,
        wallet_class: nansen.walletClass,
        case_outcome: gateOutcome,
        verdict_code: null,
        verdict_name: null,
        headline: null,
        roast: null,
        defense_statement: null,
        sentence: null,
        severity_score: null,
        confidence_score: null,
        evidence_items_json: JSON.stringify(nansen.evidence),
        metrics_json: JSON.stringify({ ...nansen.metrics, _meta: nansen.meta }),
        source_endpoints_json: JSON.stringify(nansen.sources),
        public_slug,
        analyzed_at: new Date().toISOString(),
        requested_window_days: nansen.meta?.requested_window_days ?? null,
        effective_analysis_start: nansen.meta?.effective_analysis_start ?? null,
        effective_analysis_end: nansen.meta?.effective_analysis_end ?? null,
        coverage_limited: nansen.meta?.coverage_limited ?? false
      });
      if (!durableTelemetry) {
        enqueueTrialAttribution(base44, record, refCode, visitorId, body?.source_route);
      }
      return Response.json({
        trial: record,
        analysis: {
          outcome: nansen.outcome,
          error_category: nansen.errorCategory,
          partial: nansen.partial,
          nansen_calls: nansen.nansenCalls,
          physical_calls_made: nansen.physicalCallCount || 0,
          correlation_id: nansen.correlationId || null
        }
      });
    }

    // Verdict (live or partial).
    const verdict = selectEntityVerdict(nansen.walletClass, nansen.metrics);
    const { severity: rawSeverity, confidence } = computeSeverityConfidence(nansen.metrics, nansen.partial);
    const severity = applySeverityCap(verdict, rawSeverity);
    const payload = buildLiveVerdictPayload(verdict, nansen.evidence, nansen.metrics, nansen.meta, nansen.sources, severity, confidence);
    const record = await base44.asServiceRole.entities.WalletTrial.create({
      wallet_address,
      normalized_wallet_address: normalized,
      network,
      status: "completed",
      data_mode: "live",
      submitted_by_user_id: submittedByUserId,
      wallet_class: nansen.walletClass,
      case_outcome: "verdict",
      ...payload,
      public_slug,
      analyzed_at: new Date().toISOString(),
      requested_window_days: nansen.meta?.requested_window_days ?? null,
      effective_analysis_start: nansen.meta?.effective_analysis_start ?? null,
      effective_analysis_end: nansen.meta?.effective_analysis_end ?? null,
      coverage_limited: nansen.meta?.coverage_limited ?? false
    });
    // Enqueue owner notification for live verdicts only (exactly-once,
    // non-blocking). Trigger only after the WalletTrial and public case have
    // been committed. Does NOT fire for dismissed, mistrial, or demo cases.
    waitUntil(enqueueNotification(base44, {
      event_type: EVENT_TYPES.VERDICT,
      source_entity: "WalletTrial",
      source_record_id: record.id,
      metadata: {
        verdict_name: record.verdict_name,
        network: record.network,
        address_short: shortAddr(record.normalized_wallet_address),
        severity_score: record.severity_score,
        confidence_score: record.confidence_score,
        physical_calls: nansen.physicalCallCount || 0,
        public_slug: record.public_slug,
        analyzed_at: record.analyzed_at
      }
    }).catch(() => {}));
    if (!durableTelemetry) {
      enqueueTrialAttribution(base44, record, refCode, visitorId, body?.source_route);
    }
    return Response.json({
      trial: record,
      analysis: {
        outcome: nansen.outcome,
        error_category: nansen.errorCategory,
        partial: nansen.partial,
        nansen_calls: nansen.nansenCalls,
        physical_calls_made: nansen.physicalCallCount || 0,
        correlation_id: nansen.correlationId || null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message || "The court failed to convene." }, { status: 500 });
  }
}

// Build the public Court Recess response. HTTP 503 for provider/auth/credit
// outages, 429 for rate-limit. No verdict, dismissal, mistrial, severity,
// confidence, charge, sentence, or trial is returned.
function courtRecessResponse(circuit, now) {
  const recessType = circuit?.recess_type || RECESS_TYPES.UNKNOWN;
  const retryAfterIso = circuit?.retry_after || new Date(computeRetryAfterForRecess(recessType, now)).toISOString();
  const retryMs = new Date(retryAfterIso).getTime();
  const retryInSeconds = Number.isFinite(retryMs) ? Math.max(0, Math.ceil((retryMs - now) / 1000)) : 0;
  const status = recessHttpStatus(recessType);
  return Response.json({
    court_recess: true,
    recess_type: recessType,
    sanitized_reason: sanitizeReason(recessType),
    retry_after: retryAfterIso,
    retry_in_seconds: retryInSeconds,
    http_status: status
  }, { status });
}

function computeRetryAfterForRecess(recessType, nowMs) {
  // Mirrors circuitBreaker.computeRetryAfterMs without a provider Retry-After.
  // The pipeline does not currently surface a per-call Retry-After to this layer;
  // the bounded default is used. (Rate-limit Retry-After is honored inside
  // callEndpoint's retry loop already.)
  const COOLDOWN = {
    court_recess_credits: 900,
    court_recess_auth: 900,
    court_recess_rate_limit: 60,
    court_recess_ceiling: 3600,
    court_recess_provider: 30,
    court_recess_schema: 30,
    court_recess_unknown: 20
  };
  const secs = COOLDOWN[recessType] ?? COOLDOWN.court_recess_unknown;
  return nowMs + secs * 1000;
}

function enqueueTrialAttribution(base44, trial, refCode, visitorId, sourceRoute) {
  if (!refCode || !visitorId) return;
  if (trial.data_mode === "demo") return;
  waitUntil(enqueueAttributionEvent(base44, {
    event_type: "trial_started",
    ref_code: refCode, visitor_id: visitorId,
    external_trial_id: trial.public_slug,
    metadata: { network: trial.network, source_route: sourceRoute || "home" },
  }).catch(() => {}));
  waitUntil(enqueueAttributionEvent(base44, {
    event_type: "trial_completed",
    ref_code: refCode, visitor_id: visitorId,
    external_trial_id: trial.public_slug,
    metadata: {
      network: trial.network,
      verdict_key: trial.verdict_code || null,
      outcome: trial.case_outcome || null,
      confidence_score: trial.confidence_score ?? null,
      eligible_for_honors: trial.case_outcome === "verdict" && trial.data_mode === "live",
    },
  }).catch(() => {}));
}

async function createDemoTrial(base44, wallet_address, normalized, network, public_slug, submittedByUserId) {
  const verdictIndex = selectDemoVerdictIndex(normalized);
  const verdict = VERDICTS[verdictIndex];
  const payload = buildVerdictPayload(verdict, normalized, network, "demo", null);
  return base44.asServiceRole.entities.WalletTrial.create({
    wallet_address,
    normalized_wallet_address: normalized,
    network,
    status: "completed",
    data_mode: "demo",
    submitted_by_user_id: submittedByUserId || null,
    case_outcome: "demo",
    ...payload,
    public_slug,
    analyzed_at: new Date().toISOString()
  });
}