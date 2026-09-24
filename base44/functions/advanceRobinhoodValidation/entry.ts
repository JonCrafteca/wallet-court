// Wallet Court — admin-only Robinhood validation wallet processor.
// Processes ONE wallet through the Nansen pipeline (fetchNansenEvidence),
// creates a WalletTrial, and updates the allowance counters. The frontend
// calls this once per wallet, sequentially.
//
// Key safety features:
//   - Per-physical-attempt budget guard: refuses the 22nd Nansen attempt
//     before it leaves the process. Safe stop mid-wallet if the allowance
//     is exhausted.
//   - Circuit breaker check: if the shared Nansen circuit is open, stops
//     immediately without processing the wallet.
//   - If a Robinhood request opens the circuit (assessRecess), stops
//     immediately and does NOT move to the next wallet.
//   - Does NOT touch CalibrationControl, CalibrationRun, or
//     CalibrationDocketItem — the original campaign is completely isolated.
//   - Robinhood calls still increment the truthful global NansenApiCallAudit
//     total (audit records are created), but do NOT raise the global ceiling.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import { fetchNansenEvidence, assessRecess, getNansenApiKey, ERR } from "../../shared/nansen.ts";
import { classifyOutcome, OPERATIONAL_FAILURE } from "../../shared/evidenceGate.ts";
import { computeSeverityConfidence, buildLiveVerdictPayload } from "../../shared/verdicts_live.ts";
import { selectEntityVerdict } from "../../shared/verdicts_entity.ts";
import { applySeverityCap } from "../../shared/verdicts_performance.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { getCircuit, openCircuit } from "../../shared/circuitStore.ts";
import { isCircuitOpen, sanitizeReason, RECESS_TYPES, recessHttpStatus } from "../../shared/circuitBreaker.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";
import {
  ensureAllowance, updateAllowance, canStartWallet, isExhausted, shouldStop,
  createPersistentRobinhoodBudgetGuard, sanitizeAllowance,
  computeValidationMaxTotal, newInvocationId,
  acquireAdvanceLock, releaseAdvanceLock,
  RH_STATUS, RH_WALLET_STATUS
} from "../../shared/robinhoodAllowance.ts";

const PROVIDER = "nansen";

function newSlug() {
  return "case-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function trackSafe(base44, eventName: string, props: Record<string, any>) {
  try { if (base44?.analytics?.track) waitUntil(base44.analytics.track({ eventName, properties: props })); } catch {}
}

export default async function (req) {
  const invocationId = newInvocationId();
  let lockReleased = false;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const allowance = await ensureAllowance(base44);

    // ---- Check if we can start the next wallet ----
    const startCheck = canStartWallet(allowance);
    if (!startCheck.allowed) {
      return Response.json({ error: startCheck.reason, status: allowance.status }, { status: 423 });
    }

    // ---- Acquire the cross-invocation advance lock (CAS) ----
    // Only one advance operation can run at a time. A second concurrent request
    // (double-click, second tab, second serverless invocation) returns 409
    // VALIDATION_ALREADY_PROCESSING. A stale lock (held longer than 5 minutes)
    // is reclaimed automatically.
    const lockResult = await acquireAdvanceLock(base44, invocationId);
    if (!lockResult.acquired) {
      return Response.json({
        error: "Validation is already processing a wallet. Wait for the current wallet to complete.",
        code: "VALIDATION_ALREADY_PROCESSING"
      }, { status: 409 });
    }

    try {
    // ---- Stale-lock recovery: revert any wallets stuck in "processing" ----
    // If we recovered a stale lock, the previous invocation may have crashed
    // after claiming a wallet but before completing it. Revert those wallets to
    // "pending" so they can be re-processed.
    if (lockResult.stale) {
      const stuckWallets = await base44.asServiceRole.entities.RobinhoodValidationWallet.filter(
        { status: RH_WALLET_STATUS.PROCESSING }, "sequence_order", 10
      );
      for (const w of (stuckWallets || [])) {
        await base44.asServiceRole.entities.RobinhoodValidationWallet.update(w.id, {
          status: RH_WALLET_STATUS.PENDING,
          started_at: null,
          version: (w.version || 0) + 1
        }).catch(() => {});
      }
    }
      // ---- Circuit breaker check (shared across all chains) ----
      const circuit = await getCircuit(base44, PROVIDER);
      if (isCircuitOpen(circuit, Date.now())) {
        await updateAllowance(base44, {
          status: RH_STATUS.CIRCUIT_OPEN,
          stop_reason: "Provider circuit is open (shared Nansen CircuitBreaker)."
        });
        return Response.json({
          error: "Provider circuit is open. Validation stopped.",
          status: RH_STATUS.CIRCUIT_OPEN,
          circuit_open: true
        }, { status: 423 });
      }

      // ---- Find the next pending wallet ----
      const wallets = await base44.asServiceRole.entities.RobinhoodValidationWallet.list("sequence_order", 50);
      const nextWallet = (wallets || []).find((w) => w.status === RH_WALLET_STATUS.PENDING);
      if (!nextWallet) {
        await updateAllowance(base44, { status: RH_STATUS.STOPPED, stop_reason: "No more pending wallets." });
        return Response.json({ error: "No more pending wallets.", status: RH_STATUS.STOPPED }, { status: 423 });
      }

      // ---- Claim the wallet (CAS) ----
      const claimed = await base44.asServiceRole.entities.RobinhoodValidationWallet.updateMany(
        { wallet_id: nextWallet.wallet_id, status: RH_WALLET_STATUS.PENDING, version: nextWallet.version },
        {
          $set: {
            status: RH_WALLET_STATUS.PROCESSING,
            started_at: new Date().toISOString()
          },
          $inc: { version: 1 }
        }
      );
      if (!claimed || claimed.updated !== 1) {
        return Response.json({ error: "Wallet was claimed by another process.", status: "conflict" }, { status: 409 });
      }

      // ---- Update allowance: wallets_started++, current wallet info ----
      const updatedAllowance = await updateAllowance(base44, {
        wallets_started: (allowance.wallets_started || 0) + 1,
        current_wallet_address: nextWallet.wallet_address,
        current_address_short: nextWallet.address_short,
        current_wallet_started_at: new Date().toISOString(),
        current_calls_used: 0
      });

      trackSafe(base44, "robinhood_validation_wallet_started", {
        wallet_id: nextWallet.wallet_id,
        wallets_started: updatedAllowance.wallets_started,
        attempts_used: allowance.attempts_used
      });

      // ---- Create the persistent per-physical-attempt budget guard ----
      // Unlike the local-counter guard, this reserves each physical attempt
      // via CAS on the allowance record before the outbound Nansen request.
      // Safe across serverless invocations, multiple tabs, and double-clicks.
      const rhBudgetGuard = createPersistentRobinhoodBudgetGuard(base44, allowance.max_attempts);

      // ---- Compute the ceiling exception for this validation run ----
      // The legacy 1,020 ceiling is replaced by (starting_global_total + 21)
      // for this authenticated robinhood_validation context only. All other
      // traffic remains bound by 1,020.
      const validationMaxTotal = computeValidationMaxTotal(allowance) ?? 1020;
      const ceilingException = { maxTotal: validationMaxTotal };

      // ---- Get the Nansen API key ----
      const apiKey = getNansenApiKey();
      if (!apiKey) {
        await base44.asServiceRole.entities.RobinhoodValidationWallet.update(nextWallet.id, {
          status: RH_WALLET_STATUS.FAILED,
          completed_at: new Date().toISOString(),
          failure_category: "missing_key",
          failure_message_safe: "Nansen API key not configured.",
          calls_used: 0,
          version: (nextWallet.version || 0) + 2
        });
        await updateAllowance(base44, {
          status: RH_STATUS.ERROR,
          stop_reason: "Nansen API key not configured.",
          wallets_completed: (updatedAllowance.wallets_completed || 0) + 1,
          current_wallet_address: null,
          current_address_short: null,
          current_wallet_started_at: null,
          current_calls_used: null
        });
        return Response.json({ error: "Nansen API key not configured.", status: RH_STATUS.ERROR }, { status: 500 });
      }

      // ---- Track starting attempts for callsUsed computation ----
      const startingAttempts = allowance.attempts_used || 0;

      // ---- Call fetchNansenEvidence with the Robinhood budget guard and ceiling exception ----
      const public_slug = newSlug();
      const nansen = await fetchNansenEvidence(apiKey, "robinhood", nextWallet.normalized_wallet_address, {
        windowDays: 180,
        caseSlug: public_slug,
        base44,
        timeoutMs: 20000,
        durableTelemetry: true,
        extraBudgetGuard: rhBudgetGuard,
        ceilingException,
        onPhysicalCall: (count) => {
          // Update current_calls_used for live dashboard display.
          // attempts_used is already updated persistently by the budget guard.
          waitUntil(updateAllowance(base44, {
            current_calls_used: count
          }).catch(() => {}));
        }
      });

      // ---- Read the final attempts_used from the allowance ----
      const finalAllowance = await ensureAllowance(base44);
      const callsUsed = (finalAllowance.attempts_used || 0) - startingAttempts;

    // ---- Check for Court Recess (circuit breaker) ----
    const gateOutcome = classifyOutcome(nansen.metrics, nansen.meta);
    const recess = assessRecess(nansen, gateOutcome);
    if (recess) {
      // Open the circuit and stop validation immediately.
      await openCircuit(base44, PROVIDER, {
        recessType: recess.recessType,
        requestId: recess.requestId
      });
      await base44.asServiceRole.entities.RobinhoodValidationWallet.update(nextWallet.id, {
        status: RH_WALLET_STATUS.FAILED,
        completed_at: new Date().toISOString(),
        calls_used: callsUsed,
        failure_category: "provider_recess",
        failure_message_safe: sanitizeReason(recess.recessType),
        version: (nextWallet.version || 0) + 2
      });
      await updateAllowance(base44, {
        status: RH_STATUS.CIRCUIT_OPEN,
        stop_reason: `Provider circuit opened: ${sanitizeReason(recess.recessType)}`,
        wallets_completed: (updatedAllowance.wallets_completed || 0) + 1,
        attempts_used: finalAllowance.attempts_used || 0,
        endpoint_failures: (updatedAllowance.endpoint_failures || 0) + nansen.failedSources.length,
        current_wallet_address: null,
        current_address_short: null,
        current_wallet_started_at: null,
        current_calls_used: null
      });
      trackSafe(base44, "robinhood_validation_circuit_open", {
        wallet_id: nextWallet.wallet_id,
        recess_type: recess.recessType,
        calls_used: callsUsed
      });
      return Response.json({
        wallet_id: nextWallet.wallet_id,
        status: RH_WALLET_STATUS.FAILED,
        failure_category: "provider_recess",
        circuit_open: true,
        recess_type: recess.recessType,
        calls_used: callsUsed,
        allowance: sanitizeAllowance(await ensureAllowance(base44))
      }, { status: 503 });
    }

    // ---- Check if allowance was exhausted mid-wallet ----
    const finalAttempts = finalAllowance.attempts_used || 0;
    const exhausted = isExhausted({ attempts_used: finalAttempts, max_attempts: allowance.max_attempts });

    // ---- Create the WalletTrial ----
    let trial = null;
    let walletStatus = RH_WALLET_STATUS.COMPLETED;
    let failureCategory = null;
    let failureMessage = null;

    if (nansen.outcome === "demo" || nansen.errorCategory === ERR.MISSING_KEY) {
      // No evidence — treat as failed (shouldn't happen with a valid API key)
      walletStatus = RH_WALLET_STATUS.FAILED;
      failureCategory = "provider_error";
      failureMessage = "No evidence returned from Nansen.";
    } else if (gateOutcome === "dismissed_no_evidence" || gateOutcome === "mistrial_insufficient_evidence") {
      trial = await base44.asServiceRole.entities.WalletTrial.create({
        wallet_address: nextWallet.wallet_address,
        normalized_wallet_address: nextWallet.normalized_wallet_address,
        network: "robinhood",
        status: "completed",
        data_mode: "live",
        submitted_by_user_id: null,
        wallet_class: nansen.walletClass,
        case_outcome: gateOutcome,
        verdict_code: null,
        verdict_name: null,
        headline: null,
        roast: null,
        defense_statement: null,
        sentence: null,
        severity_score: null,
        confidence_score: null,
        evidence_items_json: JSON.stringify(nansen.evidence),
        metrics_json: JSON.stringify({ ...nansen.metrics, _meta: nansen.meta }),
        source_endpoints_json: JSON.stringify(nansen.sources),
        public_slug,
        analyzed_at: new Date().toISOString(),
        requested_window_days: nansen.meta?.requested_window_days ?? null,
        effective_analysis_start: nansen.meta?.effective_analysis_start ?? null,
        effective_analysis_end: nansen.meta?.effective_analysis_end ?? null,
        coverage_limited: nansen.meta?.coverage_limited ?? false
      });
    } else {
      // Verdict
      const verdict = selectEntityVerdict(nansen.walletClass, nansen.metrics);
      const { severity: rawSeverity, confidence } = computeSeverityConfidence(nansen.metrics, nansen.partial);
      const severity = applySeverityCap(verdict, rawSeverity);
      const payload = buildLiveVerdictPayload(verdict, nansen.evidence, nansen.metrics, nansen.meta, nansen.sources, severity, confidence);
      trial = await base44.asServiceRole.entities.WalletTrial.create({
        wallet_address: nextWallet.wallet_address,
        normalized_wallet_address: nextWallet.normalized_wallet_address,
        network: "robinhood",
        status: "completed",
        data_mode: "live",
        submitted_by_user_id: null,
        wallet_class: nansen.walletClass,
        case_outcome: "verdict",
        ...payload,
        public_slug,
        analyzed_at: new Date().toISOString(),
        requested_window_days: nansen.meta?.requested_window_days ?? null,
        effective_analysis_start: nansen.meta?.effective_analysis_start ?? null,
        effective_analysis_end: nansen.meta?.effective_analysis_end ?? null,
        coverage_limited: nansen.meta?.coverage_limited ?? false
      });
    }

    // ---- If exhausted mid-wallet, mark as stopped ----
    if (exhausted && walletStatus === RH_WALLET_STATUS.COMPLETED) {
      walletStatus = RH_WALLET_STATUS.STOPPED;
      failureCategory = "allowance_exhausted";
      failureMessage = "Allowance exhausted mid-wallet. Partial evidence only.";
    }

    // ---- Update the wallet record ----
    await base44.asServiceRole.entities.RobinhoodValidationWallet.update(nextWallet.id, {
      status: walletStatus,
      completed_at: new Date().toISOString(),
      case_slug: trial?.public_slug || null,
      verdict_code: trial?.verdict_code || null,
      verdict_name: trial?.verdict_name || null,
      case_outcome: trial?.case_outcome || null,
      data_mode: trial?.data_mode || null,
      calls_used: callsUsed,
      failure_category: failureCategory,
      failure_message_safe: failureMessage,
      version: (nextWallet.version || 0) + 2
    });

    // ---- Update the allowance counters ----
    const endpointSuccesses = nansen.sources ? nansen.sources.filter((s) => s.includes(":live")).length : 0;
    const endpointFailures = nansen.failedSources ? nansen.failedSources.length : 0;

    const allowanceFields: Record<string, any> = {
      wallets_completed: (updatedAllowance.wallets_completed || 0) + 1,
      endpoint_successes: (updatedAllowance.endpoint_successes || 0) + endpointSuccesses,
      endpoint_failures: (updatedAllowance.endpoint_failures || 0) + endpointFailures,
      current_wallet_address: null,
      current_address_short: null,
      current_wallet_started_at: null,
      current_calls_used: null
    };

    // ---- Check if we should stop ----
    const stopCheck = shouldStop(
      { ...updatedAllowance, attempts_used: finalAttempts, wallets_completed: (updatedAllowance.wallets_completed || 0) + 1 },
      false
    );
    if (stopCheck.stop && stopCheck.newStatus) {
      allowanceFields.status = stopCheck.newStatus;
      allowanceFields.stop_reason = stopCheck.reason;
    }

    await updateAllowance(base44, allowanceFields);

    trackSafe(base44, "robinhood_validation_wallet_completed", {
      wallet_id: nextWallet.wallet_id,
      wallet_status: walletStatus,
      case_slug: trial?.public_slug || null,
      verdict_code: trial?.verdict_code || null,
      calls_used: callsUsed,
      attempts_used: finalAttempts,
      exhausted
    });

    return Response.json({
      wallet_id: nextWallet.wallet_id,
      address_short: nextWallet.address_short,
      status: walletStatus,
      case_slug: trial?.public_slug || null,
      verdict_name: trial?.verdict_name || null,
      case_outcome: trial?.case_outcome || null,
      calls_used: callsUsed,
      attempts_used: finalAttempts,
      exhausted,
      allowance: sanitizeAllowance(await ensureAllowance(base44))
    });
    } catch (error) {
      return Response.json({ error: error.message || "Wallet processing failed." }, { status: 500 });
    } finally {
      // Always release the advance lock, whether the wallet processing
      // succeeded, failed, or threw. The lock is released via CAS on the
      // invocation_id so only the owning invocation can release it.
      if (!lockReleased) {
        await releaseAdvanceLock(base44, invocationId).catch(() => {});
        lockReleased = true;
      }
    }
  } catch (error) {
    return Response.json({ error: error.message || "Wallet processing failed." }, { status: 500 });
  }
}