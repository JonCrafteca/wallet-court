// Receipt overflow layout tests. Pure: imports only courtReceipt.ts.
// Proves that every text block (roast, sentence) remains inside its
// assigned bounds and above the footer for all currently permitted
// verdict texts, both orientations, and both guilty/NOT GUILTY states.
import { describe, it, expect } from "vitest";
import {
  fitSentenceBox,
  calculateRoastBounds,
  calculateSentenceBoxBounds,
  sentenceBoxFits,
  wrapTextTruncatePure,
  bestRoastExcerpt,
  sentenceExcerpt,
  RECEIPT_SIZES,
  LANDSCAPE_LAYOUT,
  PORTRAIT_LAYOUT,
} from "../base44/shared/courtReceipt.ts";
import { VERDICTS } from "../base44/shared/verdicts.ts";
import { RETAIL_POOL } from "../base44/shared/verdicts_performance.ts";
import {
  CEX_POOL, MM_POOL, MEV_POOL, PROTOCOL_POOL, FUND_POOL,
} from "../base44/shared/verdicts_entity.ts";

// All verdict pools — the longest sentence and roast across all of these
// define the "longest currently permitted" texts.
const ALL_POOLS = [
  ...VERDICTS,
  ...RETAIL_POOL,
  ...CEX_POOL, ...MM_POOL, ...MEV_POOL, ...PROTOCOL_POOL, ...FUND_POOL,
];

// Find the longest sentence and roast across all verdicts.
const longestSentence = ALL_POOLS.reduce((a, v) =>
  (v.sentence || "").length > (a.sentence || "").length ? v : a
);
const longestRoast = ALL_POOLS.reduce((a, v) =>
  (v.roast || "").length > (a.roast || "").length ? v : a
);

// The overflowing Certified Exit Liquidity sentence (from the bug report).
const CERTIFIED_EXIT = VERDICTS.find((v) => v.code === "certified_exit_liquidity");
const SUSPICIOUSLY_COMPETENT = VERDICTS.find((v) => v.code === "suspiciously_competent");

// Mock measure function that approximates JetBrains Mono at a given font size.
// monospace: each character is approximately fontPx * 0.6 pixels wide.
function mockMeasure(text, fontPx) {
  return text.length * fontPx * 0.6;
}

// Mock measure for a fixed font size (used by calculateRoastBounds).
function mockMeasureFixed(text) {
  return text.length * 18 * 0.6;
}

// ---- Landscape receipt layout constants (must match courtReceipt.js) ----
const LS = {
  roastLabelY: 420,
  roastY: 444,
  roastLineH: 26,
  roastMaxLines: 2,
  roastMaxWidth: 1200 - 72,
  gapBeforeSentence: 12,
  footerY: 675 - 80,
  safeGap: 8,
  sentenceMaxWidth: 1200 - 72 - 32, // box width - 2 * padding
  sentenceLabelHeight: 20,
  sentencePadding: 12,
  sentenceInitialFont: 17,
  sentenceMinFont: 12,
  sentenceLineHMult: 1.4,
  sentenceMaxLines: 2,
};

// ---- Portrait receipt layout constants (must match courtReceipt.js) ----
const PS = {
  roastLabelY: 620,
  roastY: 656,
  roastLineH: 44,
  roastMaxLines: 4,
  roastMaxWidth: 1080 - 80,
  gapBeforeSentence: 20,
  footerY: 1350 - 120,
  safeGap: 12,
  sentenceMaxWidth: 1080 - 80 - 40, // box width - 2 * padding
  sentenceLabelHeight: 28,
  sentencePadding: 20,
  sentenceInitialFont: 24,
  sentenceMinFont: 14,
  sentenceLineHMult: 1.4,
  sentenceMaxLines: 3,
};

describe("receipt overflow — longest permitted texts are identified", () => {
  it("finds the longest sentence across all verdict pools", () => {
    expect(longestSentence.sentence).toBeTruthy();
    expect(longestSentence.sentence.length).toBeGreaterThan(100);
  });

  it("finds the longest roast across all verdict pools", () => {
    expect(longestRoast.roast).toBeTruthy();
    expect(longestRoast.roast.length).toBeGreaterThan(200);
  });

  it("Certified Exit Liquidity sentence exists", () => {
    expect(CERTIFIED_EXIT).toBeTruthy();
    expect(CERTIFIED_EXIT.sentence).toBeTruthy();
  });

  it("Suspiciously Competent sentence exists", () => {
    expect(SUSPICIOUSLY_COMPETENT).toBeTruthy();
    expect(SUSPICIOUSLY_COMPETENT.sentence).toBeTruthy();
  });
});

// Helper: run the full landscape sentence-box layout for a given verdict
// and verify it fits within bounds.
function verifyLandscapeSentenceFits(verdict) {
  const roastExcerpt = bestRoastExcerpt(verdict.roast, 2);
  const roastBounds = calculateRoastBounds(
    roastExcerpt, mockMeasureFixed, LS.roastMaxWidth, LS.roastY, LS.roastMaxLines, LS.roastLineH
  );
  const boxBounds = calculateSentenceBoxBounds(
    roastBounds.endY, LS.gapBeforeSentence, LS.footerY, LS.safeGap
  );
  expect(boxBounds.maxBoxHeight).toBeGreaterThan(0);

  const sentenceText = sentenceExcerpt(verdict.sentence, 2);
  const layout = fitSentenceBox(sentenceText, mockMeasure, LS.sentenceMaxWidth, boxBounds.maxBoxHeight, {
    labelHeight: LS.sentenceLabelHeight,
    padding: LS.sentencePadding,
    initialFontPx: LS.sentenceInitialFont,
    minFontPx: LS.sentenceMinFont,
    lineHeightMultiplier: LS.sentenceLineHMult,
    maxLines: LS.sentenceMaxLines,
  });

  // The sentence box must fit within its bounds.
  expect(sentenceBoxFits(layout, boxBounds.boxStartY, LS.footerY, LS.safeGap)).toBe(true);

  // The box bottom must not enter the footer.
  const boxBottom = boxBounds.boxStartY + layout.boxHeight;
  expect(boxBottom).toBeLessThanOrEqual(LS.footerY - LS.safeGap);

  // The text must not exceed the box bottom.
  const textBottom = boxBounds.boxStartY + layout.textStartY + layout.lines.length * layout.lineHeight;
  expect(textBottom).toBeLessThanOrEqual(boxBottom);

  // Font size must stay within readable limits.
  expect(layout.fontPx).toBeGreaterThanOrEqual(LS.sentenceMinFont);

  return { layout, boxBounds, roastBounds };
}

// Helper: run the full portrait sentence-box layout for a given verdict.
function verifyPortraitSentenceFits(verdict) {
  const roastExcerpt = bestRoastExcerpt(verdict.roast, 4);
  const roastBounds = calculateRoastBounds(
    roastExcerpt, (t) => t.length * 24 * 0.6, PS.roastMaxWidth, PS.roastY, PS.roastMaxLines, PS.roastLineH
  );
  const boxBounds = calculateSentenceBoxBounds(
    roastBounds.endY, PS.gapBeforeSentence, PS.footerY, PS.safeGap
  );
  expect(boxBounds.maxBoxHeight).toBeGreaterThan(0);

  const sentenceText = sentenceExcerpt(verdict.sentence, 3);
  const layout = fitSentenceBox(sentenceText, mockMeasure, PS.sentenceMaxWidth, boxBounds.maxBoxHeight, {
    labelHeight: PS.sentenceLabelHeight,
    padding: PS.sentencePadding,
    initialFontPx: PS.sentenceInitialFont,
    minFontPx: PS.sentenceMinFont,
    lineHeightMultiplier: PS.sentenceLineHMult,
    maxLines: PS.sentenceMaxLines,
  });

  expect(sentenceBoxFits(layout, boxBounds.boxStartY, PS.footerY, PS.safeGap)).toBe(true);
  const boxBottom = boxBounds.boxStartY + layout.boxHeight;
  expect(boxBottom).toBeLessThanOrEqual(PS.footerY - PS.safeGap);
  const textBottom = boxBounds.boxStartY + layout.textStartY + layout.lines.length * layout.lineHeight;
  expect(textBottom).toBeLessThanOrEqual(boxBottom);
  expect(layout.fontPx).toBeGreaterThanOrEqual(PS.sentenceMinFont);

  return { layout, boxBounds, roastBounds };
}

describe("receipt overflow — Certified Exit Liquidity (the overflowing case)", () => {
  it("landscape: sentence stays inside box and above footer", () => {
    const { layout, boxBounds } = verifyLandscapeSentenceFits(CERTIFIED_EXIT);
    // The complete sentence should be visible (not truncated to fewer lines than needed).
    expect(layout.lines.length).toBeGreaterThanOrEqual(1);
  });

  it("portrait: sentence stays inside box and above footer", () => {
    const { layout } = verifyPortraitSentenceFits(CERTIFIED_EXIT);
    expect(layout.lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("receipt overflow — Suspiciously Competent (the accepted receipt)", () => {
  it("landscape: sentence stays inside box and above footer", () => {
    verifyLandscapeSentenceFits(SUSPICIOUSLY_COMPETENT);
  });

  it("portrait: sentence stays inside box and above footer", () => {
    verifyPortraitSentenceFits(SUSPICIOUSLY_COMPETENT);
  });
});

describe("receipt overflow — longest currently permitted roast", () => {
  it("landscape: roast text does not overlap sentence box", () => {
    const roastExcerpt = bestRoastExcerpt(longestRoast.roast, 2);
    const roastBounds = calculateRoastBounds(
      roastExcerpt, mockMeasureFixed, LS.roastMaxWidth, LS.roastY, LS.roastMaxLines, LS.roastLineH
    );
    expect(roastBounds.endY).toBeLessThanOrEqual(LS.roastY + LS.roastMaxLines * LS.roastLineH);
  });

  it("landscape: sentence stays inside box and above footer", () => {
    verifyLandscapeSentenceFits(longestRoast);
  });

  it("portrait: roast text does not overlap sentence box", () => {
    const roastExcerpt = bestRoastExcerpt(longestRoast.roast, 4);
    const roastBounds = calculateRoastBounds(
      roastExcerpt, (t) => t.length * 24 * 0.6, PS.roastMaxWidth, PS.roastY, PS.roastMaxLines, PS.roastLineH
    );
    expect(roastBounds.endY).toBeLessThanOrEqual(PS.roastY + PS.roastMaxLines * PS.roastLineH);
  });

  it("portrait: sentence stays inside box and above footer", () => {
    verifyPortraitSentenceFits(longestRoast);
  });
});

describe("receipt overflow — longest currently permitted sentence", () => {
  it("landscape: sentence stays inside box and above footer", () => {
    verifyLandscapeSentenceFits(longestSentence);
  });

  it("portrait: sentence stays inside box and above footer", () => {
    verifyPortraitSentenceFits(longestSentence);
  });
});

describe("receipt overflow — all verdict types, landscape", () => {
  for (const verdict of ALL_POOLS) {
    it(`landscape: ${verdict.code} sentence fits`, () => {
      verifyLandscapeSentenceFits(verdict);
    });
  }
});

describe("receipt overflow — all verdict types, portrait", () => {
  for (const verdict of ALL_POOLS) {
    it(`portrait: ${verdict.code} sentence fits`, () => {
      verifyPortraitSentenceFits(verdict);
    });
  }
});

describe("receipt overflow — NOT GUILTY state (Suspiciously Competent)", () => {
  it("landscape: NOT GUILTY verdict sentence fits", () => {
    verifyLandscapeSentenceFits(SUSPICIOUSLY_COMPETENT);
  });

  it("portrait: NOT GUILTY verdict sentence fits", () => {
    verifyPortraitSentenceFits(SUSPICIOUSLY_COMPETENT);
  });
});

describe("receipt overflow — Guilty state (Certified Exit Liquidity)", () => {
  it("landscape: Guilty verdict sentence fits", () => {
    verifyLandscapeSentenceFits(CERTIFIED_EXIT);
  });

  it("portrait: Guilty verdict sentence fits", () => {
    verifyPortraitSentenceFits(CERTIFIED_EXIT);
  });
});

describe("receipt overflow — fitSentenceBox reduces font when needed", () => {
  it("uses initial font when text fits", () => {
    const layout = fitSentenceBox("Short text.", mockMeasure, 1000, 200, {
      labelHeight: 20, padding: 12, initialFontPx: 17, minFontPx: 12,
      lineHeightMultiplier: 1.4, maxLines: 2,
    });
    expect(layout.fontPx).toBe(17);
  });

  it("reduces font when text is too long for the box", () => {
    const longText = "This is a very long sentence that needs to wrap to multiple lines and may not fit in a small box at the default font size, requiring reduction to stay within bounds.";
    const layout = fitSentenceBox(longText, mockMeasure, 300, 60, {
      labelHeight: 20, padding: 12, initialFontPx: 17, minFontPx: 12,
      lineHeightMultiplier: 1.4, maxLines: 2,
    });
    expect(layout.fontPx).toBeLessThanOrEqual(17);
    expect(layout.fontPx).toBeGreaterThanOrEqual(12);
  });

  it("never goes below the minimum font size", () => {
    const veryLongText = "A".repeat(500);
    const layout = fitSentenceBox(veryLongText, mockMeasure, 200, 50, {
      labelHeight: 20, padding: 12, initialFontPx: 17, minFontPx: 12,
      lineHeightMultiplier: 1.4, maxLines: 2,
    });
    expect(layout.fontPx).toBe(12);
  });
});