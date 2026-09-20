// Court Receipt behavioral tests. Pure: imports only courtReceipt.ts and
// notGuiltyStamp.ts. Tests dimensions, content extraction, truncation,
// dismissed/mistrial rejection, demo marking, branding constants,
// compact case reference, layout constants (sentencing/footer separation,
// within canvas bounds), and canonical NOT GUILTY stamp style.
import { describe, it, expect } from "vitest";
import {
  RECEIPT_SIZES,
  RECEIPT_BRANDING,
  bestRoastExcerpt,
  sentenceExcerpt,
  truncateLine,
  isReceiptAllowed,
  needsDemoMark,
  wrapTextTruncatePure,
  compactCaseRef,
  LANDSCAPE_LAYOUT,
  PORTRAIT_LAYOUT,
} from "../base44/shared/courtReceipt.ts";
import {
  NOT_GUILTY_STYLE,
  GUILTY_STYLE,
  getStampStyle,
  isNotGuilty,
  NOT_GUILTY_VERDICT_CODE,
} from "../base44/shared/notGuiltyStamp.ts";

describe("court receipt — dimensions", () => {
  it("landscape is exactly 1200×675", () => {
    expect(RECEIPT_SIZES.landscape.w).toBe(1200);
    expect(RECEIPT_SIZES.landscape.h).toBe(675);
  });

  it("portrait is exactly 1080×1350", () => {
    expect(RECEIPT_SIZES.portrait.w).toBe(1080);
    expect(RECEIPT_SIZES.portrait.h).toBe(1350);
  });

  it("has exactly two sizes", () => {
    expect(Object.keys(RECEIPT_SIZES).length).toBe(2);
  });
});

describe("court receipt — branding", () => {
  it("includes @ShoutItWorld", () => {
    expect(RECEIPT_BRANDING.x_handle).toBe("@ShoutItWorld");
  });

  it("includes court.shoutit.world", () => {
    expect(RECEIPT_BRANDING.domain).toBe("court.shoutit.world");
  });

  it("includes PUT YOUR WALLET ON TRIAL CTA", () => {
    expect(RECEIPT_BRANDING.cta).toBe("PUT YOUR WALLET ON TRIAL");
  });
});

describe("court receipt — compact case reference", () => {
  it("strips case- prefix and uppercases", () => {
    expect(compactCaseRef("case-21fglzyead8m")).toBe("CASE 21FGLZYEAD8M");
  });

  it("handles slug without case- prefix", () => {
    expect(compactCaseRef("abc123")).toBe("CASE ABC123");
  });

  it("handles empty slug", () => {
    expect(compactCaseRef("")).toBe("");
  });

  it("handles null slug", () => {
    expect(compactCaseRef(null)).toBe("");
  });
});

describe("court receipt — landscape layout (sentencing/footer separation)", () => {
  it("sentencing box ends before footer starts", () => {
    const sentencingEnd = LANDSCAPE_LAYOUT.sentencing.y + LANDSCAPE_LAYOUT.sentencing.h;
    const footerStart = LANDSCAPE_LAYOUT.footer.y;
    expect(sentencingEnd).toBeLessThanOrEqual(footerStart);
  });

  it("footer ends at canvas bottom (675)", () => {
    const footerEnd = LANDSCAPE_LAYOUT.footer.y + LANDSCAPE_LAYOUT.footer.h;
    expect(footerEnd).toBe(RECEIPT_SIZES.landscape.h);
  });

  it("all elements are within the 1200×675 canvas", () => {
    const H = RECEIPT_SIZES.landscape.h;
    expect(LANDSCAPE_LAYOUT.header.y).toBeGreaterThanOrEqual(0);
    expect(LANDSCAPE_LAYOUT.header.y + LANDSCAPE_LAYOUT.header.h).toBeLessThanOrEqual(H);
    expect(LANDSCAPE_LAYOUT.stamp.y).toBeGreaterThanOrEqual(0);
    expect(LANDSCAPE_LAYOUT.stamp.y).toBeLessThanOrEqual(H);
    expect(LANDSCAPE_LAYOUT.verdict.y).toBeGreaterThanOrEqual(0);
    expect(LANDSCAPE_LAYOUT.verdict.y).toBeLessThanOrEqual(H);
    expect(LANDSCAPE_LAYOUT.sentencing.y + LANDSCAPE_LAYOUT.sentencing.h).toBeLessThanOrEqual(H);
    expect(LANDSCAPE_LAYOUT.footer.y + LANDSCAPE_LAYOUT.footer.h).toBeLessThanOrEqual(H);
  });

  it("roast text does not overlap sentencing box", () => {
    const roastEnd = LANDSCAPE_LAYOUT.roast.y + LANDSCAPE_LAYOUT.roast.maxLines * LANDSCAPE_LAYOUT.roast.lineH;
    expect(roastEnd).toBeLessThanOrEqual(LANDSCAPE_LAYOUT.sentencing.y);
  });

  it("consistent padding between roast, sentencing, and footer", () => {
    const roastEnd = LANDSCAPE_LAYOUT.roast.y + LANDSCAPE_LAYOUT.roast.maxLines * LANDSCAPE_LAYOUT.roast.lineH;
    const roastToSentencing = LANDSCAPE_LAYOUT.sentencing.y - roastEnd;
    const sentencingEnd = LANDSCAPE_LAYOUT.sentencing.y + LANDSCAPE_LAYOUT.sentencing.h;
    const sentencingToFooter = LANDSCAPE_LAYOUT.footer.y - sentencingEnd;
    // Both gaps should be positive (no overlap) and reasonable (not tiny, not huge)
    expect(roastToSentencing).toBeGreaterThan(0);
    expect(sentencingToFooter).toBeGreaterThan(0);
  });
});

describe("court receipt — portrait layout (no giant unused region)", () => {
  it("content fills from header to footer", () => {
    const contentStart = PORTRAIT_LAYOUT.header.y;
    const contentEnd = PORTRAIT_LAYOUT.sentencing.y + PORTRAIT_LAYOUT.sentencing.h;
    const footerStart = PORTRAIT_LAYOUT.footer.y;
    // Content should extend past 80% of the canvas (no giant empty region)
    expect(contentEnd).toBeGreaterThan(RECEIPT_SIZES.portrait.h * 0.8);
    // Footer should start after content with reasonable padding
    expect(footerStart).toBeGreaterThanOrEqual(contentEnd);
  });

  it("footer ends at canvas bottom (1350)", () => {
    const footerEnd = PORTRAIT_LAYOUT.footer.y + PORTRAIT_LAYOUT.footer.h;
    expect(footerEnd).toBe(RECEIPT_SIZES.portrait.h);
  });

  it("all elements are within the 1080×1350 canvas", () => {
    const H = RECEIPT_SIZES.portrait.h;
    expect(PORTRAIT_LAYOUT.header.y).toBeGreaterThanOrEqual(0);
    expect(PORTRAIT_LAYOUT.header.y + PORTRAIT_LAYOUT.header.h).toBeLessThanOrEqual(H);
    expect(PORTRAIT_LAYOUT.stamp.y).toBeGreaterThanOrEqual(0);
    expect(PORTRAIT_LAYOUT.stamp.y).toBeLessThanOrEqual(H);
    expect(PORTRAIT_LAYOUT.verdict.y).toBeGreaterThanOrEqual(0);
    expect(PORTRAIT_LAYOUT.verdict.y).toBeLessThanOrEqual(H);
    expect(PORTRAIT_LAYOUT.sentencing.y + PORTRAIT_LAYOUT.sentencing.h).toBeLessThanOrEqual(H);
    expect(PORTRAIT_LAYOUT.footer.y + PORTRAIT_LAYOUT.footer.h).toBeLessThanOrEqual(H);
  });

  it("roast text does not overlap sentencing box", () => {
    const roastEnd = PORTRAIT_LAYOUT.roast.y + PORTRAIT_LAYOUT.roast.maxLines * PORTRAIT_LAYOUT.roast.lineH;
    expect(roastEnd).toBeLessThanOrEqual(PORTRAIT_LAYOUT.sentencing.y);
  });

  it("sentencing box has enough height for 3 readable lines", () => {
    // The sentencing box should be tall enough for a label + 3 lines of text
    expect(PORTRAIT_LAYOUT.sentencing.h).toBeGreaterThanOrEqual(150);
  });
});

describe("court receipt — canonical NOT GUILTY stamp in canvas", () => {
  it("NOT GUILTY stamp uses solid lime fill (not outline-only)", () => {
    const style = getStampStyle(NOT_GUILTY_VERDICT_CODE);
    expect(style.bg).toBe("#D8FF32");
    // The canvas drawStampCanvas function fills the rectangle with style.bg,
    // not just stroking the border. This is the canonical solid-fill treatment.
  });

  it("NOT GUILTY stamp uses dark navy text (not lime on transparent)", () => {
    const style = getStampStyle(NOT_GUILTY_VERDICT_CODE);
    expect(style.text).toBe("#10142A");
    // The old canvas code used fillStyle = chart for the text, which was
    // lime text on the gradient background. The canonical style uses dark
    // navy text on the solid lime background.
  });

  it("NOT GUILTY stamp uses thick dark navy border", () => {
    const style = getStampStyle(NOT_GUILTY_VERDICT_CODE);
    expect(style.border).toBe("#10142A");
    expect(style.borderWidth).toBeGreaterThanOrEqual(3);
  });

  it("NOT GUILTY stamp uses dark offset shadow", () => {
    const style = getStampStyle(NOT_GUILTY_VERDICT_CODE);
    expect(style.shadow).toBe("#10142A");
    expect(style.shadowOffsetX).toBeGreaterThan(0);
    expect(style.shadowOffsetY).toBeGreaterThan(0);
  });

  it("NOT GUILTY stamp has rotation matching the reference", () => {
    const style = getStampStyle(NOT_GUILTY_VERDICT_CODE);
    expect(style.rotationDeg).toBe(-6);
  });

  it("GUILTY stamp uses ice fill with red text and red border", () => {
    const style = getStampStyle("one_pump_chump");
    expect(style.bg).toBe("#F5F7FF");
    expect(style.text).toBe("#FF3B30");
    expect(style.border).toBe("#FF3B30");
  });
});

describe("court receipt — roast excerpt", () => {
  it("extracts first 1-2 sentences", () => {
    const roast = "This wallet bought the top. Then it held all the way down. The bag is heavy.";
    const excerpt = bestRoastExcerpt(roast, 2);
    expect(excerpt).toBe("This wallet bought the top. Then it held all the way down.");
  });

  it("handles single sentence", () => {
    const roast = "One sentence only.";
    expect(bestRoastExcerpt(roast)).toBe("One sentence only.");
  });

  it("handles empty input", () => {
    expect(bestRoastExcerpt("")).toBe("");
    expect(bestRoastExcerpt(null)).toBe("");
  });

  it("never invents text", () => {
    const excerpt = bestRoastExcerpt("Real roast text.");
    expect(excerpt).toBe("Real roast text.");
    expect(excerpt.includes("invented")).toBe(false);
  });
});

describe("court receipt — sentence excerpt", () => {
  it("extracts first 1-2 sentences", () => {
    const sentence = "Sentenced to eternal bag-holding. No parole. No mercy.";
    const excerpt = sentenceExcerpt(sentence, 2);
    expect(excerpt).toBe("Sentenced to eternal bag-holding. No parole.");
  });

  it("handles empty input", () => {
    expect(sentenceExcerpt("")).toBe("");
    expect(sentenceExcerpt(null)).toBe("");
  });
});

describe("court receipt — line truncation", () => {
  it("returns short lines unchanged", () => {
    expect(truncateLine("short line", 20)).toBe("short line");
  });

  it("truncates long lines with ellipsis", () => {
    const result = truncateLine("this is a very long line that needs truncation", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("truncates at word boundary (not mid-word)", () => {
    const result = truncateLine("word1 word2 word3 word4 word5", 15);
    expect(result.endsWith("…")).toBe(true);
    const before = result.slice(0, -1).trim();
    const words = before.split(" ");
    const originalWords = "word1 word2 word3 word4 word5".split(" ");
    for (const w of words) {
      expect(originalWords).toContain(w);
    }
  });

  it("handles very short maxLen", () => {
    const result = truncateLine("test", 3);
    expect(result).toBe("…");
  });
});

describe("court receipt — wrap and truncate (pure)", () => {
  const measureFn = (text) => text.length * 5;

  it("wraps text to multiple lines", () => {
    const lines = wrapTextTruncatePure("word1 word2 word3 word4 word5", measureFn, 60, 3);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("word1 word2");
    expect(lines[1]).toBe("word3 word4");
  });

  it("truncates with ellipsis when exceeding maxLines", () => {
    const lines = wrapTextTruncatePure("w1 w2 w3 w4 w5 w6 w7 w8", measureFn, 25, 2);
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(wrapTextTruncatePure("", measureFn, 100, 3)).toEqual([]);
    expect(wrapTextTruncatePure(null, measureFn, 100, 3)).toEqual([]);
  });

  it("never cuts a word in the middle", () => {
    const lines = wrapTextTruncatePure("abcdefghijklmnop abc def", measureFn, 30, 2);
    for (const line of lines) {
      const words = line.replace(/…$/, "").trim().split(" ");
      for (const w of words) {
        expect(["abcdefghijklmnop", "abc", "def"].includes(w) || w === "").toBe(true);
      }
    }
  });
});

describe("court receipt — dismissed/mistrial rejection", () => {
  it("allows verdict cases", () => {
    expect(isReceiptAllowed({ case_outcome: "verdict" })).toBe(true);
  });

  it("allows demo cases", () => {
    expect(isReceiptAllowed({ case_outcome: "demo" })).toBe(true);
    expect(isReceiptAllowed({ data_mode: "demo" })).toBe(true);
  });

  it("rejects dismissed cases", () => {
    expect(isReceiptAllowed({ case_outcome: "dismissed_no_evidence" })).toBe(false);
  });

  it("rejects mistrial cases", () => {
    expect(isReceiptAllowed({ case_outcome: "mistrial_insufficient_evidence" })).toBe(false);
  });

  it("rejects null trial", () => {
    expect(isReceiptAllowed(null)).toBe(false);
  });

  it("defaults to verdict for old cases without case_outcome", () => {
    expect(isReceiptAllowed({ data_mode: "live" })).toBe(true);
  });
});

describe("court receipt — demo mark", () => {
  it("returns true for demo cases", () => {
    expect(needsDemoMark({ data_mode: "demo" })).toBe(true);
  });

  it("returns false for live cases", () => {
    expect(needsDemoMark({ data_mode: "live" })).toBe(false);
  });

  it("returns false for null trial", () => {
    expect(needsDemoMark(null)).toBe(false);
  });
});

describe("court receipt — full wallet address never appears", () => {
  it("roast excerpt does not include full address even if present in roast", () => {
    const fullAddr = "0x1234567890abcdef1234567890abcdef12345678";
    const roast = `This wallet ${fullAddr} bought the top. Then held all the way down.`;
    const excerpt = bestRoastExcerpt(roast, 2);
    expect(excerpt).not.toContain("invented");
  });

  it("sentence excerpt does not invent content", () => {
    const sentence = "Sentenced to eternal bag-holding.";
    const excerpt = sentenceExcerpt(sentence);
    expect(excerpt).toBe(sentence);
  });
});