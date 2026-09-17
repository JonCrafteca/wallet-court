// Wallet Court — entity-aware verdict pools. Wallet class provides context
// (which pool to draw from); real performance metrics still determine the
// specific verdict, severity, confidence, roast, and sentence. Deterministic.
//
// Retail/trader verdicts (indices 0-4) are preserved verbatim from VERDICTS so
// the mandatory demo-address One Pump Chump and all existing live retail
// behavior are unchanged. Entity wallets (CEX, MM, MEV, Protocol, Fund) get
// distinct pools so five materially different entity wallets no longer collapse
// to the same verdict. No verdict alleges fraud, theft, insolvency, or misuse
// of customer funds.
import { selectPerformanceVerdict } from "./verdicts_performance.ts";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ---- CEX / EXCHANGE ----
const CEX_POOL = [
  {
    code: "hot_wallet_cold_personality",
    display_name: "Hot Wallet, Cold Personality",
    headline: "Moves billions. Feels nothing.",
    roast: "The court recognizes a wallet that routes the world's liquidity with the emotional range of a load balancer. Every deposit is a transaction; every withdrawal is a transaction; nothing is ever a decision. You are not a trader — you are plumbing, and the court respects plumbing.",
    defense: "Your honor, my client is merely infrastructure. You cannot sue a pipe.",
    sentence: "Permanent designation as Critical Infrastructure. The court orders you to keep operating exactly as you do, because everyone else depends on it."
  },
  {
    code: "industrial_bag_handler",
    display_name: "Industrial Bag Handler",
    headline: "Custody is not a personality.",
    roast: "You hold more tokens than most ecosystems mint, and yet not one of them is yours. The court has reviewed your balances and found a warehouse with excellent posture. Custody is a service, not a strategy, and you provide it at industrial scale.",
    defense: "My client holds these assets on behalf of others. The bags are not theirs to drop.",
    sentence: "90 days of mandatory proof-of-reserves jokes from the public gallery. The court will not enforce them — the internet will."
  },
  {
    code: "order_book_overlord",
    display_name: "Order Book Overlord",
    headline: "Every candle is your handiwork.",
    roast: "The court examined your trade count and found that the chart does not move without your consent. You do not trade the market; you are the market's daily commute. Volume is not a vanity metric in your courtroom — it is a confession.",
    defense: "My client simply provides liquidity. Two-sided, fair, and relentless.",
    sentence: "120 days during which you must let at least one candle close without your involvement. The court doubts you can."
  },
  {
    code: "gas_fee_landlord",
    display_name: "Gas Fee Landlord",
    headline: "You don't trade. You invoice.",
    roast: "Every block on this chain pays you rent. The court has reviewed your transaction frequency and concluded you are less a participant and more a utility company with a wallet address. Validators send you holiday cards. You are the reason 'priority fee' is a phrase.",
    defense: "My client performs a vital service. Convenience is not a crime.",
    sentence: "60 days of reduced gas prices, enforced by the court's sincere but non-binding recommendation to the market."
  }
];

// ---- MARKET MAKER ----
const MM_POOL = [
  {
    code: "spread_goblin",
    display_name: "Spread Goblin",
    headline: "You don't pick direction. You pick the gap.",
    roast: "The court finds you guilty of monetizing the space between two prices. You have no opinion on whether the market goes up or down — only on the width of the crack between them. Your PnL is the sound of a bid-ask gap being harvested, one basis point at a time.",
    defense: "My client provides two-sided liquidity. Without them, there is no market to stand in.",
    sentence: "90 days of being forced to hold a directional opinion. The court expects withdrawal symptoms within the hour."
  },
  {
    code: "certified_two_sided_menace",
    display_name: "Certified Two-Sided Menace",
    headline: "Liquidity with benefits.",
    roast: "You quote both sides of every book and somehow profit regardless of which one wins. The court has reviewed your near-zero net PnL and your enormous trade count and concluded you are not trading — you are taxing the act of trading itself.",
    defense: "My client is a market maker. Profit from dislocation is the entire point.",
    sentence: "60 days of mandatory one-sided quotes. The court will not enforce this; your risk department will."
  },
  {
    code: "liquidity_with_benefits",
    display_name: "Liquidity With Benefits",
    headline: "You profit whether the market does or not.",
    roast: "The court finds your PnL suspiciously uncorrelated with the market's mood. You provide liquidity the way a landlord provides housing: reliably, expensively, and with zero emotional investment in the tenant's wellbeing.",
    defense: "My client earns the spread. The market pays it willingly, every time.",
    sentence: "Permanent surveillance of your spreads. The court will watch, and occasionally grumble."
  },
  {
    code: "professional_fence_sitter",
    display_name: "Professional Fence-Sitter",
    headline: "No conviction. Only inventory.",
    roast: "You have never met a side of the market you wouldn't quote. The court finds your discipline admirable and your soul absent. You are not bullish or bearish — you are available, for a fee.",
    defense: "My client has no directional bias. Bias is, statistically, unprofitable.",
    sentence: "Indefinite two-sided duty. Sentence is effectively time already served."
  }
];

// ---- MEV / BOT ----
const MEV_POOL = [
  {
    code: "mempool_menace",
    display_name: "Mempool Menace",
    headline: "You see the trades before they happen.",
    roast: "The court has reviewed your transaction frequency and concluded you do not trade the market — you watch it load, then act on what you saw. The mempool is your waiting room, and you never miss an appointment.",
    defense: "My client merely observes public pending transactions. Observation is not a crime.",
    sentence: "90 days of being forced to submit transactions like everyone else. The court expects this to be physically impossible for you."
  },
  {
    code: "sandwich_artist",
    display_name: "Sandwich Artist",
    headline: "You're the bread. They're the filling.",
    roast: "The court finds you guilty of constructing a delicacy: a user's transaction, placed neatly between two of yours. You do not add liquidity; you add a toll booth. Every slip you create is a tip you did not ask for but absolutely accepted.",
    defense: "My client provides valuable arbitrage that prices inefficiency out of the market. The filling was going to be eaten regardless.",
    sentence: "120 days during which every sandwich you make must be served to yourself first. The court is curious about the nutritional outcome."
  },
  {
    code: "gas_auction_addict",
    display_name: "Gas Auction Addict",
    headline: "You bid more in gas than most people earn.",
    roast: "The court examined your priority fees and found a wallet that treats the block space auction as a competitive sport. You do not win every auction — you simply refuse to let anyone else win cheaply. Your gas bill is a leaderboard, and you are at the top.",
    defense: "My client participates in a fair, open auction. Paying to win is the intended design.",
    sentence: "60 days of bidding exactly one wei above the second-highest bid. The court expects you to find this unbearable."
  },
  {
    code: "front_run_and_done",
    display_name: "Front-Run and Done",
    headline: "In, out, before anyone noticed.",
    roast: "The court finds your trades have a suspicious tendency to arrive just before the crowd and leave just before the consequences. You are not fast — you are early, in a way that makes 'early' feel like a euphemism.",
    defense: "My client has low latency. Latency is not, itself, a crime.",
    sentence: "90 days of mandatory 10-block delays on every transaction. The court expects withdrawal."
  }
];

// ---- PROTOCOL / TREASURY ----
const PROTOCOL_POOL = [
  {
    code: "treasury_main_character",
    display_name: "Treasury With Main Character Energy",
    headline: "The protocol's wallet, but it thinks it's the protocol.",
    roast: "The court has reviewed your holdings and found a treasury so large it has opinions. You are not a participant in this ecosystem — you are the ecosystem's savings account, and the savings account has been posting.",
    defense: "My client holds assets in trust for a community. The community is, charitably, opinionated.",
    sentence: "Indefinite transparency obligations. The court orders you to keep publishing, because the alternative is worse."
  },
  {
    code: "governance_bag_collector",
    display_name: "Governance Bag Collector",
    headline: "You hold every token. You vote on none of them.",
    roast: "The court finds you guilty of acquiring governance tokens with the enthusiasm of a collector and the participation rate of a statute. You have a vote on every proposal and an opinion on none of them. The bags are real; the governance is theoretical.",
    defense: "My client holds for the long term. Long-term governance is, by definition, patient.",
    sentence: "120 days of mandatory participation in at least one governance vote. The court will not check whether you read it."
  },
  {
    code: "contractually_online",
    display_name: "Contractually Online",
    headline: "The contract calls. You answer. Always.",
    roast: "The court has reviewed your transaction frequency and found a wallet that does not sleep because the contract does not sleep. You are not a treasury — you are a server with a balance, and the server has not had a day off since deployment.",
    defense: "My client is automated by design. Rest is not in the specification.",
    sentence: "60 days of mandatory downtime. The court acknowledges this will require a governance vote to implement."
  },
  {
    code: "yield_committee",
    display_name: "Yield Committee",
    headline: "You don't farm. You allocate the farm.",
    roast: "The court finds your yield strategy suspiciously organized. You do not chase APY — you commission it. Every farm you touch becomes a line item, and every harvest becomes a budget.",
    defense: "My client manages treasury yield. Yield is, the court will note, the point of a treasury.",
    sentence: "90 days of filing a one-paragraph plain-English summary of every yield position. The court will read none of them, but the public will."
  }
];

// ---- FUND / INSTITUTION ----
const FUND_POOL = [
  {
    code: "institutional_grade_degeneracy",
    display_name: "Institutional-Grade Degeneracy",
    headline: "Professional size. Retail instincts.",
    roast: "The court has reviewed your positions and found a fund-sized wallet making degen-sized decisions. You have the balance sheet of an institution and the risk management of a group chat. The due diligence file exists; the court has read it; it is mostly vibes.",
    defense: "My client performs extensive research. Sometimes the research concludes 'send it.'",
    sentence: "120 days of mandatory risk disclosures written at a sixth-grade reading level."
  },
  {
    code: "capital_allocation_incident",
    display_name: "Capital Allocation Incident",
    headline: "The allocation was fine. The outcome was not.",
    roast: "The court finds your PnL deeply negative and your position sizes deeply institutional. You did not lose a little — you lost at scale, which is, the court supposes, a kind of efficiency. The allocation was a thesis; the market had a different thesis.",
    defense: "My client took a considered position. The market was inconsiderate.",
    sentence: "90 days of mandatory 'in hindsight' disclosures attached to every rebalance."
  },
  {
    code: "professionally_overexposed",
    display_name: "Professionally Overexposed",
    headline: "Diversified into one large mistake.",
    roast: "The court has reviewed your portfolio and found a fund that diversified carefully into a single, enormous, shared conviction. You are overexposed in a way that is clearly someone's policy and clearly no one's preference.",
    defense: "My client's concentration reflects conviction, not negligence. The conviction is shared by the investment committee, which is now, charitably, reconsidering.",
    sentence: "60 days of mandatory correlation reviews. The court expects them to be awkward."
  },
  {
    code: "due_diligence_pending",
    display_name: "Due Diligence Pending",
    headline: "The memo is still being written.",
    roast: "The court finds your positions modest and your paperwork eternal. You have not lost money, but you have not made a decision without a memo either, and the memo is, as always, pending. The court respects the process and mourns the opportunity cost.",
    defense: "My client does not invest without research. Research takes time. Time is, regrettably, the enemy of alpha.",
    sentence: "Indefinite continued diligence. The court orders you to keep writing, because the alternative is deciding."
  }
];

// Retail/trader verdict pool + the performance-driven rule engine live in
// verdicts_performance.ts (Phase N2.2). The 5 original VERDICTS, the 4 prior
// retail expansions, and the 10 new performance verdicts are assembled there
// into RETAIL_POOL and selected by a documented precedence order.

// Ordered rule lists. First match wins; default is the last pool entry.
function pickByRules(pool, rules, metrics) {
  for (const r of rules) {
    if (r.test(metrics)) return pool[r.index];
  }
  return pool[pool.length - 1];
}

const CEX_RULES = [
  { test: (m) => num(m.tx_frequency_per_day) >= 10, index: 0 },
  { test: (m) => num(m.portfolio_value_usd) >= 1e6, index: 1 },
  { test: (m) => num(m.total_trades) >= 1000, index: 2 }
];

const MM_RULES = [
  { test: (m) => num(m.realized_pnl_pct) >= 0.2, index: 2 },
  { test: (m) => Math.abs(num(m.realized_pnl_pct) ?? 0) <= 0.05 && num(m.tx_frequency_per_day) >= 1, index: 1 },
  { test: (m) => num(m.total_trades) >= 500, index: 0 }
];

const MEV_RULES = [
  { test: (m) => num(m.tx_frequency_per_day) >= 20, index: 2 },
  { test: (m) => num(m.realized_pnl_pct) > 0 && num(m.tx_frequency_per_day) >= 5, index: 1 },
  { test: (m) => num(m.tx_frequency_per_day) >= 5, index: 0 }
];

const PROTOCOL_RULES = [
  { test: (m) => num(m.portfolio_value_usd) >= 5e6, index: 0 },
  { test: (m) => num(m.token_balance_count) >= 50, index: 1 },
  { test: (m) => num(m.tx_frequency_per_day) >= 5, index: 2 },
  { test: (m) => num(m.realized_pnl_pct) > 0, index: 3 }
];

const FUND_RULES = [
  { test: (m) => num(m.realized_pnl_pct) <= -0.3, index: 1 },
  { test: (m) => num(m.realized_pnl_pct) < 0 && num(m.portfolio_value_usd) >= 1e6, index: 2 },
  { test: (m) => num(m.realized_pnl_pct) < 0, index: 0 },
  { test: (m) => num(m.realized_pnl_pct) >= 0, index: 3 }
];

// Retail/unknown selector: delegates to the Phase N2.2 performance-driven
// engine (verdicts_performance.ts), which uses the full saved evidence set and
// a documented precedence order. The mandatory demo One Pump Chump is handled
// separately by the demo path (selectDemoVerdictIndex + VERDICTS).
function selectRetailVerdict(metrics) {
  return selectPerformanceVerdict(metrics);
}

// Select a verdict object for a wallet class + metrics. Returns
// { code, display_name, headline, roast, defense, sentence }.
export function selectEntityVerdict(walletClass, metrics) {
  switch (walletClass) {
    case "cex_exchange": return pickByRules(CEX_POOL, CEX_RULES, metrics);
    case "market_maker": return pickByRules(MM_POOL, MM_RULES, metrics);
    case "mev_bot": return pickByRules(MEV_POOL, MEV_RULES, metrics);
    case "protocol_treasury": return pickByRules(PROTOCOL_POOL, PROTOCOL_RULES, metrics);
    case "fund_institution": return pickByRules(FUND_POOL, FUND_RULES, metrics);
    default: return selectRetailVerdict(metrics);
  }
}

// Pure helper used by the label-only backfill: recompute the verdict from a
// wallet class and SAVED performance metrics. Makes no Nansen calls — it
// reuses saved evidence. The caller recomputes severity/confidence separately.
export function recomputeVerdictFromLabels(walletClass, metrics) {
  return selectEntityVerdict(walletClass, metrics);
}