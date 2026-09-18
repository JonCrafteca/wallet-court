// Official Defense text validation tests (Phase N3). Pure: imports only defense.ts.
import { describe, it, expect } from "vitest";
import {
  validateDefenseText, countCodePoints, sanitizeDefenseText,
  containsHtml, DEFENSE_MAX_CODE_POINTS
} from "../base44/shared/defense.ts";

describe("defense — code point counting", () => {
  it("counts ASCII characters correctly", () => {
    expect(countCodePoints("hello")).toBe(5);
  });
  it("counts BMP characters correctly", () => {
    expect(countCodePoints("héllo")).toBe(5);
  });
  it("counts non-BMP characters as single code points", () => {
    // 🎉 is U+1F389, which is 2 UTF-16 code units but 1 code point
    expect(countCodePoints("a🎉b")).toBe(3);
  });
  it("returns 0 for empty/null", () => {
    expect(countCodePoints("")).toBe(0);
    expect(countCodePoints(null)).toBe(0);
  });
});

describe("defense — text sanitization", () => {
  it("trims whitespace", () => {
    expect(sanitizeDefenseText("  hello  ")).toBe("hello");
  });
  it("strips control characters except newline and tab", () => {
    expect(sanitizeDefenseText("he\u0000llo")).toBe("hello");
    expect(sanitizeDefenseText("he\u0007llo")).toBe("hello");
  });
  it("preserves newlines", () => {
    expect(sanitizeDefenseText("line1\nline2")).toBe("line1\nline2");
  });
  it("collapses 3+ consecutive newlines to 2", () => {
    expect(sanitizeDefenseText("a\n\n\n\nb")).toBe("a\n\nb");
  });
  it("strips zero-width characters", () => {
    expect(sanitizeDefenseText("he\u200Bllo")).toBe("hello");
  });
});

describe("defense — HTML/XSS rejection", () => {
  it("detects script tags", () => {
    expect(containsHtml("<script>alert(1)</script>")).toBe(true);
  });
  it("detects anchor tags", () => {
    expect(containsHtml("<a href='evil'>click</a>")).toBe(true);
  });
  it("detects img tags", () => {
    expect(containsHtml("<img src=x onerror=alert(1)>")).toBe(true);
  });
  it("does not flag plain angle brackets", () => {
    expect(containsHtml("1 < 2")).toBe(false);
  });
  it("rejects defense with HTML", () => {
    expect(validateDefenseText("<script>alert(1)</script>").ok).toBe(false);
  });
  it("rejects defense with embedded link tag", () => {
    expect(validateDefenseText("Click <a href='evil'>here</a>").ok).toBe(false);
  });
});

describe("defense — 280 code point limit", () => {
  it("accepts text at exactly 280 code points", () => {
    const text = "a".repeat(280);
    const r = validateDefenseText(text);
    expect(r.ok).toBe(true);
    expect(r.codePoints).toBe(280);
  });
  it("rejects text at 281 code points", () => {
    const text = "a".repeat(281);
    expect(validateDefenseText(text).ok).toBe(false);
  });
  it("counts emoji as single code points", () => {
    const text = "🎉".repeat(280);
    const r = validateDefenseText(text);
    expect(r.ok).toBe(true);
    expect(r.codePoints).toBe(280);
  });
  it("rejects 281 emoji", () => {
    const text = "🎉".repeat(281);
    expect(validateDefenseText(text).ok).toBe(false);
  });
});

describe("defense — empty rejection", () => {
  it("rejects empty string", () => {
    expect(validateDefenseText("").ok).toBe(false);
  });
  it("rejects whitespace-only string", () => {
    expect(validateDefenseText("   ").ok).toBe(false);
  });
  it("rejects null", () => {
    expect(validateDefenseText(null).ok).toBe(false);
  });
});

describe("defense — valid text", () => {
  it("accepts a simple defense statement", () => {
    const r = validateDefenseText("I bought the top because I believed in the technology.");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("I bought the top because I believed in the technology.");
  });
  it("preserves newlines in valid text", () => {
    const r = validateDefenseText("Line 1\nLine 2");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("Line 1\nLine 2");
  });
});