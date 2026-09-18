// Claim message replay protection tests (Phase N3). Pure: imports only
// walletClaim.ts. Verifies that the signing challenge binds every required
// field (purpose, domain, account, wallet, network, case, nonce, issued,
// expires) so a signature cannot be replayed for a different account, wallet,
// network, case, domain, or purpose.
import { describe, it, expect } from "vitest";
import {
  buildClaimMessage, parseClaimMessage, newClaimSlug,
  CLAIM_PURPOSE, REVOKE_PURPOSE
} from "../base44/shared/walletClaim.ts";

const BASE = {
  purpose: CLAIM_PURPOSE,
  domain: "walletcourt.app",
  account: "user_abc123",
  address: "0x71c000000000000000000000000000000000c4f1",
  network: "ethereum",
  caseSlug: "case-abcd1234",
  nonce: "a1b2c3d4e5f6",
  issuedAt: "2026-09-18T14:00:00.000Z",
  expiresAt: "2026-09-18T14:05:00.000Z"
};

function build(overrides = {}) {
  return buildClaimMessage({ ...BASE, ...overrides });
}

describe("claimMessage — contains all required fields", () => {
  const msg = build();
  it("contains purpose", () => expect(msg).toContain("Purpose: wallet_claim"));
  it("contains domain", () => expect(msg).toContain("Domain: walletcourt.app"));
  it("contains account", () => expect(msg).toContain(`Account: ${BASE.account}`));
  it("contains wallet address", () => expect(msg).toContain(`Wallet: ${BASE.address}`));
  it("contains network", () => expect(msg).toContain("Network: ethereum"));
  it("contains case slug", () => expect(msg).toContain(`Case: ${BASE.caseSlug}`));
  it("contains nonce", () => expect(msg).toContain(`Nonce: ${BASE.nonce}`));
  it("contains issued timestamp", () => expect(msg).toContain(`Issued: ${BASE.issuedAt}`));
  it("contains expiration timestamp", () => expect(msg).toContain(`Expires: ${BASE.expiresAt}`));
  it("contains the no-transactions statement", () => expect(msg).toContain("does not authorize transactions"));
});

describe("claimMessage — parseClaimMessage extracts all fields", () => {
  const msg = build();
  const parsed = parseClaimMessage(msg);
  it("extracts purpose", () => expect(parsed.purpose).toBe(CLAIM_PURPOSE));
  it("extracts domain", () => expect(parsed.domain).toBe(BASE.domain));
  it("extracts account", () => expect(parsed.account).toBe(BASE.account));
  it("extracts wallet", () => expect(parsed.wallet).toBe(BASE.address));
  it("extracts network", () => expect(parsed.network).toBe(BASE.network));
  it("extracts case", () => expect(parsed.case).toBe(BASE.caseSlug));
  it("extracts nonce", () => expect(parsed.nonce).toBe(BASE.nonce));
  it("extracts issued", () => expect(parsed.issued).toBe(BASE.issuedAt));
  it("extracts expires", () => expect(parsed.expires).toBe(BASE.expiresAt));
});

describe("claimMessage — cross-purpose replay protection", () => {
  it("a wallet_claim message differs from a wallet_revoke message", () => {
    const claimMsg = build({ purpose: CLAIM_PURPOSE });
    const revokeMsg = build({ purpose: REVOKE_PURPOSE });
    expect(claimMsg).not.toBe(revokeMsg);
  });
  it("parseClaimMessage extracts the correct purpose", () => {
    expect(parseClaimMessage(build({ purpose: CLAIM_PURPOSE })).purpose).toBe(CLAIM_PURPOSE);
    expect(parseClaimMessage(build({ purpose: REVOKE_PURPOSE })).purpose).toBe(REVOKE_PURPOSE);
  });
});

describe("claimMessage — cross-account replay protection", () => {
  it("changing the account changes the message", () => {
    const msgA = build({ account: "user_A" });
    const msgB = build({ account: "user_B" });
    expect(msgA).not.toBe(msgB);
  });
  it("parseClaimMessage extracts the correct account", () => {
    const parsed = parseClaimMessage(build({ account: "user_xyz" }));
    expect(parsed.account).toBe("user_xyz");
  });
});

describe("claimMessage — cross-wallet replay protection", () => {
  it("changing the wallet address changes the message", () => {
    const msgA = build({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const msgB = build({ address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(msgA).not.toBe(msgB);
  });
});

describe("claimMessage — cross-network replay protection", () => {
  it("changing the network changes the message", () => {
    const msgEth = build({ network: "ethereum" });
    const msgBase = build({ network: "base" });
    expect(msgEth).not.toBe(msgBase);
  });
});

describe("claimMessage — cross-case replay protection", () => {
  it("changing the case slug changes the message", () => {
    const msgA = build({ caseSlug: "case-aaaa1111" });
    const msgB = build({ caseSlug: "case-bbbb2222" });
    expect(msgA).not.toBe(msgB);
  });
});

describe("claimMessage — cross-domain replay protection", () => {
  it("changing the domain changes the message", () => {
    const msgA = build({ domain: "walletcourt.app" });
    const msgB = build({ domain: "court.shoutit.world" });
    expect(msgA).not.toBe(msgB);
  });
});

describe("claimMessage — nonce uniqueness", () => {
  it("changing the nonce changes the message", () => {
    const msgA = build({ nonce: "nonce_aaa" });
    const msgB = build({ nonce: "nonce_bbb" });
    expect(msgA).not.toBe(msgB);
  });
});

describe("claimMessage — expiration binding", () => {
  it("changing the expiration changes the message", () => {
    const msgA = build({ expiresAt: "2026-09-18T14:05:00.000Z" });
    const msgB = build({ expiresAt: "2026-09-18T14:10:00.000Z" });
    expect(msgA).not.toBe(msgB);
  });
});

describe("claimMessage — no transaction or approval requested", () => {
  it("the message text explicitly states no transactions", () => {
    const msg = build();
    expect(msg).toContain("does not authorize transactions");
    expect(msg).toContain("does not authorize");
    // The statement explicitly says it does NOT authorize approvals/transfers —
    // it does not request them. Verify the negation is present.
    expect(msg.toLowerCase()).toContain("does not authorize");
    expect(msg.toLowerCase()).not.toContain("seed phrase");
    expect(msg.toLowerCase()).not.toContain("private key");
    expect(msg.toLowerCase()).not.toContain("send usdc");
    expect(msg.toLowerCase()).not.toContain("send eth");
  });
});

describe("claimMessage — permanent wallet slug format", () => {
  it("newClaimSlug starts with wlt_", () => {
    expect(newClaimSlug()).toMatch(/^wlt_/);
  });
  it("newClaimSlug has 24 hex characters after the prefix", () => {
    const slug = newClaimSlug();
    const hex = slug.slice(4);
    expect(hex.length).toBe(24);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
  it("newClaimSlug is cryptographically random (two calls differ)", () => {
    const a = newClaimSlug();
    const b = newClaimSlug();
    expect(a).not.toBe(b);
  });
  it("newClaimSlug is never derived from an address", () => {
    const slug = newClaimSlug();
    const addr = "0x71c000000000000000000000000000000000c4f1";
    expect(slug).not.toContain(addr);
    expect(slug).not.toContain(addr.slice(2, 8));
  });
});

describe("claimMessage — parseClaimMessage edge cases", () => {
  it("returns empty object for null message", () => {
    expect(parseClaimMessage(null)).toEqual({});
  });
  it("returns empty object for empty message", () => {
    expect(parseClaimMessage("")).toEqual({});
  });
  it("ignores unknown keys", () => {
    const msg = "Unknown: value\nPurpose: wallet_claim";
    const parsed = parseClaimMessage(msg);
    expect(parsed.purpose).toBe("wallet_claim");
    expect(parsed).not.toHaveProperty("unknown");
  });
});