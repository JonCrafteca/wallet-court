// Pure display helpers for the Nansen evidence pipeline. No runtime imports
// (safe for unit testing). Nansen returns percentage fields as DECIMAL RATIOS
// per the official docs — realized_pnl_percent is "a percentage (not multiplied
// by 100)" and win_rate is a ratio — so 0.84 == 84% and 0.25 == 25%. Raw ratios
// are preserved everywhere internally and multiplied by 100 ONLY at display time.

export function fmtPctSigned(n) {
  if (n === null || n === undefined) return null;
  const s = n > 0 ? "+" : "";
  return `${s}${(n * 100).toFixed(1)}%`;
}

export function fmtPctPlain(n) {
  if (n === null || n === undefined) return null;
  return `${(n * 100).toFixed(0)}%`;
}

export function fmtUsd(n) {
  if (n === null || n === undefined) return null;
  const s = n >= 0 ? "$" : "-$";
  return `${s}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Summary total (from pnl-summary) vs paginated sample (first page from
// dex-trades / transactions). The sample is never described as the wallet's
// complete history.
export function totalTradesEvidence(count) {
  return {
    tag: "NANSEN · PNL",
    label: "Total Trades",
    value: String(count),
    detail: "Total sales recorded by Nansen during the evidence window."
  };
}

export function sampleEvidence(tag, label, count, noun) {
  return {
    tag,
    label,
    value: String(count),
    detail: `${count} most recent ${noun} examined (sample — not complete history).`
  };
}