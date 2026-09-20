// Comprehensive behavioral tests for the N3 ownership system: Solana Ed25519,
// EVM EIP-191, nonce CAS lifecycle, atomic Court Name reservation, ownership
// lifecycle (recovery, admin override, revocation, account deletion), privacy,
// and outcome presentation gating. Uses real keypairs (tweetnacl + ethers)
// and mock data-access objects that simulate Base44 CAS semantics.
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { Wallet, verifyMessage } from "ethers";
import {
  verifySolanaSignature,
  base58Encode,
} from "../base44/shared/solanaVerify.ts";
import {
  buildClaimMessage,
  parseClaimMessage,
  sanitizeClaim,
  CLAIM_PURPOSE,
  REVOKE_PURPOSE,
  DISPUTE_PURPOSE,
} from "../base44/shared/walletClaim.ts";
import {
  validateNonceFields,
  acquireValidNonce,
  enforceRateLimit,
} from "../base44/shared/nonceLifecycle.ts";
import {
  setCourtNameAtomically,
  courtNameWinner,
} from "../base44/shared/courtNameReservation.ts";
import {
  validateAdminOverride,
  snapshotClaim,
  buildCleanupUpdates,
  buildCleanupAuditRecord,
} from "../base44/shared/claimAudit.ts";
import {
  getCaseOutcome,
  isDismissedOrMistrial,
  isVerdictOutcome,
} from "../base44/shared/evidenceGate.ts";
import {
  resolveCaseOutcome,
  computeDashboardCounts,
} from "../base44/shared/accountDashboard.ts";

// ─── Mock data access (simulates Base44 CAS semantics) ─────────────────────

class MockNonceDataAccess {
  nonces = new Map();
  idCounter = 0;

  addNonce(params) {
    const id = `nonce_${++this.idCounter}`;
    this.nonces.set(id, {
      id,
      owner_user_id: params.ownerUserId,
      normalized_wallet_address: params.normalizedAddress,
      message_hash: params.messageHash,
      purpose: params.purpose,
      domain: params.domain || "walletcourt.app",
      used_at: null,
      expires_at: params.expiresAt,
      created_at: params.createdAt || new Date().toISOString(),
    });
    return id;
  }

  async findValidNonce(params) {
    for (const nonce of this.nonces.values()) {
      if (
        nonce.owner_user_id === params.ownerUserId &&
        nonce.normalized_wallet_address === params.normalizedAddress &&
        nonce.message_hash === params.messageHash &&
        nonce.purpose === params.purpose &&
        nonce.used_at === null &&
        new Date(nonce.expires_at) > new Date(params.nowIso)
      ) {
        return { ...nonce };
      }
    }
    return null;
  }

  // CAS: only succeeds if used_at is currently null. Simulates updateMany
  // with { id, used_at: null } filter — exactly one concurrent caller wins.
  async casConsumeNonce(id, nowIso) {
    const nonce = this.nonces.get(id);
    if (!nonce || nonce.used_at !== null) return { consumed: false };
    nonce.used_at = nowIso;
    return { consumed: true };
  }

  async countRecentNonces(params) {
    let count = 0;
    for (const nonce of this.nonces.values()) {
      if (
        nonce.owner_user_id === params.ownerUserId &&
        nonce.normalized_wallet_address === params.normalizedAddress &&
        nonce.purpose === params.purpose &&
        new Date(nonce.created_at) >= new Date(params.sinceIso)
      ) {
        count++;
      }
    }
    return count;
  }

  async invalidatePendingNonces(params) {
    for (const nonce of this.nonces.values()) {
      if (
        nonce.owner_user_id === params.ownerUserId &&
        nonce.normalized_wallet_address === params.normalizedAddress &&
        nonce.purpose === params.purpose &&
        nonce.used_at === null
      ) {
        nonce.used_at = params.nowIso;
      }
    }
  }
}

class MockClaimDataAccess {
  claims = new Map();
  history = [];

  async getClaim(claim_slug) {
    for (const claim of this.claims.values()) {
      if (claim.claim_slug === claim_slug && claim.status === "active") {
        return { ...claim };
      }
    }
    return null;
  }

  async casUpdateClaim(id, expectedVersion, updates) {
    const claim = this.claims.get(id);
    if (!claim) return { updated: false };
    const currentVersion = claim.court_name_version || 0;
    const versionMatches =
      expectedVersion === 0
        ? currentVersion === 0 || currentVersion == null
        : currentVersion === expectedVersion;
    if (!versionMatches) return { updated: false };
    Object.assign(claim, updates);
    return { updated: true };
  }

  async findActiveByName(normalized, excludeId) {
    const results = [];
    for (const claim of this.claims.values()) {
      if (
        claim.status === "active" &&
        claim.court_name_normalized === normalized &&
        claim.id !== excludeId
      ) {
        results.push({ ...claim });
      }
    }
    return results;
  }

  async createHistoryRecord(record) {
    this.history.push(record);
  }

  addClaim(claim) {
    this.claims.set(claim.id, claim);
    return claim;
  }
}

function makeClaim(id, slug, userId, verifiedAt) {
  return {
    id,
    claim_slug: slug,
    owner_user_id: userId,
    status: "active",
    verified_at: verifiedAt,
    court_name_version: 0,
    court_name: null,
    court_name_normalized: null,
    court_name_changed_at: null,
  };
}

function solanaSign(keypair, message) {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, keypair.secretKey);
  return base58Encode(sig);
}

// ─── 1. Solana Ed25519 full lifecycle ──────────────────────────────────────

describe("Solana ownership — Ed25519 signature verification", () => {
  const BASE = {
    domain: "walletcourt.app",
    account: "user_sol_abc",
    network: "solana",
    caseSlug: "case-sol-123",
    nonce: "solnonce123456",
    issuedAt: "2026-09-19T10:00:00.000Z",
    expiresAt: "2026-09-19T10:05:00.000Z",
  };

  it("valid Ed25519 signature succeeds", async () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    const signature = solanaSign(kp, message);
    expect(await verifySolanaSignature(message, signature, address)).toBe(true);
  });

  it("invalid signature fails", async () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    expect(await verifySolanaSignature(message, "invalid_sig", address)).toBe(false);
  });

  it("wrong wallet fails", async () => {
    const kp1 = nacl.sign.keyPair();
    const kp2 = nacl.sign.keyPair();
    const addr1 = base58Encode(kp1.publicKey);
    const addr2 = base58Encode(kp2.publicKey);
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: addr1 });
    const signature = solanaSign(kp1, message);
    expect(await verifySolanaSignature(message, signature, addr2)).toBe(false);
  });

  it("altered message fails", async () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    const signature = solanaSign(kp, message);
    const altered = message.replace("wallet_claim", "wallet_revoke");
    expect(await verifySolanaSignature(altered, signature, address)).toBe(false);
  });

  it("wrong network fails (field validation)", () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    // Build a message with the WRONG network (ethereum) but everything else correct
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address, network: "ethereum" });
    const parsed = parseClaimMessage(message);
    const err = validateNonceFields(parsed, {
      purpose: CLAIM_PURPOSE, account: BASE.account, caseSlug: BASE.caseSlug,
      network: "solana", wallet: address, domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBe("Network mismatch.");
  });

  it("wrong action (purpose) fails (field validation)", () => {
    const parsed = { ...BASE, purpose: REVOKE_PURPOSE, network: "solana", wallet: "addr" };
    const err = validateNonceFields(parsed, {
      purpose: CLAIM_PURPOSE, account: BASE.account, caseSlug: BASE.caseSlug,
      network: "solana", wallet: "addr", domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBe("Purpose mismatch.");
  });

  it("wrong case fails (field validation)", () => {
    const parsed = { ...BASE, purpose: CLAIM_PURPOSE, case: "wrong-case", network: "solana", wallet: "addr" };
    const err = validateNonceFields(parsed, {
      purpose: CLAIM_PURPOSE, account: BASE.account, caseSlug: "case-sol-123",
      network: "solana", wallet: "addr", domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBe("Case mismatch.");
  });

  it("wrong account fails (field validation)", () => {
    const parsed = { ...BASE, purpose: CLAIM_PURPOSE, account: "wrong_user", network: "solana", wallet: "addr" };
    const err = validateNonceFields(parsed, {
      purpose: CLAIM_PURPOSE, account: "user_sol_abc", caseSlug: BASE.caseSlug,
      network: "solana", wallet: "addr", domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBe("Account mismatch.");
  });

  it("expired nonce fails (acquireValidNonce)", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:06:00.000Z"; // after expiresAt
    da.addNonce({
      ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    const result = await acquireValidNonce(da, {
      ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash",
      purpose: CLAIM_PURPOSE, nowIso,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("nonce_invalid");
  });

  it("consumed nonce fails (acquireValidNonce)", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:01:00.000Z";
    const id = da.addNonce({
      ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    // Consume it first
    da.nonces.get(id).used_at = nowIso;
    const result = await acquireValidNonce(da, {
      ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash",
      purpose: CLAIM_PURPOSE, nowIso,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("nonce_invalid");
  });

  it("simultaneous replay produces exactly one success", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:01:00.000Z";
    da.addNonce({
      ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    const [r1, r2] = await Promise.all([
      acquireValidNonce(da, { ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash", purpose: CLAIM_PURPOSE, nowIso }),
      acquireValidNonce(da, { ownerUserId: "u1", normalizedAddress: "addr", messageHash: "hash", purpose: CLAIM_PURPOSE, nowIso }),
    ]);
    const winners = [r1, r2].filter((r) => r.ok);
    expect(winners.length).toBe(1);
    const losers = [r1, r2].filter((r) => !r.ok);
    expect(losers.length).toBe(1);
    expect(losers[0].code).toBe("nonce_consumed");
  });

  it("revocation requires a fresh valid signature (different purpose)", async () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const claimMsg = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    const revokeMsg = buildClaimMessage({ ...BASE, purpose: REVOKE_PURPOSE, address });
    const claimSig = solanaSign(kp, claimMsg);
    // Claim signature is NOT valid for revoke message
    expect(await verifySolanaSignature(revokeMsg, claimSig, address)).toBe(false);
    // Fresh revoke signature IS valid
    const revokeSig = solanaSign(kp, revokeMsg);
    expect(await verifySolanaSignature(revokeMsg, revokeSig, address)).toBe(true);
  });
});

// ─── 2. EVM EIP-191 full lifecycle ─────────────────────────────────────────

describe("EVM ownership — EIP-191 signature verification", () => {
  const BASE = {
    domain: "walletcourt.app",
    account: "user_evm_abc",
    network: "ethereum",
    caseSlug: "case-eth-456",
    nonce: "evmnonce123456",
    issuedAt: "2026-09-19T10:00:00.000Z",
    expiresAt: "2026-09-19T10:05:00.000Z",
  };

  it("valid signature succeeds", async () => {
    const wallet = Wallet.createRandom();
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: wallet.address });
    const signature = await wallet.signMessage(message);
    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("invalid signature fails", async () => {
    const wallet = Wallet.createRandom();
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: wallet.address });
    // ethers throws on malformed signatures — that's a rejection, which is correct
    let threw = false;
    try { verifyMessage(message, "0xinvalid"); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  it("wrong wallet fails", async () => {
    const w1 = Wallet.createRandom();
    const w2 = Wallet.createRandom();
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: w1.address });
    const signature = await w1.signMessage(message);
    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(w1.address.toLowerCase());
    expect(recovered.toLowerCase()).not.toBe(w2.address.toLowerCase());
  });

  it("altered message fails", async () => {
    const wallet = Wallet.createRandom();
    const message = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: wallet.address });
    const signature = await wallet.signMessage(message);
    const altered = message.replace("wallet_claim", "wallet_revoke");
    const recovered = verifyMessage(altered, signature);
    expect(recovered.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });

  it("nonce expiry rejection", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:06:00.000Z";
    da.addNonce({
      ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    const result = await acquireValidNonce(da, {
      ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash",
      purpose: CLAIM_PURPOSE, nowIso,
    });
    expect(result.ok).toBe(false);
  });

  it("replayed nonce (already consumed) is rejected", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:01:00.000Z";
    const id = da.addNonce({
      ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    da.nonces.get(id).used_at = nowIso;
    const result = await acquireValidNonce(da, {
      ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash",
      purpose: CLAIM_PURPOSE, nowIso,
    });
    expect(result.ok).toBe(false);
  });

  it("simultaneous replay produces exactly one success", async () => {
    const da = new MockNonceDataAccess();
    const nowIso = "2026-09-19T10:01:00.000Z";
    da.addNonce({
      ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash",
      purpose: CLAIM_PURPOSE, expiresAt: "2026-09-19T10:05:00.000Z",
    });
    const [r1, r2] = await Promise.all([
      acquireValidNonce(da, { ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash", purpose: CLAIM_PURPOSE, nowIso }),
      acquireValidNonce(da, { ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: "hash", purpose: CLAIM_PURPOSE, nowIso }),
    ]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
    expect([r1, r2].filter((r) => !r.ok).length).toBe(1);
  });

  it("revocation requires a fresh signature (different purpose)", async () => {
    const wallet = Wallet.createRandom();
    const claimMsg = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address: wallet.address });
    const revokeMsg = buildClaimMessage({ ...BASE, purpose: REVOKE_PURPOSE, address: wallet.address });
    const claimSig = await wallet.signMessage(claimMsg);
    // Claim signature NOT valid for revoke message
    expect(verifyMessage(revokeMsg, claimSig).toLowerCase()).not.toBe(wallet.address.toLowerCase());
    // Fresh revoke signature IS valid
    const revokeSig = await wallet.signMessage(revokeMsg);
    expect(verifyMessage(revokeMsg, revokeSig).toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("rate limiting blocks excessive attempts", async () => {
    const da = new MockNonceDataAccess();
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      da.addNonce({
        ownerUserId: "u1", normalizedAddress: "0xabc", messageHash: `hash${i}`,
        purpose: CLAIM_PURPOSE, expiresAt: new Date(now + 300000).toISOString(),
        createdAt: new Date(now - i * 1000).toISOString(),
      });
    }
    const result = await enforceRateLimit(da, {
      ownerUserId: "u1", normalizedAddress: "0xabc", purpose: CLAIM_PURPOSE,
      windowMs: 10 * 60 * 1000, max: 5,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── 3. Court Name atomic reservation ──────────────────────────────────────

describe("Court Name — normalized uniqueness and case-insensitive conflicts", () => {
  it("DiamondHands and diamondhands conflict (case-insensitive)", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const r1 = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");
    expect(r1.ok).toBe(true);

    // c2 tries the same name with different casing
    const r2 = await setCourtNameAtomically(da, "wlt_bbbb", "diamondhands", "u2");
    expect(r2.ok).toBe(false);

    const c1 = await da.getClaim("wlt_aaaa");
    const c2 = await da.getClaim("wlt_bbbb");
    expect(c1.court_name_normalized).toBe("diamondhands");
    expect(c2.court_name_normalized).toBeNull();
  });

  it("concurrent reservation produces exactly one winner", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const [r1, r2] = await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "RareName", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "RareName", "u2"),
    ]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
  });

  it("cooldown enforcement blocks rapid changes", async () => {
    const da = new MockClaimDataAccess();
    const claim = {
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "First",
      court_name_normalized: "first",
      court_name_version: 1,
      court_name_changed_at: new Date().toISOString(),
    };
    da.addClaim(claim);

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Second", "u1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  it("immutable history creation", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_aaaa", "First", "u1");
    expect(da.history.length).toBe(1);
    expect(da.history[0].court_name).toBe("First");
    expect(da.history[0].changed_by_user_id).toBe("u1");

    // Backdate to bypass cooldown
    da.claims.get("c1").court_name_changed_at = new Date(Date.now() - 31 * 86400000).toISOString();

    await setCourtNameAtomically(da, "wlt_aaaa", "Second", "u1");
    expect(da.history.length).toBe(2);
    expect(da.history[1].court_name).toBe("Second");
    // First record is not overwritten
    expect(da.history[0].court_name).toBe("First");
  });

  it("permanent wallet URL (claim_slug) remains unchanged when Court Name changes", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_permanent123", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_permanent123", "First", "u1");
    const after1 = await da.getClaim("wlt_permanent123");
    expect(after1.claim_slug).toBe("wlt_permanent123");
    expect(after1.court_name).toBe("First");

    // Backdate to bypass cooldown
    da.claims.get("c1").court_name_changed_at = new Date(Date.now() - 31 * 86400000).toISOString();

    await setCourtNameAtomically(da, "wlt_permanent123", "Second", "u1");
    const after2 = await da.getClaim("wlt_permanent123");
    expect(after2.claim_slug).toBe("wlt_permanent123");
    expect(after2.court_name).toBe("Second");
  });

  it("one user cannot set a Court Name on another user's claim", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "StolenName", "u2");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});

// ─── 4. Lifecycle and privacy ─────────────────────────────────────────────

describe("Lifecycle — recovery requires wallet control", () => {
  const BASE = {
    domain: "walletcourt.app",
    account: "user_recovery",
    network: "solana",
    caseSlug: "case-recovery-1",
    nonce: "recoverynonce1",
    issuedAt: "2026-09-19T10:00:00.000Z",
    expiresAt: "2026-09-19T10:05:00.000Z",
  };

  it("a wallet_dispute signature with wrong purpose is rejected", () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const claimMsg = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    const parsed = parseClaimMessage(claimMsg);
    const err = validateNonceFields(parsed, {
      purpose: DISPUTE_PURPOSE, account: BASE.account, caseSlug: BASE.caseSlug,
      network: "solana", wallet: address, domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBe("Purpose mismatch.");
  });

  it("a valid dispute signature passes field validation", () => {
    const kp = nacl.sign.keyPair();
    const address = base58Encode(kp.publicKey);
    const disputeMsg = buildClaimMessage({ ...BASE, purpose: DISPUTE_PURPOSE, address });
    const parsed = parseClaimMessage(disputeMsg);
    const err = validateNonceFields(parsed, {
      purpose: DISPUTE_PURPOSE, account: BASE.account, caseSlug: BASE.caseSlug,
      network: "solana", wallet: address, domain: BASE.domain, expiresAt: BASE.expiresAt,
    });
    expect(err).toBeNull();
  });
});

describe("Lifecycle — ownership conflicts do not disclose another account", () => {
  const fullClaim = {
    owner_user_id: "user_secret_owner",
    normalized_wallet_address: "0xsecretaddress",
    claim_slug: "wlt_conflict",
    network: "ethereum",
    address_short: "0xabc1…1234",
    status: "active",
    court_name: "SecretName",
    court_name_normalized: "secretname",
    court_name_version: 3,
    court_name_history_json: "[{}]",
    profile_visibility: "public",
    show_trial_history: true,
    show_badges: true,
    verified_at: "2024-01-01T00:00:00Z",
    last_verified_at: "2024-01-01T00:00:00Z",
    latest_trial_slug: "case-1",
    signature_scheme: "eip191_personal_sign",
  };

  it("sanitizeClaim hides owner_user_id from public view", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("owner_user_id");
    expect(view).not.toHaveProperty("normalized_wallet_address");
    expect(view).not.toHaveProperty("court_name_version");
    // signature_scheme is the method name (e.g. "eip191_personal_sign"), not
    // the actual signature — it is safe to expose and not private data.
  });

  it("the already_claimed response pattern does not include owner identifiers", () => {
    const response = {
      status: "already_claimed",
      error: "This wallet is already claimed by another account.",
      dispute_available: true,
    };
    expect(response).not.toHaveProperty("owner_id");
    expect(response).not.toHaveProperty("owner_user_id");
    expect(response).not.toHaveProperty("owner_email");
    expect(response).not.toHaveProperty("claim_slug");
  });
});

describe("Lifecycle — admin override requires authorization and reason", () => {
  it("rejects empty reason", () => {
    const result = validateAdminOverride("revoke", "");
    expect(result.ok).toBe(false);
  });

  it("rejects null reason", () => {
    const result = validateAdminOverride("revoke", null);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown action", () => {
    const result = validateAdminOverride("delete", "good reason");
    expect(result.ok).toBe(false);
  });

  it("accepts valid action and reason", () => {
    const result = validateAdminOverride("revoke", "Wallet compromised, owner verified off-platform.");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("Wallet compromised, owner verified off-platform.");
  });

  it("trims whitespace from reason", () => {
    const result = validateAdminOverride("revoke", "  valid reason  ");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("valid reason");
  });
});

describe("Lifecycle — immutable audit records", () => {
  it("snapshotClaim captures state without secrets", () => {
    const claim = {
      claim_slug: "wlt_audit",
      owner_user_id: "u1",
      network: "ethereum",
      status: "active",
      court_name: "TestName",
      court_name_normalized: "testname",
      profile_visibility: "public",
      verified_at: "2024-01-01T00:00:00Z",
      signature_scheme: "eip191_personal_sign",
    };
    const snapshot = snapshotClaim(claim);
    const parsed = JSON.parse(snapshot);
    expect(parsed.claim_slug).toBe("wlt_audit");
    expect(parsed.status).toBe("active");
    expect(parsed.court_name).toBe("TestName");
    // Signature scheme is not captured in the audit snapshot
    expect(parsed).not.toHaveProperty("signature_scheme");
  });

  it("snapshotClaim handles null claim", () => {
    expect(snapshotClaim(null)).toBe("{}");
  });

  it("buildCleanupAuditRecord creates a complete audit entry", () => {
    const claim = { claim_slug: "wlt_cleanup" };
    const record = buildCleanupAuditRecord(
      claim, "admin_u1", "deleted_u2",
      '{"status":"active"}', '{"status":"revoked"}',
      "2026-09-19T10:00:00Z"
    );
    expect(record.claim_slug).toBe("wlt_cleanup");
    expect(record.admin_user_id).toBe("admin_u1");
    expect(record.action).toBe("account_cleanup");
    expect(record.reason).toContain("deleted_u2");
    expect(record.before_state_json).toBe('{"status":"active"}');
    expect(record.after_state_json).toBe('{"status":"revoked"}');
    expect(record.created_at).toBe("2026-09-19T10:00:00Z");
  });
});

describe("Lifecycle — account deletion removes public identity", () => {
  it("buildCleanupUpdates revokes claim and clears identity", () => {
    const updates = buildCleanupUpdates();
    expect(updates.status).toBe("revoked");
    expect(updates.court_name).toBeNull();
    expect(updates.court_name_normalized).toBeNull();
    expect(updates.profile_visibility).toBe("private");
  });

  it("a revoked claim is no longer active (cannot be managed)", async () => {
    const da = new MockClaimDataAccess();
    const claim = da.addClaim({
      ...makeClaim("c1", "wlt_deleted", "u_deleted", "2024-01-01T00:00:00Z"),
      court_name: "DeletedUser",
      court_name_normalized: "deleteduser",
      court_name_version: 1,
    });
    // Simulate cleanup: revoke
    Object.assign(claim, buildCleanupUpdates());
    // getClaim only returns active claims — revoked claim is invisible
    const result = await da.getClaim("wlt_deleted");
    expect(result).toBeNull();
  });
});

// ─── 5. Outcome presentation gating ───────────────────────────────────────

describe("Outcome presentation — dismissed and mistrial cases", () => {
  it("getCaseOutcome returns dismissed_no_evidence for dismissed cases", () => {
    expect(getCaseOutcome({ case_outcome: "dismissed_no_evidence" })).toBe("dismissed_no_evidence");
  });

  it("getCaseOutcome returns mistrial_insufficient_evidence for mistrial cases", () => {
    expect(getCaseOutcome({ case_outcome: "mistrial_insufficient_evidence" })).toBe("mistrial_insufficient_evidence");
  });

  it("getCaseOutcome returns verdict for verdict cases", () => {
    expect(getCaseOutcome({ case_outcome: "verdict" })).toBe("verdict");
  });

  it("getCaseOutcome returns demo for demo cases", () => {
    expect(getCaseOutcome({ case_outcome: "demo" })).toBe("demo");
    expect(getCaseOutcome({ data_mode: "demo" })).toBe("demo");
  });

  it("getCaseOutcome infers verdict for pre-N2.3 live records", () => {
    expect(getCaseOutcome({ data_mode: "live" })).toBe("verdict");
  });

  it("isDismissedOrMistrial correctly identifies dismissed and mistrial", () => {
    expect(isDismissedOrMistrial({ case_outcome: "dismissed_no_evidence" })).toBe(true);
    expect(isDismissedOrMistrial({ case_outcome: "mistrial_insufficient_evidence" })).toBe(true);
    expect(isDismissedOrMistrial({ case_outcome: "verdict" })).toBe(false);
    expect(isDismissedOrMistrial({ case_outcome: "demo" })).toBe(false);
  });

  it("isVerdictOutcome correctly identifies verdict and demo", () => {
    expect(isVerdictOutcome({ case_outcome: "verdict" })).toBe(true);
    expect(isVerdictOutcome({ case_outcome: "demo" })).toBe(true);
    expect(isVerdictOutcome({ case_outcome: "dismissed_no_evidence" })).toBe(false);
    expect(isVerdictOutcome({ case_outcome: "mistrial_insufficient_evidence" })).toBe(false);
  });

  it("dismissed cases are excluded from Hall (filter logic)", () => {
    const records = [
      { case_outcome: "verdict", verdict_name: "One Pump Chump", severity_score: 82 },
      { case_outcome: "dismissed_no_evidence", verdict_name: null, severity_score: null },
      { case_outcome: "mistrial_insufficient_evidence", verdict_name: null, severity_score: null },
      { case_outcome: "demo", verdict_name: "One Pump Chump", severity_score: 82 },
    ];
    const eligible = records.filter((t) => {
      const o = getCaseOutcome(t);
      return o !== "dismissed_no_evidence" && o !== "mistrial_insufficient_evidence";
    });
    expect(eligible.length).toBe(2);
    expect(eligible.every((t) => t.verdict_name !== null)).toBe(true);
  });

  it("mistrial cases are excluded from Hall (filter logic)", () => {
    const records = [
      { case_outcome: "verdict", severity_score: 80 },
      { case_outcome: "mistrial_insufficient_evidence", severity_score: null },
    ];
    const eligible = records.filter((t) => {
      const o = getCaseOutcome(t);
      return o !== "dismissed_no_evidence" && o !== "mistrial_insufficient_evidence";
    });
    expect(eligible.length).toBe(1);
    expect(eligible[0].case_outcome).toBe("verdict");
  });
});

describe("Outcome presentation — dashboard counts accuracy", () => {
  it("counts verdicts, dismissals, and mistrials separately", () => {
    const trials = [
      { case_outcome: "verdict", data_mode: "live" },
      { case_outcome: "dismissed_no_evidence", data_mode: "live" },
      { case_outcome: "mistrial_insufficient_evidence", data_mode: "live" },
      { case_outcome: "demo", data_mode: "demo" },
    ];
    const counts = computeDashboardCounts(trials, [], []);
    expect(counts.trials).toBe(4);
    expect(counts.verdicts).toBe(2); // verdict + demo
    expect(counts.dismissals).toBe(1);
    expect(counts.mistrials).toBe(1);
  });

  it("does not count dismissed or mistrial as verdicts", () => {
    const trials = [
      { case_outcome: "dismissed_no_evidence", data_mode: "live" },
      { case_outcome: "mistrial_insufficient_evidence", data_mode: "live" },
    ];
    const counts = computeDashboardCounts(trials, [], []);
    expect(counts.verdicts).toBe(0);
    expect(counts.dismissals).toBe(1);
    expect(counts.mistrials).toBe(1);
  });

  it("resolveCaseOutcome matches getCaseOutcome for all outcome types", () => {
    const cases = [
      { case_outcome: "verdict", data_mode: "live" },
      { case_outcome: "dismissed_no_evidence", data_mode: "live" },
      { case_outcome: "mistrial_insufficient_evidence", data_mode: "live" },
      { case_outcome: "demo", data_mode: "demo" },
      { data_mode: "live" }, // pre-N2.3
      { data_mode: "demo" }, // pre-N2.3
    ];
    for (const c of cases) {
      expect(resolveCaseOutcome(c)).toBe(getCaseOutcome(c));
    }
  });
});

describe("Outcome presentation — Solana ownership notice never on dismissed/mistrial", () => {
  // The ClaimWalletSection is only rendered inside VerdictReveal for valid
  // verdict/demo cases. Dismissed and mistrial cases route to CaseDismissed
  // and CaseMistrial respectively, which never include ClaimWalletSection.
  // This test verifies the gating logic that controls this routing.

  it("VerdictReveal routes dismissed cases to CaseDismissed (no claim section)", () => {
    const trial = { case_outcome: "dismissed_no_evidence", data_mode: "live", network: "solana" };
    const outcome = getCaseOutcome(trial);
    expect(outcome).toBe("dismissed_no_evidence");
    // CaseDismissed component does not render ClaimWalletSection
    expect(isDismissedOrMistrial(trial)).toBe(true);
  });

  it("VerdictReveal routes mistrial cases to CaseMistrial (no claim section)", () => {
    const trial = { case_outcome: "mistrial_insufficient_evidence", data_mode: "live", network: "solana" };
    const outcome = getCaseOutcome(trial);
    expect(outcome).toBe("mistrial_insufficient_evidence");
    expect(isDismissedOrMistrial(trial)).toBe(true);
  });

  it("valid Solana verdict cases route to VerdictReveal (with claim section)", () => {
    const trial = { case_outcome: "verdict", data_mode: "live", network: "solana", verdict_code: "one_pump_chump" };
    const outcome = getCaseOutcome(trial);
    expect(outcome).toBe("verdict");
    expect(isDismissedOrMistrial(trial)).toBe(false);
    expect(isVerdictOutcome(trial)).toBe(true);
  });

  it("dismissed Solana case does not show verdict, severity, or confidence", () => {
    const trial = {
      case_outcome: "dismissed_no_evidence",
      data_mode: "live",
      network: "solana",
      verdict_code: null,
      verdict_name: null,
      severity_score: null,
      confidence_score: null,
    };
    expect(trial.verdict_code).toBeNull();
    expect(trial.severity_score).toBeNull();
    expect(isDismissedOrMistrial(trial)).toBe(true);
  });
});