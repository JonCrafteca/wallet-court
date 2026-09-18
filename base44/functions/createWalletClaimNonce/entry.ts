// Wallet Court — issue a single-use signing challenge. Authenticated only.
// Supports wallet_claim (from a case page), wallet_revoke (from a claimed
// Rap Sheet), and wallet_dispute (recovery request for an already-claimed
// wallet). Supports EVM and Solana. The server resolves the canonical address
// from the stored case or claim — never trusts a frontend-supplied address.
// Stores only hashes; returns the message for the wallet to sign.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  isClaimableNetwork, isClaimableAddress, normalizeClaimAddress, shortAddr,
  randomNonce, sha256Hex, buildClaimMessage,
  CLAIM_PURPOSE, REVOKE_PURPOSE, DISPUTE_PURPOSE,
  NONCE_TTL_MS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX
} from "../../shared/walletClaim.ts";
import { enforceRateLimit } from "../../shared/nonceLifecycle.ts";
import { makeNonceDataAccess } from "../../shared/claimDataAccess.ts";
import { findCaseBySlug } from "../../shared/caseUtils.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const purpose = body?.purpose === REVOKE_PURPOSE ? REVOKE_PURPOSE
      : body?.purpose === DISPUTE_PURPOSE ? DISPUTE_PURPOSE
      : CLAIM_PURPOSE;
    const domain = appDomain(req) || "walletcourt.app";
    let network, normalized, scopeSlug;

    if (purpose === REVOKE_PURPOSE) {
      const claim_slug = body?.claim_slug;
      if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });
      const claims = await base44.asServiceRole.entities.WalletClaim.filter(
        { claim_slug, status: "active" }, "-verified_at", 5
      );
      const claim = claims && claims[0];
      if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
      if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });
      network = claim.network;
      normalized = claim.normalized_wallet_address;
      scopeSlug = claim_slug;
    } else {
      // wallet_claim or wallet_dispute — both from a case
      const case_slug = body?.case_slug;
      if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });
      const trial = await findCaseBySlug(base44, case_slug);
      if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });
      network = trial.network;
      if (!isClaimableNetwork(network)) return Response.json({ error: "Wallet claiming for this network is coming soon.", code: "unsupported_network" }, { status: 422 });
      if (!isClaimableAddress(network, trial.normalized_wallet_address)) return Response.json({ error: "This case is not eligible for claiming." }, { status: 422 });
      normalized = normalizeClaimAddress(network, trial.normalized_wallet_address);
      scopeSlug = case_slug;

      // For wallet_dispute, the wallet must be claimed by another user
      if (purpose === DISPUTE_PURPOSE) {
        const existing = await base44.asServiceRole.entities.WalletClaim.filter(
          { normalized_wallet_address: normalized, network, status: "active" }, "-verified_at", 5
        );
        const existingClaim = existing && existing[0];
        if (!existingClaim || existingClaim.owner_user_id === user.id) {
          return Response.json({ error: "This wallet is not claimed by another account." }, { status: 422 });
        }
      }
    }

    // Rate limit
    const nonceDa = makeNonceDataAccess(base44);
    const rateLimit = await enforceRateLimit(nonceDa, {
      ownerUserId: user.id, normalizedAddress: normalized, purpose,
      windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX
    });
    if (!rateLimit.ok) return Response.json({ error: rateLimit.error }, { status: 429 });

    // Invalidate pending nonces
    const nowIso = new Date().toISOString();
    await nonceDa.invalidatePendingNonces({
      ownerUserId: user.id, normalizedAddress: normalized, purpose, nowIso
    });

    // Create new nonce
    const nonce = randomNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const message = buildClaimMessage({
      purpose, domain, account: user.id, address: normalized,
      network, caseSlug: scopeSlug, nonce,
      issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString()
    });
    const nonce_hash = await sha256Hex(nonce);
    const message_hash = await sha256Hex(message);

    await base44.asServiceRole.entities.WalletClaimNonce.create({
      owner_user_id: user.id, network, normalized_wallet_address: normalized,
      case_slug: scopeSlug, purpose, domain, nonce_hash, message_hash,
      expires_at: expiresAt.toISOString(), used_at: null, created_at: issuedAt.toISOString()
    });

    return Response.json({
      message, expires_at: expiresAt.toISOString(), purpose,
      case_slug: scopeSlug, network, address_short: shortAddr(normalized)
    });
  } catch (error) {
    return Response.json({ error: error.message || "Could not start wallet claim." }, { status: 500 });
  }
}

function appDomain(req) {
  try {
    const origin = req.headers.get("origin");
    if (origin) return new URL(origin).host;
    const ref = req.headers.get("referer");
    if (ref) return new URL(ref).host;
  } catch {}
  return null;
}