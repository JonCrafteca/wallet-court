// Wallet Court — admin-only Robinhood validation wallet submission.
// Adds a wallet to the Robinhood validation queue. Max 5 wallets.
// Validates the address for the Robinhood chain and deduplicates.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any write.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateWalletForChain } from "../../shared/walletValidation.ts";
import { normalizeAddress } from "../../shared/verdicts.ts";
import { walletFingerprint, shortAddress } from "../../shared/calibration.ts";
import { ensureAllowance, newRobinhoodWalletId, RH_MAX_WALLETS } from "../../shared/robinhoodAllowance.ts";
import { sha256Hex } from "../../shared/nansenTelemetry.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const wallet_address = body?.wallet_address;
    if (!wallet_address || typeof wallet_address !== "string") {
      return Response.json({ error: "wallet_address is required." }, { status: 400 });
    }

    // Validate for Robinhood chain (structural, zero Nansen calls)
    const validation = validateWalletForChain("robinhood", wallet_address.trim());
    if (!validation.ok) {
      return Response.json({
        error: validation.message,
        code: validation.code || "INVALID_WALLET_FOR_CHAIN"
      }, { status: 400 });
    }

    // Check wallet count
    const allowance = await ensureAllowance(base44);
    const existing = await base44.asServiceRole.entities.RobinhoodValidationWallet.list("sequence_order", 50);
    const existingCount = (existing || []).length;
    if (existingCount >= RH_MAX_WALLETS) {
      return Response.json({ error: `Maximum ${RH_MAX_WALLETS} wallets allowed.` }, { status: 400 });
    }

    // Normalize and fingerprint
    const normalized = normalizeAddress("robinhood", wallet_address.trim());
    const fingerprint = await walletFingerprint("robinhood", normalized);

    // Deduplicate
    const dup = (existing || []).find((w) => w.wallet_fingerprint === fingerprint);
    if (dup) {
      return Response.json({ error: "This wallet is already in the validation queue.", duplicate: true }, { status: 409 });
    }

    // Create the wallet record
    const now = new Date().toISOString();
    const wallet = await base44.asServiceRole.entities.RobinhoodValidationWallet.create({
      wallet_id: newRobinhoodWalletId(),
      wallet_address: wallet_address.trim(),
      normalized_wallet_address: normalized,
      address_short: shortAddress("robinhood", wallet_address.trim()),
      wallet_fingerprint: fingerprint,
      status: "pending",
      version: 0,
      sequence_order: existingCount + 1,
      queued_at: now
    });

    return Response.json({
      wallet_id: wallet.wallet_id,
      address_short: wallet.address_short,
      sequence_order: wallet.sequence_order,
      status: wallet.status,
      wallets_in_queue: existingCount + 1
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to submit wallet." }, { status: 500 });
  }
}