// Shared helpers for Wallet Court backend functions. Server-side only.

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// Sanitize a WalletTrial for the public case page (getTrialBySlug). Removes the
// complete wallet address (wallet_address, normalized_wallet_address) and the
// internal-only rescore_audit_json, returning only approved public-safe fields
// plus a pre-computed, non-reversible address_short. Nested JSON string fields
// (metrics_json, evidence_items_json, source_endpoints_json) are defensively
// scrubbed of any full-address occurrence so the address cannot leak through
// metadata, evidence, or audit information.
export function sanitizeTrialForPublicCase(trial) {
  if (!trial) return null;
  const fullAddr = trial.normalized_wallet_address || trial.wallet_address || "";
  const address_short = shortAddr(fullAddr);
  const addrsToScrub = [trial.normalized_wallet_address, trial.wallet_address]
    .filter((a) => a && a.length > 8);
  return {
    public_slug: trial.public_slug,
    network: trial.network,
    data_mode: trial.data_mode,
    case_outcome: trial.case_outcome,
    wallet_class: trial.wallet_class,
    verdict_code: trial.verdict_code,
    verdict_name: trial.verdict_name,
    severity_score: trial.severity_score,
    confidence_score: trial.confidence_score,
    headline: trial.headline,
    roast: trial.roast,
    defense_statement: trial.defense_statement,
    sentence: trial.sentence,
    evidence_items_json: scrubAddrFromString(trial.evidence_items_json, addrsToScrub, address_short),
    metrics_json: scrubAddrFromString(trial.metrics_json, addrsToScrub, address_short),
    source_endpoints_json: scrubAddrFromString(trial.source_endpoints_json, addrsToScrub, address_short),
    analyzed_at: trial.analyzed_at,
    created_date: trial.created_date,
    address_short
  };
}

function scrubAddrFromString(jsonStr, addrsToScrub, replacement) {
  if (!jsonStr || typeof jsonStr !== "string") return jsonStr;
  let result = jsonStr;
  for (const a of addrsToScrub) {
    if (a && result.includes(a)) result = result.split(a).join(replacement);
  }
  return result;
}

export function randomSlug(prefix) {
  return (
    prefix +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

export function sanitizeHandle(h) {
  if (!h) return "";
  let s = String(h).trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/[^a-zA-Z0-9_]/g, "");
  return s.slice(0, 15);
}

export function isValidHandle(h) {
  if (!h) return false;
  return /^[a-zA-Z0-9_]{1,15}$/.test(h);
}

export async function findCaseBySlug(base44, slug) {
  const results = await base44.asServiceRole.entities.WalletTrial.filter(
    { public_slug: slug },
    "-created_date",
    1
  );
  return results && results[0];
}