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

import { displayAddressShort } from "@/lib/wallet";
import { getCaseOutcome } from "@/lib/caseOutcome";

const COLORS = {
  cobalt: "#2457FF",
  uv: "#5127C7",
  navy: "#10142A",
  ice: "#F5F7FF",
  chart: "#D8FF32",
  red: "#FF3B30",
  mute: "#B8C7FF",
};

// Branding constants for the Court Receipt
const RECEIPT_X_HANDLE = "@ShoutItWorld";
const RECEIPT_DOMAIN = "court.shoutit.world";
const RECEIPT_CTA = "PUT YOUR WALLET ON TRIAL";

export const RECEIPT_SIZES = {
  landscape: { w: 1200, h: 675, label: "X Landscape" },
  portrait: { w: 1080, h: 1350, label: "Portrait" },
};

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

  // If not all words were used and we hit maxLines, add ellipsis
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

// Extract the best 1-2 lines of roast: first 1-2 sentences, trimmed.
function bestRoastExcerpt(roast, maxSentences = 2) {
  if (!roast) return "";
  const sentences = String(roast).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

// Extract a sentence excerpt (first 1-2 sentences, trimmed).
function sentenceExcerpt(sentence, maxSentences = 2) {
  if (!sentence) return "";
  const sentences = String(sentence).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ").trim();
}

export async function drawCourtReceipt(canvas, trial, orientation = "landscape") {
  // Guard: never generate receipts for dismissed or mistrial cases
  const outcome = getCaseOutcome(trial);
  if (outcome === "dismissed_no_evidence" || outcome === "mistrial_insufficient_evidence") {
    throw new Error("Court receipts are not available for dismissed or mistrial cases.");
  }

  await ensureFonts();
  const ctx = canvas.getContext("2d");
  const size = RECEIPT_SIZES[orientation] || RECEIPT_SIZES.landscape;
  const W = canvas.width;
  const H = canvas.height;
  const s = W / size.w; // scale factor

  const isLive = trial.data_mode === "live";
  const isDemo = trial.data_mode === "demo";
  const competent = trial.verdict_code === "suspiciously_competent";

  // --- Background gradient ---
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.cobalt);
  g.addColorStop(0.5, COLORS.uv);
  g.addColorStop(1, COLORS.navy);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // --- Faint grid texture ---
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

  // --- Top brand bar ---
  const barH = orientation === "portrait" ? 100 * s : 80 * s;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, 0, W, barH);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${orientation === "portrait" ? 36 : 32 * s}px Anton, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("WALLET COURT", 36 * s, barH / 2);

  // Live/demo badge (top right)
  const badgeText = isLive ? "LIVE · NANSEN" : "DEMO";
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  const bw = ctx.measureText(badgeText).width + 28 * s;
  ctx.fillStyle = isLive ? COLORS.chart : COLORS.red;
  ctx.fillRect(W - bw - 36 * s, 24 * s, bw, 34 * s);
  ctx.fillStyle = isLive ? COLORS.navy : COLORS.ice;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, W - bw / 2 - 36 * s, 42 * s);
  ctx.textAlign = "left";

  // --- Verdict stamp ---
  const stampText = competent ? "NOT GUILTY" : "GUILTY";
  const stampY = orientation === "portrait" ? 160 * s : 140 * s;
  ctx.save();
  ctx.translate(120 * s, stampY);
  ctx.rotate(-0.1);
  ctx.font = `700 ${28 * s}px Anton, sans-serif`;
  const sw = ctx.measureText(stampText).width + 44 * s;
  ctx.strokeStyle = competent ? COLORS.chart : COLORS.red;
  ctx.lineWidth = 4 * s;
  ctx.strokeRect(-sw / 2, -20 * s, sw, 40 * s);
  ctx.fillStyle = competent ? COLORS.chart : COLORS.red;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(stampText, 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // --- Verdict name (dominant headline) ---
  const verdictY = orientation === "portrait" ? 260 * s : 240 * s;
  const verdictFontSize = orientation === "portrait" ? 88 * s : 78 * s;
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${verdictFontSize}px Anton, sans-serif`;
  const verdictText = (trial.verdict_name || "").toUpperCase();
  // Truncate verdict name if too wide
  let displayVerdict = verdictText;
  const maxVerdictWidth = W - 72 * s;
  while (displayVerdict && ctx.measureText(displayVerdict).width > maxVerdictWidth) {
    displayVerdict = displayVerdict.slice(0, -1);
  }
  if (displayVerdict !== verdictText && displayVerdict.length > 3) {
    displayVerdict = displayVerdict.slice(0, -1) + "…";
  }
  ctx.fillText(displayVerdict, 36 * s, verdictY);

  // --- Network + address ---
  const metaY = verdictY + (orientation === "portrait" ? 60 * s : 50 * s);
  const short = displayAddressShort(trial);
  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${20 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(`${(trial.network || "").toUpperCase()} · ${short}`, 36 * s, metaY);

  // --- Severity score ---
  const sevY = metaY + (orientation === "portrait" ? 50 * s : 42 * s);
  ctx.fillStyle = COLORS.navy;
  const sevBoxW = 200 * s;
  const sevBoxH = 70 * s;
  ctx.fillRect(36 * s, sevY, sevBoxW, sevBoxH);
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${14 * s}px Oswald, sans-serif`;
  ctx.fillText("SEVERITY", 48 * s, sevY + 22 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${34 * s}px Anton, sans-serif`;
  ctx.fillText(`${Math.round(trial.severity_score || 0)}/100`, 48 * s, sevY + 56 * s);

  // --- Roast excerpt ---
  const roastY = sevY + sevBoxH + (orientation === "portrait" ? 40 * s : 30 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${18 * s}px "JetBrains Mono", monospace`;
  const roastExcerpt = bestRoastExcerpt(trial.roast, 2);
  const roastMaxWidth = W - 72 * s;
  const roastLineH = 26 * s;
  const roastMaxLines = orientation === "portrait" ? 4 : 3;
  wrapTextTruncate(ctx, roastExcerpt, 36 * s, roastY, roastMaxWidth, roastLineH, roastMaxLines);

  // --- Sentence excerpt in a stamped/boxed section ---
  const sentenceText = sentenceExcerpt(trial.sentence, 2);
  if (sentenceText) {
    // Estimate roast height to position the sentence box
    const roastLines = Math.min(roastExcerpt.split(/\s+/).length, roastMaxLines);
    const sentenceBoxY = roastY + roastLineH * roastMaxLines + (orientation === "portrait" ? 30 * s : 20 * s);
    const sentenceBoxH = orientation === "portrait" ? 160 * s : 120 * s;
    const sentenceBoxW = W - 72 * s;
    const sentencePad = 16 * s;

    // Box background
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(36 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);
    // Border (stamped look)
    ctx.strokeStyle = COLORS.chart;
    ctx.lineWidth = 3 * s;
    ctx.strokeRect(36 * s, sentenceBoxY, sentenceBoxW, sentenceBoxH);

    // Label
    ctx.fillStyle = COLORS.chart;
    ctx.font = `600 ${13 * s}px Oswald, sans-serif`;
    ctx.fillText("THE COURT SENTENCES YOU TO…", 36 * s + sentencePad, sentenceBoxY + 24 * s);

    // Sentence text
    ctx.fillStyle = COLORS.ice;
    ctx.font = `500 ${17 * s}px "JetBrains Mono", monospace`;
    const sentenceMaxLines = orientation === "portrait" ? 4 : 3;
    wrapTextTruncate(
      ctx,
      sentenceText,
      36 * s + sentencePad,
      sentenceBoxY + 52 * s,
      sentenceBoxW - sentencePad * 2,
      24 * s,
      sentenceMaxLines
    );
  }

  // --- Bottom branding bar ---
  const bottomH = orientation === "portrait" ? 120 * s : 80 * s;
  const bottomY = H - bottomH;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, bottomY, W, bottomH);

  // @ShoutItWorld
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${18 * s}px Oswald, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(RECEIPT_X_HANDLE, 36 * s, bottomY + 28 * s);

  // court.shoutit.world
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${16 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(RECEIPT_DOMAIN, 36 * s, bottomY + 54 * s);

  // PUT YOUR WALLET ON TRIAL
  ctx.fillStyle = COLORS.chart;
  ctx.font = `700 ${20 * s}px Anton, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(RECEIPT_CTA, W - 36 * s, bottomY + 28 * s);

  // Case URL (compact)
  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${14 * s}px "JetBrains Mono", monospace`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const caseUrl = `${origin}/case/${trial.public_slug}`;
  // Truncate URL if too long
  const maxUrlWidth = W - 72 * s;
  let displayUrl = caseUrl;
  while (displayUrl && ctx.measureText(displayUrl).width > maxUrlWidth) {
    displayUrl = displayUrl.slice(0, -1);
  }
  if (displayUrl !== caseUrl) {
    displayUrl = displayUrl.slice(0, -3) + "…";
  }
  ctx.fillText(displayUrl, W - 36 * s, bottomY + 54 * s);

  // --- DEMO mark for demo cases ---
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

// Check if Web Share with files is available (mobile).
export function canShareFiles() {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.canShare !== "function") return false;
  if (typeof navigator.share !== "function") return false;
  // Check for iframe (cross-origin preview blocks share)
  if (typeof window !== "undefined" && window.self !== window.top) return false;
  return true;
}