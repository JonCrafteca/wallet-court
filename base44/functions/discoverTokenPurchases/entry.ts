// Wallet Court — Single Trade Trial: discover purchases of a specific token
// by a wallet. Calls the Nansen dex-trades endpoint with a token_bought_address
// filter. Returns a sanitized list of purchases with opaque selection tokens.
// One physical Nansen call. No trial is created.
//
// Security: The browser NEVER receives the transaction_hash, wallet address,
// or mint. It receives only an opaque selection_id plus sanitized display
// data. The analyzeSingleTrade function resolves the authoritative purchase
// server-side by consuming the selection token.
//
// Budget: Uses the SEPARATE Single Trade usage policy, NOT the legacy 1,020
// calibration ceiling. Physical calls still increment NansenApiCallAudit.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { getNansenApiKey, fetchTokenPurchases, buildSingleTradeTelemetryContext } from "../../shared/nansen.ts";
import { normalizePurchases, sanitizePurchaseForPublic } from "../../shared/singleTradeEvidence.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { getCircuit } from "../../shared/circuitStore.ts";
import { isSingleTradePublicEnabled } from "../../shared/featureFlags.ts";
import { checkDiscoveryRateLimit } from "../../shared/singleTradeUsageStore.ts";
import { createSelection, newSelectionId } from "../../shared/singleTradeSelectionStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const wallet_address = body?.wallet_address;
    const network = body?.network;
    const token_mint = body?.token_mint;

    if (!wallet_address || !network || !token_mint) {
      return Response.json({ error: "wallet_address, network, and token_mint are required.", code: "MISSING_FIELDS" }, { status: 400 });
    }
    // ---- Capability registry: reject unsupported networks before any Nansen call ----
    const { isSingleTradeSupported } = await import("../../shared/singleTradeCapability.ts");
    if (!isSingleTradeSupported(network)) {
      return Response.json({ error: "This network is not yet supported for Single Trade Trial.", code: "UNSUPPORTED_CHAIN" }, { status: 400 });
    }

    // ---- Feature flag check: public users blocked when flag is false ----
    const isPublic = await isSingleTradePublicEnabled(base44);
    let isAdmin = false;
    try {
      const user = await base44.auth.me();
      if (user && user.role === "admin") isAdmin = true;
    } catch {}
    if (!isPublic && !isAdmin) {
      return Response.json({ error: "Single Trade Trial is coming soon. Check back shortly!", code: "FEATURE_DISABLED" }, { status: 403 });
    }

    const validation = validateWalletForChain(network, wallet_address);
    if (!validation.ok) {
      return Response.json({ error: validation.message, code: validation.code }, { status: 400 });
    }

    const normalized = normalizeAddress(network, wallet_address);

    // ---- Rate limit: discoveries per wallet per hour ----
    const rateLimit = await checkDiscoveryRateLimit(base44, normalized, network);
    if (!rateLimit.allowed) {
      return Response.json({ error: rateLimit.reason, code: "RATE_LIMITED" }, { status: 429 });
    }

    const apiKey = getNansenApiKey();
    if (!apiKey) {
      return Response.json({ error: "Nansen API key is not configured.", code: "MISSING_KEY" }, { status: 503 });
    }

    // Circuit check before any paid call.
    const circuit = await getCircuit(base44, "nansen");
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ court_recess: true, recess_type: circuit?.recess_type || "court_recess_unknown", retry_after: circuit?.retry_after || null }, { status: 503 });
    }

    // ---- Single Trade telemetry context (separate budget, NOT ceiling) ----
    const { telemetryCtx, budgetGuard } = buildSingleTradeTelemetryContext(base44, {
      workflow: "single_trade_discovery", network, caseSlug: null
    });

    const to = new Date();
    const from = new Date(to.getTime() - 365 * 86400000);
    const result = await fetchTokenPurchases(apiKey, network, normalized, token_mint, {
      from, to, timeoutMs: 20000, telemetryCtx, budgetGuard
    });

    // Check if the budget guard blocked the call (Single Trade daily limit or emergency stop).
    if (!result.ok && result.errorCategory === "ceiling_reached") {
      return Response.json({ error: "Single Trade daily call limit reached or emergency stop is active. Please try again later.", code: "BUDGET_EXHAUSTED" }, { status: 429 });
    }

    if (!result.ok) {
      return Response.json({ error: "Failed to fetch purchases from Nansen.", code: result.errorCategory || "unknown" }, { status: 502 });
    }

    const purchases = normalizePurchases(result.json, token_mint);

    // ---- Create purchase selections (opaque tokens) for each purchase ----
    const publicPurchases = [];
    for (const p of purchases) {
      const selectionId = newSelectionId();
      try {
        await createSelection(base44, {
          selection_id: selectionId,
          normalized_wallet_address: normalized,
          network,
          token_mint,
          transaction_hash: p.transaction_hash,
          purchase_timestamp: p.block_timestamp,
          purchase_cost_usd: p.purchase_cost_usd,
          tokens_received: p.tokens_received,
          entry_market_cap_usd: p.entry_market_cap_usd,
          entry_price_usd: p.entry_price_usd,
          token_symbol: p.token_bought_symbol
        });
      } catch {
        // If selection creation fails, skip this purchase (don't expose raw data).
        continue;
      }
      const sanitized = sanitizePurchaseForPublic(p);
      publicPurchases.push({ ...sanitized, selection_id: selectionId });
    }

    return Response.json({ purchases: publicPurchases, count: publicPurchases.length, token_mint, network });
  } catch (error) {
    return Response.json({ error: error.message || "Discovery failed.", code: "DISCOVERY_ERROR" }, { status: 500 });
  }
}