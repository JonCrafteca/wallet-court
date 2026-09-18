// Wallet Court — verify a wallet-ownership signature and create/refresh a
// WalletClaim. Authenticated only. Supports EVM (EIP-191 personal_sign via
// ethers) and Solana (Ed25519 detached via crypto.subtle). Validates every
// signed field, recovers/verifies the signer, and only then creates the
// claim. The nonce is consumed atomically via CAS before the claim completes.
// Never trusts a frontend-supplied address.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { verifyMessage } from "npm:ethers@6.13.4";
import {
  isClaimableNetwork, isEvmNetwork, isClaimableAddress, normalizeClaimAddress,
  shortAddr, sha256Hex, parseClaimMessage, newClaimSlug, sanitizeClaim,
  SIGNATURE_SCHEME, SOLANA_SIGNATURE_SCHEME, CLAIM_PURPOSE
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
    if (!isClaimableNetwork(network)) return Response.json({ error: "Wallet claiming for this network is coming soon." }, { status: 422 });
    if (!isClaimableAddress(network, trial.normalized_wallet_address)) return Response.json({ error: "This case is not eligible for claiming." }, { status: 422 });
    const normalized = normalizeClaimAddress(network, trial.normalized_wallet_address);

    const message_hash = await sha256Hex(message);
    const nowIso = new Date().toISOString();

    // CAS nonce consumption — atomic one-time use
    const nonceDa = makeNonceDataAccess(base44);
    const nonceResult = await acquireValidNonce(nonceDa, {
      ownerUserId: user.id, normalizedAddress: normalized,
      messageHash: message_hash, purpose: CLAIM_PURPOSE, nowIso
    });
    if (!nonceResult.ok) return Response.json({ error: nonceResult.error, code: nonceResult.code }, { status: 401 });
    const nonceRec = nonceResult.nonce;

    // Validate all parsed fields against expected values
    const parsed = parseClaimMessage(message);
    const fieldError = validateNonceFields(parsed, {
      purpose: CLAIM_PURPOSE, account: user.id, caseSlug: case_slug,
      network, wallet: normalized, domain: nonceRec.domain, expiresAt: nonceRec.expires_at
    });
    if (fieldError) return fail(fieldError);

    // Verify signature — EVM (EIP-191) or Solana (Ed25519)
    let signatureValid = false;
    if (isEvmNetwork(network)) {
      let recovered;
      try { recovered = verifyMessage(message, signature); } catch { return fail("Invalid signature."); }
      signatureValid = !!(recovered && recovered.toLowerCase() === normalized);
    } else if (network === "solana") {
      signatureValid = await verifySolanaSignature(message, signature, normalized);
    }
    if (!signatureValid) return fail("Signature does not match this wallet.");

    // Check for existing claim
    const existing = await base44.asServiceRole.entities.WalletClaim.filter(
      { normalized_wallet_address: normalized, network, status: "active" }, "-verified_at", 5
    );
    const existingClaim = existing && existing[0];

    if (existingClaim && existingClaim.owner_user_id !== user.id) {
      return Response.json({
        status: "already_claimed",
        error: "This wallet is already claimed by another account.",
        dispute_note: "If you are the true owner, account recovery and dispute tools are available via admin review.",
        dispute_available: true
      });
    }

    if (existingClaim && existingClaim.owner_user_id === user.id) {
      const refreshed = await base44.asServiceRole.entities.WalletClaim.update(existingClaim.id, {
        last_verified_at: nowIso, latest_trial_slug: trial.public_slug, status: "active"
      });
      return Response.json({ status: "refreshed", claim: sanitizeClaim(refreshed, { isOwner: true }) });
    }

    // New claim
    let claim_slug;
    for (let i = 0; i < 5; i++) {
      const candidate = newClaimSlug();
      const conflict = await base44.asServiceRole.entities.WalletClaim.filter({ claim_slug: candidate }, "-created_date", 1);
      if (!conflict || conflict.length === 0) { claim_slug = candidate; break; }
    }
    if (!claim_slug) return Response.json({ error: "Could not generate a wallet identity. Please try again." }, { status: 500 });

    const sigScheme = isEvmNetwork(network) ? SIGNATURE_SCHEME : SOLANA_SIGNATURE_SCHEME;
    const claim = await base44.asServiceRole.entities.WalletClaim.create({
      owner_user_id: user.id, network, normalized_wallet_address: normalized,
      address_short: shortAddr(normalized), claim_slug, status: "active",
      verified_at: nowIso, last_verified_at: nowIso, signature_scheme: sigScheme,
      public_alias: null, court_name: null, court_name_normalized: null, court_name_changed_at: null,
      court_name_version: 0, court_name_history_json: "[]",
      profile_visibility: "private", show_trial_history: false, show_badges: true,
      latest_trial_slug: trial.public_slug
    });
    return Response.json({ status: "claimed", claim: sanitizeClaim(claim, { isOwner: true }) });
  } catch (error) {
    return Response.json({ error: error.message || "Wallet claim failed." }, { status: 500 });
  }
}

function fail(message) {
  return Response.json({ error: message, code: "claim_failed" }, { status: 401 });
}