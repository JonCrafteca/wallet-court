// EVM EIP-191 signature verification — behavioral tests with real keypairs.
// Signs messages with ethers' Wallet.signMessage (EIP-191 personal_sign) and
// verifies with ethers' verifyMessage, proving the claim flow's crypto works.
import { describe, it, expect } from "vitest";
import { Wallet, verifyMessage } from "ethers";
import {
  buildClaimMessage,
  parseClaimMessage,
  CLAIM_PURPOSE,
  REVOKE_PURPOSE,
} from "../base44/shared/walletClaim.ts";

const BASE = {
  domain: "walletcourt.app",
  account: "user_abc123",
  network: "ethereum",
  caseSlug: "case-eth-1234",
  nonce: "a1b2c3d4e5f6",
  issuedAt: "2026-09-18T14:00:00.000Z",
  expiresAt: "2026-09-18T14:05:00.000Z",
};

function makeMessage(purpose, address) {
  return buildClaimMessage({ ...BASE, purpose, address });
}

describe("evmVerify — real EIP-191 signature verification", () => {
  it("verifies a valid signature", async () => {
    const wallet = Wallet.createRandom();
    const message = makeMessage(CLAIM_PURPOSE, wallet.address);
    const signature = await wallet.signMessage(message);
    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("rejects an invalid signature (tampered message)", async () => {
    const wallet = Wallet.createRandom();
    const message = makeMessage(CLAIM_PURPOSE, wallet.address);
    const signature = await wallet.signMessage(message);
    const recovered = verifyMessage("Tampered message", signature);
    expect(recovered.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });

  it("rejects a signature from a different wallet", async () => {
    const wallet1 = Wallet.createRandom();
    const wallet2 = Wallet.createRandom();
    const message = makeMessage(CLAIM_PURPOSE, wallet1.address);
    const signature = await wallet1.signMessage(message);
    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(wallet1.address.toLowerCase());
    expect(recovered.toLowerCase()).not.toBe(wallet2.address.toLowerCase());
  });

  it("rejects a replayed signature (different message)", async () => {
    const wallet = Wallet.createRandom();
    const message1 = makeMessage(CLAIM_PURPOSE, wallet.address);
    const message2 = makeMessage(REVOKE_PURPOSE, wallet.address);
    const signature = await wallet.signMessage(message1);
    const recovered1 = verifyMessage(message1, signature);
    const recovered2 = verifyMessage(message2, signature);
    expect(recovered1.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(recovered2.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });
});

describe("evmVerify — fresh-signature revocation (behavioral)", () => {
  it("a wallet_claim signature is not valid for the revoke message", async () => {
    const wallet = Wallet.createRandom();
    const claimMessage = makeMessage(CLAIM_PURPOSE, wallet.address);
    const revokeMessage = makeMessage(REVOKE_PURPOSE, wallet.address);

    expect(claimMessage).not.toBe(revokeMessage);

    const claimSignature = await wallet.signMessage(claimMessage);

    // The claim signature is valid for the claim message
    expect(verifyMessage(claimMessage, claimSignature).toLowerCase()).toBe(
      wallet.address.toLowerCase()
    );

    // The claim signature is NOT valid for the revoke message
    const recoveredForRevoke = verifyMessage(revokeMessage, claimSignature);
    expect(recoveredForRevoke.toLowerCase()).not.toBe(wallet.address.toLowerCase());
  });

  it("a wallet_revoke signature is valid for the revoke message", async () => {
    const wallet = Wallet.createRandom();
    const revokeMessage = makeMessage(REVOKE_PURPOSE, wallet.address);
    const revokeSignature = await wallet.signMessage(revokeMessage);

    expect(verifyMessage(revokeMessage, revokeSignature).toLowerCase()).toBe(
      wallet.address.toLowerCase()
    );
  });
});

describe("evmVerify — parsed field extraction", () => {
  it("parseClaimMessage extracts the correct purpose from a signed message", () => {
    const wallet = Wallet.createRandom();
    const claimMessage = makeMessage(CLAIM_PURPOSE, wallet.address);
    const parsed = parseClaimMessage(claimMessage);
    expect(parsed.purpose).toBe(CLAIM_PURPOSE);
    expect(parsed.account).toBe(BASE.account);
    expect(parsed.network).toBe("ethereum");
  });
});