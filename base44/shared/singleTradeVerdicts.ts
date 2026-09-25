// Wallet Court — Single Trade Trial verdict pool + selection. Pure: no SDK, no
// network. Deterministic verdict selection from trade-level metrics.
//
// Verdict dimensions (all deterministic, computed from OHLCV + DEX evidence):
//   - max_drawdown_pct       how deep the position went underwater
//   - time_underwater_pct     how long it stayed there
//   - conviction              held / sold / averaged down
//   - current_unrealized_pnl  where the position stands now
//   - recovery_pct            how far it climbed back from the trough
//   - holding_duration_days   how long the trader has been in
//   - max_unrealized_gain_pct the peak upside they saw (and maybe missed)
//
// Verdict copy (headline, roast, defense, sentence) is template-selected from
// the pool below — no LLM call is needed for the initial launch. Each verdict
// code maps to fixed copy so the verdict is deterministic and auditable.

export interface TradeVerdict {
  code: string;
  display_name: string;
  headline: string;
  roast: string;
  defense: string;
  sentence: string;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Verdict pool ----

export const TRADE_VERDICTS: TradeVerdict[] = [
  {
    code: "bag_holder_of_the_court",
    display_name: "Bag Holder of the Court",
    headline: "Held the bag. The bag held back.",
    roast:
      "The court has reviewed your single trade and found a position so underwater it has its own postal code. You bought, you held, you watched it sink, and you held some more. The drawdown is not a dip — it is a lifestyle. The court respects the conviction and mourns the capital.",
    defense:
      "My client has not lost money. My client is merely early. Any decade now.",
    sentence:
      "Indefinite holding. The court notes you are already serving this sentence voluntarily."
  },
  {
    code: "premature_bail_out",
    display_name: "Premature Bail-Out",
    headline: "You sold the dip. The dip disagreed.",
    roast:
      "The court finds you exited before the recovery, handing your bags to a more patient stranger at the exact moment the chart decided to cooperate. The token went on without you. It usually does. Your realized loss is the entry fee to someone else's gains.",
    defense:
      "My client employed a strict stop-loss. Discipline is not a crime, even when it costs money.",
    sentence:
      "60 days forbidden from checking the price of any token sold in the last 30 days. The court will not enforce this — your own curiosity will."
  },
  {
    code: "diamond_hands_diamond_losses",
    display_name: "Diamond Hands, Diamond Losses",
    headline: "Diamond hands. Diamond losses.",
    roast:
      "You held through a drawdown so deep most traders would have questioned their existence. You questioned nothing. The position is still open, still red, and still, in some spiritual sense, yours. The court admires the resolve and questions the thesis.",
    defense:
      "My client believes in the technology. The technology has not yet believed in my client.",
    sentence:
      "90 days of mandatory reflection on the difference between conviction and sunk-cost fallacy."
  },
  {
    code: "averaging_down_into_the_abyss",
    display_name: "Averaging Down Into the Abyss",
    headline: "The dip was not the bottom. The dip was a staircase.",
    roast:
      "The court has reviewed your subsequent buys and found a trader who treats drawdowns as discounts. Each add lowered your cost basis and raised your commitment to a losing position. You are not dollar-cost-averaging — you are dollar-cost-averaging into someone else's exit liquidity.",
    defense:
      "My client was improving their average entry. The average kept moving.",
    sentence:
      "120 days during which every additional buy must be accompanied by a written justification. The court will read none of them."
  },
  {
    code: "patient_winner",
    display_name: "Patient Winner",
    headline: "Held through the storm. Came out on top.",
    roast:
      "The court has reviewed your trade and found something rare: a position that went underwater, recovered, and is now in profit. You held when it was red, you held when it was scary, and you held when it was right. The court is suspicious of this level of discipline but cannot find fault.",
    defense:
      "My client did nothing. That was the strategy.",
    sentence:
      "No sentence. The court places you under permanent surveillance. We are watching. Nice trade."
  },
  {
    code: "top_buyer",
    display_name: "Top Buyer",
    headline: "Bought the top. The court took note.",
    roast:
      "The court has examined your entry market cap and found you arrived at the party just as the music stopped. Your purchase sits at the peak, and everything since has been a slow walk back to reality. You did not buy the dip — you bought the ceiling.",
    defense:
      "My client could not have known it was the top. Nobody can. Except, apparently, everyone who sold to my client.",
    sentence:
      "90 days of mandatory waiting for at least a 30% drawdown before any new purchase. The court expects withdrawal symptoms."
  },
  {
    code: "suspiciously_good_entry",
    display_name: "Suspiciously Good Entry",
    headline: "Bought the floor. Still holding in profit.",
    roast:
      "The court has reviewed your entry market cap and found it suspiciously near the bottom of the token's range. Either you have an edge, a bot, or a very lucky chart-reading habit. The position is still open and still green. We do not trust it, but we cannot argue with it.",
    defense:
      "My client reads the chart before buying. A victimless crime.",
    sentence:
      "Permanent surveillance. The court is watching. We are always watching."
  },
  {
    code: "stuck_in_the_middle",
    display_name: "Stuck in the Middle",
    headline: "Not a winner. Not a loser. Just… stuck.",
    roast:
      "The court has reviewed your trade and found a position that is neither deeply underwater nor meaningfully in profit. You are in the no-man's-land of trading: not enough pain to learn from, not enough gain to celebrate. The court finds this the most honest outcome of all.",
    defense:
      "My client is neither winning nor losing. My client is waiting.",
    sentence:
      "30 days of mandatory indecision. The court expects you to continue exactly as you have."
  }
];

// ---- Selection rules (ordered, first match wins) ----

interface SelectionRule {
  test: (m: Record<string, any>) => boolean;
  index: number;
}

const RULES: SelectionRule[] = [
  // Averaging down into a losing position.
  {
    test: (m) => {
      const dd = num(m.max_drawdown_pct);
      const pnl = num(m.current_unrealized_pnl_pct);
      return m.conviction === "averaged_down" && dd !== null && dd <= -0.3 && (pnl === null || pnl < 0);
    },
    index: 3
  },
  // Premature bail-out: full exit with negative PnL after a deep drawdown.
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      const maxGain = num(m.max_unrealized_gain_pct);
      return m.conviction === "full_exit" && pnl !== null && pnl < 0 && maxGain !== null && maxGain > 0.5;
    },
    index: 1
  },
  // Partial exit during a drawdown.
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      return m.conviction === "partial_exit" && pnl !== null && pnl < 0;
    },
    index: 1
  },
  // Patient winner: held through drawdown, now in profit.
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      const dd = num(m.max_drawdown_pct);
      return m.conviction === "held" && pnl !== null && pnl > 0 && dd !== null && dd <= -0.1;
    },
    index: 4
  },
  // Suspiciously good entry: entry mcap near the bottom, still in profit.
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      const dd = num(m.max_drawdown_pct);
      return m.conviction === "held" && pnl !== null && pnl > 0.2 && (dd === null || dd > -0.1);
    },
    index: 6
  },
  // Diamond hands, diamond losses: long hold, deep drawdown, still holding.
  // Checked BEFORE top_buyer so a long-held deep drawdown gets the more
  // specific verdict (top_buyer is the fallback for shorter holds).
  {
    test: (m) => {
      const dd = num(m.max_drawdown_pct);
      const dur = num(m.holding_duration_days);
      const pnl = num(m.current_unrealized_pnl_pct);
      return m.conviction === "held" && dd !== null && dd <= -0.3 && dur !== null && dur >= 7 && (pnl === null || pnl < 0);
    },
    index: 2
  },
  // Top buyer: deep drawdown, still underwater, held (shorter holds).
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      const dd = num(m.max_drawdown_pct);
      return m.conviction === "held" && dd !== null && dd <= -0.5 && (pnl === null || pnl < 0);
    },
    index: 5
  },
  // Bag holder: significant drawdown, still holding, negative PnL.
  {
    test: (m) => {
      const pnl = num(m.current_unrealized_pnl_pct);
      const dd = num(m.max_drawdown_pct);
      return m.conviction === "held" && dd !== null && dd <= -0.2 && (pnl === null || pnl < 0);
    },
    index: 0
  },
];

// Select a verdict from trade-level metrics. Returns the verdict object.
export function selectTradeVerdict(metrics: Record<string, any>): TradeVerdict {
  for (const rule of RULES) {
    if (rule.test(metrics)) return TRADE_VERDICTS[rule.index];
  }
  // Default: stuck in the middle (neutral).
  return TRADE_VERDICTS[7];
}

// ---- Severity & confidence ----

export function computeTradeSeverityConfidence(metrics: Record<string, any>): { severity: number; confidence: number } {
  const dd = num(metrics.max_drawdown_pct);
  const pnl = num(metrics.current_unrealized_pnl_pct);
  const underwater = num(metrics.time_underwater_pct);
  const dur = num(metrics.holding_duration_days);

  let severity = 45;
  if (dd !== null) {
    if (dd <= -0.8) severity += 35;
    else if (dd <= -0.5) severity += 25;
    else if (dd <= -0.3) severity += 15;
    else if (dd <= -0.1) severity += 5;
    else severity -= 10;
  }
  if (pnl !== null) {
    if (pnl <= -0.5) severity += 20;
    else if (pnl <= -0.2) severity += 12;
    else if (pnl <= 0) severity += 5;
    else if (pnl >= 1.0) severity -= 25;
    else if (pnl >= 0.2) severity -= 15;
  }
  if (underwater !== null) {
    if (underwater >= 0.8) severity += 10;
    else if (underwater >= 0.5) severity += 5;
  }
  if (dur !== null && dur >= 30) severity += 5;
  if (metrics.conviction === "full_exit" && pnl !== null && pnl < 0) severity += 8;
  if (metrics.conviction === "averaged_down") severity += 8;
  severity = Math.max(10, Math.min(96, Math.round(severity)));

  let confidence = 84;
  const fieldCount = Object.keys(metrics).filter((k) => metrics[k] !== null && metrics[k] !== undefined).length;
  if (fieldCount < 5) confidence -= 15;
  else if (fieldCount < 8) confidence -= 8;
  if (metrics.candle_count && metrics.candle_count < 10) confidence -= 10;
  confidence = Math.max(30, Math.min(95, Math.round(confidence)));

  return { severity, confidence };
}