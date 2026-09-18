// Wallet Court — owner-only wallet claim revocation. Requires a fresh wallet
// signature with purpose "wallet_revoke". Supports EVM (EIP-191) and Solana
// (Ed25519). The nonce is consumed atomically via CAS. Sets the claim status
// to "revoked". Never silently transfers ownership.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { verifyMessage } from "npm:ethers@6.13.4";
import {
  isEvmNetwork, sha256Hex, parseClaimMessage, REVOKE_PURPOSE
} from "../../shared/walletClaim.ts";
import { verifySolanaSignature } from "../../shared/solanaVerify.ts";
import { acquireValidNonce, validateNonceFields } from "../../shared/nonceLifecycle.ts";
import { makeNonceDataAccess } from "../../shared/claimDataAccess.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { claim_slug, message, signature } = body || {};
    if (!claim_slug || !message || !signature) {
      return Response.json({ error: "claim_slug, message, and signature are required." }, { status: 400 });
    }

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });

    const normalized = claim.normalized_wallet_address;
    const network = claim.network;
    const message_hash = await sha256Hex(message);
    const nowIso = new Date().toISOString();

    // CAS nonce consumption — atomic one-time use
    const nonceDa = makeNonceDataAccess(base44);
    const nonceResult = await acquireValidNonce(nonceDa, {
      ownerUserId: user.id, normalizedAddress: normalized,
      messageHash: message_hash, purpose: REVOKE_PURPOSE, nowIso
    });
    if (!nonceResult.ok) return Response.json({ error: nonceResult.error, code: nonceResult.code }, { status: 401 });
    const nonceRec = nonceResult.nonce;

    // Validate all parsed fields
    const parsed = parseClaimMessage(message);
    const fieldError = validateNonceFields(parsed, {
      purpose: REVOKE_PURPOSE, account: user.id, caseSlug: claim_slug,
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

    await base44.asServiceRole.entities.WalletClaim.update(claim.id, { status: "revoked" });
    return Response.json({ status: "revoked" });
  } catch (error) {
    return Response.json({ error: error.message || "Revocation failed." }, { status: 500 });
  }
}