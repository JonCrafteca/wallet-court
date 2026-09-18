// Nonce lifecycle — behavioral tests: expiry, atomic one-time consumption,
// replay rejection, rate limits, concurrent consumption. Uses a mock
// NonceDataAccess that simulates CAS semantics (synchronous casConsumeNonce).
import { describe, it, expect } from "vitest";
import {
  acquireValidNonce,
  enforceRateLimit,
  validateNonceFields,
} from "../base44/shared/nonceLifecycle.ts";
import {
  CLAIM_PURPOSE,
  REVOKE_PURPOSE,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
} from "../base44/shared/walletClaim.ts";

class MockNonceDataAccess {
  nonces = new Map();
  counter = 0;

  async findValidNonce(params) {
    for (const nonce of this.nonces.values()) {
      if (
        nonce.owner_user_id === params.ownerUserId &&
        nonce.normalized_wallet_address === params.normalizedAddress &&
        nonce.message_hash === params.messageHash &&
        nonce.purpose === params.purpose &&
        nonce.used_at === null &&
        new Date(nonce.expires_at).getTime() >= new Date(params.nowIso).getTime()
      ) {
        return { ...nonce };
      }
    }
    return null;
  }

  // Synchronous check-and-set — atomic, no interleaving.
  async casConsumeNonce(id, nowIso) {
    const nonce = this.nonces.get(id);
    if (!nonce) return { consumed: false };
    if (nonce.used_at !== null) return { consumed: false };
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
        new Date(nonce.created_at).getTime() >= new Date(params.sinceIso).getTime()
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

  addNonce(nonce) {
    const id = nonce.id || `nonce_${++this.counter}`;
    nonce.id = id;
    this.nonces.set(id, nonce);
    return id;
  }
}

describe("nonceLifecycle — nonce expiry", () => {
  it("rejects an expired nonce", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date(Date.now() - 2000).toISOString(),
    });

    const result = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      messageHash: "hash123",
      purpose: CLAIM_PURPOSE,
      nowIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("nonce_invalid");
  });

  it("accepts a non-expired nonce", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const result = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      messageHash: "hash123",
      purpose: CLAIM_PURPOSE,
      nowIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(result.nonce).toBeDefined();
  });
});

describe("nonceLifecycle — atomic one-time consumption", () => {
  it("a consumed nonce cannot be reused", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const nowIso = new Date().toISOString();
    const r1 = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      messageHash: "hash123",
      purpose: CLAIM_PURPOSE,
      nowIso,
    });
    expect(r1.ok).toBe(true);

    const r2 = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      messageHash: "hash123",
      purpose: CLAIM_PURPOSE,
      nowIso,
    });
    expect(r2.ok).toBe(false);
  });

  it("concurrent consumption of the same nonce produces exactly one winner", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      id: "shared_nonce",
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const nowIso = new Date().toISOString();
    const [r1, r2] = await Promise.all([
      acquireValidNonce(da, {
        ownerUserId: "u1",
        normalizedAddress: "0xabc",
        messageHash: "hash123",
        purpose: CLAIM_PURPOSE,
        nowIso,
      }),
      acquireValidNonce(da, {
        ownerUserId: "u1",
        normalizedAddress: "0xabc",
        messageHash: "hash123",
        purpose: CLAIM_PURPOSE,
        nowIso,
      }),
    ]);

    const winners = [r1, r2].filter((r) => r.ok);
    expect(winners.length).toBe(1);
  });
});

describe("nonceLifecycle — replay rejection", () => {
  it("rejects a nonce with the wrong purpose", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const result = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      messageHash: "hash123",
      purpose: REVOKE_PURPOSE,
      nowIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a nonce with the wrong wallet address", async () => {
    const da = new MockNonceDataAccess();
    da.addNonce({
      owner_user_id: "u1",
      normalized_wallet_address: "0xabc",
      message_hash: "hash123",
      purpose: CLAIM_PURPOSE,
      used_at: null,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const result = await acquireValidNonce(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xwrong",
      messageHash: "hash123",
      purpose: CLAIM_PURPOSE,
      nowIso: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
  });
});

describe("nonceLifecycle — rate limiting", () => {
  it("allows requests under the limit", async () => {
    const da = new MockNonceDataAccess();
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
      da.addNonce({
        owner_user_id: "u1",
        normalized_wallet_address: "0xabc",
        purpose: CLAIM_PURPOSE,
        created_at: new Date().toISOString(),
      });
    }

    const result = await enforceRateLimit(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      purpose: CLAIM_PURPOSE,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });

    expect(result.ok).toBe(true);
  });

  it("blocks requests at the limit", async () => {
    const da = new MockNonceDataAccess();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      da.addNonce({
        owner_user_id: "u1",
        normalized_wallet_address: "0xabc",
        purpose: CLAIM_PURPOSE,
        created_at: new Date().toISOString(),
      });
    }

    const result = await enforceRateLimit(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      purpose: CLAIM_PURPOSE,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Too many");
  });

  it("does not count nonces outside the window", async () => {
    const da = new MockNonceDataAccess();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      da.addNonce({
        owner_user_id: "u1",
        normalized_wallet_address: "0xabc",
        purpose: CLAIM_PURPOSE,
        created_at: new Date(Date.now() - RATE_LIMIT_WINDOW_MS - 1000).toISOString(),
      });
    }

    const result = await enforceRateLimit(da, {
      ownerUserId: "u1",
      normalizedAddress: "0xabc",
      purpose: CLAIM_PURPOSE,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });

    expect(result.ok).toBe(true);
  });
});

describe("nonceLifecycle — validateNonceFields", () => {
  const expected = {
    purpose: CLAIM_PURPOSE,
    account: "user_abc",
    caseSlug: "case-123",
    network: "ethereum",
    wallet: "0xabc",
    domain: "walletcourt.app",
    expiresAt: "2026-09-18T14:05:00.000Z",
  };

  function makeParsed(overrides = {}) {
    return {
      purpose: expected.purpose,
      account: expected.account,
      case: expected.caseSlug,
      network: expected.network,
      wallet: expected.wallet,
      domain: expected.domain,
      expires: expected.expiresAt,
      ...overrides,
    };
  }

  it("returns null when all fields match", () => {
    expect(validateNonceFields(makeParsed(), expected)).toBeNull();
  });

  it("returns an error for purpose mismatch", () => {
    expect(validateNonceFields(makeParsed({ purpose: REVOKE_PURPOSE }), expected)).toBe(
      "Purpose mismatch."
    );
  });

  it("returns an error for account mismatch", () => {
    expect(validateNonceFields(makeParsed({ account: "wrong" }), expected)).toBe(
      "Account mismatch."
    );
  });

  it("returns an error for case mismatch", () => {
    expect(validateNonceFields(makeParsed({ case: "wrong-case" }), expected)).toBe(
      "Case mismatch."
    );
  });

  it("returns an error for network mismatch", () => {
    expect(validateNonceFields(makeParsed({ network: "solana" }), expected)).toBe(
      "Network mismatch."
    );
  });

  it("returns an error for wallet mismatch", () => {
    expect(validateNonceFields(makeParsed({ wallet: "0xwrong" }), expected)).toBe(
      "Wallet mismatch."
    );
  });

  it("returns an error for domain mismatch", () => {
    expect(validateNonceFields(makeParsed({ domain: "wrong.com" }), expected)).toBe(
      "Domain mismatch."
    );
  });

  it("returns an error for expires mismatch", () => {
    expect(validateNonceFields(makeParsed({ expires: "2026-01-01T00:00:00Z" }), expected)).toBe(
      "Message expired."
    );
  });
});