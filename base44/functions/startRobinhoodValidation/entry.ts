// Wallet Court — admin-only Robinhood validation starter.
// Flips the allowance status to "running" and records the starting global
// verified total. Does NOT process any wallet, call Nansen, create audit
// records, touch the original calibration campaign, or change the public
// feature flag. The frontend calls advanceRobinhoodValidation once per
// wallet, sequentially, after wallets have been added.
//
// Idempotent + concurrent-safe:
//   - Already running → returns the existing status cleanly (200), never a 400.
//   - Terminal (exhausted / circuit_open / error) → 409, cannot restart.
//   - not_started / stopped → CAS transition to running. Only the first
//     concurrent start wins; the loser re-reads and returns the current state.
//   - starting_global_total is captured only on the first start (when null);
//     a restart from "stopped" preserves the original. Counters are never reset.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any write.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  ensureAllowance, getAllowance,
  RH_STATUS, computeValidationMaxTotal, resolveStartAction
} from "../../shared/robinhoodAllowance.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const allowance = await ensureAllowance(base44);
    const verifiedTotal = await getVerifiedTotal(base44);

    const decision = resolveStartAction(allowance, verifiedTotal);

    // Idempotent: already running → return existing status cleanly (200, not an error).
    if (decision.action === "already_running") {
      return Response.json({
        status: RH_STATUS.RUNNING,
        starting_global_total: decision.startingTotal,
        validation_max_total: computeValidationMaxTotal({ ...allowance, starting_global_total: decision.startingTotal }),
        current_global_total: verifiedTotal,
        already_running: true
      });
    }

    // Terminal (exhausted, circuit_open, error) → cannot restart.
    if (decision.action === "terminal") {
      return Response.json({
        error: decision.reason,
        status: allowance.status,
        code: "VALIDATION_TERMINAL"
      }, { status: 409 });
    }

    // Proceed: CAS transition from the current status to running.
    // Only set starting_global_total when it was null (first start). A restart
    // from "stopped" preserves the original starting total. Counters
    // (attempts_used, wallets_started, wallets_completed) are never in the
    // $set, so they are never reset.
    const startingTotal = decision.startingTotal;
    const cas = await base44.asServiceRole.entities.RobinhoodValidationAllowance.updateMany(
      { id: allowance.id, status: allowance.status, version: allowance.version },
      {
        $set: {
          status: RH_STATUS.RUNNING,
          stop_reason: null,
          starting_global_total: startingTotal,
          started_at: allowance.started_at || new Date().toISOString(),
          started_by_user_id: user.id,
          updated_at: new Date().toISOString()
        },
        $inc: { version: 1 }
      }
    );

    if (cas && cas.updated === 1) {
      return Response.json({
        status: RH_STATUS.RUNNING,
        starting_global_total: startingTotal,
        validation_max_total: computeValidationMaxTotal({ starting_global_total: startingTotal, max_attempts: allowance.max_attempts }),
        current_global_total: verifiedTotal,
        attempts_used: allowance.attempts_used || 0,
        wallets_started: allowance.wallets_started || 0,
        wallets_completed: allowance.wallets_completed || 0
      });
    }

    // CAS failed — a concurrent start/stop/advance won the race. Re-read and
    // return the current state cleanly (idempotent), not an unhelpful error.
    const current = await getAllowance(base44);
    const currentTotal = await getVerifiedTotal(base44);
    return Response.json({
      status: current?.status || RH_STATUS.NOT_STARTED,
      starting_global_total: current?.starting_global_total ?? null,
      validation_max_total: computeValidationMaxTotal(current),
      current_global_total: currentTotal,
      already_running: current?.status === RH_STATUS.RUNNING,
      code: current?.status === RH_STATUS.RUNNING ? "VALIDATION_ALREADY_RUNNING" : "VALIDATION_STATE_CHANGED"
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to start validation." }, { status: 500 });
  }
}