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

export function fmtInt(n) {
  if (n === null || n === undefined) return null;
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? x.toLocaleString() : String(n);
}

// Summary total (from pnl-summary) vs paginated sample (first page from
// dex-trades / transactions). The sample is never described as the wallet's
// complete history.
export function totalTradesEvidence(count) {
  return {
    tag: "NANSEN · PNL",
    label: "Total Trades",
    value: fmtInt(count),
    detail: "Total sales recorded by Nansen during the evidence window."
  };
}

export function sampleEvidence(tag, label, count, noun) {
  return {
    tag,
    label,
    value: fmtInt(count),
    detail: `${fmtInt(count)} most recent ${noun} examined (sample — not complete history).`
  };
}

// Average bought-token age across valid sampled DEX trades. Nansen provides
// `token_bought_age_days` per trade as an INTEGER in days (age = buy block
// timestamp minus token creation/deployment date, computed by Nansen). Wallet
// Court only averages the provided day values — it never parses timestamps or
// converts units. Invalid values (missing, non-finite, negative) are excluded;
// valid values are never capped. Returns { avg, validCount, total } or null.
export function avgTokenAge(trades) {
  if (!Array.isArray(trades)) return null;
  let sum = 0;
  let count = 0;
  for (const t of trades) {
    const v = t.token_bought_age_days ?? t.tokenBoughtAgeDays;
    const n = typeof v === "number" ? v : parseFloat(v);
    if (Number.isFinite(n) && n >= 0) {
      sum += n;
      count++;
    }
  }
  if (count === 0) return null;
  return { avg: sum / count, validCount: count, total: trades.length };
}