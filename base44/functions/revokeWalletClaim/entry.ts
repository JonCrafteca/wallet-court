// Wallet Court — owner-only wallet claim revocation. Requires a fresh wallet
// signature with purpose "wallet_revoke". Reuses the nonce infrastructure:
// the owner first calls createWalletClaimNonce with purpose "wallet_revoke",
// signs the message, then calls this function. Sets the claim status to
// "revoked". Never silently transfers ownership.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { verifyMessage } from "npm:ethers@6.13.4";
import {
  sha256Hex, parseClaimMessage, REVOKE_PURPOSE
} from "../../shared/walletClaim.ts";

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

    const candidates = await base44.asServiceRole.entities.WalletClaimNonce.filter(
      { owner_user_id: user.id, normalized_wallet_address: normalized, message_hash, purpose: REVOKE_PURPOSE, used_at: null, expires_at: { $gte: nowIso } },
      "-created_date", 5
    );
    const nonceRec = candidates && candidates[0];
    if (!nonceRec) return Response.json({ error: "Revocation session expired or already used. Please start again.", code: "nonce_invalid" }, { status: 401 });

    await base44.asServiceRole.entities.WalletClaimNonce.update(nonceRec.id, { used_at: nowIso });

    const parsed = parseClaimMessage(message);
    if (parsed.purpose !== REVOKE_PURPOSE) return Response.json({ error: "Purpose mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.account !== user.id) return Response.json({ error: "Account mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.case !== claim_slug) return Response.json({ error: "Claim mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.network !== network) return Response.json({ error: "Network mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.wallet !== normalized) return Response.json({ error: "Wallet mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.domain !== nonceRec.domain) return Response.json({ error: "Domain mismatch.", code: "claim_failed" }, { status: 401 });
    if (parsed.expires !== nonceRec.expires_at) return Response.json({ error: "Message expired.", code: "claim_failed" }, { status: 401 });

    let recovered;
    try { recovered = verifyMessage(message, signature); } catch {
      return Response.json({ error: "Invalid signature.", code: "claim_failed" }, { status: 401 });
    }
    if (!recovered || recovered.toLowerCase() !== normalized) {
      return Response.json({ error: "Signature does not match this wallet.", code: "claim_failed" }, { status: 401 });
    }

    await base44.asServiceRole.entities.WalletClaim.update(claim.id, { status: "revoked" });
    return Response.json({ status: "revoked" });
  } catch (error) {
    return Response.json({ error: error.message || "Revocation failed." }, { status: 500 });
  }
}