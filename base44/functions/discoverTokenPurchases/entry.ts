// Wallet Court — Single Trade Trial: discover purchases of a specific token
// by a wallet. Calls the Nansen dex-trades endpoint with a token_bought_address
// filter. Returns a sanitized list of purchases for the user to select from.
// One physical Nansen call. No trial is created.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { waitUntil } from "base44:runtime";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { getNansenApiKey, fetchTokenPurchases, buildTelemetryContext, ERR } from "../../shared/nansen.ts";
import { normalizePurchases, sanitizePurchaseForPublic } from "../../shared/singleTradeEvidence.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { getCircuit } from "../../shared/circuitStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const wallet_address = body?.wallet_address;
    const network = body?.network;
    const token_mint = body?.token_mint;

    if (!wallet_address || !network || !token_mint) {
      return Response.json({ error: "wallet_address, network, and token_mint are required." }, { status: 400 });
    }
    if (network !== "solana") {
      return Response.json({ error: "Single Trade Trial currently supports Solana only.", code: "UNSUPPORTED_CHAIN" }, { status: 400 });
    }

    const validation = validateWalletForChain(network, wallet_address);
    if (!validation.ok) {
      return Response.json({ error: validation.message, code: validation.code }, { status: 400 });
    }

    const normalized = normalizeAddress(network, wallet_address);
    const apiKey = getNansenApiKey();
    if (!apiKey) {
      return Response.json({ error: "Nansen API key is not configured.", code: "MISSING_KEY" }, { status: 503 });
    }

    // Circuit check before any paid call.
    const circuit = await getCircuit(base44, "nansen");
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ court_recess: true, recess_type: circuit?.recess_type || "court_recess_unknown", retry_after: circuit?.retry_after || null }, { status: 503 });
    }

    const { telemetryCtx, budgetGuard } = buildTelemetryContext(base44, {
      workflow: "single_trade_analysis", network, caseSlug: null
    });

    const to = new Date();
    const from = new Date(to.getTime() - 365 * 86400000);
    const result = await fetchTokenPurchases(apiKey, network, normalized, token_mint, {
      from, to, timeoutMs: 20000, telemetryCtx, budgetGuard
    });

    if (!result.ok) {
      return Response.json({ error: "Failed to fetch purchases from Nansen.", code: result.errorCategory || "unknown" }, { status: 502 });
    }

    const purchases = normalizePurchases(result.json, token_mint);
    const publicPurchases = purchases.map(sanitizePurchaseForPublic);

    return Response.json({ purchases: publicPurchases, count: publicPurchases.length, token_mint, network });
  } catch (error) {
    return Response.json({ error: error.message || "Discovery failed." }, { status: 500 });
  }
}