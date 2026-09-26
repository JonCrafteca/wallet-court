// Wallet Court — Single Trade Trial: slug-specific recovery state endpoint.
// Admin-only. Returns whether a failed Single Trade trial can be retried,
// combining admin auth, trial status, and usage policy into a single
// server-authoritative decision. This is the single source of truth for the
// RETRY ANALYSIS button on the unavailable case page.
//
// Returns ONLY: { can_retry, reason, usage_enabled, emergency_stop }
// Never returns wallet addresses, transaction hashes, selection tokens,
// evidence, metrics, or any trial data.
//
// Public/unauthenticated callers receive 403 with can_retry: false and never
// see the button. No Nansen calls are made. No state is mutated.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { getPolicyOrDefault } from "../../shared/singleTradeUsageStore.ts";
import { isSingleTradeSupported } from "../../shared/singleTradeCapability.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin-only: public/unauthenticated callers get 403 ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user || user.role !== "admin") {
      return Response.json(
        { can_retry: false, reason: "forbidden", usage_enabled: false, emergency_stop: false },
        { status: 403 }
      );
    }

    let body;
    try { body = await req.json(); } catch {
      return Response.json(
        { can_retry: false, reason: "invalid_body", usage_enabled: false, emergency_stop: false },
        { status: 400 }
      );
    }

    const slug = body?.slug;
    if (!slug) {
      return Response.json(
        { can_retry: false, reason: "missing_slug", usage_enabled: false, emergency_stop: false },
        { status: 400 }
      );
    }

    // ---- Read usage policy (no mutation) ----
    const policy = await getPolicyOrDefault(base44);
    const usage_enabled = !!(policy && policy.enabled === true);
    const emergency_stop = !!(policy && policy.emergency_stop === true);

    if (!usage_enabled) {
      return Response.json({ can_retry: false, reason: "usage_disabled", usage_enabled: false, emergency_stop });
    }
    if (emergency_stop) {
      return Response.json({ can_retry: false, reason: "emergency_stop", usage_enabled, emergency_stop: true });
    }

    // ---- Read the trial (service-role) ----
    const trial = await findBySlug(base44, slug);
    if (!trial) {
      return Response.json({ can_retry: false, reason: "not_found", usage_enabled, emergency_stop });
    }

    if (trial.status !== "failed") {
      return Response.json({ can_retry: false, reason: "not_failed", usage_enabled, emergency_stop });
    }

    if (!isSingleTradeSupported(trial.network)) {
      return Response.json({ can_retry: false, reason: "unsupported_chain", usage_enabled, emergency_stop });
    }

    if (!trial.transaction_hash || !trial.normalized_wallet_address || !trial.token_mint) {
      return Response.json({ can_retry: false, reason: "missing_purchase_details", usage_enabled, emergency_stop });
    }

    // All checks passed — the admin can retry this failed trial.
    return Response.json({ can_retry: true, reason: null, usage_enabled, emergency_stop });
  } catch {
    return Response.json(
      { can_retry: false, reason: "error", usage_enabled: false, emergency_stop: false },
      { status: 500 }
    );
  }
}