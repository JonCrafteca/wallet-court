// Client-side 1200x675 verdict card rendered to a canvas and exported as a PNG.
// This is a dedicated share-card generator — not a screenshot of the verdict
// page — so the card has its own controlled Electric Court TV layout.

import { displayAddressShort } from "@/lib/wallet";

const COLORS = {
  cobalt: "#2457FF",
  uv: "#5127C7",
  navy: "#10142A",
  ice: "#F5F7FF",
  chart: "#D8FF32",
  red: "#FF3B30",
  mute: "#B8C7FF",
};

// Lucide "microphone" glyph paths (viewBox 0 0 24 24) — the temporary ShoutIt
// mark drawn on the card header beside "A ShoutIt Original".
const MIC_PATHS = [
  "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",
  "M19 10v2a7 7 0 0 1-14 0v-2",
  "M12 19v3",
];

function drawMic(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 24, size / 24);
  ctx.translate(-12, -12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of MIC_PATHS) {
    ctx.stroke(new Path2D(d));
  }
  ctx.restore();
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 80px Anton'),
      document.fonts.load('600 40px Oswald'),
      document.fonts.load('500 22px "JetBrains Mono"'),
    ]);
  } catch {
    // fall back to system fonts if web fonts are unavailable
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = (text || "").split(" ");
  let line = "";
  const lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

// Same-origin image loader for the verdict card. Resolves null on error so the
// canvas can fall back to the microphone without tainting the PNG export.
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function drawVerdictCard(canvas, trial) {
  await ensureFonts();
  const mascot = await loadImage("/brand/shoutit-mascot-round.png");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const s = W / 1200;

  // Background gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.cobalt);
  g.addColorStop(0.6, COLORS.uv);
  g.addColorStop(1, COLORS.navy);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Faint grid texture
  ctx.strokeStyle = "rgba(245,247,255,0.05)";
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

  const isLive = trial.data_mode === "live";
  const isOnePump = trial.verdict_code === "one_pump_chump";
  const competent = trial.verdict_code === "suspiciously_competent";

  // Top brand bar
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, 0, W, 92 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${38 * s}px Anton, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("WALLET COURT", 40 * s, 38 * s);
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  ctx.fillStyle = COLORS.chart;
  // ShoutIt round mascot beside "A ShoutIt Original"; mic fallback on load fail.
  const ms = 42 * s;
  const mcx = 28 * s;
  const mcy = 70 * s;
  if (mascot) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mcx, mcy, ms / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(mascot, mcx - ms / 2, mcy - ms / 2, ms, ms);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(mcx, mcy, ms / 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245,247,255,0.4)";
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();
    ctx.restore();
  } else {
    drawMic(ctx, 28 * s, 70 * s, 18 * s, COLORS.chart);
  }
  ctx.fillText("A ShoutIt Original", 54 * s, 70 * s);

  // Live/demo badge (top right)
  const badgeText = isLive ? "LIVE · NANSEN" : "DEMO";
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  const bw = ctx.measureText(badgeText).width + 32 * s;
  ctx.fillStyle = isLive ? COLORS.chart : COLORS.red;
  ctx.fillRect(W - bw - 40 * s, 28 * s, bw, 36 * s);
  ctx.fillStyle = isLive ? COLORS.navy : COLORS.ice;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, W - bw / 2 - 40 * s, 47 * s);
  ctx.textAlign = "left";

  // Stamp
  const stampText = competent ? "CASE DISMISSED" : "GUILTY";
  ctx.save();
  ctx.translate(150 * s, 190 * s);
  ctx.rotate(-0.1);
  ctx.font = `700 ${30 * s}px Anton, sans-serif`;
  const sw = ctx.measureText(stampText).width + 48 * s;
  ctx.strokeStyle = competent ? COLORS.chart : COLORS.red;
  ctx.lineWidth = 4 * s;
  ctx.strokeRect(-sw / 2, -22 * s, sw, 44 * s);
  ctx.fillStyle = competent ? COLORS.chart : COLORS.red;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(stampText, 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Verdict name (largest element)
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${isOnePump ? 104 * s : 92 * s}px Anton, sans-serif`;
  ctx.fillText((trial.verdict_name || "").toUpperCase(), 40 * s, 300 * s);

  // One Pump Chump banner
  if (isOnePump) {
    ctx.fillStyle = COLORS.chart;
    ctx.fillRect(40 * s, 322 * s, 760 * s, 46 * s);
    ctx.fillStyle = COLORS.navy;
    ctx.font = `600 ${20 * s}px Oswald, sans-serif`;
    ctx.fillText("PERFORMANCE REVIEW: ARRIVED EARLY. FINISHED EARLIER.", 56 * s, 351 * s);
  }

  // Address + network
  const short = displayAddressShort(trial);
  ctx.fillStyle = COLORS.mute;
  ctx.font = `500 ${22 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(`${(trial.network || "").toUpperCase()} · ${short}`, 40 * s, 402 * s);

  // Headline
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${26 * s}px "JetBrains Mono", monospace`;
  wrapText(ctx, trial.headline || "", 40 * s, 444 * s, 1120 * s, 34 * s, 2);

  // Stat blocks
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(40 * s, 524 * s, 540 * s, 100 * s);
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  ctx.fillText("SEVERITY", 60 * s, 552 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${44 * s}px Anton, sans-serif`;
  ctx.fillText(`${Math.round(trial.severity_score || 0)}/100`, 60 * s, 598 * s);

  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(620 * s, 524 * s, 540 * s, 100 * s);
  ctx.fillStyle = COLORS.chart;
  ctx.font = `600 ${16 * s}px Oswald, sans-serif`;
  ctx.fillText("CONFIDENCE", 640 * s, 552 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `700 ${44 * s}px Anton, sans-serif`;
  ctx.fillText(`${Math.round(trial.confidence_score || 0)}%`, 640 * s, 598 * s);

  // Bottom URL bar
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, H - 50 * s, W, 50 * s);
  ctx.fillStyle = COLORS.ice;
  ctx.font = `500 ${18 * s}px "JetBrains Mono", monospace`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/case/${trial.public_slug}`;
  ctx.fillText(url, 40 * s, H - 19 * s);
  if (isLive) {
    ctx.fillStyle = COLORS.chart;
    ctx.textAlign = "right";
    ctx.fillText("Evidence powered by Nansen", W - 40 * s, H - 19 * s);
    ctx.textAlign = "left";
  }
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

export async function downloadVerdictCard(trial) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  await drawVerdictCard(canvas, trial);
  await new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        triggerDownload(blob, `wallet-court-${trial.public_slug}.png`);
        resolve();
      },
      "image/png"
    );
  });
}

// Returns the verdict card as a PNG Blob for native share-sheet file sharing.
export async function getVerdictCardBlob(trial) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  await drawVerdictCard(canvas, trial);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render verdict card"))),
      "image/png"
    );
  });
}