// Wallet Court — admin-only controlled provider health check (Phase N2.4).
// Acquires an atomic half-open probe lease (compare-and-set via updateMany)
// before making exactly one lightweight Nansen call. Only the lease holder may
// close or reopen the circuit. A second concurrent admin request receives a
// safe "probe already in progress" result and makes ZERO provider calls.
//
// Safety:
//  - Admin-only.
//  - Probes ONLY when the circuit is OPEN and the cooldown has elapsed, or a
//    previous probe lease has expired (stale lease reclamation). A CLOSED
//    circuit needs no probe.
//  - The half-open transition is a single atomic updateMany filtered by
//    { provider, circuit_status: "open", circuit_version: V }. Two concurrent
//    callers cannot both win — MongoDB serializes the update; the loser sees
//    updated: 0 and returns without any provider call.
//  - Makes exactly one lightweight Nansen call (current-balance for the
//    mandatory demo address, per_page: 1). Never stores the key, raw payloads,
//    or addresses.
//  - On success, closes the circuit via a version+lease-guarded CAS. On
//    failure, reopens via a lease-guarded CAS. Only the lease holder can mutate.
//
// NOTE (implementation phase): this function is implemented but NOT invoked
// during the N2.4 implementation/test phase. No real Nansen probe is initiated
// here. The admin UI exposes the action for later use.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets, waitUntil } from "base44:runtime";
import { callEndpoint, CHAIN_BY_NETWORK, logUsage } from "../../shared/nansen.ts";
import {
  classifyRecessType,
  computeRetryAfterMs,
  isHalfOpenEligible,
  isCircuitOpen,
  hasActiveProbeLease,
  isProbeLeaseExpired,
  readCircuitVersion,
  sanitizeReason,
  CIRCUIT_STATUS,
  RECESS_TYPES
} from "../../shared/circuitBreaker.ts";
import { getCircuit, acquireProbeLease, closeCircuitWithVersion, reopenCircuitWithLease } from "../../shared/circuitStore.ts";
import { MANDATORY_DEMO_ADDRESS } from "../../shared/verdicts.ts";

const PROVIDER = "nansen";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const apiKey = secrets.get("NANSEN_API_KEY");
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: "NANSEN_API_KEY not configured — cannot probe." }, { status: 503 });
    }

    const circuit = await getCircuit(base44, PROVIDER);
    const now = Date.now();

    // CLOSED — nothing to do.
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.CLOSED) {
      return Response.json({ status: "closed", message: "Circuit is already closed. No probe needed." });
    }

    // HALF_OPEN with a live lease — another probe is in flight. Do NOT make a
    // provider call; return a safe "probe in progress" result.
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.HALF_OPEN && hasActiveProbeLease(circuit, now)) {
      return Response.json({
        status: "probe_in_progress",
        message: "A recovery probe is already in flight. No provider call was made.",
        probe_lease_id: circuit.probe_lease_id
      }, { status: 409 });
    }

    // HALF_OPEN with an EXPIRED lease — reclaim it. Fall through to lease
    // acquisition. (isHalfOpenEligible returns false for half_open, so we handle
    // the expired-lease case explicitly before the eligibility check below.)

    // OPEN but still in cooldown — not eligible yet.
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.OPEN && !isHalfOpenEligible(circuit, now)) {
      const retryMs = circuit.retry_after ? new Date(circuit.retry_after).getTime() : now;
      const secs = Math.max(0, Math.ceil((retryMs - now) / 1000));
      return Response.json({
        status: "cooldown_active",
        message: `Cooldown still active. Probe eligible in approximately ${secs}s.`
      }, { status: 429 });
    }

    // For an expired half_open lease, treat the circuit as eligible for a fresh
    // probe. For a normal open+eligible circuit, proceed. Either way, the
    // atomic lease acquisition below is the gate.
    const expectedVersion = readCircuitVersion(circuit);

    // ---- Atomic probe-lease acquisition (compare-and-set) ----
    // updateMany filters by { provider, circuit_status: "open", circuit_version:
    // expectedVersion }. If two admins race, MongoDB serializes the updates: the
    // first bumps the version to half_open, the second matches 0 documents.
    // Only the winner (updated === 1) proceeds to the provider call.
    let lease = null;
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.HALF_OPEN && isProbeLeaseExpired(circuit, now)) {
      // Expired lease: acquire a fresh lease from the half_open state by
      // filtering on the current version + half_open status.
      const reclaimResult = await base44.asServiceRole.entities.ProviderCircuit.updateMany(
        { provider: PROVIDER, circuit_status: CIRCUIT_STATUS.HALF_OPEN, circuit_version: expectedVersion },
        { $set: {
          circuit_version: expectedVersion + 1,
          probe_lease_id: (lease = generateLeaseIdLocal()),
          probe_started_at: new Date(now).toISOString(),
          probe_expires_at: new Date(now + 30_000).toISOString(),
          updated_at: new Date(now).toISOString()
        }}
      );
      if (reclaimResult && reclaimResult.updated === 1) {
        lease = { leaseId: lease, newVersion: expectedVersion + 1 };
      } else {
        return Response.json({ status: "probe_in_progress", message: "A recovery probe is already in flight. No provider call was made." }, { status: 409 });
      }
    } else {
      lease = await acquireProbeLease(base44, PROVIDER, expectedVersion, now);
    }

    if (!lease) {
      // Lost the race — another caller holds the transition. Zero provider calls.
      return Response.json({
        status: "probe_in_progress",
        message: "A recovery probe is already in flight or the circuit changed. No provider call was made."
      }, { status: 409 });
    }

    const { leaseId, newVersion } = lease;

    // ---- One lightweight probe (lease holder only) ----
    const ep = { key: "current_balance", path: "/api/v1/profiler/address/current-balance", required: false, needsDateRange: false, dateFmt: null, paginated: true };
    const body = { address: MANDATORY_DEMO_ADDRESS, chain: CHAIN_BY_NETWORK.ethereum, pagination: { page: 1, per_page: 1 }, hide_spam_token: true };
    const r = await callEndpoint(apiKey, ep, body, 20000);
    r.chain = CHAIN_BY_NETWORK.ethereum;
    waitUntil(logUsage(base44, "admin-health-check", "live", [r]).catch(() => {}));

    if (r.ok) {
      // Close via version+lease-guarded CAS. If the version changed (shouldn't,
      // since we hold the lease), the CAS fails safely and we report it.
      const closed = await closeCircuitWithVersion(base44, PROVIDER, newVersion, Date.now(), { requestId: r.requestId || null });
      return Response.json({
        status: closed ? "recovered" : "recovered_version_mismatch",
        probe: "success",
        request_id: r.requestId || null
      });
    }

    // Failure → reopen via lease-guarded CAS. Only the lease holder can reopen.
    const recessType = classifyRecessType(r.errorCategory);
    const reopened = await reopenCircuitWithLease(base44, PROVIDER, newVersion, leaseId, {
      recessType,
      requestId: r.requestId || null,
      consecutiveFailures: circuit?.consecutive_failures || 0
    });
    const retryMs = computeRetryAfterMs(recessType, now, null);
    return Response.json({
      status: reopened ? "reopened" : "reopened_version_mismatch",
      probe: "failed",
      recess_type: recessType,
      error_category: r.errorCategory,
      http_status: r.status,
      retry_after: new Date(retryMs).toISOString()
    }, { status: 503 });
  } catch (error) {
    return Response.json({ error: error.message || "Health check failed." }, { status: 500 });
  }
}

// Local lease-id generator for the expired-lease reclamation path (avoids
// importing generateLeaseId twice in a way that could tree-shake oddly).
function generateLeaseIdLocal() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}