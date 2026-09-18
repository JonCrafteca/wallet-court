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
import { secrets } from "base44:runtime";
import {
  validateAddress,
  normalizeAddress,
  selectDemoVerdictIndex,
  buildVerdictPayload,
  VERDICTS,
  NETWORKS,
  MANDATORY_DEMO_ADDRESS
} from "../../shared/verdicts.ts";
import {
  computeSeverityConfidence,
  buildLiveVerdictPayload
} from "../../shared/verdicts_live.ts";
import { selectEntityVerdict } from "../../shared/verdicts_entity.ts";
import { applySeverityCap } from "../../shared/verdicts_performance.ts";
import { classifyOutcome, OPERATIONAL_FAILURE } from "../../shared/evidenceGate.ts";
import { fetchNansenEvidence, assessRecess, CHAIN_BY_NETWORK, ERR } from "../../shared/nansen.ts";
import {
  isCircuitOpen,
  sanitizeReason,
  recessHttpStatus,
  readCircuitVersion,
  RECESS_TYPES
} from "../../shared/circuitBreaker.ts";
import { getCircuit, openCircuit, closeCircuitWithVersion } from "../../shared/circuitStore.ts";

const PROVIDER = "nansen";

function newSlug() {
  return "case-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

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
    if (!NETWORKS.includes(network)) {
      return Response.json({ error: "Unsupported network." }, { status: 400 });
    }
    if (!validateAddress(network, wallet_address)) {
      return Response.json({ error: "That does not look like a valid address for the selected network." }, { status: 422 });
    }

    // Pre-flight: unsupported_chain is a request-validation error, NOT a Nansen
    // provider outage. It returns a public-safe 400 before any circuit check or
    // Nansen call — no WalletTrial, no slug, no ProviderCircuit mutation, no
    // Court Recess. Only genuine provider operational failures open the circuit.
    if (!CHAIN_BY_NETWORK[network]) {
      return Response.json({ error: "The selected network is not currently supported." }, { status: 400 });
    }

    const normalized = normalizeAddress(network, wallet_address);
    const windowDays = Math.min(Math.max(parseInt(body?.window_days, 10) || 180, 7), 365);

    // Mandatory demo wallet: deterministic demo verdict, never spends Nansen calls
    // and never touches the circuit.
    if (normalized.toLowerCase() === MANDATORY_DEMO_ADDRESS) {
      const public_slug = newSlug();
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug);
      return Response.json({ trial, analysis: { outcome: "demo", error_category: null, partial: false, nansen_calls: 0 } });
    }

    const apiKey = secrets.get("NANSEN_API_KEY");
    if (!apiKey || !apiKey.trim()) {
      // No key configured — honest demo. Not a provider outage; no circuit action.
      const public_slug = newSlug();
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug);
      return Response.json({ trial, analysis: { outcome: "demo", error_category: "missing_key", partial: false, nansen_calls: 0 } });
    }

    // ---- Circuit check BEFORE any paid Nansen request (N2.4) ----
    // Capture the circuit_version at the start so a stale success cannot later
    // close a newer circuit opened by another request (stale-success protection).
    const circuit = await getCircuit(base44, PROVIDER);
    const circuitVersionAtStart = readCircuitVersion(circuit);
    const now = Date.now();
    if (isCircuitOpen(circuit, now)) {
      return courtRecessResponse(circuit, now);
    }

    // ---- Paid Nansen pipeline ----
    const public_slug = newSlug();
    const nansen = await fetchNansenEvidence(apiKey, network, normalized, {
      windowDays,
      caseSlug: public_slug,
      base44,
      timeoutMs: 20000
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
      // Open the circuit and return Court Recess. NO WalletTrial is created.
      await openCircuit(base44, PROVIDER, {
        recessType: recess.recessType,
        requestId: recess.requestId
      });
      return courtRecessResponse({
        recess_type: recess.recessType,
        retry_after: new Date(computeRetryAfterForRecess(recess.recessType, now)).toISOString(),
        sanitized_reason: sanitizeReason(recess.recessType),
        last_request_id: recess.requestId || null
      }, now);
    }

    // No blocking failure. On a successful live/partial result, close the
    // circuit ONLY if this request still owns the recovery generation (its
    // captured circuit_version matches the current record). A request that
    // began before another request opened the circuit must NOT close that
    // newer circuit — the CAS updateMany matches 0 documents and the circuit
    // stays open. (Stale-success protection, N2.4.)
    if (circuit && circuit.circuit_status !== "closed") {
      await closeCircuitWithVersion(base44, PROVIDER, circuitVersionAtStart, Date.now(), { requestId: null }).catch(() => {});
    }

    if (gateOutcome === "dismissed_no_evidence" || gateOutcome === "mistrial_insufficient_evidence") {
      const record = await base44.asServiceRole.entities.WalletTrial.create({
        wallet_address,
        normalized_wallet_address: normalized,
        network,
        status: "completed",
        data_mode: "live",
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
        analyzed_at: new Date().toISOString()
      });
      return Response.json({
        trial: record,
        analysis: {
          outcome: nansen.outcome,
          error_category: nansen.errorCategory,
          partial: nansen.partial,
          nansen_calls: nansen.nansenCalls
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
      wallet_class: nansen.walletClass,
      case_outcome: "verdict",
      ...payload,
      public_slug,
      analyzed_at: new Date().toISOString()
    });
    return Response.json({
      trial: record,
      analysis: {
        outcome: nansen.outcome,
        error_category: nansen.errorCategory,
        partial: nansen.partial,
        nansen_calls: nansen.nansenCalls
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
    court_recess_provider: 30,
    court_recess_unknown: 20
  };
  const secs = COOLDOWN[recessType] ?? COOLDOWN.court_recess_unknown;
  return nowMs + secs * 1000;
}

async function createDemoTrial(base44, wallet_address, normalized, network, public_slug) {
  const verdictIndex = selectDemoVerdictIndex(normalized);
  const verdict = VERDICTS[verdictIndex];
  const payload = buildVerdictPayload(verdict, normalized, network, "demo", null);
  return base44.asServiceRole.entities.WalletTrial.create({
    wallet_address,
    normalized_wallet_address: normalized,
    network,
    status: "completed",
    data_mode: "demo",
    case_outcome: "demo",
    ...payload,
    public_slug,
    analyzed_at: new Date().toISOString()
  });
}