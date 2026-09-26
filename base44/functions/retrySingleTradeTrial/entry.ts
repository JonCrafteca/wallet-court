// Wallet Court — Single Trade Trial: retry a failed trial without another
// discovery call. Admin-only. Creates a new SingleTradePurchaseSelection from
// the failed trial's stored immutable purchase details, so analyzeSingleTrade
// can proceed using server-authoritative data — no client-supplied purchase
// facts, no redundant Nansen discovery call.
//
// Flow:
//   1. Admin clicks "Retry Analysis" on a failed case page.
//   2. This function looks up the failed trial by slug.
//   3. Creates a new selection from the trial's stored purchase details.
//   4. Returns { selection_token, wallet_address, network, token_mint }.
//   5. Frontend calls analyzeSingleTrade with that selection_token.
//   6. analyzeSingleTrade detects the failed trial → allows retry → new trial.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { findBySlug } from "../../shared/singleTradeStore.ts";
import { createSelection } from "../../shared/singleTradeSelectionStore.ts";
import { isSingleTradeSupported } from "../../shared/singleTradeCapability.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin-only ----
    let isAdmin = false;
    try {
      const currentUser = await base44.auth.me();
      if (currentUser && currentUser.role === "admin") isAdmin = true;
    } catch {}
    if (!isAdmin) {
      return Response.json({ error: "Admin access required to retry a failed case.", code: "FORBIDDEN" }, { status: 403 });
    }

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body.", code: "INVALID_BODY" }, { status: 400 }); }

    const slug = body?.slug;
    if (!slug) {
      return Response.json({ error: "Case slug is required.", code: "MISSING_FIELDS" }, { status: 400 });
    }

    // ---- Look up the failed trial ----
    const trial = await findBySlug(base44, slug);
    if (!trial) {
      return Response.json({ error: "Case not found.", code: "NOT_FOUND" }, { status: 404 });
    }
    if (trial.status !== "failed") {
      return Response.json({ error: "Only failed cases can be retried.", code: "NOT_FAILED" }, { status: 400 });
    }

    // ---- Verify the network is still supported ----
    if (!isSingleTradeSupported(trial.network)) {
      return Response.json({ error: "This network is no longer supported for Single Trade Trial.", code: "UNSUPPORTED_CHAIN" }, { status: 400 });
    }

    // ---- Verify the trial has the required purchase details ----
    if (!trial.transaction_hash || !trial.normalized_wallet_address || !trial.token_mint) {
      return Response.json({ error: "This case is missing the purchase details needed for a retry.", code: "MISSING_PURCHASE_DETAILS" }, { status: 400 });
    }

    // ---- Create a new selection from the failed trial's stored details ----
    // These are server-authoritative, immutable purchase facts captured at the
    // original discovery. No client-supplied data is trusted.
    const selection = await createSelection(base44, {
      normalized_wallet_address: trial.normalized_wallet_address,
      network: trial.network,
      token_mint: trial.token_mint,
      transaction_hash: trial.transaction_hash,
      purchase_timestamp: trial.purchase_timestamp,
      purchase_cost_usd: trial.purchase_cost_usd,
      tokens_received: trial.tokens_received,
      entry_market_cap_usd: trial.entry_market_cap_usd,
      entry_price_usd: trial.entry_price_usd,
      token_symbol: trial.token_symbol
    });

    return Response.json({
      selection_token: selection.selection_id,
      wallet_address: trial.wallet_address,
      network: trial.network,
      token_mint: trial.token_mint
    });
  } catch (error) {
    return Response.json({ error: "Failed to prepare retry.", code: "RETRY_ERROR" }, { status: 500 });
  }
}