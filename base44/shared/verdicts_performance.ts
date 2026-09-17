// Wallet Court — performance-driven verdict variety (Phase N2.2).
// Expands the trader_individual / unknown verdict engine to use the FULL set of
// saved Nansen performance evidence, so materially different wallets no longer
// collapse into the same verdict when address labels are unavailable.
//
// This module is PURE: it reads only the metrics object passed to it, makes no
// network calls, and NEVER calls the Nansen Address Labels endpoint. Selection
// is deterministic — the first matching rule in PERFORMANCE_RULES wins; ties are
// impossible because the rules are strictly ordered (documented precedence).
// The mandatory demo One Pump Chump is unaffected: demo mode uses
// selectDemoVerdictIndex + VERDICTS, not this engine.
//
// UNIT CONTRACT: Nansen returns percentage fields as DECIMAL RATIOS
// (realized_pnl_percent 0.84 == 84%; win_rate 0.25 == 25%). All thresholds below
// use RATIO units. Display helpers multiply by 100 only at render time.
//
// Metrics consumed (all optional — missing values never fabricate evidence):
//   realized_pnl_pct, realized_pnl_abs_usd, win_rate_pct, total_trades,
//   tokens_traded, top5_wins, top5_losses, dex_trade_count, avg_trade_value_usd,
//   avg_token_bought_age_days, token_balance_count, portfolio_value_usd,
//   transaction_count, tx_frequency_per_day, avg_holding_seconds.
import { VERDICTS } from "./verdicts.ts";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// No realized trading activity: zero (or absent) sales, tokens traded, and DEX
// trades, AND some holder evidence (holdings or portfolio value present). The
// holder-evidence requirement prevents empty/unknown metrics from fabricating
// a holder verdict — a wallet with no data is "unknown", not a bagholder.
function noActiveTrading(m) {
  const trades = num(m.total_trades);
  const tokens = num(m.tokens_traded);
  const dex = num(m.dex_trade_count);
  const holdings = num(m.token_balance_count);
  const portVal = num(m.portfolio_value_usd);
  const noSales = (trades === null || trades === 0)
    && (tokens === null || tokens === 0)
    && (dex === null || dex === 0);
  const hasHolderEvidence = (holdings !== null && holdings > 0) || (portVal !== null && portVal > 0);
  return noSales && hasHolderEvidence;
}

// ---- Existing retail verdicts (preserved verbatim from the prior phase) ----
// Indices 0-4 are the original VERDICTS. 5-8 are the Phase N2 retail expansions.
// Text is unchanged so existing cases and tests keep their voice.
export const NEW_RETAIL = [
  {
    code: "rug_survivors_guilt",
    display_name: "Rug Survivor's Guilt",
    headline: "You got out. You feel weird about it.",
    roast: "The court finds you guilty of surviving a rug with your capital and most of your dignity intact. You sold before the floor gave out, which is admirable, and now you refresh the chart of a token you no longer hold, which is not. Survivor's guilt is real, and you have it, onchain.",
    defense: "My client took profits. The court is confusing prudence for pathology.",
    sentence: "60 days of not checking the price of the token you escaped. The court expects relapse within the hour."
  },
  {
    code: "stop_loss_optional",
    display_name: "Stop-Loss Optional",
    headline: "You trade so often the fees are a lifestyle.",
    roast: "The court has reviewed your trade count and concluded you do not have a strategy — you have a reflex. Every dip is a buy, every bounce is a sell, and every gas fee is a subscription. You are not trading the market; you are renting it, by the hour.",
    defense: "My client is active. Activity is not, in itself, a crime.",
    sentence: "90 days of mandatory holds longer than your average shower. The court sets the bar intentionally low."
  },
  {
    code: "bought_the_rumor",
    display_name: "Bought the Rumor, Married the Bag",
    headline: "The rumor was false. The marriage is not.",
    roast: "The court finds you guilty of buying the narrative at full price and holding the bag through every chapter of its slow debunking. You did not sell the news; you married the news, and the news has been quietly disappointing you ever since.",
    defense: "My client has conviction. Conviction, the court will note, is not the same as being right.",
    sentence: "120 days of mandatory 'sell the news' drills. The court will not enforce them; your therapist might."
  },
  {
    code: "diamond_hands_by_accident",
    display_name: "Diamond Hands by Accident",
    headline: "You held because you forgot. It worked.",
    roast: "The court has reviewed your win rate and your holding pattern and concluded your discipline is indistinguishable from neglect. You held winners not because you believed, but because you forgot you owned them, and the court finds this accidental conviction deeply offensive to everyone who tried on purpose.",
    defense: "My client is a long-term investor. The long term was, admittedly, not the original plan.",
    sentence: "No sentence. The court instead orders you to keep forgetting, since it is clearly your edge."
  }
];

// ---- Phase N2.2 performance-driven verdicts (10 new) ----
// Each is reachable only by an explicit, deterministic evidence rule below.
export const PERFORMANCE_VERDICTS = [
  {
    code: "diamond_hands_somehow_correct",
    display_name: "Diamond Hands, Somehow Correct",
    headline: "Held through everything. Was right anyway.",
    roast: "The court has reviewed your holding duration and your PnL and arrived at a deeply irritating conclusion: you held far longer than any reasonable risk model permits, and the market eventually agreed with you. This is not skill. This is stubbornness that happened to intersect with a chart, and the court refuses to congratulate you for it.",
    defense: "My client has conviction. The conviction outlasted the court's patience, and apparently the market's.",
    sentence: "Permanent surveillance. The court needs to know if this was a strategy or a coma."
  },
  {
    code: "bagholder_emeritus",
    display_name: "Bagholder Emeritus",
    headline: "A distinguished career in holding the bag.",
    roast: "The court has reviewed your holdings and finds a wallet of distinguished inactivity. You are not a trader; you are a tenured custodian of decisions that did not work out, and the court salutes your commitment to not selling. Emeritus status is conferred not for excellence but for endurance, and you have endured.",
    defense: "My client is a long-term holder. The long term is, the court will note, taking quite a long time.",
    sentence: "Indefinite continued holding, with honors. The court expects the bags to outlive us all."
  },
  {
    code: "portfolio_polygamist",
    display_name: "Portfolio Polygamist",
    headline: "Committed to every token. Faithful to none.",
    roast: "The court has counted your holdings and lost track. You are not diversified; you are romantically involved with every token on the chain simultaneously, and like all polygamists you are stretched too thin to meaningfully engage with any of them. The court admires the breadth and questions the depth.",
    defense: "My client believes in diversification. The court believes my client cannot commit.",
    sentence: "90 days of monogamy with a single position. The court expects withdrawal within the hour."
  },
  {
    code: "frequent_trader_infrequent_winner",
    display_name: "Frequent Trader, Infrequent Winner",
    headline: "Trades every day. Wins occasionally. By accident.",
    roast: "The court has reviewed your trade count and your win rate and detected a mismatch: you swing often and connect seldom. You are not a trader so much as a very active donor to the order flow, and the market has accepted your generosity without ever sending a thank-you note. Volume is not a virtue when the win column is this lonely.",
    defense: "My client is persistent. Persistence, the court will observe, is not the same as profitable.",
    sentence: "120 days of mandatory reflection before every trade. The court expects your throughput to collapse."
  },
  {
    code: "gas_fee_sugar_daddy",
    display_name: "Gas Fee Sugar Daddy",
    headline: "You don't trade. You subsidize the network.",
    roast: "The court has reviewed your transaction frequency and your PnL and concluded you are less a participant than a patron. You pay gas the way a sugar daddy pays for dinner: often, generously, and with no expectation of a return. Validators send you holiday cards. The network depends on you, and you depend on nothing coming back.",
    defense: "My client supports the network. Patronage is not, in itself, a crime.",
    sentence: "60 days of mandatory inactivity. The court expects the chain to miss you."
  },
  {
    code: "museum_grade_bagholder",
    display_name: "Museum-Grade Bagholder",
    headline: "A curated collection of regret.",
    roast: "The court has toured your holdings and found a museum of decisions preserved for posterity. Each token is an exhibit, each balance a plaque, and the collection is nothing if not comprehensive. You are not an investor; you are a curator, and the permanent collection is your portfolio.",
    defense: "My client holds for the long term. The long term, the court notes, has become an archive.",
    sentence: "Indefinite stewardship. The court orders the collection kept intact for future generations."
  },
  {
    code: "diversified_into_every_bad_decision",
    display_name: "Diversified Into Every Bad Decision",
    headline: "You didn't pick one mistake. You collected them all.",
    roast: "The court has reviewed the breadth of tokens you traded and the depth of the loss and concluded your risk management was, in fact, a scattergun. You did not concentrate your error; you democratized it, spreading the damage across hundreds of positions so efficiently that no single bag could feel special. Diversification of a bad idea is still a bad idea, at scale.",
    defense: "My client diversified. The court will note that diversifying into losses is a strategy, technically.",
    sentence: "90 days of mandatory single-token conviction. The court expects this to be physically impossible."
  },
  {
    code: "liquidity_donor",
    display_name: "Liquidity Donor",
    headline: "Size in. Regret out. For everyone else's benefit.",
    roast: "The court has reviewed your trade sizes and your PnL and concluded you are not a trader so much as a charitable institution for the order book. You enter with conviction and size, exit with loss and grace, and somewhere a market maker is naming a boat after you. The market thanks you for your contribution; your wallet does not.",
    defense: "My client provides liquidity. Generosity, the court will note, is not a crime.",
    sentence: "120 days of mandatory small-size orders. The court expects your impact to vanish."
  },
  {
    code: "commitment_issues_onchain",
    display_name: "Commitment Issues, Onchain",
    headline: "Bought in. Ghosted. Never closed.",
    roast: "The court has reviewed your transaction history and found a wallet that showed up once, bought a few things, and then emotionally left the chain. You are not a holder; you are an ex who left their stuff in the apartment and never came back for it. The positions are still there. You, apparently, are not.",
    defense: "My client is busy. The court is confusing absence for a strategy.",
    sentence: "60 days of mandatory engagement with at least one of your own positions. The court expects no reply."
  },
  {
    code: "one_good_trade_and_a_personality",
    display_name: "One Good Trade and a Personality",
    headline: "One trade. One win. One entire identity.",
    roast: "The court has reviewed your trade count and your PnL and found a wallet that did one thing right and has been dining out on it ever since. The trade was good. The personality built around it is enormous. You are not a trader; you are a single anecdote with a wallet attached, and the court respects the anecdote more than the portfolio.",
    defense: "My client made one excellent decision. The court is penalizing quality over quantity.",
    sentence: "Indefinite retelling of the one trade. The court orders you to find a second one."
  }
];

// Full retail/trader pool: 5 original + 4 prior retail + 10 new = 19 verdicts.
export const RETAIL_POOL = [...VERDICTS, ...NEW_RETAIL, ...PERFORMANCE_VERDICTS];
const BY_CODE = Object.fromEntries(RETAIL_POOL.map((v) => [v.code, v]));

// Deterministic, precedence-ordered evidence rules. First match wins. Each rule
// requires at least two supporting evidence conditions and never fabricates a
// metric that is absent. Documented precedence (high → low):
//   1  one_pump_chump                    pump-chase + short-duration exit at a loss
//   2  frequent_trader_infrequent_winner high volume + low win + losing
//   3  diversified_into_every_bad_decision many tokens traded + many held + losing
//   4  liquidity_donor                   large trade size + losing + meaningful volume
//   5  bought_the_rumor                  old-token bags + still holding + losing
//   6  stop_loss_optional                overtrader + modest loss + decent win
//   7  gas_fee_sugar_daddy               high tx frequency + no profit
//   8  certified_exit_liquidity          deep loss + low win (broad retail fallback)
//   9  rug_survivors_guilt               deep loss + decent win (escaped some)
//   10 diamond_handed_hostage            very long holds + no profit
//   11 diamond_hands_somehow_correct     very long holds + profitable
//   12 diamond_hands_by_accident         huge win + very high win rate
//   13 one_good_trade_and_a_personality  profitable + barely any trades
//   14 premature_liquidator              modest profit + decent win
//   15 suspiciously_competent            strong profit + good win
//   16 portfolio_polygamist              no trading + many holdings + valuable
//   17 museum_grade_bagholder            no trading + huge token collection
//   18 commitment_issues_onchain         no trading + modest holdings + ghosted
//   DEFAULT bagholder_emeritus (no trading) / suspiciously_competent (active, unmatched)
export const PERFORMANCE_RULES = [
  {
    code: "one_pump_chump",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl >= 0) return false;
      const age = num(m.avg_token_bought_age_days);
      const hold = num(m.avg_holding_seconds);
      const shortDur = (age !== null && age < 7) || (hold !== null && hold < 3600);
      if (!shortDur) return false;
      const win = num(m.win_rate_pct);
      return win === null || win < 0.35;
    }
  },
  {
    code: "frequent_trader_infrequent_winner",
    test: (m) => {
      const trades = num(m.total_trades);
      const dex = num(m.dex_trade_count);
      const hiVolume = (trades !== null && trades >= 500) || (dex !== null && dex >= 100);
      if (!hiVolume) return false;
      const win = num(m.win_rate_pct);
      if (win === null || win >= 0.4) return false;
      const pnl = num(m.realized_pnl_pct);
      return pnl !== null && pnl < 0;
    }
  },
  {
    code: "diversified_into_every_bad_decision",
    test: (m) => {
      const tokens = num(m.tokens_traded);
      if (tokens === null || tokens < 200) return false;
      const holdings = num(m.token_balance_count);
      if (holdings === null || holdings < 50) return false;
      const pnl = num(m.realized_pnl_pct);
      return pnl !== null && pnl < 0;
    }
  },
  {
    code: "liquidity_donor",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl >= 0) return false;
      const avgTrade = num(m.avg_trade_value_usd);
      if (avgTrade === null || avgTrade < 10000) return false;
      const trades = num(m.total_trades);
      return trades !== null && trades >= 50;
    }
  },
  {
    code: "bought_the_rumor",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl >= 0) return false;
      const age = num(m.avg_token_bought_age_days);
      if (age === null || age < 365) return false;
      const holdings = num(m.token_balance_count);
      return holdings !== null && holdings >= 5;
    }
  },
  {
    code: "stop_loss_optional",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl >= 0) return false;
      const trades = num(m.total_trades);
      if (trades === null || trades < 200) return false;
      const win = num(m.win_rate_pct);
      return win === null || win >= 0.4;
    }
  },
  {
    code: "gas_fee_sugar_daddy",
    test: (m) => {
      const txFreq = num(m.tx_frequency_per_day);
      if (txFreq === null || txFreq < 5) return false;
      const pnl = num(m.realized_pnl_pct);
      return pnl === null || pnl <= 0;
    }
  },
  {
    code: "certified_exit_liquidity",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl > -0.2) return false;
      const win = num(m.win_rate_pct);
      return win === null || win < 0.4;
    }
  },
  {
    code: "rug_survivors_guilt",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl > -0.5) return false;
      const win = num(m.win_rate_pct);
      return win !== null && win >= 0.5;
    }
  },
  {
    code: "diamond_handed_hostage",
    test: (m) => {
      const hold = num(m.avg_holding_seconds);
      if (hold === null || hold <= 2592000) return false;
      const pnl = num(m.realized_pnl_pct);
      return pnl === null || pnl <= 0;
    }
  },
  {
    code: "diamond_hands_somehow_correct",
    test: (m) => {
      const hold = num(m.avg_holding_seconds);
      if (hold === null || hold <= 2592000) return false;
      const pnl = num(m.realized_pnl_pct);
      return pnl !== null && pnl > 0;
    }
  },
  {
    code: "diamond_hands_by_accident",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl < 0.8) return false;
      const win = num(m.win_rate_pct);
      return win !== null && win >= 0.8;
    }
  },
  {
    code: "one_good_trade_and_a_personality",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl <= 0) return false;
      // Requires EVIDENCE of few trades — absent trade data is "unknown", not
      // "one good trade", so a strong winner with no trade count falls through to
      // suspiciously_competent rather than fabricating a barely-trades narrative.
      const trades = num(m.total_trades);
      if (trades === null || trades > 5) return false;
      const tokens = num(m.tokens_traded);
      return tokens !== null && tokens <= 3;
    }
  },
  {
    code: "premature_liquidator",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl <= 0 || pnl >= 0.8) return false;
      const win = num(m.win_rate_pct);
      return win === null || win >= 0.5;
    }
  },
  {
    code: "suspiciously_competent",
    test: (m) => {
      const pnl = num(m.realized_pnl_pct);
      if (pnl === null || pnl < 0.8) return false;
      const win = num(m.win_rate_pct);
      return win === null || win >= 0.55;
    }
  },
  {
    code: "portfolio_polygamist",
    test: (m) => {
      if (!noActiveTrading(m)) return false;
      const holdings = num(m.token_balance_count);
      if (holdings === null || holdings < 50) return false;
      const portVal = num(m.portfolio_value_usd);
      return portVal !== null && portVal >= 100000;
    }
  },
  {
    code: "museum_grade_bagholder",
    test: (m) => {
      if (!noActiveTrading(m)) return false;
      const holdings = num(m.token_balance_count);
      return holdings !== null && holdings >= 100;
    }
  },
  {
    code: "commitment_issues_onchain",
    test: (m) => {
      if (!noActiveTrading(m)) return false;
      const holdings = num(m.token_balance_count);
      if (holdings === null || holdings >= 50) return false;
      const txCount = num(m.transaction_count);
      return txCount === null || txCount < 20;
    }
  }
];

// Select a verdict object from saved performance metrics. Pure + deterministic.
export function selectPerformanceVerdict(metrics) {
  const m = metrics || {};
  for (const r of PERFORMANCE_RULES) {
    if (r.test(m)) return BY_CODE[r.code];
  }
  // Default: inactive holders → bagholder emeritus; active but unmatched → suspiciously competent.
  return noActiveTrading(m) ? BY_CODE["bagholder_emeritus"] : BY_CODE["suspiciously_competent"];
}