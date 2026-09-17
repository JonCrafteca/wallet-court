// Wallet Court — live verdict selection and scoring from normalized Nansen
// metrics. Server-side only. Demo selection (selectDemoVerdictIndex) and the
// demo payload builder remain unchanged; these functions add the live path.
// Live verdicts are chosen deterministically from real metrics — never forced
// into One Pump Chump without supporting evidence.
//
// UNIT CONTRACT: Nansen returns percentage fields as decimal ratios per the
// official docs (realized_pnl_percent is "a percentage, not multiplied by 100";
// win_rate is a ratio). So 0.84 == 84% and 0.25 == 25%. All thresholds below use
// RATIO units (e.g. -0.2 means -20%, 0.35 means 35%). Display helpers multiply
// by 100 only at render time.

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
  // Certified exit liquidity: deeply negative PnL (<= -20%) with a low win rate (< 35%).
  if (hasPnl && pnl <= -0.2 && (!hasWin || win < 0.35)) return 1;
  // Premature liquidator: positive but modest PnL (< 80%), decent win rate (>= 50%).
  if (hasPnl && pnl > 0 && pnl < 0.8 && hasWin && win >= 0.5) return 2;
  // Suspiciously competent: strong positive PnL (>= 80%) with a respectable win rate (>= 55%).
  if (hasPnl && pnl >= 0.8 && (!hasWin || win >= 0.55)) return 4;
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
    if (pnl <= -0.3) severity += 32;
    else if (pnl <= -0.1) severity += 18;
    else if (pnl <= 0) severity += 8;
    else if (pnl >= 1.0) severity -= 22;
    else if (pnl >= 0.2) severity -= 12;
    else severity -= 4;
  }
  if (win !== null) {
    if (win < 0.25) severity += 16;
    else if (win < 0.45) severity += 8;
    else if (win >= 0.65) severity -= 10;
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