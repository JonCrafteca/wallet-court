// Wallet Court — live verdict selection and scoring from normalized Nansen
// metrics. Server-side only. Demo selection (selectDemoVerdictIndex) and the
// demo payload builder remain unchanged; these functions add the live path.
// Live verdicts are chosen deterministically from real metrics — never forced
// into One Pump Chump without supporting evidence.

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Deterministic live verdict selection. Rules are ordered; the first match wins.
// Indices match VERDICTS: 0 one_pump_chump, 1 certified_exit_liquidity,
// 2 premature_liquidator, 3 diamond_handed_hostage, 4 suspiciously_competent.
export function selectLiveVerdictIndex(metrics) {
  const pnl = num(metrics.realized_pnl_pct);
  const win = num(metrics.win_rate_pct);
  const hold = num(metrics.avg_holding_seconds);
  const hasPnl = pnl !== null;
  const hasWin = win !== null;
  const hasHold = hold !== null;

  // Diamond-handed: very long holds with non-positive PnL.
  if (hasHold && hold > 2592000 && (!hasPnl || pnl <= 0)) return 3;
  // One pump chump: negative PnL with very short holds (bought the top, left early).
  if (hasPnl && pnl < 0 && hasHold && hold < 3600) return 0;
  // Certified exit liquidity: deeply negative PnL with a low win rate.
  if (hasPnl && pnl <= -20 && (!hasWin || win < 35)) return 1;
  // Premature liquidator: positive but modest PnL, decent win rate.
  if (hasPnl && pnl > 0 && pnl < 80 && hasWin && win >= 50) return 2;
  // Suspiciously competent: strong positive PnL with a respectable win rate.
  if (hasPnl && pnl >= 80 && (!hasWin || win >= 55)) return 4;
  // Sign-of-PnL fallbacks when only PnL is known.
  if (hasPnl && pnl < 0) return 1;
  if (hasPnl && pnl > 0) return 2;
  // No PnL evidence — neutral default (rarely reached in live mode).
  return 4;
}

export function computeSeverityConfidence(metrics, partial) {
  const pnl = num(metrics.realized_pnl_pct);
  const win = num(metrics.win_rate_pct);
  const hold = num(metrics.avg_holding_seconds);

  let severity = 50;
  if (pnl !== null) {
    if (pnl <= -30) severity += 32;
    else if (pnl <= -10) severity += 18;
    else if (pnl <= 0) severity += 8;
    else if (pnl >= 100) severity -= 22;
    else if (pnl >= 20) severity -= 12;
    else severity -= 4;
  }
  if (win !== null) {
    if (win < 25) severity += 16;
    else if (win < 45) severity += 8;
    else if (win >= 65) severity -= 10;
  }
  if (hold !== null && hold > 2592000) severity += 8;
  severity = Math.max(8, Math.min(96, Math.round(severity)));

  let confidence = 86;
  if (partial) confidence -= 22;
  const fieldCount = Object.keys(metrics).filter((k) => metrics[k] !== null && metrics[k] !== undefined).length;
  if (fieldCount < 4) confidence -= 12;
  else if (fieldCount < 7) confidence -= 6;
  confidence = Math.max(30, Math.min(95, Math.round(confidence)));

  return { severity, confidence };
}

export function buildLiveVerdictPayload(verdict, evidence, metrics, meta, sources, severity, confidence) {
  return {
    verdict_code: verdict.code,
    verdict_name: verdict.display_name,
    severity_score: severity,
    confidence_score: confidence,
    headline: verdict.headline,
    roast: verdict.roast,
    defense_statement: verdict.defense,
    sentence: verdict.sentence,
    evidence_items_json: JSON.stringify(evidence),
    metrics_json: JSON.stringify({ ...metrics, _meta: meta }),
    source_endpoints_json: JSON.stringify(sources)
  };
}