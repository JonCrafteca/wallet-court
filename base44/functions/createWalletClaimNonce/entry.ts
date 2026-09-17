// Wallet Court — issue a single-use EIP-191 claim nonce for an EVM wallet.
// Authenticated only. The server loads the case, validates the network/address,
// rate-limits, invalidates outstanding unused nonces, then stores only hashes
// and returns the message for the wallet to sign. No raw private keys, no
// transactions, no token approvals — message signing only.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  isClaimableNetwork,
  isValidEvmAddress,
  normalizeClaimAddress,
  shortAddr,
  randomNonce,
  sha256Hex,
  buildClaimMessage,
  NONCE_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX
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
    const case_slug = body?.case_slug;
    if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });

    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });

    const network = trial.network;
    if (!isClaimableNetwork(network)) {
      return Response.json(
        { error: "Wallet claiming for this network is coming soon.", code: "unsupported_network" },
        { status: 422 }
      );
    }
    if (!isValidEvmAddress(trial.normalized_wallet_address)) {
      return Response.json({ error: "This case is not eligible for claiming." }, { status: 422 });
    }
    const normalized = normalizeClaimAddress(network, trial.normalized_wallet_address);

    // Rate-limit nonce requests by authenticated user + wallet.
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const recent = await base44.asServiceRole.entities.WalletClaimNonce.filter(
      { owner_user_id: user.id, normalized_wallet_address: normalized, created_at: { $gte: since } },
      "-created_date",
      100
    );
    if (recent && recent.length >= RATE_LIMIT_MAX) {
      return Response.json(
        { error: "Too many claim attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    // Invalidate any outstanding unused nonces for this user + wallet.
    await base44.asServiceRole.entities.WalletClaimNonce.updateMany(
      { owner_user_id: user.id, normalized_wallet_address: normalized, used_at: null },
      { $set: { used_at: new Date().toISOString() } }
    );

    const domain = appDomain(req) || "walletcourt.app";
    const nonce = randomNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const message = buildClaimMessage({
      domain,
      address: normalized,
      network,
      caseSlug: case_slug,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    const nonce_hash = await sha256Hex(nonce);
    const message_hash = await sha256Hex(message);

    await base44.asServiceRole.entities.WalletClaimNonce.create({
      owner_user_id: user.id,
      network,
      normalized_wallet_address: normalized,
      case_slug,
      domain,
      nonce_hash,
      message_hash,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      created_at: issuedAt.toISOString()
    });

    return Response.json({
      message,
      expires_at: expiresAt.toISOString(),
      case_slug,
      network,
      address_short: shortAddr(normalized)
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
  } catch {
    // ignore
  }
  return null;
}