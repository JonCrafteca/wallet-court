// Wallet Court — privacy-safe recovery request (dispute). Authenticated only.
// When a wallet is already claimed by another account, the true owner can
// submit a recovery request by signing a message with purpose "wallet_dispute".
// The signature is verified (EVM or Solana) and a ClaimDispute record is
// created for admin review. The response never reveals the current owner's
// identity, email, or user id.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { verifyMessage } from "npm:ethers@6.13.4";
import {
  isEvmNetwork, isClaimableAddress, normalizeClaimAddress,
  sha256Hex, parseClaimMessage, DISPUTE_PURPOSE
} from "../../shared/walletClaim.ts";
import { verifySolanaSignature } from "../../shared/solanaVerify.ts";
import { acquireValidNonce, validateNonceFields } from "../../shared/nonceLifecycle.ts";
import { makeNonceDataAccess } from "../../shared/claimDataAccess.ts";
import { findCaseBySlug } from "../../shared/caseUtils.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { case_slug, message, signature } = body || {};
    if (!case_slug || !message || !signature) {
      return Response.json({ error: "case_slug, message, and signature are required." }, { status: 400 });
    }

    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });
    const network = trial.network;
    if (!isClaimableAddress(network, trial.normalized_wallet_address)) {
      return Response.json({ error: "This case is not eligible for disputing." }, { status: 422 });
    }
    const normalized = normalizeClaimAddress(network, trial.normalized_wallet_address);

    // The wallet must be claimed by another user
    const existing = await base44.asServiceRole.entities.WalletClaim.filter(
      { normalized_wallet_address: normalized, network, status: "active" }, "-verified_at", 5
    );
    const existingClaim = existing && existing[0];
    if (!existingClaim || existingClaim.owner_user_id === user.id) {
      return Response.json({ error: "This wallet is not claimed by another account." }, { status: 422 });
    }

    // Check for existing pending dispute by this user for this case
    const existingDisputes = await base44.asServiceRole.entities.ClaimDispute.filter(
      { case_slug, dispute_user_id: user.id, status: "pending" }, "-created_date", 1
    );
    if (existingDisputes && existingDisputes.length > 0) {
      return Response.json({ error: "You already have a pending dispute for this case." }, { status: 409 });
    }

    // CAS nonce consumption — atomic one-time use
    const message_hash = await sha256Hex(message);
    const nowIso = new Date().toISOString();
    const nonceDa = makeNonceDataAccess(base44);
    const nonceResult = await acquireValidNonce(nonceDa, {
      ownerUserId: user.id, normalizedAddress: normalized,
      messageHash: message_hash, purpose: DISPUTE_PURPOSE, nowIso
    });
    if (!nonceResult.ok) return Response.json({ error: nonceResult.error, code: nonceResult.code }, { status: 401 });
    const nonceRec = nonceResult.nonce;

    // Validate parsed fields
    const parsed = parseClaimMessage(message);
    const fieldError = validateNonceFields(parsed, {
      purpose: DISPUTE_PURPOSE, account: user.id, caseSlug: case_slug,
      network, wallet: normalized, domain: nonceRec.domain, expiresAt: nonceRec.expires_at
    });
    if (fieldError) return Response.json({ error: fieldError, code: "claim_failed" }, { status: 401 });

    // Verify signature — EVM or Solana
    let signatureValid = false;
    if (isEvmNetwork(network)) {
      let recovered;
      try { recovered = verifyMessage(message, signature); } catch {
        return Response.json({ error: "Invalid signature.", code: "claim_failed" }, { status: 401 });
      }
      signatureValid = !!(recovered && recovered.toLowerCase() === normalized);
    } else if (network === "solana") {
      signatureValid = await verifySolanaSignature(message, signature, normalized);
    }
    if (!signatureValid) {
      return Response.json({ error: "Signature does not match this wallet.", code: "claim_failed" }, { status: 401 });
    }

    // Create dispute record
    await base44.asServiceRole.entities.ClaimDispute.create({
      case_slug, dispute_user_id: user.id, network,
      normalized_wallet_address: normalized, message_hash,
      status: "pending", created_at: nowIso
    });

    // Privacy-safe response — never reveals the current owner
    return Response.json({
      status: "dispute_submitted",
      message: "Your recovery request has been submitted for admin review."
    });
  } catch (error) {
    return Response.json({ error: error.message || "Dispute submission failed." }, { status: 500 });
  }
}