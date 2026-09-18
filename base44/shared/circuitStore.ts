// Wallet Court — provider circuit persistence helpers (Phase N2.4). Server-side
// only. Reads/writes the ProviderCircuit entity via the service role (bypasses
// RLS, which is admin-only). One circuit record per provider.
//
// Never stores secrets, authorization headers, raw provider payloads, or full
// wallet addresses. Only sanitized classifications and safe request IDs.
import {
  computeRetryAfterMs,
  sanitizeReason,
  CIRCUIT_STATUS,
  RECESS_TYPES
} from "./circuitBreaker.ts";

const DEFAULT_PROVIDER = "nansen";

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
// window from the recess type and increments consecutive failures.
export async function openCircuit(base44, provider, opts) {
  const now = Date.now();
  const recessType = opts?.recessType || RECESS_TYPES.UNKNOWN;
  const retryMs = computeRetryAfterMs(recessType, now, opts?.providerRetryAfterSeconds);
  const existing = await getCircuit(base44, provider);
  return upsertCircuit(base44, provider, {
    circuit_status: CIRCUIT_STATUS.OPEN,
    recess_type: recessType,
    sanitized_reason: sanitizeReason(recessType),
    opened_at: new Date(now).toISOString(),
    retry_after: new Date(retryMs).toISOString(),
    last_request_id: opts?.requestId || existing?.last_request_id || null,
    consecutive_failures: (existing?.consecutive_failures || 0) + 1,
    recovered_at: null,
    updated_at: new Date(now).toISOString()
  });
}

// Close the circuit after a successful recovery probe (or a successful live
// analysis that confirms the provider is healthy).
export async function closeCircuit(base44, provider, opts) {
  const now = Date.now();
  const existing = await getCircuit(base44, provider);
  return upsertCircuit(base44, provider, {
    circuit_status: CIRCUIT_STATUS.CLOSED,
    recess_type: null,
    sanitized_reason: null,
    opened_at: existing?.opened_at || new Date(now).toISOString(),
    retry_after: null,
    last_request_id: opts?.requestId || existing?.last_request_id || null,
    consecutive_failures: 0,
    recovered_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString()
  });
}