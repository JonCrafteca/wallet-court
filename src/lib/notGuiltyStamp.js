// Wallet Court — Canonical NOT GUILTY stamp visual system (client-side mirror).
// Single source of truth for every NOT GUILTY renderer in the product.
// Both DOM (VerdictStamp) and canvas (Court Receipt, Verdict Card) consume
// these exact tokens so treatments cannot drift.
//
// This file mirrors base44/shared/notGuiltyStamp.ts for client-side use.
// Both copies must stay in sync.

export const NOT_GUILTY_VERDICT_CODE = "suspiciously_competent";

// Canonical visual tokens for the NOT GUILTY stamp.
export const NOT_GUILTY_STYLE = {
  bg: "#D8FF32",
  text: "#10142A",
  border: "#10142A",
  shadow: "#10142A",
  shadowOffsetX: 5,
  shadowOffsetY: 5,
  borderWidth: 4,
  rotationDeg: -6,
  fontFamily: "Anton",
  label: "NOT GUILTY",
};

// GUILTY stamp visual tokens (red on ice — unchanged).
export const GUILTY_STYLE = {
  bg: "#F5F7FF",
  text: "#FF3B30",
  border: "#FF3B30",
  shadow: "#10142A",
  shadowOffsetX: 5,
  shadowOffsetY: 5,
  borderWidth: 4,
  rotationDeg: -6,
  fontFamily: "Anton",
  label: "GUILTY",
};

export function isNotGuilty(verdictCode) {
  return verdictCode === NOT_GUILTY_VERDICT_CODE;
}

export function getStampText(verdictCode) {
  return isNotGuilty(verdictCode) ? NOT_GUILTY_STYLE.label : GUILTY_STYLE.label;
}

export function getStampStyle(verdictCode) {
  return isNotGuilty(verdictCode) ? NOT_GUILTY_STYLE : GUILTY_STYLE;
}

// Draw a canonical stamp on a canvas 2D context. Both courtReceipt.js and
// verdictCard.js use this to ensure identical visual treatment — solid fill,
// thick border, dark offset shadow, rotation, and bold condensed typography.
export function drawStampCanvas(ctx, x, y, verdictCode, scale, fontSize = 28) {
  const style = getStampStyle(verdictCode);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((style.rotationDeg * Math.PI) / 180);

  ctx.font = `700 ${fontSize * scale}px ${style.fontFamily}, sans-serif`;
  const sw = ctx.measureText(style.label).width + 44 * scale;
  const sh = (fontSize + 16) * scale;

  // Shadow (offset down and right)
  ctx.fillStyle = style.shadow;
  ctx.fillRect(
    -sw / 2 + style.shadowOffsetX * scale,
    -sh / 2 + style.shadowOffsetY * scale,
    sw,
    sh
  );

  // Fill (solid background — no transparency)
  ctx.fillStyle = style.bg;
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);

  // Border (thick)
  ctx.strokeStyle = style.border;
  ctx.lineWidth = style.borderWidth * scale;
  ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);

  // Text (uppercase, bold condensed)
  ctx.fillStyle = style.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(style.label, 0, 0);

  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}