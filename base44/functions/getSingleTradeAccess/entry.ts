// Wallet Court — Single Trade Trial: authoritative access decision endpoint.
// Returns the access decision for the Home page Single Trade mode toggle.
//
// Uses the EXACT same canonical admin authorization logic that protects
// /admin/single-trade-usage (base44.auth.me() + user.role === "admin").
// This guarantees that if the admin dashboard recognizes you as an admin,
// this endpoint recognizes you as an admin too — no client-side inference.
//
// Never exposes email, user ID, role internals, allowlists, or other user
// data. Returns only the six boolean fields needed for the access decision.
//
// No Nansen calls are made. No state is mutated.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { isSingleTradePublicEnabled } from "../../shared/featureFlags.ts";
import { getPolicyOrDefault } from "../../shared/singleTradeUsageStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Resolve authenticated user (canonical admin check) ----
    // Same pattern as getSingleTradeUsageStatus: base44.auth.me() + role check.
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    const is_admin = !!(user && user.role === "admin");

    // ---- Read feature flag and usage policy (no mutation) ----
    const [public_enabled, policy] = await Promise.all([
      isSingleTradePublicEnabled(base44),
      getPolicyOrDefault(base44)
    ]);

    const usage_enabled = !!(policy && policy.enabled === true);
    const emergency_stop = !!(policy && policy.emergency_stop === true);

    const can_access = public_enabled || is_admin;
    const admin_preview = is_admin && !public_enabled;

    return Response.json({
      public_enabled,
      is_admin,
      can_access,
      admin_preview,
      usage_enabled,
      emergency_stop
    });
  } catch {
    // Fail closed: return all-false on any error so the client shows Coming Soon.
    return Response.json({
      public_enabled: false,
      is_admin: false,
      can_access: false,
      admin_preview: false,
      usage_enabled: false,
      emergency_stop: false
    });
  }
}