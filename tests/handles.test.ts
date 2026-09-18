// Social handle validation tests (Phase N3). Pure: imports only handles.ts.
import { describe, it, expect } from "vitest";
import {
  validateHandle, sanitizeHandle, sanitizeHandlePublic,
  isValidProvider, HANDLE_PROVIDERS
} from "../base44/shared/handles.ts";

describe("handles — provider validation", () => {
  it("accepts valid providers", () => {
    expect(isValidProvider("x")).toBe(true);
    expect(isValidProvider("fomo")).toBe(true);
    expect(isValidProvider("pump_fun")).toBe(true);
  });
  it("rejects unknown providers", () => {
    expect(isValidProvider("twitter")).toBe(false);
    expect(isValidProvider("discord")).toBe(false);
    expect(isValidProvider("")).toBe(false);
  });
});

describe("handles — sanitization", () => {
  it("strips leading @", () => {
    expect(sanitizeHandle("@vitalik")).toBe("vitalik");
  });
  it("strips URL prefixes", () => {
    expect(sanitizeHandle("https://x.com/vitalik")).toBe("vitalik");
    expect(sanitizeHandle("https://twitter.com/vitalik")).toBe("vitalik");
  });
  it("strips paths and tracking parameters", () => {
    expect(sanitizeHandle("vitalik?s=123")).toBe("vitalik");
    expect(sanitizeHandle("vitalik/referral")).toBe("vitalik");
  });
  it("strips HTML tags and script blocks", () => {
    const sanitized = sanitizeHandle("vit<script>alert(1)</script>alik");
    // Script blocks are removed entirely; remaining text is rejected by provider regex.
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("</script>");
    expect(validateHandle("x", sanitized).ok).toBe(false);
  });
  it("strips control characters", () => {
    expect(sanitizeHandle("vit\u0000alik")).toBe("vitalik");
  });
  it("strips zero-width characters", () => {
    expect(sanitizeHandle("vit\u200Balik")).toBe("vitalik");
  });
});

describe("handles — X validation", () => {
  it("accepts a valid X handle", () => {
    const r = validateHandle("x", "vitalik");
    expect(r.ok).toBe(true);
    expect(r.display).toBe("vitalik");
    expect(r.normalized).toBe("vitalik");
  });
  it("accepts underscores in X handle", () => {
    expect(validateHandle("x", "elon_musk").ok).toBe(true);
  });
  it("accepts digits in X handle", () => {
    expect(validateHandle("x", "user123").ok).toBe(true);
  });
  it("rejects hyphens in X handle (X doesn't allow hyphens)", () => {
    expect(validateHandle("x", "user-name").ok).toBe(false);
  });
  it("rejects X handle over 15 characters", () => {
    expect(validateHandle("x", "a".repeat(16)).ok).toBe(false);
  });
  it("rejects empty handle", () => {
    expect(validateHandle("x", "").ok).toBe(false);
  });
  it("strips @ before validating", () => {
    expect(validateHandle("x", "@vitalik").ok).toBe(true);
  });
});

describe("handles — FOMO and Pump.fun validation", () => {
  it("accepts a valid FOMO handle", () => {
    expect(validateHandle("fomo", "degen-trader").ok).toBe(true);
  });
  it("accepts hyphens in FOMO/Pump.fun handles", () => {
    expect(validateHandle("fomo", "my-handle").ok).toBe(true);
    expect(validateHandle("pump_fun", "my-handle").ok).toBe(true);
  });
  it("rejects special characters in FOMO handle", () => {
    expect(validateHandle("fomo", "my.handle").ok).toBe(false);
  });
  it("rejects FOMO handle over 20 characters", () => {
    expect(validateHandle("fomo", "a".repeat(21)).ok).toBe(false);
  });
});

describe("handles — unverified labeling", () => {
  it("sanitizeHandlePublic always labels as unverified when state is unverified", () => {
    const h = { provider: "x", display_handle: "vitalik", verification_state: "unverified" };
    const out = sanitizeHandlePublic(h);
    expect(out.verification_state).toBe("unverified");
  });
  it("sanitizeHandlePublic includes provider_label", () => {
    const h = { provider: "pump_fun", display_handle: "test", verification_state: "unverified" };
    const out = sanitizeHandlePublic(h);
    expect(out.provider_label).toBe("Pump.fun");
  });
  it("sanitizeHandlePublic does not include normalized_handle (internal only)", () => {
    const h = { provider: "x", display_handle: "vitalik", normalized_handle: "vitalik", verification_state: "unverified" };
    const out = sanitizeHandlePublic(h);
    expect(out).not.toHaveProperty("normalized_handle");
  });
  it("sanitizeHandlePublic returns null for null input", () => {
    expect(sanitizeHandlePublic(null)).toBeNull();
  });
});

describe("handles — no inferred verification", () => {
  it("a manually entered handle is always unverified", () => {
    // validateHandle returns display/normalized but never sets verification_state
    const r = validateHandle("x", "vitalik");
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("verification_state");
    expect(r).not.toHaveProperty("verified");
  });
});