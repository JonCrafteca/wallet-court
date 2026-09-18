// Wallet Court — pipeline-level recess assessment (Phase N2.4). Pure logic,
// extracted from nansen.ts so it is unit-testable without the platform runtime.
//
// Given the per-call failure details from the Nansen pipeline and the evidence-
// gate outcome, decide whether an operational failure should BLOCK the case
// (Court Recess — no WalletTrial created) or allow the case to proceed to a
// verdict / dismissal / mistrial.
//
// Returns null when the case may proceed; otherwise returns
//   { recessType, errorCategory, requestId }
// describing the blocking failure so the pipeline can open the circuit and
// return a Court Recess response.
//
// Blocking rules (N2.4), in precedence order:
//   1. Any hard operational error (auth/credits/rate_limit/missing_key) in any
//      failed call → block (account-level; every endpoint is affected).
//   2. A required endpoint (pnl_summary / dex_trades) failed → block (cannot
//      defensibly determine a verdict without PnL + DEX evidence).
//   3. The evidence gate returned OPERATIONAL_FAILURE (no activity AND the
//      current_balance endpoint failed, so emptiness cannot be confirmed) →
//      block, using the balance call's recess type.
//   4. Otherwise (only an optional soft failure, or no failure) → proceed; the
//      pipeline runs the evidence gate for verdict/dismissed/mistrial.
//
// Pure: reads only its arguments. No network, no DB. Deterministic.
import {
  classifyRecessType,
  isHardOperationalError,
  highestPrecedenceRecess
} from "./circuitBreaker.ts";
import { OPERATIONAL_FAILURE } from "./evidenceGate.ts";

export function assessRecess(nansenResult, gateOutcome) {
  let failedCalls = Array.isArray(nansenResult?.failedCalls) ? nansenResult.failedCalls : [];
  // unsupported_chain is a request-validation error, NOT a provider outage. It
  // must never open the global circuit. Filter it out here so it cannot trigger
  // any blocking rule; the pipeline handles it as a 400 upstream.
  failedCalls = failedCalls.filter((c) => c && c.errorCategory !== "unsupported_chain");
  if (!failedCalls.length) return null;

  // 1. Hard operational error anywhere.
  const hard = failedCalls.filter((c) => isHardOperationalError(c.errorCategory));
  if (hard.length) {
    const types = hard.map((c) => classifyRecessType(c.errorCategory));
    const recessType = highestPrecedenceRecess(types);
    const lead = hard[0];
    return { recessType, errorCategory: lead.errorCategory, requestId: lead.requestId };
  }

  // 2. Required endpoint failed.
  const requiredFailed = failedCalls.find((c) => c.key === "pnl_summary" || c.key === "dex_trades");
  if (requiredFailed) {
    return {
      recessType: classifyRecessType(requiredFailed.errorCategory),
      errorCategory: requiredFailed.errorCategory,
      requestId: requiredFailed.requestId
    };
  }

  // 3. Evidence gate could not confirm an empty profile because an endpoint
  //    needed for confirmation (current_balance) failed.
  if (gateOutcome === OPERATIONAL_FAILURE) {
    const balanceFailed = failedCalls.find((c) => c.key === "current_balance");
    if (balanceFailed) {
      return {
        recessType: classifyRecessType(balanceFailed.errorCategory),
        errorCategory: balanceFailed.errorCategory,
        requestId: balanceFailed.requestId
      };
    }
    // Fallback: any remaining failed optional call.
    const any = failedCalls[0];
    return {
      recessType: classifyRecessType(any.errorCategory),
      errorCategory: any.errorCategory,
      requestId: any.requestId
    };
  }

  // 4. Optional soft failure with sufficient remaining evidence → proceed.
  return null;
}