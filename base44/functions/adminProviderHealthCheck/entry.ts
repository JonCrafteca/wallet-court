// Wallet Court — admin-only controlled provider health check (Phase N2.4).
// Performs ONE controlled half-open probe against Nansen when the circuit
// cooldown has elapsed. On success, closes the circuit. On failure, reopens it
// with the appropriate recess type. Visitors are never used as probes — only an
// authorized admin may trigger this.
//
// Safety:
//  - Admin-only.
//  - Probes ONLY when the circuit is OPEN and the cooldown has elapsed, or
//    already HALF_OPEN (one probe at a time).
//  - Makes exactly one lightweight Nansen call (current-balance for the
//    mandatory demo address). Never stores the key, raw payloads, or addresses.
//  - Records the sanitized outcome on the ProviderCircuit record.
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
  sanitizeReason,
  CIRCUIT_STATUS,
  RECESS_TYPES
} from "../../shared/circuitBreaker.ts";
import { getCircuit, upsertCircuit, openCircuit, closeCircuit } from "../../shared/circuitStore.ts";
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

    // Only probe when the cooldown has elapsed (OPEN + eligible) or already
    // HALF_OPEN. A CLOSED circuit needs no probe.
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.CLOSED) {
      return Response.json({ status: "closed", message: "Circuit is already closed. No probe needed." });
    }
    if (circuit && circuit.circuit_status === CIRCUIT_STATUS.OPEN && !isHalfOpenEligible(circuit, now)) {
      const retryMs = circuit.retry_after ? new Date(circuit.retry_after).getTime() : now;
      const secs = Math.max(0, Math.ceil((retryMs - now) / 1000));
      return Response.json({
        status: "cooldown_active",
        message: `Cooldown still active. Probe eligible in approximately ${secs}s.`
      }, { status: 429 });
    }

    // Transition to HALF_OPEN before probing so concurrent visitors/admins see
    // a probe is in flight and do not start a second one.
    await upsertCircuit(base44, PROVIDER, {
      circuit_status: CIRCUIT_STATUS.HALF_OPEN,
      recess_type: circuit?.recess_type || null,
      sanitized_reason: circuit?.sanitized_reason || sanitizeReason(RECESS_TYPES.UNKNOWN),
      opened_at: circuit?.opened_at || new Date(now).toISOString(),
      retry_after: circuit?.retry_after || null,
      last_request_id: circuit?.last_request_id || null,
      consecutive_failures: circuit?.consecutive_failures || 0,
      updated_at: new Date(now).toISOString()
    });

    // One lightweight probe: current-balance for the mandatory demo address.
    const ep = { key: "current_balance", path: "/api/v1/profiler/address/current-balance", required: false, needsDateRange: false, dateFmt: null, paginated: true };
    const body = { address: MANDATORY_DEMO_ADDRESS, chain: CHAIN_BY_NETWORK.ethereum, pagination: { page: 1, per_page: 1 }, hide_spam_token: true };
    const r = await callEndpoint(apiKey, ep, body, 20000);
    r.chain = CHAIN_BY_NETWORK.ethereum;
    waitUntil(logUsage(base44, "admin-health-check", "live", [r]).catch(() => {}));

    if (r.ok) {
      await closeCircuit(base44, PROVIDER, { requestId: r.requestId || null });
      return Response.json({ status: "recovered", probe: "success", request_id: r.requestId || null });
    }

    // Failure → reopen with the classified recess type.
    const recessType = classifyRecessType(r.errorCategory);
    await openCircuit(base44, PROVIDER, {
      recessType,
      requestId: r.requestId || null
    });
    const retryMs = computeRetryAfterMs(recessType, now, null);
    return Response.json({
      status: "reopened",
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