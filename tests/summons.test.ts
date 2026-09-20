// Summons behavioral tests. Pure: imports only summons.ts.
// Tests handle normalization, copy building, truthful states, sanitization,
// rate limits, duplicates, and status transitions.
import { describe, it, expect } from "vitest";
import {
  normalizeXHandleInput,
  generateSummonsId,
  buildSummonsPost,
  buildVerdictSharePost,
  truncateForX,
  resolveIdentityState,
  sanitizeSummonsPublic,
  sanitizeSummonsForOwner,
  isDuplicateSummons,
  checkSummonsRateLimit,
  isValidStatusTransition,
  SUMMONS_ID_PREFIX,
  SUMMONS_RATE_LIMIT_MAX_USER,
  SUMMONS_RATE_LIMIT_MAX_HANDLE,
  SUMMONS_RATE_LIMIT_MAX_ANON,
  X_POST_CHAR_LIMIT,
} from "../base44/shared/summons.ts";

describe("summons — handle normalization", () => {
  it("accepts @handle", () => {
    const r = normalizeXHandleInput("@vitalik");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("accepts plain handle", () => {
    const r = normalizeXHandleInput("vitalik");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("accepts x.com URL", () => {
    const r = normalizeXHandleInput("https://x.com/vitalik");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("accepts twitter.com URL", () => {
    const r = normalizeXHandleInput("https://twitter.com/vitalik");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("accepts x.com URL with path (status)", () => {
    const r = normalizeXHandleInput("https://x.com/vitalik/status/123456");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("accepts www.x.com URL", () => {
    const r = normalizeXHandleInput("www.x.com/vitalik");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe("vitalik");
  });

  it("rejects non-X URLs (instagram)", () => {
    const r = normalizeXHandleInput("https://instagram.com/vitalik");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Only X");
  });

  it("rejects non-X URLs (example.com)", () => {
    const r = normalizeXHandleInput("https://example.com/handle");
    expect(r.ok).toBe(false);
  });

  it("rejects handles over 15 chars", () => {
    const r = normalizeXHandleInput("this_handle_is_way_too_long");
    expect(r.ok).toBe(false);
  });

  it("rejects handles with invalid characters", () => {
    const r = normalizeXHandleInput("vitalik!@#");
    expect(r.ok).toBe(false);
  });

  it("rejects empty input as null (ok=true, handle=null)", () => {
    const r = normalizeXHandleInput("");
    expect(r.ok).toBe(true);
    expect(r.handle).toBe(null);
  });

  it("rejects null input as null (ok=true, handle=null)", () => {
    const r = normalizeXHandleInput(null);
    expect(r.ok).toBe(true);
    expect(r.handle).toBe(null);
  });

  it("rejects script injection", () => {
    const r = normalizeXHandleInput("<script>alert(1)</script>");
    expect(r.ok).toBe(false);
  });

  it("rejects arbitrary text that isn't a handle or URL", () => {
    const r = normalizeXHandleInput("just some random text with spaces");
    expect(r.ok).toBe(false);
  });
});

describe("summons — ID generation", () => {
  it("generates IDs with correct prefix", () => {
    const id = generateSummonsId();
    expect(id.startsWith(SUMMONS_ID_PREFIX)).toBe(true);
  });

  it("generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSummonsId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("summons — copy building", () => {
  it("builds summons post with handle, verdict, URL, and uncertainty", () => {
    const post = buildSummonsPost("vitalik", "One Pump Chump", "https://wallet-court-roast.base44.app/case/abc123");
    expect(post).toContain("@vitalik");
    expect(post).toContain("ONE PUMP CHUMP");
    expect(post).toContain("https://wallet-court-roast.base44.app/case/abc123");
    expect(post).toContain("nominated you as the defendant");
    expect(post).toContain("Is it yours?");
  });

  it("includes SUMMONS header", () => {
    const post = buildSummonsPost("vitalik", "Bagholder", "https://example.com/case/abc");
    expect(post.startsWith("🚨 SUMMONS")).toBe(true);
  });

  it("returns null for no handle", () => {
    const post = buildSummonsPost(null, "Verdict", "https://example.com");
    expect(post).toBe(null);
  });

  it("builds verdict share post with verdict, severity, and CTA", () => {
    const post = buildVerdictSharePost("Bagholder", 75, "https://example.com/case/abc");
    expect(post).toContain("WALLET COURT VERDICT");
    expect(post).toContain("BAGHOLDER");
    expect(post).toContain("75/100");
    expect(post).toContain("Put your wallet on trial");
    expect(post).toContain("https://example.com/case/abc");
  });
});

describe("summons — X character limit", () => {
  it("keeps short posts unchanged", () => {
    const post = buildSummonsPost("vitalik", "Guilty", "https://example.com/c/abc");
    expect(post.length).toBeLessThan(X_POST_CHAR_LIMIT);
    expect(truncateForX(post)).toBe(post);
  });

  it("truncates long posts to within limit", () => {
    const longHandle = "a".repeat(15);
    const longVerdict = "V".repeat(100);
    const longUrl = "https://example.com/case/" + "x".repeat(200);
    const post = buildSummonsPost(longHandle, longVerdict, longUrl);
    const truncated = truncateForX(post, X_POST_CHAR_LIMIT);
    expect(truncated.length).toBeLessThanOrEqual(X_POST_CHAR_LIMIT);
  });

  it("truncates with ellipsis, not mid-word", () => {
    const text = "word ".repeat(100);
    const truncated = truncateForX(text, 50);
    expect(truncated.length).toBeLessThanOrEqual(50);
    if (truncated.endsWith("…")) {
      // No word should be cut in the middle — every word should be complete
      const before = truncated.slice(0, -1).trim();
      const words = before.split(" ");
      for (const w of words) {
        expect(w).toBe("word");
      }
    }
  });
});

describe("summons — truthful identity states", () => {
  it("returns anonymous defendant when no summons and no claim", () => {
    const r = resolveIdentityState({ summons: null, claimStatus: null, defenseStatus: null });
    expect(r.state).toBe("anonymous_defendant");
    expect(r.label).toBe("Anonymous Defendant");
  });

  it("returns summons_ready when summons exists with that status", () => {
    const r = resolveIdentityState({
      summons: { status: "summons_ready" },
      claimStatus: null,
      defenseStatus: null,
    });
    expect(r.state).toBe("summons_ready");
  });

  it("returns share_opened when summons was shared", () => {
    const r = resolveIdentityState({
      summons: { status: "share_opened" },
      claimStatus: null,
      defenseStatus: null,
    });
    expect(r.state).toBe("share_opened");
  });

  it("returns summons_served when user confirmed posting (self-reported)", () => {
    const r = resolveIdentityState({
      summons: { status: "summons_served_self_reported" },
      claimStatus: null,
      defenseStatus: null,
    });
    expect(r.state).toBe("summons_served");
    expect(r.label).toContain("Self-reported");
  });

  it("verified wallet owner overrides summons state", () => {
    const r = resolveIdentityState({
      summons: { status: "summons_served_self_reported" },
      claimStatus: { claimed: true },
      defenseStatus: null,
    });
    expect(r.state).toBe("verified_wallet_owner");
  });

  it("official defense filed overrides summons and claim", () => {
    const r = resolveIdentityState({
      summons: { status: "summons_ready" },
      claimStatus: { claimed: true, official_defense: { text: "I object" } },
      defenseStatus: null,
    });
    expect(r.state).toBe("official_defense_filed");
  });

  it("nominated handle never grants ownership", () => {
    // Even with a summons and handle, without a claim, the state is summons-based
    const r = resolveIdentityState({
      summons: { status: "summons_ready", display_handle: "vitalik" },
      claimStatus: null,
      defenseStatus: null,
    });
    expect(r.state).toBe("summons_ready");
    expect(r.state).not.toBe("verified_wallet_owner");
  });
});

describe("summons — sanitization", () => {
  it("public sanitization excludes creator_user_id and abuse_status", () => {
    const s = sanitizeSummonsPublic({
      summons_id: "smn_abc",
      display_handle: "vitalik",
      status: "summons_ready",
      share_method: "x_intent",
      created_at: "2024-01-01T00:00:00Z",
      creator_user_id: "user123",
      abuse_status: "clean",
      confirmed_post_url: "https://x.com/post/123",
    });
    expect(s.summons_id).toBe("smn_abc");
    expect(s.display_handle).toBe("vitalik");
    expect(s.status).toBe("summons_ready");
    expect(s.creator_user_id).toBeUndefined();
    expect(s.abuse_status).toBeUndefined();
    expect(s.confirmed_post_url).toBeUndefined();
  });

  it("owner sanitization includes case info but not abuse_status", () => {
    const s = sanitizeSummonsForOwner(
      {
        summons_id: "smn_abc",
        case_slug: "case123",
        display_handle: "vitalik",
        status: "summons_ready",
        share_method: "x_intent",
        created_at: "2024-01-01T00:00:00Z",
        creator_user_id: "user123",
        abuse_status: "clean",
      },
      { verdict_name: "Bagholder", network: "ethereum", address_short: "0x1234…abcd" }
    );
    expect(s.case_slug).toBe("case123");
    expect(s.verdict_name).toBe("Bagholder");
    expect(s.network).toBe("ethereum");
    expect(s.creator_user_id).toBeUndefined();
    expect(s.abuse_status).toBeUndefined();
  });

  it("returns null for null input", () => {
    expect(sanitizeSummonsPublic(null)).toBe(null);
    expect(sanitizeSummonsForOwner(null, null)).toBe(null);
  });
});

describe("summons — duplicate detection", () => {
  it("detects duplicate for same case and handle", () => {
    const existing = [
      { normalized_target_handle: "vitalik", abuse_status: "clean" },
    ];
    expect(isDuplicateSummons(existing, "vitalik")).toBe(true);
  });

  it("does not flag different handles as duplicate", () => {
    const existing = [
      { normalized_target_handle: "vitalik", abuse_status: "clean" },
    ];
    expect(isDuplicateSummons(existing, "satoshi")).toBe(false);
  });

  it("ignores blocked summons", () => {
    const existing = [
      { normalized_target_handle: "vitalik", abuse_status: "blocked" },
    ];
    expect(isDuplicateSummons(existing, "vitalik")).toBe(false);
  });

  it("returns false for null handle", () => {
    expect(isDuplicateSummons([], null)).toBe(false);
    expect(isDuplicateSummons(null, "vitalik")).toBe(false);
  });
});

describe("summons — rate limiting", () => {
  const now = new Date();
  const withinWindow = (mins) => new Date(now.getTime() - mins * 60 * 1000).toISOString();
  const outsideWindow = (hrs) => new Date(now.getTime() - hrs * 60 * 60 * 1000).toISOString();

  it("allows within user limit", () => {
    const recent = Array.from({ length: SUMMONS_RATE_LIMIT_MAX_USER - 1 }, (_, i) => ({
      created_at: withinWindow(1),
    }));
    const r = checkSummonsRateLimit(recent, false, "handle1");
    expect(r.ok).toBe(true);
  });

  it("blocks over user limit", () => {
    const recent = Array.from({ length: SUMMONS_RATE_LIMIT_MAX_USER }, (_, i) => ({
      created_at: withinWindow(1),
    }));
    const r = checkSummonsRateLimit(recent, false, "handle1");
    expect(r.ok).toBe(false);
  });

  it("blocks over anonymous limit", () => {
    const recent = Array.from({ length: SUMMONS_RATE_LIMIT_MAX_ANON }, (_, i) => ({
      created_at: withinWindow(1),
    }));
    const r = checkSummonsRateLimit(recent, true, "handle1");
    expect(r.ok).toBe(false);
  });

  it("blocks over per-handle limit", () => {
    const recent = Array.from({ length: SUMMONS_RATE_LIMIT_MAX_HANDLE }, (_, i) => ({
      created_at: withinWindow(1),
      normalized_target_handle: "vitalik",
    }));
    const r = checkSummonsRateLimit(recent, false, "vitalik");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("handle");
  });

  it("ignores records outside the time window", () => {
    const recent = Array.from({ length: 100 }, (_, i) => ({
      created_at: outsideWindow(2), // 2 hours ago — outside 1-hour window
    }));
    const r = checkSummonsRateLimit(recent, false, "handle1");
    expect(r.ok).toBe(true);
  });
});

describe("summons — status transitions", () => {
  it("allows anonymous_defendant → summons_ready", () => {
    expect(isValidStatusTransition("anonymous_defendant", "summons_ready")).toBe(true);
  });

  it("allows anonymous_defendant → share_opened", () => {
    expect(isValidStatusTransition("anonymous_defendant", "share_opened")).toBe(true);
  });

  it("allows summons_ready → share_opened", () => {
    expect(isValidStatusTransition("summons_ready", "share_opened")).toBe(true);
  });

  it("allows summons_ready → summons_served_self_reported", () => {
    expect(isValidStatusTransition("summons_ready", "summons_served_self_reported")).toBe(true);
  });

  it("allows share_opened → summons_served_self_reported", () => {
    expect(isValidStatusTransition("share_opened", "summons_served_self_reported")).toBe(true);
  });

  it("blocks summons_served_self_reported → any (no rollback)", () => {
    expect(isValidStatusTransition("summons_served_self_reported", "share_opened")).toBe(false);
    expect(isValidStatusTransition("summons_served_self_reported", "summons_ready")).toBe(false);
  });

  it("blocks anonymous_defendant → summons_served_self_reported (must share first)", () => {
    expect(isValidStatusTransition("anonymous_defendant", "summons_served_self_reported")).toBe(false);
  });
});