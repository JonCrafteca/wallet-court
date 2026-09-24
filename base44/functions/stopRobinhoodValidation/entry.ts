// Wallet Court — admin-only Robinhood validation stopper.
// Sets the allowance status to "stopped" and reverts the current processing
// wallet to pending. Does NOT interrupt an in-flight Nansen request — the
// current wallet's analysis is allowed to complete, then the runner stops.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any write.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ensureAllowance, updateAllowance, RH_STATUS, RH_WALLET_STATUS } from "../../shared/robinhoodAllowance.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const allowance = await ensureAllowance(base44);

    if (allowance.status === RH_STATUS.STOPPED || allowance.status === RH_STATUS.NOT_STARTED) {
      return Response.json({ status: allowance.status, message: "Validation is not running." });
    }

    // Revert the current processing wallet to pending
    if (allowance.current_wallet_address) {
      const wallets = await base44.asServiceRole.entities.RobinhoodValidationWallet.filter(
        { status: RH_WALLET_STATUS.PROCESSING }, "sequence_order", 10
      );
      for (const w of (wallets || [])) {
        await base44.asServiceRole.entities.RobinhoodValidationWallet.update(w.id, {
          status: RH_WALLET_STATUS.PENDING,
          started_at: null,
          version: (w.version || 0) + 1
        });
      }
    }

    await updateAllowance(base44, {
      status: RH_STATUS.STOPPED,
      stop_reason: "Stopped by admin.",
      current_wallet_address: null,
      current_address_short: null,
      current_wallet_started_at: null,
      current_calls_used: null
    });

    return Response.json({ status: RH_STATUS.STOPPED, stop_reason: "Stopped by admin." });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to stop validation." }, { status: 500 });
  }
}