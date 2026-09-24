// Wallet Court — admin-only Robinhood validation status endpoint.
// Returns the allowance state, the wallet queue, and the current global
// verified NansenApiCallAudit total. Used by the validation dashboard.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ensureAllowance, sanitizeAllowance } from "../../shared/robinhoodAllowance.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";
import { getCircuit } from "../../shared/circuitStore.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { isRobinhoodPublicEnabled } from "../../shared/featureFlags.ts";

const PROVIDER = "nansen";

function sanitizeWallet(w: any): Record<string, any> {
  if (!w) return null;
  return {
    wallet_id: w.wallet_id || "",
    address_short: w.address_short || "",
    wallet_fingerprint: w.wallet_fingerprint || "",
    status: w.status || "pending",
    sequence_order: w.sequence_order ?? 0,
    case_slug: w.case_slug || null,
    verdict_code: w.verdict_code || null,
    verdict_name: w.verdict_name || null,
    case_outcome: w.case_outcome || null,
    data_mode: w.data_mode || null,
    calls_used: w.calls_used ?? null,
    failure_category: w.failure_category || null,
    failure_message_safe: w.failure_message_safe || null,
    queued_at: w.queued_at || null,
    started_at: w.started_at || null,
    completed_at: w.completed_at || null
  };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const [allowance, wallets, verifiedTotal, circuit, rhPublicEnabled] = await Promise.all([
      ensureAllowance(base44),
      base44.asServiceRole.entities.RobinhoodValidationWallet.list("sequence_order", 50),
      getVerifiedTotal(base44),
      getCircuit(base44, PROVIDER),
      isRobinhoodPublicEnabled(base44)
    ]);

    const circuitOpen = isCircuitOpen(circuit, Date.now());
    const sanitized = sanitizeAllowance(allowance);
    // Merge the feature flag from the separate FeatureFlag entity so the
    // admin dashboard can show the public toggle state.
    sanitized.robinhood_public_enabled = rhPublicEnabled;

    return Response.json({
      allowance: sanitized,
      wallets: (wallets || []).map(sanitizeWallet),
      current_global_total: verifiedTotal,
      circuit_open: circuitOpen,
      circuit_shared_warning: "Nansen's CircuitBreaker is shared across all chains. A Robinhood request that opens the circuit will block Ethereum, Base, and Solana requests until it recovers."
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load validation status." }, { status: 500 });
  }
}