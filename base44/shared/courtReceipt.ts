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