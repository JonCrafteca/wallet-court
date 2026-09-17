// Wallet Court — verdict definitions, demo fixtures, address validation,
// and deterministic verdict selection. Server-side only (imported by backend
// functions). Keeping this here means the verdict logic lives in one place and
// is never copied between functions.

// The mandatory demo wallet — always returns One Pump Chump.
export const MANDATORY_DEMO_ADDRESS = "0x71c000000000000000000000000000000000c4f1";

export const NETWORKS = ["ethereum", "base", "solana"];

export function validateAddress(network, address) {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (network === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  }
  // ethereum + base share the 0x-prefixed 20-byte hex format
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export function normalizeAddress(network, address) {
  const a = (address || "").trim();
  if (network === "solana") return a;
  return a.toLowerCase();
}

// Deterministic, explainable verdict selection for demo mode.
// The mandatory demo address is always pinned to One Pump Chump (index 0).
// Every other address is hashed to a stable index 0-4.
export function selectDemoVerdictIndex(address) {
  if (!address) return 0;
  if (address.toLowerCase() === MANDATORY_DEMO_ADDRESS) return 0;
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) >>> 0;
  }
  return h % VERDICTS.length;
}

export const VERDICTS = [
  {
    code: "one_pump_chump",
    display_name: "One Pump Chump",
    severity: 82,
    confidence: 88,
    headline: "Bought the top. Left before the plot.",
    roast:
      "The honorable court finds you entered this token with the confidence of a degen and exited with the speed of someone whose mom just walked in. You held just long enough to confirm the top, then handed your bags to a more patient stranger. The chart went on without you. It usually does.",
    defense:
      "Your honor, my client merely runs a very strict stop-loss — set three percent below entry — on every single trade. Discipline is not a crime.",
    sentence:
      "90 days of paper-handing probation. You are forbidden from replying 'would' to any token you previously sold.",
    evidence: [
      { tag: "NANSEN · TRADES", label: "Holding Duration", value: "4 min 12s", detail: "Entered at local top, exited before the next block." },
      { tag: "NANSEN · PNL", label: "Realized PnL", value: "-7.4%", detail: "Exited at a loss inside the first candle close." },
      { tag: "NANSEN · PRICE", label: "Missed Upside", value: "+340%", detail: "Token ran for 18 hours after exit. The court took note." }
    ],
    metrics: {
      holding_duration_label: "4m 12s",
      avg_buy_after_pump_pct: 0,
      avg_sell_after_drawdown_pct: 0,
      realized_pnl_pct: -7.4,
      missed_upside_pct: 340,
      smart_money_delta_pct: -312,
      win_rate_pct: 0,
      max_drawdown_pct: -7.4,
      position_reduction_pct: 100
    },
    source_endpoints_demo: ["demo://fixtures/one-pump-chump", "nansen:trades:demo", "nansen:profit-loss:demo"]
  },
  {
    code: "certified_exit_liquidity",
    display_name: "Certified Exit Liquidity",
    severity: 88,
    confidence: 84,
    headline: "Congratulations. You are the liquidity.",
    roast:
      "You buy when the green candles are already exhausted and sell the moment the chart asks for a moment of silence. Smart Money thanks you for your service. You are not exiting liquidity — you are the entrance liquidity, for everyone else. The order book remembers you fondly.",
    defense:
      "My client was simply dollar-cost-averaging — directly into someone else's take-profit. There is no law against generosity.",
    sentence:
      "120 days restricted to buying only after a 20% drawdown. Sentence is suspended, because you would probably buy the drawdown of the sentencing.",
    evidence: [
      { tag: "NANSEN · TRADES", label: "Avg Buy Timing", value: "+38% after pump", detail: "Median entry sits well past the move's exhaustion." },
      { tag: "NANSEN · DRAWDOWN", label: "Avg Sell Timing", value: "-18% after peak", detail: "Exits cluster at local bottoms, not tops." },
      { tag: "NANSEN · SMART MONEY", label: "vs Smart Money", value: "-46 pts", detail: "Smart Money distribution events align with your entries." }
    ],
    metrics: {
      holding_duration_label: "9h 40m",
      avg_buy_after_pump_pct: 38,
      avg_sell_after_drawdown_pct: 18,
      realized_pnl_pct: -31.2,
      missed_upside_pct: 0,
      smart_money_delta_pct: -46,
      win_rate_pct: 22,
      max_drawdown_pct: -41,
      position_reduction_pct: 100
    },
    source_endpoints_demo: ["demo://fixtures/exit-liquidity", "nansen:smart-money:demo", "nansen:profit-loss:demo"]
  },
  {
    code: "premature_liquidator",
    display_name: "Premature Liquidator",
    severity: 64,
    confidence: 80,
    headline: "Exited with profit. Left the fortune on the table.",
    roast:
      "You have a rare talent: you pick winners, then leave before they become legends. Your realized PnL is a footnote; your unrealized PnL is a tragedy. The court recognizes your discipline and mourns your timing. You did not sell the top — you sold the prelude.",
    defense:
      "My client took profit. In this economy. The court should show some respect.",
    sentence:
      "60 days forbidden from checking the price of any asset sold within the last 30 days. The court will not enforce this — your own curiosity will.",
    evidence: [
      { tag: "NANSEN · DURATION", label: "Avg Holding Period", value: "2h 04m", detail: "Positions closed long before the move matured." },
      { tag: "NANSEN · PNL", label: "Realized PnL", value: "+18%", detail: "Profitable on paper — modestly, consistently." },
      { tag: "NANSEN · PRICE", label: "Missed Upside Post-Exit", value: "+520%", detail: "Several exits preceded 5-10x continuation runs." }
    ],
    metrics: {
      holding_duration_label: "2h 04m",
      avg_buy_after_pump_pct: 4,
      avg_sell_after_drawdown_pct: 0,
      realized_pnl_pct: 18,
      missed_upside_pct: 520,
      smart_money_delta_pct: -18,
      win_rate_pct: 64,
      max_drawdown_pct: -6,
      position_reduction_pct: 100
    },
    source_endpoints_demo: ["demo://fixtures/premature-liquidator", "nansen:trades:demo", "nansen:profit-loss:demo"]
  },
  {
    code: "diamond_handed_hostage",
    display_name: "Diamond-Handed Hostage",
    severity: 72,
    confidence: 82,
    headline: "Diamond hands. Paper returns.",
    roast:
      "You held. And held. And held. Through -80%, through silence, through three full market cycles. Your conviction is legendary. Your PnL is not. These assets are not 'down bad' — they are 'down permanent.' You are not an investor; you are a museum curator, and the exhibits are your hopes.",
    defense:
      "My client has not lost money. My client has merely not yet realized gains. Any decade now.",
    sentence:
      "Indefinite holding. Oh wait — you are already doing that. Sentence is therefore time served. The court admires the consistency.",
    evidence: [
      { tag: "NANSEN · DURATION", label: "Avg Holding Period", value: "547 days", detail: "Positions held across multiple market cycles." },
      { tag: "NANSEN · DRAWDOWN", label: "Avg Drawdown", value: "-74%", detail: "Underwater for the majority of the holding window." },
      { tag: "NANSEN · POSITION", label: "Position Reduction", value: "3%", detail: "Effectively no exits — bags treated as heirlooms." }
    ],
    metrics: {
      holding_duration_label: "547 days",
      avg_buy_after_pump_pct: 12,
      avg_sell_after_drawdown_pct: 0,
      realized_pnl_pct: 0,
      missed_upside_pct: 0,
      smart_money_delta_pct: -22,
      win_rate_pct: 0,
      max_drawdown_pct: -74,
      position_reduction_pct: 3
    },
    source_endpoints_demo: ["demo://fixtures/diamond-handed-hostage", "nansen:portfolio:demo", "nansen:profit-loss:demo"]
  },
  {
    code: "suspiciously_competent",
    display_name: "Suspiciously Competent",
    severity: 35,
    confidence: 90,
    headline: "Suspiciously competent. We are watching you.",
    roast:
      "The court has reviewed your record and found something deeply disturbing: you appear to know what you are doing. Disciplined entries. Reasonable holds. Exits that do not require a therapist. We do not trust it. Nobody is this consistent without an edge, a bot, or a very boring personality. The backhanded compliment: you are genuinely good at this. We hate that for you.",
    defense:
      "My client pleads guilty to reading the chart before buying. A victimless crime.",
    sentence:
      "No sentence. The court instead places you under permanent surveillance. We are watching. We are always watching. Nice trade, by the way.",
    evidence: [
      { tag: "NANSEN · PNL", label: "Realized PnL", value: "+210%", detail: "Consistently positive across the reviewed window." },
      { tag: "NANSEN · DURATION", label: "Avg Holding Period", value: "6 days", detail: "Holds long enough to capture moves, short enough to avoid decay." },
      { tag: "NANSEN · SMART MONEY", label: "vs Smart Money", value: "+9 pts", detail: "Entries and exits track Smart Money favorably." }
    ],
    metrics: {
      holding_duration_label: "6 days",
      avg_buy_after_pump_pct: -4,
      avg_sell_after_drawdown_pct: 2,
      realized_pnl_pct: 210,
      missed_upside_pct: 14,
      smart_money_delta_pct: 9,
      win_rate_pct: 71,
      max_drawdown_pct: -12,
      position_reduction_pct: 100
    },
    source_endpoints_demo: ["demo://fixtures/suspiciously-competent", "nansen:smart-money:demo", "nansen:profit-loss:demo"]
  }
];

export function buildVerdictPayload(verdict, address, network, dataMode, nansenData) {
  const endpoints = dataMode === "live" && nansenData
    ? ["nansen:profit-loss:live", "nansen:smart-money:live", "nansen:trades:live"]
    : verdict.source_endpoints_demo;
  return {
    verdict_code: verdict.code,
    verdict_name: verdict.display_name,
    severity_score: verdict.severity,
    confidence_score: verdict.confidence,
    headline: verdict.headline,
    roast: verdict.roast,
    defense_statement: verdict.defense,
    sentence: verdict.sentence,
    evidence_items_json: JSON.stringify(verdict.evidence),
    metrics_json: JSON.stringify(verdict.metrics),
    source_endpoints_json: JSON.stringify(endpoints)
  };
}