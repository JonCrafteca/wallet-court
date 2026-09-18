// Wallet Court — holdings-evidence hardening (Phase N2.4). Dust, spam, and
// unsolicited tokens can create false holdings (token_balance_count > 0 with
// negligible aggregate value). A positive token count alone must NOT support a
// holder verdict.
//
// Meaningful holder evidence requires aggregate portfolio value present and
// materially greater than a conservative minimum. The provider (Nansen
// current-balance) does not currently supply reliable spam/dust classification,
// so we use a centralized configurable minimum aggregate portfolio value rather
// than scattering magic numbers through the code.
//
// Launch default: USD $25. All approved N2.2 holder cases have portfolio values
// far above this minimum, so they are unaffected.
//
// Pure: reads only the metrics object. No network. Deterministic.

export const MIN_PORTFOLIO_VALUE_USD = 25;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Meaningful holder evidence: aggregate portfolio value present and >= the
// minimum. No reliance on token_balance_count alone, and no reliance on missing
// fields. When the provider supplies reliable spam/dust classification in the
// future, extend this to also accept at least one provider-recognized,
// non-spam/non-dust asset.
export function hasMeaningfulHoldingsEvidence(metrics) {
  const m = metrics || {};
  const portVal = num(m.portfolio_value_usd);
  return portVal !== null && portVal >= MIN_PORTFOLIO_VALUE_USD;
}