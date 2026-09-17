// Wallet Court — verify an EIP-191 personal_sign signature and create/refresh
// a WalletClaim. Authenticated only. The server reloads the case, finds the
// user's matching unused nonce, consumes it atomically, validates every signed
// field, recovers the signer address with ethers, and only then creates the
// claim. The nonce is consumed before the claim completes, so a failed or
// replayed verification cannot reuse it. Never trusts a frontend-supplied
// address — the recovered signer must match the case's normalized address.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { verifyMessage } from "npm:ethers@6.13.4";
import {
  isClaimableNetwork,
  isValidEvmAddress,
  normalizeClaimAddress,
  shortAddr,
  sha256Hex,
  parseClaimMessage,
  newClaimSlug,
  sanitizeClaim,
  SIGNATURE_SCHEME
} from "../../shared/walletClaim.ts";
import { findCaseBySlug } from "../../shared/caseUtils.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try {
      body = await req.json();
    } catch {
      // allow empty body
    }
    const { case_slug, message, signature } = body || {};
    if (!case_slug || !message || !signature) {
      return Response.json({ error: "case_slug, message, and signature are required." }, { status: 400 });
    }

    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });
    const network = trial.network;
    if (!isClaimableNetwork(network)) {
      return Response.json({ error: "Wallet claiming for this network is coming soon." }, { status: 422 });
    }
    if (!isValidEvmAddress(trial.normalized_wallet_address)) {
      return Response.json({ error: "This case is not eligible for claiming." }, { status: 422 });
    }
    const normalized = normalizeClaimAddress(network, trial.normalized_wallet_address);

    const message_hash = await sha256Hex(message);
    const nowIso = new Date().toISOString();

    // Find this user's matching unused, unexpired nonce.
    const candidates = await base44.asServiceRole.entities.WalletClaimNonce.filter(
      {
        owner_user_id: user.id,
        normalized_wallet_address: normalized,
        message_hash,
        used_at: null,
        expires_at: { $gte: nowIso }
      },
      "-created_date",
      5
    );
    const nonceRec = candidates && candidates[0];
    if (!nonceRec) {
      return Response.json(
        { error: "Claim session expired or already used. Please start again.", code: "nonce_invalid" },
        { status: 401 }
      );
    }

    // Consume the nonce before completing the claim. A failed verification
    // cannot reuse it.
    await base44.asServiceRole.entities.WalletClaimNonce.update(nonceRec.id, {
      used_at: nowIso
    });

    // Validate the signed message contents against the case + nonce.
    const parsed = parseClaimMessage(message);
    if (parsed.case !== case_slug) return fail("Case mismatch.");
    if (parsed.network !== network) return fail("Network mismatch.");
    if (parsed.wallet !== normalized) return fail("Wallet mismatch.");
    if (parsed.domain !== nonceRec.domain) return fail("Domain mismatch.");
    if (parsed.expires !== nonceRec.expires_at) return fail("Message expired.");

    // Recover the signer address from the EIP-191 personal signature.
    let recovered;
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      return fail("Invalid signature.");
    }
    if (!recovered || recovered.toLowerCase() !== normalized) {
      return fail("Signature does not match this wallet.");
    }

    // Enforce one active claim per normalized address + network.
    const existing = await base44.asServiceRole.entities.WalletClaim.filter(
      { normalized_wallet_address: normalized, network, status: "active" },
      "-verified_at",
      5
    );
    const existingClaim = existing && existing[0];

    if (existingClaim && existingClaim.owner_user_id !== user.id) {
      return Response.json({
        status: "already_claimed",
        error: "This wallet is already claimed by another account.",
        dispute_note:
          "If you are the true owner, account recovery and dispute tools are coming in a future phase."
      });
    }

    if (existingClaim && existingClaim.owner_user_id === user.id) {
      const refreshed = await base44.asServiceRole.entities.WalletClaim.update(existingClaim.id, {
        last_verified_at: nowIso,
        latest_trial_slug: trial.public_slug,
        status: "active"
      });
      return Response.json({ status: "refreshed", claim: sanitizeClaim(refreshed, { isOwner: true }) });
    }

    const claim_slug = newClaimSlug();
    const claim = await base44.asServiceRole.entities.WalletClaim.create({
      owner_user_id: user.id,
      network,
      normalized_wallet_address: normalized,
      address_short: shortAddr(normalized),
      claim_slug,
      status: "active",
      verified_at: nowIso,
      last_verified_at: nowIso,
      signature_scheme: SIGNATURE_SCHEME,
      public_alias: null,
      profile_visibility: "private",
      show_trial_history: false,
      show_badges: true,
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