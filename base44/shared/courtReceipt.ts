// Wallet Court — Court Receipt shared logic. Pure, unit-testable functions
// for receipt content extraction, truncation, and validation. Imported by
// backend functions and unit-tested without platform runtime or canvas.
//
// The client-side src/lib/courtReceipt.js mirrors these functions for canvas
// rendering. Both copies must stay in sync.

import { resolveCaseOutcome } from "./accountDashboard.ts";

export const RECEIPT_SIZES = {
  landscape: { w: 1200, h: 675, label: "X Landscape" },
  portrait: { w: 1080, h: 1350, label: "Portrait" },
};

export const RECEIPT_BRANDING = {
  x_handle: "@ShoutItWorld",
  domain: "court.shoutit.world",
  cta: "PUT YOUR WALLET ON TRIAL",
};

// Extract the best 1-2 sentences of roast text for the receipt.
export function bestRoastExcerpt(roast, maxSentences = 2) {
  if (!roast) return "";
  const sentences = String(roast).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

// Extract a sentence excerpt (first 1-2 sentences) for the stamped section.
export function sentenceExcerpt(sentence, maxSentences = 2) {
  if (!sentence) return "";
  const sentences = String(sentence).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

// Truncate a single line to maxLen with ellipsis at word boundary.
// Never cuts a word in the middle. If no word boundary is found, returns
// just the ellipsis (never a partial word).
export function truncateLine(line, maxLen) {
  if (!line || line.length <= maxLen) return line;
  const ellipsis = "…";
  const target = maxLen - ellipsis.length;
  if (target <= 0) return ellipsis;
  const truncated = line.slice(0, target);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace).trimEnd() + ellipsis;
  }
  return ellipsis;
}

// Check if a receipt is allowed for this case. Only verdict and demo cases
// get receipts — never dismissed or mistrial.
export function isReceiptAllowed(trial) {
  if (!trial) return false;
  const outcome = resolveCaseOutcome(trial);
  return outcome === "verdict" || outcome === "demo";
}

// Check if a demo mark should be shown.
export function needsDemoMark(trial) {
  return trial?.data_mode === "demo";
}

// Compact case reference for receipt images: "CASE 21FGLZYEAD8M".
// The X post carries the clickable URL; the image shows this compact ref.
export function compactCaseRef(slug) {
  if (!slug) return "";
  const id = String(slug).replace(/^case-/, "").toUpperCase();
  return `CASE ${id}`;
}

// Layout constants for the landscape receipt (1200×675). Used by tests to
// verify sentencing/footer separation and that all elements fit within
// the canvas. The canvas renderer in src/lib/courtReceipt.js uses the same
// values.
export const LANDSCAPE_LAYOUT = {
  header: { y: 0, h: 80 },
  stamp: { y: 140 },
  verdict: { y: 240 },
  network: { y: 290 },
  stats: { y: 325, h: 70 },
  roastLabel: { y: 420 },
  roast: { y: 444, maxLines: 2, lineH: 26 },
  sentencing: { y: 508, h: 72 },
  footer: { y: 595, h: 80 },
};

// Layout constants for the portrait receipt (1080×1350). Used by tests to
// verify content fills the canvas without a giant unused region.
export const PORTRAIT_LAYOUT = {
  header: { y: 0, h: 120 },
  stamp: { y: 200 },
  verdict: { y: 350 },
  network: { y: 430 },
  stats: { y: 480, h: 100 },
  roastLabel: { y: 620 },
  roast: { y: 656, maxLines: 4, lineH: 44 },
  sentencing: { y: 870, h: 300 },
  footer: { y: 1230, h: 120 },
};

// Layout result for the sentence box after fitting.
export interface SentenceBoxLayout {
  lines: string[];
  fontPx: number;
  lineHeight: number;
  boxHeight: number;
  textStartY: number; // Y offset within the box where text begins
}

// Fit sentence text into a box with dynamic height. Reduces font size from
// initialFontPx down to minFontPx (inclusive, 1px steps) until the wrapped
// text fits within maxBoxHeight. If it still doesn't fit at minFontPx, the
// box height is capped at maxBoxHeight (text is truncated by
// wrapTextTruncatePure's ellipsis logic). The complete sentence remains
// visible for all currently permitted sentence lengths at a readable size.
//
// measureFn(text, fontPx) returns the rendered width of text at the given
// font size — in the canvas renderer this is ctx.measureText(text).width
// after setting ctx.font; in tests it is a deterministic mock.
export function fitSentenceBox(
  text: string,
  measureFn: (text: string, fontPx: number) => number,
  maxWidth: number,
  maxBoxHeight: number,
  options: {
    labelHeight: number;
    padding: number;
    initialFontPx: number;
    minFontPx: number;
    lineHeightMultiplier: number;
    maxLines: number;
  }
): SentenceBoxLayout {
  const { labelHeight, padding, initialFontPx, minFontPx, lineHeightMultiplier, maxLines } = options;

  let fontPx = initialFontPx;
  while (fontPx >= minFontPx) {
    const lineHeight = Math.round(fontPx * lineHeightMultiplier);
    const lines = wrapTextTruncatePure(text, (t) => measureFn(t, fontPx), maxWidth, maxLines);
    const textHeight = lines.length * lineHeight;
    const requiredHeight = padding + labelHeight + padding + textHeight + padding;
    if (requiredHeight <= maxBoxHeight) {
      return { lines, fontPx, lineHeight, boxHeight: requiredHeight, textStartY: padding + labelHeight + padding };
    }
    fontPx -= 1;
  }

  // Force fit at min font size — cap box height at maxBoxHeight.
  const lineHeight = Math.round(minFontPx * lineHeightMultiplier);
  const lines = wrapTextTruncatePure(text, (t) => measureFn(t, minFontPx), maxWidth, maxLines);
  const textHeight = lines.length * lineHeight;
  const requiredHeight = padding + labelHeight + padding + textHeight + padding;
  const boxHeight = Math.min(requiredHeight, maxBoxHeight);
  return { lines, fontPx: minFontPx, lineHeight, boxHeight, textStartY: padding + labelHeight + padding };
}

// Calculate the roast text bounds: wrapped lines and the Y coordinate where
// the roast block ends (startY + lines * lineHeight).
export function calculateRoastBounds(
  text: string,
  measureFn: (text: string) => number,
  maxWidth: number,
  startY: number,
  maxLines: number,
  lineHeight: number
): { lines: string[]; endY: number } {
  const lines = wrapTextTruncatePure(text, measureFn, maxWidth, maxLines);
  return { lines, endY: startY + lines.length * lineHeight };
}

// Calculate the sentence box start Y and the maximum available height,
// given the roast end Y, the gap before the sentence box, the footer Y,
// and the safe gap that must separate the sentence box from the footer.
export function calculateSentenceBoxBounds(
  roastEndY: number,
  gapBeforeSentence: number,
  footerY: number,
  safeGap: number
): { boxStartY: number; maxBoxHeight: number } {
  const boxStartY = roastEndY + gapBeforeSentence;
  const maxBoxBottom = footerY - safeGap;
  const maxBoxHeight = Math.max(0, maxBoxBottom - boxStartY);
  return { boxStartY, maxBoxHeight };
}

// Verify that a sentence box layout fits within its bounds: the box bottom
// (boxStartY + boxHeight) must not exceed the footer minus the safe gap, and
// the text (boxStartY + textStartY + lines * lineHeight) must not exceed the
// box bottom. Returns true if everything is within bounds.
export function sentenceBoxFits(
  layout: SentenceBoxLayout,
  boxStartY: number,
  footerY: number,
  safeGap: number
): boolean {
  const boxBottom = boxStartY + layout.boxHeight;
  if (boxBottom > footerY - safeGap) return false;
  const textBottom = boxStartY + layout.textStartY + layout.lines.length * layout.lineHeight;
  if (textBottom > boxBottom) return false;
  return true;
}

// Wrap text into lines using a measure function (for canvas-independent testing).
// Returns the lines array. Truncates with ellipsis if exceeding maxLines.
export function wrapTextTruncatePure(text, measureFn, maxWidth, maxLines) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let line = "";
  let wordIdx = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = line ? line + " " + w : w;
    if (measureFn(test) > maxWidth && line) {
      lines.push(line);
      line = w;
      wordIdx = i;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
      wordIdx = i + 1;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  // If not all words were used and we hit maxLines, add ellipsis
  if (wordIdx < words.length && lines.length >= maxLines) {
    let last = lines[lines.length - 1];
    const ellipsis = "…";
    while (last && measureFn(last + ellipsis) > maxWidth && last.includes(" ")) {
      last = last.split(" ").slice(0, -1).join(" ");
    }
    if (last) {
      lines[lines.length - 1] = last + (measureFn(last + ellipsis) <= maxWidth ? ellipsis : "");
    }
  }

  return lines;
}