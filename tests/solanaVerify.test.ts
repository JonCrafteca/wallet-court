// Solana Ed25519 signature verification — behavioral tests with real keypairs.
// Signs messages with tweetnacl's Ed25519 implementation and verifies with
// crypto.subtle (Web Crypto API), proving cross-implementation compatibility.
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import {
  verifySolanaSignature,
  base58Encode,
  base58Decode,
} from "../base44/shared/solanaVerify.ts";
import {
  buildClaimMessage,
  CLAIM_PURPOSE,
  REVOKE_PURPOSE,
} from "../base44/shared/walletClaim.ts";

function signMessage(keypair, message) {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return base58Encode(signature);
}

describe("solanaVerify — real Ed25519 signature verification", () => {
  it("verifies a valid signature", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);
    const message = "Wallet Court\nPurpose: wallet_claim";
    const signatureBase58 = signMessage(keypair, message);

    const isValid = await verifySolanaSignature(message, signatureBase58, publicKey);
    expect(isValid).toBe(true);
  });

  it("rejects an invalid signature (tampered message)", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);
    const signatureBase58 = signMessage(keypair, "Original message");

    const isValid = await verifySolanaSignature("Tampered message", signatureBase58, publicKey);
    expect(isValid).toBe(false);
  });

  it("rejects a signature from a different wallet (wrong public key)", async () => {
    const keypair1 = nacl.sign.keyPair();
    const keypair2 = nacl.sign.keyPair();
    const message = "Test message";
    const signatureBase58 = signMessage(keypair1, message);
    const wrongPublicKey = base58Encode(keypair2.publicKey);

    const isValid = await verifySolanaSignature(message, signatureBase58, wrongPublicKey);
    expect(isValid).toBe(false);
  });

  it("rejects a replayed signature (different message)", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);
    const signatureBase58 = signMessage(keypair, "Message 1");

    const isValid = await verifySolanaSignature("Message 2", signatureBase58, publicKey);
    expect(isValid).toBe(false);
  });

  it("rejects a malformed signature", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);

    const isValid = await verifySolanaSignature("message", "invalid-signature", publicKey);
    expect(isValid).toBe(false);
  });

  it("rejects a malformed public key", async () => {
    const keypair = nacl.sign.keyPair();
    const message = "Test message";
    const signatureBase58 = signMessage(keypair, message);

    const isValid = await verifySolanaSignature(message, signatureBase58, "invalid-public-key");
    expect(isValid).toBe(false);
  });

  it("rejects empty inputs", async () => {
    expect(await verifySolanaSignature("", "sig", "key")).toBe(false);
    expect(await verifySolanaSignature("msg", "", "key")).toBe(false);
    expect(await verifySolanaSignature("msg", "sig", "")).toBe(false);
  });
});

describe("solanaVerify — base58 round-trip", () => {
  it("decodes and encodes a 32-byte public key", () => {
    const keypair = nacl.sign.keyPair();
    const encoded = base58Encode(keypair.publicKey);
    const decoded = base58Decode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.length).toBe(32);
    expect(Array.from(decoded)).toEqual(Array.from(keypair.publicKey));
  });

  it("decodes and encodes a 64-byte signature", () => {
    const keypair = nacl.sign.keyPair();
    const signature = nacl.sign.detached(
      new TextEncoder().encode("Test"),
      keypair.secretKey
    );
    const encoded = base58Encode(signature);
    const decoded = base58Decode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.length).toBe(64);
    expect(Array.from(decoded)).toEqual(Array.from(signature));
  });

  it("rejects invalid base58 characters (0, O, I, l)", () => {
    expect(base58Decode("0OIl")).toBeNull();
  });
});

describe("solanaVerify — fresh-signature revocation (behavioral)", () => {
  const BASE = {
    domain: "walletcourt.app",
    account: "user_abc",
    network: "solana",
    caseSlug: "case-sol-123",
    nonce: "a1b2c3d4e5f6",
    issuedAt: "2026-09-18T14:00:00.000Z",
    expiresAt: "2026-09-18T14:05:00.000Z",
  };

  it("a wallet_claim signature is not valid for the revoke message", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);
    const address = publicKey;

    const claimMessage = buildClaimMessage({ ...BASE, purpose: CLAIM_PURPOSE, address });
    const revokeMessage = buildClaimMessage({ ...BASE, purpose: REVOKE_PURPOSE, address });

    // Messages are different (different purpose)
    expect(claimMessage).not.toBe(revokeMessage);

    const claimSignature = signMessage(keypair, claimMessage);

    // The claim signature is valid for the claim message
    expect(await verifySolanaSignature(claimMessage, claimSignature, publicKey)).toBe(true);

    // The claim signature is NOT valid for the revoke message
    expect(await verifySolanaSignature(revokeMessage, claimSignature, publicKey)).toBe(false);
  });

  it("a wallet_revoke signature is valid for the revoke message", async () => {
    const keypair = nacl.sign.keyPair();
    const publicKey = base58Encode(keypair.publicKey);
    const address = publicKey;

    const revokeMessage = buildClaimMessage({ ...BASE, purpose: REVOKE_PURPOSE, address });
    const revokeSignature = signMessage(keypair, revokeMessage);

    expect(await verifySolanaSignature(revokeMessage, revokeSignature, publicKey)).toBe(true);
  });
});