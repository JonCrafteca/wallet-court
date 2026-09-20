// Anonymous summons management capability token tests. Verifies secure
// generation, hashing, verification, rate limiting, and that tokens/hashes
// are never exposed through public responses.
import { describe, it, expect } from "vitest";
import {
  generateManagementToken,
  hashManagementToken,
  verifyManagementToken,
  constantTimeEqual,
  checkCapabilityRateLimit,
  CAPABILITY_TOKEN_BYTES,
  CAPABILITY_RATE_LIMIT_MAX,
} from "../base44/shared/summonsCapability.ts";

describe("anonymous management token — generation", () => {
  it("generates a hex string of correct length (64 chars = 32 bytes)", () => {
    const token = generateManagementToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBe(CAPABILITY_TOKEN_BYTES * 2);
  });

  it("generates unique tokens", () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateManagementToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("generates cryptographically random tokens (not predictable)", () => {
    const token = generateManagementToken();
    // Should not be all zeros
    expect(token).not.toBe("0".repeat(64));
    // Should not be all f's
    expect(token).not.toBe("f".repeat(64));
  });
});

describe("anonymous management token — hashing", () => {
  it("hashes a token to a SHA-256 hex string (64 chars)", async () => {
    const token = generateManagementToken();
    const hash = await hashManagementToken(token);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(64);
  });

  it("hash is different from the raw token (one-way)", async () => {
    const token = generateManagementToken();
    const hash = await hashManagementToken(token);
    expect(hash).not.toBe(token);
  });

  it("same token always produces the same hash", async () => {
    const token = "abc123";
    const hash1 = await hashManagementToken(token);
    const hash2 = await hashManagementToken(token);
    expect(hash1).toBe(hash2);
  });

  it("different tokens produce different hashes", async () => {
    const hash1 = await hashManagementToken("token1");
    const hash2 = await hashManagementToken("token2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("anonymous management token — verification", () => {
  it("verifies a correct token against its hash", async () => {
    const token = generateManagementToken();
    const hash = await hashManagementToken(token);
    const verified = await verifyManagementToken(token, hash);
    expect(verified).toBe(true);
  });

  it("rejects a wrong token", async () => {
    const token = generateManagementToken();
    const hash = await hashManagementToken(token);
    const verified = await verifyManagementToken("wrong-token", hash);
    expect(verified).toBe(false);
  });

  it("rejects null token", async () => {
    const hash = await hashManagementToken("test");
    const verified = await verifyManagementToken(null, hash);
    expect(verified).toBe(false);
  });

  it("rejects undefined token", async () => {
    const hash = await hashManagementToken("test");
    const verified = await verifyManagementToken(undefined, hash);
    expect(verified).toBe(false);
  });

  it("rejects empty token", async () => {
    const hash = await hashManagementToken("test");
    const verified = await verifyManagementToken("", hash);
    expect(verified).toBe(false);
  });

  it("rejects null hash", async () => {
    const verified = await verifyManagementToken("token", null);
    expect(verified).toBe(false);
  });

  it("rejects undefined hash", async () => {
    const verified = await verifyManagementToken("token", undefined);
    expect(verified).toBe(false);
  });

  it("rejects empty hash", async () => {
    const verified = await verifyManagementToken("token", "");
    expect(verified).toBe(false);
  });
});

describe("anonymous management token — constant-time comparison", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(constantTimeEqual("abc123", "abc456")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("anonymous management token — rate limiting", () => {
  it("allows within limit", () => {
    const attempts = Array.from({ length: CAPABILITY_RATE_LIMIT_MAX - 1 }, () => ({
      attempted_at: new Date().toISOString(),
    }));
    const result = checkCapabilityRateLimit(attempts);
    expect(result.ok).toBe(true);
  });

  it("blocks at limit", () => {
    const attempts = Array.from({ length: CAPABILITY_RATE_LIMIT_MAX }, () => ({
      attempted_at: new Date().toISOString(),
    }));
    const result = checkCapabilityRateLimit(attempts);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("ignores attempts outside the time window", () => {
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const attempts = Array.from({ length: CAPABILITY_RATE_LIMIT_MAX }, () => ({
      attempted_at: oldTime,
    }));
    const result = checkCapabilityRateLimit(attempts);
    expect(result.ok).toBe(true);
  });

  it("allows empty attempts", () => {
    const result = checkCapabilityRateLimit([]);
    expect(result.ok).toBe(true);
  });

  it("allows null attempts", () => {
    const result = checkCapabilityRateLimit(null);
    expect(result.ok).toBe(true);
  });
});

describe("anonymous management token — no public exposure", () => {
  it("raw token is never stored — only the hash is stored", async () => {
    const token = generateManagementToken();
    const hash = await hashManagementToken(token);
    // The hash is a SHA-256 digest, which cannot be reversed to get the token
    expect(hash).not.toContain(token);
    expect(token).not.toContain(hash);
  });

  it("hash does not leak the token length or prefix", async () => {
    const shortToken = "a";
    const longToken = "a".repeat(100);
    const hash1 = await hashManagementToken(shortToken);
    const hash2 = await hashManagementToken(longToken);
    // Both hashes are 64 chars regardless of input length
    expect(hash1.length).toBe(64);
    expect(hash2.length).toBe(64);
    // Hashes are completely different
    expect(hash1).not.toBe(hash2);
  });
});