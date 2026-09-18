// Court Name validation tests (Phase N3). Pure: imports only courtName.ts.
import { describe, it, expect } from "vitest";
import {
  validateCourtName, checkCourtNameCooldown, normalizeCourtName,
  COURT_NAME_MIN, COURT_NAME_MAX, COURT_NAME_COOLDOWN_MS
} from "../base44/shared/courtName.ts";

describe("courtName — validation boundaries", () => {
  it("rejects names shorter than 3 characters", () => {
    expect(validateCourtName("ab").ok).toBe(false);
    expect(validateCourtName("a").ok).toBe(false);
  });
  it("rejects names longer than 24 characters", () => {
    expect(validateCourtName("a".repeat(25)).ok).toBe(false);
  });
  it("accepts a 3-character name", () => {
    expect(validateCourtName("abc").ok).toBe(true);
  });
  it("accepts a 24-character name", () => {
    expect(validateCourtName("a".repeat(24)).ok).toBe(true);
  });
  it("rejects empty string", () => {
    expect(validateCourtName("").ok).toBe(false);
  });
  it("rejects null", () => {
    expect(validateCourtName(null).ok).toBe(false);
  });
});

describe("courtName — trimming and normalization", () => {
  it("trims leading/trailing whitespace before validation", () => {
    const r = validateCourtName("  DegenSupreme  ");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("DegenSupreme");
  });
  it("returns a lowercase normalized form", () => {
    const r = validateCourtName("DegenSupreme");
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("degensupreme");
  });
  it("normalizeCourtName lowercases and trims", () => {
    expect(normalizeCourtName("  Hello  ")).toBe("hello");
  });
});

describe("courtName — character rules", () => {
  it("rejects spaces", () => {
    expect(validateCourtName("a b").ok).toBe(false);
  });
  it("rejects special characters", () => {
    expect(validateCourtName("abc!").ok).toBe(false);
    expect(validateCourtName("abc.").ok).toBe(false);
    expect(validateCourtName("ab@c").ok).toBe(false);
  });
  it("accepts underscores and hyphens in the middle", () => {
    expect(validateCourtName("a_b-c").ok).toBe(true);
    expect(validateCourtName("Degen_Supreme").ok).toBe(true);
  });
  it("rejects leading underscore or hyphen", () => {
    expect(validateCourtName("_abc").ok).toBe(false);
    expect(validateCourtName("-abc").ok).toBe(false);
  });
  it("rejects trailing underscore or hyphen", () => {
    expect(validateCourtName("abc_").ok).toBe(false);
    expect(validateCourtName("abc-").ok).toBe(false);
  });
  it("accepts digits", () => {
    expect(validateCourtName("abc123").ok).toBe(true);
  });
});

describe("courtName — reserved terms", () => {
  it("rejects 'admin'", () => {
    expect(validateCourtName("admin").ok).toBe(false);
  });
  it("rejects 'administrator'", () => {
    expect(validateCourtName("administrator").ok).toBe(false);
  });
  it("rejects 'moderator'", () => {
    expect(validateCourtName("moderator").ok).toBe(false);
  });
  it("rejects 'support'", () => {
    expect(validateCourtName("support").ok).toBe(false);
  });
  it("rejects 'official'", () => {
    expect(validateCourtName("official").ok).toBe(false);
  });
  it("rejects 'shoutit'", () => {
    expect(validateCourtName("shoutit").ok).toBe(false);
  });
  it("rejects 'shoutitworld'", () => {
    expect(validateCourtName("shoutitworld").ok).toBe(false);
  });
  it("rejects 'walletcourt'", () => {
    expect(validateCourtName("walletcourt").ok).toBe(false);
  });
  it("rejects 'nansen'", () => {
    expect(validateCourtName("nansen").ok).toBe(false);
  });
  it("rejects reserved term as substring (e.g. 'admin1')", () => {
    expect(validateCourtName("admin1").ok).toBe(false);
    expect(validateCourtName("myadmin").ok).toBe(false);
  });
  it("rejects case-insensitive match (e.g. 'ADMIN')", () => {
    expect(validateCourtName("ADMIN").ok).toBe(false);
  });
});

describe("courtName — profanity rejection", () => {
  it("rejects profanity", () => {
    expect(validateCourtName("fuckbtc").ok).toBe(false);
    expect(validateCourtName("shitcoin").ok).toBe(false);
  });
});

describe("courtName — Unicode lookalike rejection", () => {
  it("rejects non-ASCII characters (Cyrillic homoglyphs)", () => {
    // Cyrillic 'а' looks like Latin 'a' but is not ASCII
    expect(validateCourtName("аdmin").ok).toBe(false);
  });
  it("rejects emoji", () => {
    expect(validateCourtName("abc🎉").ok).toBe(false);
  });
  it("rejects zero-width characters", () => {
    expect(validateCourtName("ab\u200Bc").ok).toBe(false);
  });
});

describe("courtName — 30-day cooldown", () => {
  it("allows change when no previous change timestamp", () => {
    expect(checkCourtNameCooldown(null).ok).toBe(true);
    expect(checkCourtNameCooldown(undefined).ok).toBe(true);
  });
  it("blocks change within 30 days", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const r = checkCourtNameCooldown(recent);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("day");
  });
  it("allows change after 30 days", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(checkCourtNameCooldown(old).ok).toBe(true);
  });
  it("allows change at exactly 30 days boundary", () => {
    const boundary = new Date(Date.now() - COURT_NAME_COOLDOWN_MS - 1000).toISOString();
    expect(checkCourtNameCooldown(boundary).ok).toBe(true);
  });
});