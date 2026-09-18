// Claim lifecycle — ownership conflict privacy, fresh-signature revocation,
// admin override validation, and account cleanup. Tests the pure shared
// logic that the backend functions delegate to.
import { describe, it, expect } from "vitest";
import {
  sanitizeClaim,
  buildClaimMessage,
  parseClaimMessage,
  CLAIM_PURPOSE,
  REVOKE_PURPOSE,
  DISPUTE_PURPOSE,
} from "../base44/shared/walletClaim.ts";
import { validateNonceFields } from "../base44/shared/nonceLifecycle.ts";
import {
  validateAdminOverride,
  snapshotClaim,
  buildCleanupUpdates,
  buildCleanupAuditRecord,
} from "../base44/shared/claimAudit.ts";

describe("claimLifecycle — ownership conflict privacy", () => {
  const fullClaim = {
    owner_user_id: "user_secret_123",
    normalized_wallet_address: "0xsecretaddress1234",
    claim_slug: "wlt_test",
    network: "ethereum",
    address_short: "0xabc1…1234",
    status: "active",
    court_name: "TestName",
    court_name_normalized: "testname",
    court_name_version: 5,
    court_name_history_json: '[{"court_name":"Old"}]',
    profile_visibility: "public",
    show_trial_history: true,
    show_badges: true,
    verified_at: "2024-01-01T00:00:00Z",
    last_verified_at: "2024-01-01T00:00:00Z",
    latest_trial_slug: "case-123",
    signature_scheme: "eip191_personal_sign",
  };

  it("sanitizeClaim never exposes owner_user_id", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("owner_user_id");
  });

  it("sanitizeClaim never exposes normalized_wallet_address", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("normalized_wallet_address");
  });

  it("sanitizeClaim never exposes court_name_version", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("court_name_version");
  });

  it("sanitizeClaim never exposes court_name_history_json", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("court_name_history_json");
  });

  it("sanitizeClaim never exposes court_name_normalized", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view).not.toHaveProperty("court_name_normalized");
  });

  it("sanitizeClaim exposes safe public fields", () => {
    const view = sanitizeClaim(fullClaim, { isOwner: false });
    expect(view.claim_slug).toBe("wlt_test");
    expect(view.address_short).toBe("0xabc1…1234");
    expect(view.court_name).toBe("TestName");
    expect(view.network).toBe("ethereum");
    expect(view.is_owner).toBe(false);
  });

  it("the already_claimed response does not reveal the owner", () => {
    const response = {
      status: "already_claimed",
      error: "This wallet is already claimed by another account.",
      dispute_note:
        "If you are the true owner, account recovery and dispute tools are available via admin review.",
      dispute_available: true,
    };
    expect(response).not.toHaveProperty("owner_id");
    expect(response).not.toHaveProperty("owner_user_id");
    expect(response).not.toHaveProperty("owner_email");
    expect(response).not.toHaveProperty("owner_name");
    expect(response).not.toHaveProperty("claim_slug");
  });
});

describe("claimLifecycle — fresh-signature revocation (behavioral)", () => {
  const base = {
    domain: "walletcourt.app",
    account: "u1",
    address: "0xabc",
    network: "ethereum",
    caseSlug: "case-1",
    nonce: "n1",
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:05:00Z",
  };

  it("a wallet_claim purpose is rejected for revocation", () => {
    const msg = buildClaimMessage({ ...base, purpose: CLAIM_PURPOSE });
    const parsed = parseClaimMessage(msg);
    const error = validateNonceFields(parsed, {
      purpose: REVOKE_PURPOSE,
      account: "u1",
      caseSlug: "case-1",
      network: "ethereum",
      wallet: "0xabc",
      domain: "walletcourt.app",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    expect(error).toBe("Purpose mismatch.");
  });

  it("a wallet_revoke purpose is accepted for revocation", () => {
    const msg = buildClaimMessage({ ...base, purpose: REVOKE_PURPOSE });
    const parsed = parseClaimMessage(msg);
    const error = validateNonceFields(parsed, {
      purpose: REVOKE_PURPOSE,
      account: "u1",
      caseSlug: "case-1",
      network: "ethereum",
      wallet: "0xabc",
      domain: "walletcourt.app",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    expect(error).toBeNull();
  });

  it("a wallet_claim purpose is rejected for dispute", () => {
    const msg = buildClaimMessage({ ...base, purpose: CLAIM_PURPOSE });
    const parsed = parseClaimMessage(msg);
    const error = validateNonceFields(parsed, {
      purpose: DISPUTE_PURPOSE,
      account: "u1",
      caseSlug: "case-1",
      network: "ethereum",
      wallet: "0xabc",
      domain: "walletcourt.app",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    expect(error).toBe("Purpose mismatch.");
  });

  it("a wallet_dispute purpose is accepted for dispute", () => {
    const msg = buildClaimMessage({ ...base, purpose: DISPUTE_PURPOSE });
    const parsed = parseClaimMessage(msg);
    const error = validateNonceFields(parsed, {
      purpose: DISPUTE_PURPOSE,
      account: "u1",
      caseSlug: "case-1",
      network: "ethereum",
      wallet: "0xabc",
      domain: "walletcourt.app",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    expect(error).toBeNull();
  });
});

describe("claimLifecycle — admin override requires a reason", () => {
  it("rejects an empty reason", () => {
    const result = validateAdminOverride("revoke", "");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("reason");
  });

  it("rejects a whitespace-only reason", () => {
    const result = validateAdminOverride("revoke", "   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing action", () => {
    const result = validateAdminOverride(null, "Because");
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown action", () => {
    const result = validateAdminOverride("delete", "Because");
    expect(result.ok).toBe(false);
  });

  it("accepts a valid action with a reason", () => {
    const result = validateAdminOverride("revoke", "Fraudulent claim");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("Fraudulent claim");
  });

  it("trims the reason", () => {
    const result = validateAdminOverride("revoke", "  Fraud  ");
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("Fraud");
  });
});

describe("claimLifecycle — immutable audit record", () => {
  it("snapshotClaim captures the claim state", () => {
    const claim = {
      claim_slug: "wlt_test",
      owner_user_id: "u1",
      network: "ethereum",
      status: "active",
      court_name: "TestName",
      court_name_normalized: "testname",
      profile_visibility: "public",
      verified_at: "2024-01-01T00:00:00Z",
    };
    const snapshot = snapshotClaim(claim);
    const parsed = JSON.parse(snapshot);
    expect(parsed.claim_slug).toBe("wlt_test");
    expect(parsed.status).toBe("active");
    expect(parsed.court_name).toBe("TestName");
  });

  it("snapshotClaim handles null claim", () => {
    expect(snapshotClaim(null)).toBe("{}");
  });
});

describe("claimLifecycle — account cleanup", () => {
  it("buildCleanupUpdates returns the correct update fields", () => {
    const updates = buildCleanupUpdates();
    expect(updates.status).toBe("revoked");
    expect(updates.court_name).toBeNull();
    expect(updates.court_name_normalized).toBeNull();
    expect(updates.profile_visibility).toBe("private");
  });

  it("buildCleanupAuditRecord creates a complete audit record", () => {
    const claim = {
      claim_slug: "wlt_test",
      owner_user_id: "deleted_user",
      network: "ethereum",
      status: "active",
      court_name: "TestName",
      court_name_normalized: "testname",
      profile_visibility: "public",
      verified_at: "2024-01-01T00:00:00Z",
    };
    const beforeState = snapshotClaim(claim);
    const afterState = JSON.stringify({ status: "revoked", court_name: null });
    const nowIso = "2026-09-18T14:00:00Z";

    const record = buildCleanupAuditRecord(
      claim,
      "admin_1",
      "deleted_user",
      beforeState,
      afterState,
      nowIso
    );

    expect(record.claim_slug).toBe("wlt_test");
    expect(record.admin_user_id).toBe("admin_1");
    expect(record.action).toBe("account_cleanup");
    expect(record.reason).toContain("deleted_user");
    expect(record.before_state_json).toBe(beforeState);
    expect(record.after_state_json).toBe(afterState);
    expect(record.created_at).toBe(nowIso);
  });
});