// Account dashboard — sanitization privacy, outcome classification, count
// accuracy, and defense status display. Tests the pure shared logic that the
// getAccountDashboard backend function delegates to.
import { describe, it, expect } from "vitest";
import {
  sanitizeTrialForAccount,
  sanitizeClaimForAccount,
  sanitizeDefenseForAccount,
  computeDashboardCounts,
  resolveCaseOutcome
} from "../base44/shared/accountDashboard.ts";

describe("accountDashboard — trial sanitization privacy", () => {
  const fullTrial = {
    public_slug: "case-abc123",
    wallet_address: "0xFullWalletAddress1234567890abcdef",
    normalized_wallet_address: "0xfullwalletaddress1234567890abcdef",
    network: "ethereum",
    data_mode: "live",
    case_outcome: "verdict",
    verdict_code: "one_pump_chump",
    verdict_name: "One Pump Chump",
    severity_score: 72,
    confidence_score: 85,
    headline: "Bought the top",
    analyzed_at: "2024-01-01T00:00:00Z",
    created_date: "2024-01-01T00:00:00Z",
    rescore_audit_json: '{"internal":"audit"}',
    submitted_by_user_id: "user_secret_123",
    metrics_json: '{"_meta":{}}',
    evidence_items_json: "[]",
    source_endpoints_json: "[]"
  };

  it("never exposes wallet_address", () => {
    expect(sanitizeTrialForAccount(fullTrial)).not.toHaveProperty("wallet_address");
  });

  it("never exposes normalized_wallet_address", () => {
    expect(sanitizeTrialForAccount(fullTrial)).not.toHaveProperty("normalized_wallet_address");
  });

  it("never exposes submitted_by_user_id", () => {
    expect(sanitizeTrialForAccount(fullTrial)).not.toHaveProperty("submitted_by_user_id");
  });

  it("never exposes rescore_audit_json", () => {
    expect(sanitizeTrialForAccount(fullTrial)).not.toHaveProperty("rescore_audit_json");
  });

  it("never exposes metrics_json, evidence_items_json, or source_endpoints_json", () => {
    const view = sanitizeTrialForAccount(fullTrial);
    expect(view).not.toHaveProperty("metrics_json");
    expect(view).not.toHaveProperty("evidence_items_json");
    expect(view).not.toHaveProperty("source_endpoints_json");
  });

  it("includes address_short, not the full address", () => {
    const view = sanitizeTrialForAccount(fullTrial);
    expect(view.address_short).toBeTruthy();
    expect(view.address_short).not.toContain(fullTrial.normalized_wallet_address);
  });

  it("includes public_slug for the permanent case link", () => {
    expect(sanitizeTrialForAccount(fullTrial).public_slug).toBe("case-abc123");
  });

  it("includes severity_score for verdicts", () => {
    expect(sanitizeTrialForAccount(fullTrial).severity_score).toBe(72);
  });

  it("severity_score is null for dismissals", () => {
    const view = sanitizeTrialForAccount({ ...fullTrial, case_outcome: "dismissed_no_evidence", severity_score: null });
    expect(view.severity_score).toBeNull();
  });
});

describe("accountDashboard — claim sanitization privacy", () => {
  const fullClaim = {
    claim_slug: "wlt_abc123def456ghi789",
    owner_user_id: "user_secret_456",
    normalized_wallet_address: "0xsecretclaimaddress1234567",
    network: "ethereum",
    address_short: "0xabc1…1234",
    court_name: "DiamondHands",
    court_name_normalized: "diamondhands",
    court_name_version: 3,
    court_name_history_json: '[{"court_name":"Old"}]',
    court_name_changed_at: "2024-01-01T00:00:00Z",
    profile_visibility: "public",
    status: "active",
    verified_at: "2024-01-01T00:00:00Z",
    last_verified_at: "2024-01-02T00:00:00Z",
    latest_trial_slug: "case-xyz",
    signature_scheme: "eip191_personal_sign",
    public_alias: "oldalias"
  };

  it("never exposes owner_user_id", () => {
    expect(sanitizeClaimForAccount(fullClaim)).not.toHaveProperty("owner_user_id");
  });

  it("never exposes normalized_wallet_address", () => {
    expect(sanitizeClaimForAccount(fullClaim)).not.toHaveProperty("normalized_wallet_address");
  });

  it("never exposes court_name_version or court_name_history_json", () => {
    const view = sanitizeClaimForAccount(fullClaim);
    expect(view).not.toHaveProperty("court_name_version");
    expect(view).not.toHaveProperty("court_name_history_json");
  });

  it("never exposes signature_scheme", () => {
    expect(sanitizeClaimForAccount(fullClaim)).not.toHaveProperty("signature_scheme");
  });

  it("never exposes public_alias", () => {
    expect(sanitizeClaimForAccount(fullClaim)).not.toHaveProperty("public_alias");
  });

  it("includes court_name, network, address_short, and claim_slug", () => {
    const view = sanitizeClaimForAccount(fullClaim);
    expect(view.court_name).toBe("DiamondHands");
    expect(view.network).toBe("ethereum");
    expect(view.address_short).toBe("0xabc1…1234");
    expect(view.claim_slug).toBe("wlt_abc123def456ghi789");
  });

  it("includes profile_visibility for identity privacy status", () => {
    expect(sanitizeClaimForAccount(fullClaim).profile_visibility).toBe("public");
  });
});

describe("accountDashboard — defense sanitization privacy", () => {
  const fullDefense = {
    claim_slug: "wlt_abc123def456ghi789",
    owner_user_id: "user_secret_789",
    version: 2,
    text: "I was just holding for a friend.",
    moderation_status: "approved",
    replaces_version: 1,
    submitted_at: "2024-01-01T00:00:00Z",
    moderated_at: "2024-01-03T00:00:00Z",
    moderated_by: "admin_user_id_secret",
    moderation_note: "Internal admin note never shown to owner"
  };

  it("never exposes owner_user_id", () => {
    expect(sanitizeDefenseForAccount(fullDefense)).not.toHaveProperty("owner_user_id");
  });

  it("never exposes moderated_by", () => {
    expect(sanitizeDefenseForAccount(fullDefense)).not.toHaveProperty("moderated_by");
  });

  it("never exposes moderation_note", () => {
    expect(sanitizeDefenseForAccount(fullDefense)).not.toHaveProperty("moderation_note");
  });

  it("includes claim_slug for linking to the associated case", () => {
    expect(sanitizeDefenseForAccount(fullDefense).claim_slug).toBe("wlt_abc123def456ghi789");
  });

  it("includes moderation_status for the owner", () => {
    expect(sanitizeDefenseForAccount(fullDefense).moderation_status).toBe("approved");
  });

  it("includes version and submitted_at", () => {
    const view = sanitizeDefenseForAccount(fullDefense);
    expect(view.version).toBe(2);
    expect(view.submitted_at).toBe("2024-01-01T00:00:00Z");
  });
});

describe("accountDashboard — verdict, dismissal, and mistrial counts", () => {
  it("counts verdicts, dismissals, and mistrials separately", () => {
    const trials = [
      { case_outcome: "verdict", data_mode: "live" },
      { case_outcome: "verdict", data_mode: "live" },
      { case_outcome: "dismissed_no_evidence", data_mode: "live" },
      { case_outcome: "mistrial_insufficient_evidence", data_mode: "live" },
      { case_outcome: "demo", data_mode: "demo" }
    ];
    const counts = computeDashboardCounts(trials, [], [], []);
    expect(counts.trials).toBe(5);
    expect(counts.verdicts).toBe(3); // 2 verdicts + 1 demo
    expect(counts.dismissals).toBe(1);
    expect(counts.mistrials).toBe(1);
  });

  it("does not call every trial a verdict", () => {
    const trials = [
      { case_outcome: "verdict", data_mode: "live" },
      { case_outcome: "dismissed_no_evidence", data_mode: "live" },
      { case_outcome: "mistrial_insufficient_evidence", data_mode: "live" }
    ];
    const counts = computeDashboardCounts(trials, [], [], []);
    expect(counts.verdicts).toBe(1);
    expect(counts.dismissals).toBe(1);
    expect(counts.mistrials).toBe(1);
  });

  it("counts only active claims as verified wallets, not revoked", () => {
    const claims = [
      { status: "active" },
      { status: "active" },
      { status: "revoked" }
    ];
    expect(computeDashboardCounts([], claims, [], []).verified_wallets).toBe(2);
  });

  it("counts all defenses regardless of status", () => {
    const defenses = [
      { moderation_status: "pending" },
      { moderation_status: "approved" },
      { moderation_status: "rejected" },
      { moderation_status: "hidden" }
    ];
    expect(computeDashboardCounts([], [], defenses, []).defenses).toBe(4);
  });

  it("handles empty arrays", () => {
    expect(computeDashboardCounts([], [], [], [])).toEqual({
      trials: 0, verdicts: 0, dismissals: 0, mistrials: 0,
      verified_wallets: 0, defenses: 0, summons: 0
    });
  });

  it("handles null arrays", () => {
    expect(computeDashboardCounts(null, null, null, null).trials).toBe(0);
  });

  it("infers outcome for pre-N2.3 records (no case_outcome)", () => {
    const trials = [
      { data_mode: "live" },
      { data_mode: "demo" }
    ];
    const counts = computeDashboardCounts(trials, [], [], []);
    expect(counts.verdicts).toBe(2);
  });
});

describe("accountDashboard — outcome resolution", () => {
  it("returns case_outcome when present", () => {
    expect(resolveCaseOutcome({ case_outcome: "dismissed_no_evidence" })).toBe("dismissed_no_evidence");
  });

  it("returns demo when data_mode is demo and no case_outcome", () => {
    expect(resolveCaseOutcome({ data_mode: "demo" })).toBe("demo");
  });

  it("returns verdict when no case_outcome and not demo", () => {
    expect(resolveCaseOutcome({ data_mode: "live" })).toBe("verdict");
  });

  it("returns null for null trial", () => {
    expect(resolveCaseOutcome(null)).toBeNull();
  });
});

describe("accountDashboard — submitting a wallet does not imply ownership", () => {
  it("trial sanitization does not include any claim or ownership field", () => {
    const view = sanitizeTrialForAccount({
      public_slug: "case-x",
      network: "ethereum",
      wallet_address: "0xabc1234567890123",
      normalized_wallet_address: "0xabc1234567890123",
      data_mode: "live",
      case_outcome: "verdict",
      submitted_by_user_id: "user_a"
    });
    expect(view).not.toHaveProperty("owner_user_id");
    expect(view).not.toHaveProperty("claim_slug");
    expect(view).not.toHaveProperty("verified");
    expect(view).not.toHaveProperty("claimed");
  });

  it("claim sanitization does not include any trial-submission field", () => {
    const view = sanitizeClaimForAccount({
      claim_slug: "wlt_test",
      owner_user_id: "user_a",
      network: "ethereum",
      address_short: "0xabc1…1234",
      profile_visibility: "private",
      status: "active",
      verified_at: "2024-01-01T00:00:00Z"
    });
    expect(view).not.toHaveProperty("submitted_by_user_id");
    expect(view).not.toHaveProperty("public_slug");
  });
});