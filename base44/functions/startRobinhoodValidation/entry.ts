// Wallet Court — admin-only Robinhood validation starter.
// Sets the allowance status to "running" and records the starting global
// verified total. Does NOT process any wallet — the frontend calls
// advanceRobinhoodValidation once per wallet, sequentially.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any write.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ensureAllowance, updateAllowance, RH_STATUS, RH_TERMINAL_STATUSES } from "../../shared/robinhoodAllowance.ts";
import { getVerifiedTotal } from "../../shared/calibrationStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const allowance = await ensureAllowance(base44);

    // Don't restart if already running
    if (allowance.status === RH_STATUS.RUNNING) {
      return Response.json({ error: "Validation is already running.", status: allowance.status }, { status: 409 });
    }

    // Don't restart if in a terminal state (exhausted, circuit_open, error)
    if (RH_TERMINAL_STATUSES.has(allowance.status) && allowance.status !== RH_STATUS.STOPPED) {
      return Response.json({ error: `Validation is in terminal state: ${allowance.status}.`, status: allowance.status }, { status: 409 });
    }

    // Check there are wallets to process
    const wallets = await base44.asServiceRole.entities.RobinhoodValidationWallet.list("sequence_order", 50);
    const pendingCount = (wallets || []).filter((w) => w.status === "pending").length;
    if (pendingCount === 0) {
      return Response.json({ error: "No pending wallets in the queue. Add wallets first." }, { status: 400 });
    }

    // Check there are remaining attempts
    if (allowance.attempts_used >= allowance.max_attempts) {
      return Response.json({ error: `Allowance exhausted (${allowance.max_attempts} attempts used).` }, { status: 400 });
    }

    // Check there are remaining wallets
    if (allowance.wallets_started >= allowance.max_wallets) {
      return Response.json({ error: `Maximum ${allowance.max_wallets} wallets already started.` }, { status: 400 });
    }

    const verifiedTotal = await getVerifiedTotal(base44);
    const startingTotal = allowance.starting_global_total ?? verifiedTotal;

    await updateAllowance(base44, {
      status: RH_STATUS.RUNNING,
      stop_reason: null,
      starting_global_total: startingTotal,
      started_at: allowance.started_at || new Date().toISOString(),
      started_by_user_id: user.id
    });

    return Response.json({
      status: RH_STATUS.RUNNING,
      starting_global_total: startingTotal,
      current_global_total: verifiedTotal,
      pending_wallets: pendingCount
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to start validation." }, { status: 500 });
  }
}