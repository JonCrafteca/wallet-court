// Wallet Court — Single Trade Trial: refresh a completed trial's current
// status. Appends a new current-status snapshot to refresh_snapshots_json
// WITHOUT modifying the original OHLCV snapshot, verdict, severity,
// confidence, roast, or sentence. Uses the SEPARATE Single Trade budget.
// Requires authentication and rate limiting. CAS-protected against duplicate
// concurrent refreshes.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { waitUntil } from "base44:runtime";
import { getNansenApiKey, NANSEN_ENDPOINTS, callEndpoint, CHAIN_BY_NETWORK, buildSingleTradeTelemetryContext } from "../../shared/nansen.ts";
import { findBySlug, appendRefreshSnapshot } from "../../shared/singleTradeStore.ts";
import { sanitizeSingleTrialForPublicCase } from "../../shared/singleTradeEvidence.ts";
import { isSingleTradePublicEnabled } from "../../shared/featureFlags.ts";
import { isCircuitOpen } from "../../shared/circuitBreaker.ts";
import { getCircuit } from "../../shared/circuitStore.ts";

// Rate limit: one refresh per trial per 5 minutes.
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Require authentication ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) {
      return Response.json({ error: "Sign in to refresh a trade case.", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

    const slug = body?.slug;
    if (!slug) return Response.json({ error: "slug is required." }, { status: 400 });

    // ---- Load the existing trial ----
    const trial = await findBySlug(base44, slug);
    if (!trial) return Response.json({ error: "This trade case never made it to the docket." }, { status: 404 });

    if (trial.status !== "completed") {
      return Response.json({ error: "This trade case is not yet completed.", code: "NOT_COMPLETED" }, { status: 409 });
    }
    if (trial.case_outcome !== "verdict") {
      return Response.json({ error: "Dismissed and mistrial cases cannot be refreshed.", code: "NOT_REFRESHABLE" }, { status: 409 });
    }

    // ---- Rate limit: one refresh per trial per 5 minutes ----
    let lastRefresh = null;
    try {
      const snapshots = JSON.parse(trial.refresh_snapshots_json || "[]");
      if (Array.isArray(snapshots) && snapshots.length > 0) {
        lastRefresh = snapshots[snapshots.length - 1]?.refreshed_at || null;
      }
    } catch {}
    if (lastRefresh) {
      const elapsed = Date.now() - new Date(lastRefresh).getTime();
      if (elapsed < REFRESH_COOLDOWN_MS) {
        const remaining = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
        return Response.json({
          error: `Please wait ${remaining}s before refreshing this case again.`,
          code: "REFRESH_COOLDOWN"
        }, { status: 429 });
      }
    }

    // ---- Feature flag check (admins can always refresh) ----
    const isPublic = await isSingleTradePublicEnabled(base44);
    const isAdmin = user.role === "admin";
    if (!isPublic && !isAdmin) {
      return Response.json({ error: "Single Trade Trial refresh is not yet publicly available.", code: "FEATURE_DISABLED" }, { status: 403 });
    }

    const apiKey = getNansenApiKey();
    if (!apiKey) {
      return Response.json({ error: "Nansen API key is not configured.", code: "MISSING_KEY" }, { status: 503 });
    }

    // ---- Circuit check ----
    const circuit = await getCircuit(base44, "nansen");
    if (isCircuitOpen(circuit, Date.now())) {
      return Response.json({ court_recess: true, recess_type: circuit?.recess_type || "court_recess_unknown", retry_after: circuit?.retry_after || null }, { status: 503 });
    }

    // ---- Single Trade telemetry context (separate budget) ----
    const { telemetryCtx, budgetGuard } = buildSingleTradeTelemetryContext(base44, {
      workflow: "single_trade_refresh", network: trial.network, caseSlug: slug
    });

    // ---- Fetch current balance for this token (1 physical call) ----
    const balEp = NANSEN_ENDPOINTS.find((e) => e.key === "current_balance");
    const chain = CHAIN_BY_NETWORK[trial.network];
    const balBody = { address: trial.normalized_wallet_address, chain, hide_spam_token: true, pagination: { page: 1, per_page: 1000 } };
    const balResult = await callEndpoint(apiKey, balEp, balBody, 20000, telemetryCtx, budgetGuard);

    if (!balResult.ok) {
      return Response.json({ error: "Failed to fetch current balance from Nansen.", code: balResult.errorCategory || "unknown" }, { status: 502 });
    }

    let currentPriceUsd: number | null = null;
    let currentValueUsd: number | null = null;
    let currentTokenAmount: number | null = null;
    const balData = balResult.json?.data || balResult.json?.balances || [];
    if (Array.isArray(balData)) {
      const mintLower = (trial.token_mint || "").toLowerCase();
      const holding = balData.find((b: any) => (b.token_address || "").toLowerCase() === mintLower);
      if (holding) {
        currentPriceUsd = holding.price_usd ? parseFloat(holding.price_usd) : null;
        currentValueUsd = holding.value_usd ? parseFloat(holding.value_usd) : null;
        currentTokenAmount = holding.token_amount ? parseFloat(holding.token_amount) : null;
      }
    }

    // ---- Compute refresh snapshot values ----
    const purchaseCostUsd = trial.purchase_cost_usd ?? null;
    let currentUnrealizedPnlPct: number | null = null;
    if (purchaseCostUsd && purchaseCostUsd > 0 && currentValueUsd !== null) {
      currentUnrealizedPnlPct = (currentValueUsd / purchaseCostUsd) - 1;
    }

    // Recovery: from the lowest market cap to the current market cap.
    // We don't have the current market cap from current-balance, so we
    // estimate it from the current price if we have the entry mcap and price.
    let recoveryPct: number | null = null;
    const entryMcap = trial.entry_market_cap_usd ?? null;
    const entryPrice = trial.entry_price_usd ?? null;
    if (entryMcap && entryPrice && entryPrice > 0 && currentPriceUsd !== null) {
      const estimatedCurrentMcap = (currentPriceUsd / entryPrice) * entryMcap;
      // Recovery from the lowest point — we'd need the lowest mcap from the
      // OHLCV snapshot. For simplicity, we compute it from the stored metrics.
      try {
        const metrics = JSON.parse(trial.metrics_json || "{}");
        const lowestMcap = metrics.lowest_market_cap_usd ?? null;
        if (lowestMcap !== null && entryMcap > lowestMcap) {
          recoveryPct = (estimatedCurrentMcap - lowestMcap) / (entryMcap - lowestMcap);
        }
      } catch {}
    }

    const snapshot = {
      refreshed_at: new Date().toISOString(),
      current_price_usd: currentPriceUsd,
      current_value_usd: currentValueUsd,
      current_token_amount: currentTokenAmount,
      current_unrealized_pnl_pct: currentUnrealizedPnlPct,
      recovery_pct: recoveryPct
    };

    // ---- Append the snapshot (CAS-protected) ----
    const { appended, trial: updatedTrial } = await appendRefreshSnapshot(base44, trial.id, snapshot);
    if (!appended) {
      return Response.json({
        error: "This case was just refreshed by another request. Please try again in a few minutes.",
        code: "REFRESH_CONTENTION"
      }, { status: 409 });
    }

    return Response.json({
      trial: sanitizeSingleTrialForPublicCase(updatedTrial),
      refresh: snapshot
    });
  } catch (error) {
    return Response.json({ error: error.message || "Refresh failed." }, { status: 500 });
  }
}