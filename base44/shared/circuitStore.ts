// Wallet Court — provider circuit persistence helpers (Phase N2.4). Server-side
// only. Reads/writes the ProviderCircuit entity via the service role (bypasses
// RLS, which is admin-only). One circuit record per provider.
//
// Never stores secrets, authorization headers, raw provider payloads, or full
// wallet addresses. Only sanitized classifications and safe request IDs.
import {
  computeRetryAfterMs,
  sanitizeReason,
  generateLeaseId,
  readCircuitVersion,
  CIRCUIT_STATUS,
  RECESS_TYPES
} from "./circuitBreaker.ts";

const DEFAULT_PROVIDER = "nansen";
const PROBE_LEASE_DURATION_MS = 30_000; // 30-second probe lease

export async function getCircuit(base44, provider) {
  const p = provider || DEFAULT_PROVIDER;
  const records = await base44.asServiceRole.entities.ProviderCircuit.filter(
    { provider: p }, "-updated_at", 5
  );
  return (records && records[0]) || null;
}

export async function upsertCircuit(base44, provider, fields) {
  const p = provider || DEFAULT_PROVIDER;
  const existing = await getCircuit(base44, p);
  const payload = { ...fields, provider: p };
  if (existing) {
    return base44.asServiceRole.entities.ProviderCircuit.update(existing.id, payload);
  }
  return base44.asServiceRole.entities.ProviderCircuit.create(payload);
}

// Open the circuit after a blocking operational failure. Computes the retry
// window from the recess type, increments consecutive failures, and bumps
// circuit_version so any in-flight request that captured an older version
// cannot later close this newer circuit (stale-success protection).
export async function openCircuit(base44, provider, opts) {
  const now = Date.now();
  const recessType = opts?.recessType || RECESS_TYPES.UNKNOWN;
  const retryMs = computeRetryAfterMs(recessType, now, opts?.providerRetryAfterSeconds);
  const existing = await getCircuit(base44, provider);
  const newVersion = readCircuitVersion(existing) + 1;
  return upsertCircuit(base44, provider, {
    circuit_status: CIRCUIT_STATUS.OPEN,
    recess_type: recessType,
    sanitized_reason: sanitizeReason(recessType),
    opened_at: new Date(now).toISOString(),
    retry_after: new Date(retryMs).toISOString(),
    last_request_id: opts?.requestId || existing?.last_request_id || null,
    consecutive_failures: (existing?.consecutive_failures || 0) + 1,
    recovered_at: null,
    circuit_version: newVersion,
    probe_lease_id: null,
    probe_started_at: null,
    probe_expires_at: null,
    updated_at: new Date(now).toISOString()
  });
}

// Close the circuit after a successful recovery probe (or a successful live
// analysis that confirms the provider is healthy). Bumps circuit_version.
export async function closeCircuit(base44, provider, opts) {
  const now = Date.now();
  const existing = await getCircuit(base44, provider);
  const newVersion = readCircuitVersion(existing) + 1;
  return upsertCircuit(base44, provider, {
    circuit_status: CIRCUIT_STATUS.CLOSED,
    recess_type: null,
    sanitized_reason: null,
    opened_at: existing?.opened_at || new Date(now).toISOString(),
    retry_after: null,
    last_request_id: opts?.requestId || existing?.last_request_id || null,
    consecutive_failures: 0,
    recovered_at: new Date(now).toISOString(),
    circuit_version: newVersion,
    probe_lease_id: null,
    probe_started_at: null,
    probe_expires_at: null,
    updated_at: new Date(now).toISOString()
  });
}

// ---- Compare-and-set (CAS) probe-lease and version-guarded transitions ----
//
// These use updateMany with a filter that includes circuit_version and
// circuit_status. MongoDB's updateMany is atomic at the document level: if
// two concurrent calls both filter on { circuit_version: V }, only the first
// succeeds (it bumps the version), so the second matches 0 documents. The
// returned `updated` count is the CAS verdict — 1 means the caller won the
// transition, 0 means it lost the race and must NOT mutate the circuit further.

// Atomically acquire the half-open probe lease. The caller must have already
// verified the circuit is OPEN and the cooldown has elapsed. Returns
// { leaseId, newVersion } on success, or null if another caller holds the
// transition (probe in flight, circuit changed, or version mismatch).
export async function acquireProbeLease(base44, provider, expectedVersion, nowMs) {
  const leaseId = generateLeaseId();
  const newVersion = expectedVersion + 1;
  const filter = { provider: provider || DEFAULT_PROVIDER, circuit_status: CIRCUIT_STATUS.OPEN };
  // Old records may have a null/missing circuit_version. When the caller read 0
  // (the default), match null/missing/0 so the first probe after migration works.
  if (expectedVersion === 0) {
    filter.$or = [
      { circuit_version: 0 },
      { circuit_version: null },
      { circuit_version: { $exists: false } }
    ];
  } else {
    filter.circuit_version = expectedVersion;
  }
  const result = await base44.asServiceRole.entities.ProviderCircuit.updateMany(filter, {
    $set: {
      circuit_status: CIRCUIT_STATUS.HALF_OPEN,
      circuit_version: newVersion,
      probe_lease_id: leaseId,
      probe_started_at: new Date(nowMs).toISOString(),
      probe_expires_at: new Date(nowMs + PROBE_LEASE_DURATION_MS).toISOString(),
      updated_at: new Date(nowMs).toISOString()
    }
  });
  if (result && result.updated === 1) return { leaseId, newVersion };
  return null;
}

// Atomically close the circuit, guarded by a captured circuit_version. Used by
// the analysis pipeline: only the request that captured the matching version
// may close the circuit. A stale request (whose version was bumped by a newer
// open) matches 0 documents and does NOT close. Returns true on success.
export async function closeCircuitWithVersion(base44, provider, expectedVersion, nowMs, opts) {
  const newVersion = expectedVersion + 1;
  const filter = { provider: provider || DEFAULT_PROVIDER, circuit_version: expectedVersion };
  const result = await base44.asServiceRole.entities.ProviderCircuit.updateMany(filter, {
    $set: {
      circuit_status: CIRCUIT_STATUS.CLOSED,
      circuit_version: newVersion,
      recess_type: null,
      sanitized_reason: null,
      retry_after: null,
      last_request_id: opts?.requestId || null,
      consecutive_failures: 0,
      recovered_at: new Date(nowMs).toISOString(),
      probe_lease_id: null,
      probe_started_at: null,
      probe_expires_at: null,
      updated_at: new Date(nowMs).toISOString()
    }
  });
  return !!(result && result.updated === 1);
}

// Atomically reopen the circuit after a failed probe, guarded by the probe
// lease. Only the lease holder may reopen. Returns true on success.
export async function reopenCircuitWithLease(base44, provider, expectedVersion, leaseId, opts) {
  const now = Date.now();
  const recessType = opts?.recessType || RECESS_TYPES.UNKNOWN;
  const retryMs = computeRetryAfterMs(recessType, now, opts?.providerRetryAfterSeconds);
  const newVersion = expectedVersion + 1;
  const filter = {
    provider: provider || DEFAULT_PROVIDER,
    circuit_version: expectedVersion,
    probe_lease_id: leaseId,
    circuit_status: CIRCUIT_STATUS.HALF_OPEN
  };
  const result = await base44.asServiceRole.entities.ProviderCircuit.updateMany(filter, {
    $set: {
      circuit_status: CIRCUIT_STATUS.OPEN,
      circuit_version: newVersion,
      recess_type: recessType,
      sanitized_reason: sanitizeReason(recessType),
      opened_at: new Date(now).toISOString(),
      retry_after: new Date(retryMs).toISOString(),
      last_request_id: opts?.requestId || null,
      consecutive_failures: (opts?.consecutiveFailures || 0) + 1,
      probe_lease_id: null,
      probe_started_at: null,
      probe_expires_at: null,
      updated_at: new Date(now).toISOString()
    }
  });
  return !!(result && result.updated === 1);
}