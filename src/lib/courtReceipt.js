// Client-side Court Receipt generator. Renders entirely from saved, sanitized
// case data to a canvas — no Nansen calls, no AI, no external screenshot
// services. Supports two PNG formats: X landscape (1200×675) and portrait
// (1080×1350). Uses the existing Wallet Court Electric Court TV design system.
//
// Content rules:
// - Uses only saved case data (verdict_name, roast, sentence, severity, etc.)
// - Never includes the full wallet address (only abbreviated)
// - Never includes internal IDs, account IDs, audit data, or signatures
// - Never invents roast or sentencing text
// - Text is wrapped safely and truncated with ellipsis (never mid-word)
// - Fonts are loaded before rendering
// - Demo receipts display a clear DEMO mark
// - NOT GUILTY stamp uses the canonical treatment from notGuiltyStamp.js
// - The X post carries the clickable URL; the image shows domain + case ref

import { displayAddressShort } from "@/lib/wallet";
import { getCaseOutcome } from "@/lib/caseOutcome";
import { drawStampCanvas } from "@/lib/notGuiltyStamp";
import { isMobileDevice, canShareFiles } from "./shareDevice";

export { isMobileDevice, canShareFiles };

const COLORS = {
  cobalt: "#2457FF",
  uv: "#5127C7",
  navy: "#10142A",
  ice: "#F5F7FF",
  chart: "#D8FF32",
  red: "#FF3B30",
  mute: "#B8C7FF",
};

const RECEIPT_X_HANDLE = "@ShoutItWorld";
const RECEIPT_DOMAIN = "court.shoutit.world";
const RECEIPT_CTA = "PUT YOUR WALLET ON TRIAL";

export const RECEIPT_SIZES = {
  landscape: { w: 1200, h: 675, label: "X Landscape" },
  portrait: { w: 1080, h: 1350, label: "Portrait" },
};

// Compact case reference: "CASE 21FGLZYEAD8M"
function compactCaseRef(slug) {
  if (!slug) return "";
  const id = String(slug).replace(/^case-/, "").toUpperCase();
  return `CASE ${id}`;
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 80px Anton'),
      document.fonts.load('600 40px Oswald'),
      document.fonts.load('500 22px "JetBrains Mono"'),
      document.fonts.load('400 18px "JetBrains Mono"'),
    ]);
  } catch {
    // fall back to system fonts if web fonts are unavailable
  }
}

// Wrap text to max width, max lines. Truncates with ellipsis if exceeding maxLines.
// Never cuts a word in the middle — truncates at word boundary.
function wrapTextTruncate(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let line = "";
  let wordIdx = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
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

  if (wordIdx < words.length && lines.length >= maxLines) {
    let last = lines[lines.length - 1];
    const ellipsis = "…";
    while (last && ctx.measureText(last + ellipsis).width > maxWidth && last.includes(" ")) {
      last = last.split(" ").slice(0, -1).join(" ");
    }
    if (last) {
      lines[lines.length - 1] = last + (ctx.measureText(last + ellipsis).width <= maxWidth ? ellipsis : "");
    }
  }

  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines;
}

// Wrap text to max width, max lines — measure only, does NOT draw.
// Returns the lines array so the caller can calculate the required height
// before positioning and drawing the box.
function wrapTextMeasure(ctx, text, maxWidth, maxLines) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let line = "";
  let wordIdx = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
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
  if (wordIdx < words.length && lines.length >= maxLines) {
    let last = lines[lines.length - 1];
    const ellipsis = "…";
    while (last && ctx.measureText(last + ellipsis).width > maxWidth && last.includes(" ")) {
      last = last.split(" ").slice(0, -1).join(" ");
    }
    if (last) {
      lines[lines.length - 1] = last + (ctx.measureText(last + ellipsis).width <= maxWidth ? ellipsis : "");
    }
  }
  return lines;
}

function bestRoastExcerpt(roast, maxSentences = 2) {
  if (!roast) return "";
  const sentences = String(roast).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

function sentenceExcerpt(sentence, maxSentences = 2) {
  if (!sentence) return "";
  const sentences = String(sentence).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

// Draw a stat box (Severity or Confidence) at the given position.
function drawStatBox(ctx, x, y, w, h, label, value, scale) {
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${14 * scale}px Oswald, sans-serif`;
  ctx.fillText(label, x + 12 * scale, y + 22 * scale);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${34 * scale}px Anton, sans-serif`;
  ctx.fillText(value, x + 12 * scale, y + 56 * scale);
}

export async function drawCourtReceipt(canvas, trial, orientation = "landscape") {
  const outcome = getCaseOutcome(trial);
  if (outcome === "dismissed_no_evidence" || outcome === "mistrial_insufficient_evidence") {
    throw new Error("Court receipts are not available for dismissed or mistrial cases.");
  }

  await ensureFonts();
  const ctx = canvas.getContext("2d");
  const size = RECEIPT_SIZES[orientation] || RECEIPT_SIZES.landscape;
  const W = canvas.width;
  const H = canvas.height;
  const s = W / size.w;

  const isLive = trial.data_mode === "live";
  const isDemo = trial.data_mode === "demo";

  // Background gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.cobalt);
  g.addColorStop(0.5, COLORS.uv);
  g.addColorStop(1, COLORS.navy);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Grid texture
  ctx.strokeStyle = "rgba(245,247,255,0.04)";
  ctx.lineWidth = 1 * s;
  for (let x = 0; x <= W; x += 64 * s) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 64 * s) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  if (orientation === "portrait") {
    drawPortraitReceipt(ctx, trial, W, H, s, isLive, isDemo);
  } else {
    drawLandscapeReceipt(ctx, trial, W, H, s, isLive, isDemo);
  }

  // DEMO mark
  if (isDemo) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.3);
    ctx.font = `700 ${60 * s}px Anton, sans-serif`;
    const demoText = "DEMO";
    const demoW = ctx.measureText(demoText).width + 60 * s;
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 6 * s;
    ctx.strokeRect(-demoW / 2, -40 * s, demoW, 80 * s);
    ctx.fillStyle = COLORS.red;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.8;
    ctx.fillText(demoText, 0, 0);
    ctx.restore();
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// Landscape receipt — 1200×675. Preserves the existing composition while
// fixing: canonical NOT GUILTY stamp, THE ROAST label, confidence beside
// severity, domain + case ref instead of URL, sentencing box border, and
// footer separation.
function drawLandscapeReceipt(ctx, trial, W, H, s, isLive, isDemo) {
  // 1. Header bar
  const barH = 80 * s;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, 0, W, barH);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${32 * s}px Anton, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("WALLET COURT", 36 * s, barH / 2);

  // Live/demo badge
  const badgeText = isLive ? "LIVE · NANSEN" : "DEMO";
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  const bw = ctx.measureText(badgeText).width + 28 * s;
  ctx.fillStyle = isLive ? COLORS.chart : COLORS.red;
  ctx.fillRect(W - bw - 36 * s, 24 * s, bw, 34 * s);
  ctx.fillStyle = isLive ? COLORS.navy : COLORS.ice;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, W - bw / 2 - 36 * s, 42 * s);
  ctx.textAlign = "left";

  // 2. Canonical stamp
  drawStampCanvas(ctx, 120 * s, 140 * s, trial.verdict_code, s, 28);

  // 3. Verdict headline
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${78 * s}px Anton, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const verdictText = (trial.verdict_name || "").toUpperCase();
  let displayVerdict = verdictText;
  const maxVerdictWidth = W - 72 * s;
  while (displayVerdict && ctx.measureText(displayVerdict).width > maxVerdictWidth) {
    displayVerdict = displayVerdict.slice(0, -1);
  }
  if (displayVerdict !== verdictText && displayVerdict.length > 3) {
    displayVerdict = displayVerdict.slice(0, -1) + "…";
  }
  ctx.fillText(displayVerdict, 36 * s, 240 * s);

  // 4. Network + address
  const short = displayAddressShort(trial);
  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${20 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(`${(trial.network || "").toUpperCase()} · ${short}`, 36 * s, 290 * s);

  // 5. Severity + Confidence (side by side)
  const sevY = 325 * s;
  const boxH = 70 * s;
  const boxW = 200 * s;
  const gap = 20 * s;

  drawStatBox(ctx, 36 * s, sevY, boxW, boxH, "SEVERITY", `${Math.round(trial.severity_score || 0)}/100`, s);

  if (trial.confidence_score != null) {
    drawStatBox(ctx, 36 * s + boxW + gap, sevY, boxW, boxH, "CONFIDENCE", `${Math.round(trial.confidence_score)}%`, s);
  }

  // 6. THE ROAST label + text
  const roastLabelY = 420 * s;
  ctx.fillStyle = COLORS.red;
  ctx.font = `600 ${14 * s}px Oswald, sans-serif`;
  ctx.fillText("THE ROAST", 36 * s, roastLabelY);

  const roastY = roastLabelY + 24 * s;
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${18 * s}px "JetBrains Mono", monospace`;
  const roastExcerpt = bestRoastExcerpt(trial.roast, 2);
  const roastLines = wrapTextTruncate(ctx, roastExcerpt, 36 * s, roastY, W - 72 * s, 26 * s, 2);
  const roastEndY = roastY + roastLines.length * 26 * s;

  // 7. Sentencing box — dynamic position after roast, dynamic height from
  // wrapped lines, font reduction within readable limits. The box never
  // crosses the footer border.
  const sentenceGap = 12 * s;
  const footerTopY = H - 80 * s;
  const safeGap = 8 * s;
  const sentenceBoxY = roastEndY + sentenceGap;
  const maxBoxBottom = footerTopY - safeGap;
  const maxBoxHeight = Math.max(0, maxBoxBottom - sentenceBoxY);
  const sentenceBoxW = W - 72 * s;
  const sentencePad = 12 * s;
  const sentenceTextWidth = sentenceBoxW - sentencePad * 2;
  const sentenceLabelH = 20 * s;

  const sentenceText = sentenceExcerpt(trial.sentence, 2);
  let sentenceFontPx = 17;
  let sentenceLineH = 24 * s;
  let sentenceLines = [];
  if (sentenceText) {
    for (let fp = 17; fp >= 12; fp--) {
      const lh = Math.round(fp * 1.4) * s;
      ctx.font = `500 ${fp * s}px "JetBrains Mono", monospace`;
      const lines = wrapTextMeasure(ctx, sentenceText, sentenceTextWidth, 2);
      const requiredH = sentencePad + sentenceLabelH + sentencePad + lines.length * lh + sentencePad;
      if (requiredH <= maxBoxHeight) {
        sentenceFontPx = fp;
        sentenceLineH = lh;
        sentenceLines = lines;
        break;
      }
      if (fp === 12) {
        sentenceFontPx = fp;
        sentenceLineH = lh;
        sentenceLines = lines;
      }
    }
  }

  const sentenceBoxH = Math.min(
    sentencePad + sentenceLabelH + sentencePad + sentenceLines.length * sentenceLineH + sentencePad,
    maxBoxHeight
  );

  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(36 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);
  ctx.strokeStyle = COLORS.chart;
  ctx.lineWidth = 3 * s;
  ctx.strokeRect(36 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${13 * s}px Oswald, sans-serif`;
  ctx.fillText("THE COURT SENTENCES YOU TO…", 36 * s + sentencePad, sentenceBoxY + sentencePad + 16 * s);

  if (sentenceText && sentenceLines.length > 0) {
    ctx.fillStyle = COLORS.ice;
    ctx.font = `500 ${sentenceFontPx * s}px "JetBrains Mono", monospace`;
    const textStartY = sentenceBoxY + sentencePad + sentenceLabelH + sentencePad;
    sentenceLines.forEach((line, i) => {
      ctx.fillText(line, 36 * s + sentencePad, textStartY + i * sentenceLineH + sentenceLineH * 0.8);
    });
  }

  // 8. Footer (domain + case ref, not full URL)
  const footerH = 80 * s;
  const footerY = H - footerH;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, footerY, W, footerH);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${18 * s}px Oswald, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(RECEIPT_X_HANDLE, 36 * s, footerY + 28 * s);

  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${16 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(RECEIPT_DOMAIN, 36 * s, footerY + 54 * s);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `700 ${20 * s}px Anton, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(RECEIPT_CTA, W - 36 * s, footerY + 28 * s);

  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${14 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(compactCaseRef(trial.public_slug), W - 36 * s, footerY + 54 * s);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// Portrait receipt — 1080×1350. Deliberate vertical composition, not a
// stretched landscape. Content fills from header to footer with balanced
// spacing and no giant empty region.
function drawPortraitReceipt(ctx, trial, W, H, s, isLive, isDemo) {
  // 1. Header: Wallet Court + LIVE · NANSEN
  const barH = 120 * s;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, 0, W, barH);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${40 * s}px Anton, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("WALLET COURT", 40 * s, barH / 2);

  const badgeText = isLive ? "LIVE · NANSEN" : "DEMO";
  ctx.font = `600 ${20 * s}px Oswald, sans-serif`;
  const bw = ctx.measureText(badgeText).width + 32 * s;
  ctx.fillStyle = isLive ? COLORS.chart : COLORS.red;
  ctx.fillRect(W - bw - 40 * s, 35 * s, bw, 42 * s);
  ctx.fillStyle = isLive ? COLORS.navy : COLORS.ice;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, W - bw / 2 - 40 * s, 56 * s);
  ctx.textAlign = "left";

  // 2. Canonical NOT GUILTY stamp
  drawStampCanvas(ctx, W / 2, 200 * s, trial.verdict_code, s, 36);

  // 3. Large verdict headline
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${100 * s}px Anton, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const verdictText = (trial.verdict_name || "").toUpperCase();
  let displayVerdict = verdictText;
  const maxVerdictWidth = W - 80 * s;
  while (displayVerdict && ctx.measureText(displayVerdict).width > maxVerdictWidth) {
    displayVerdict = displayVerdict.slice(0, -1);
  }
  if (displayVerdict !== verdictText && displayVerdict.length > 3) {
    displayVerdict = displayVerdict.slice(0, -1) + "…";
  }
  ctx.fillText(displayVerdict, 40 * s, 350 * s);

  // 4. Network + abbreviated wallet
  const short = displayAddressShort(trial);
  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${28 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(`${(trial.network || "").toUpperCase()} · ${short}`, 40 * s, 430 * s);

  // 5. Severity and Confidence side by side
  const statY = 480 * s;
  const statH = 100 * s;
  const statW = 480 * s;
  const statGap = 40 * s;

  // Severity box
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(40 * s, statY, statW, statH);
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${18 * s}px Oswald, sans-serif`;
  ctx.fillText("SEVERITY", 52 * s, statY + 30 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${48 * s}px Anton, sans-serif`;
  ctx.fillText(`${Math.round(trial.severity_score || 0)}/100`, 52 * s, statY + 80 * s);

  // Confidence box (only if available)
  if (trial.confidence_score != null) {
    const confX = 40 * s + statW + statGap;
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(confX, statY, statW, statH);
    ctx.fillStyle = COLORS.chart;
    ctx.font = `600 ${18 * s}px Oswald, sans-serif`;
    ctx.fillText("CONFIDENCE", confX + 12 * s, statY + 30 * s);
    ctx.fillStyle = COLORS.ice;
    ctx.font = `700 ${48 * s}px Anton, sans-serif`;
    ctx.fillText(`${Math.round(trial.confidence_score)}%`, confX + 12 * s, statY + 80 * s);
  }

  // 6. THE ROAST content block
  const roastLabelY = 620 * s;
  ctx.fillStyle = COLORS.red;
  ctx.font = `600 ${20 * s}px Oswald, sans-serif`;
  ctx.fillText("THE ROAST", 40 * s, roastLabelY);

  const roastY = roastLabelY + 36 * s;
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${24 * s}px "JetBrains Mono", monospace`;
  const roastExcerpt = bestRoastExcerpt(trial.roast, 4);
  wrapTextTruncate(ctx, roastExcerpt, 40 * s, roastY, W - 80 * s, 44 * s, 4);

  // 7. THE COURT SENTENCES YOU TO… block
  const sentenceBoxY = 870 * s;
  const sentenceBoxH = 300 * s;
  const sentenceBoxW = W - 80 * s;
  const sentencePad = 20 * s;

  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(40 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);
  ctx.strokeStyle = COLORS.chart;
  ctx.lineWidth = 4 * s;
  ctx.strokeRect(40 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${20 * s}px Oswald, sans-serif`;
  ctx.fillText("THE COURT SENTENCES YOU TO…", 40 * s + sentencePad, sentenceBoxY + 36 * s);

  const sentenceText = sentenceExcerpt(trial.sentence, 3);
  if (sentenceText) {
    ctx.fillStyle = COLORS.ice;
    ctx.font = `500 ${24 * s}px "JetBrains Mono", monospace`;
    wrapTextTruncate(
      ctx,
      sentenceText,
      40 * s + sentencePad,
      sentenceBoxY + 84 * s,
      sentenceBoxW - sentencePad * 2,
      46 * s,
      3
    );
  }

  // 8. Compact branded footer
  const footerH = 120 * s;
  const footerY = H - footerH;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, footerY, W, footerH);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${24 * s}px Oswald, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(RECEIPT_X_HANDLE, 40 * s, footerY + 35 * s);

  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${20 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(RECEIPT_DOMAIN, 40 * s, footerY + 75 * s);

  ctx.fillStyle = COLORS.chart;
  ctx.font = `700 ${28 * s}px Anton, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(RECEIPT_CTA, W - 40 * s, footerY + 35 * s);

  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${18 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(compactCaseRef(trial.public_slug), W - 40 * s, footerY + 75 * s);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadCourtReceipt(trial, orientation = "landscape") {
  const size = RECEIPT_SIZES[orientation] || RECEIPT_SIZES.landscape;
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  await drawCourtReceipt(canvas, trial, orientation);
  await new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        triggerDownload(blob, `wallet-court-receipt-${trial.public_slug}-${orientation}.png`);
        resolve();
      },
      "image/png"
    );
  });
}

export async function getCourtReceiptBlob(trial, orientation = "landscape") {
  const size = RECEIPT_SIZES[orientation] || RECEIPT_SIZES.landscape;
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  await drawCourtReceipt(canvas, trial, orientation);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render court receipt"))),
      "image/png"
    );
  });
}