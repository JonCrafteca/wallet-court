// Wallet Court — Canonical verdict-archetype registry.
//
// Single source of truth for all verdict classifications across single-trade
// and whole-wallet analysis, verdict receipt rendering, share images, My Court,
// Hall of Fame, and admin/debug views.
//
// PRINCIPLE: The deterministic analysis selects the archetype. AI may write
// roast/commentary only AFTER receiving the selected archetype and verified
// metrics. AI must never invent or override the classification.
//
// RECOVERY METRICS HONESTY:
// Price-based recovery metrics (price_recovery_multiple_from_bottom,
// cash_flow_adjusted_recovery_pct) are PURE price ratios — they are unaffected
// by token-quantity changes from later buys. The legacy value-based
// recovered_loss_pct compared ending_value (all tokens sold, including later
// buys) against lowest_position_value (entry tokens only at trough price),
// which inflated recovery when capital was injected after the trough.
// final_return_pct uses total_cost_basis_usd (entry + later buys) so the return
// reflects the complete cash-flow picture, not just the entry cost.
//
// This module is PURE: no SDK, no network, no side effects. Imported by
// backend functions and unit-tested in isolation.

// ---- Types ----

export type ArchetypeTier = "comeback" | "recovery" | "guilty" | "neutral" | "not_guilty";

export interface ArchetypeDefinition {
  archetype_id: string;
  archetype_name: string;
  archetype_tier: ArchetypeTier;
  charge: string;
  headline: string;
  sentence: string;
  defense: string;
}

// ---- Comeback tier definitions ----
//
// Drawdown thresholds are in RATIO form (e.g., -0.50 means -50%).
// A comeback archetype requires ending_value >= total_cost_basis (recovered
// to total cost basis or better). The journey takes precedence over generic
// final-P&L classifications like "Stuck in the Middle."
//
// Tier boundaries (inclusive lower, exclusive upper):
//   ESCAPE ARTIST:     dd <= -50%  AND  dd > -70%
//   COMEBACK KID:      dd <= -70%  AND  dd > -90%
//   BACK FROM THE DEAD: dd <= -90%

export interface ComebackTier {
  archetype_id: string;
  archetype_name: string;
  charge: string;
  min_drawdown: number; // inclusive lower bound (e.g., -0.50)
  max_drawdown: number | null; // exclusive upper bound (e.g., -0.70); null = no bound
  defense: string;
  sentence: string;
}

export const COMEBACK_TIERS: ComebackTier[] = [
  {
    archetype_id: "escape_artist",
    archetype_name: "ESCAPE ARTIST",
    charge: "REFUSING TO STAY UNDERWATER",
    min_drawdown: -0.50,
    max_drawdown: -0.70,
    defense:
      "My client merely held through a routine correction. The court is dramatizing a dip.",
    sentence:
      "One mandatory victory lap, served exclusively in the group chat.",
  },
  {
    archetype_id: "comeback_kid",
    archetype_name: "COMEBACK KID",
    charge: "REFUSING TO DIE",
    min_drawdown: -0.70,
    max_drawdown: -0.90,
    defense:
      "My client was merely early. The timing of the recovery is coincidental.",
    sentence:
      "One mandatory victory lap—and a lifetime ban from pretending this was disciplined risk management.",
  },
  {
    archetype_id: "back_from_the_dead",
    archetype_name: "BACK FROM THE DEAD",
    charge: "RETURNING FROM THE AFTERLIFE",
    min_drawdown: -0.90,
    max_drawdown: null,
    defense:
      "My client was not dead. My client was resting. The court has no jurisdiction over naps.",
    sentence:
      "One mandatory resurrection certificate, framed and displayed above the trading terminal.",
  },
];

// ---- Almost Escaped (incomplete comeback) ----
//
// A journey archetype for positions that survived a severe drawdown and
// recovered most of the loss via PRICE appreciation, but sold just short of
// full cost-basis recovery.
//
// ELIGIBILITY (price-based, capital-injection-honest):
//   - max_drawdown_pct <= -70%
//   - price_recovery_multiple_from_bottom >= 5x  (exit_price / trough_price)
//   - final_return_pct < 0%   (did not recover to total cost basis)
//   - final_return_pct >= -20%  (came close to break-even)
//   - reliable chronological entry, trough, subsequent cash flows and exit data
//
// Precedence: completed comebacks > Almost Escaped > generic classifications.
export const ALMOST_ESCAPED = {
  archetype_id: "almost_escaped",
  archetype_name: "Almost Escaped",
  display_headline: "FUMBLED THE COMEBACK",
  charge: "SELLING AT THE FINISH LINE",
  tier: "recovery" as ArchetypeTier,
  hall_eligible: true,
  defense: "My client was implementing a disciplined exit strategy. The court is punishing timing.",
  sentence:
    "The Court sentences you to watching the chart continue without you and explaining forever that you almost broke even.",
};

// All journey archetype IDs (comeback + recovery tiers). Used by the Hall of
// Fame Recovery category to identify journey-based verdicts.
export const JOURNEY_ARCHETYPE_IDS = [
  ...COMEBACK_TIERS.map((t) => t.archetype_id),
  ALMOST_ESCAPED.archetype_id,
];

export function isJourneyArchetype(verdictCode: string | null | undefined): boolean {
  return !!verdictCode && JOURNEY_ARCHETYPE_IDS.includes(verdictCode);
}

// ---- Comeback classification inputs ----

export interface ComebackInputs {
  amount_invested_usd: number | null;
  // Total cost basis = entry cost + later buys. Used for final_return_pct and
  // the recovered-to-cost-basis check. Falls back to amount_invested_usd when
  // null (no later buys or unknown).
  total_cost_basis_usd: number | null;
  lowest_position_value_usd: number | null;
  ending_value_usd: number | null;
  // Price-based recovery inputs (pure price ratios, unaffected by token
  // quantity changes from later buys).
  entry_price_usd: number | null;
  trough_price_usd: number | null;
  exit_price_usd: number | null;
  // Chronological confirmation: the low occurred after entry and before ending.
  low_after_entry: boolean;
  low_before_ending: boolean;
}

// ---- Canonical archetype record (the result) ----

export interface ComebackResult {
  archetype_id: string | null;
  archetype_name: string | null;
  archetype_tier: ArchetypeTier | null;
  classification_reason: string;
  amount_invested_usd: number;
  total_cost_basis_usd: number;
  lowest_position_value_usd: number;
  ending_value_usd: number;
  max_drawdown_pct: number; // as percentage (e.g., -89.1)
  final_return_pct: number; // as percentage (e.g., -17.1), based on total_cost_basis
  // Pure price-based recovery: exit_price / trough_price. Unaffected by token
  // quantity changes from later buys. Replaces the legacy value-based
  // recovery_multiple_from_bottom which was inflated when capital was injected.
  price_recovery_multiple_from_bottom: number | null;
  // Cash-flow-adjusted recovery: (exit_price - trough_price) / (entry_price -
  // trough_price) * 100. Measures how much of the trough loss was recovered by
  // price movement alone, excluding capital injected after the trough.
  cash_flow_adjusted_recovery_pct: number | null;
  // Legacy field, now equal to cash_flow_adjusted_recovery_pct for backward
  // compatibility with stored metrics. No longer used as the Almost Escaped gate.
  recovered_loss_pct: number | null;
  data_confidence: "high" | "medium" | "low";
  qualifying_evidence: string[];
  disqualifying_evidence: string[];
}

// ---- Pure classification function ----
//
// Classifies a comeback archetype from verified inputs. Returns null
// archetype_id if no comeback tier is matched (inputs missing, unreliable,
// ending below cost basis, or drawdown doesn't meet the minimum -50% threshold).
export function classifyComeback(inputs: ComebackInputs): ComebackResult {
  const {
    amount_invested_usd,
    total_cost_basis_usd,
    lowest_position_value_usd,
    ending_value_usd,
    entry_price_usd,
    trough_price_usd,
    exit_price_usd,
    low_after_entry,
    low_before_ending,
  } = inputs;

  const qualifying: string[] = [];
  const disqualifying: string[] = [];

  // ---- Reliability checks ----
  const hasInvested =
    amount_invested_usd !== null && amount_invested_usd !== undefined && amount_invested_usd > 0;
  const hasLow =
    lowest_position_value_usd !== null && lowest_position_value_usd !== undefined && lowest_position_value_usd >= 0;
  const hasEnding =
    ending_value_usd !== null && ending_value_usd !== undefined && ending_value_usd >= 0;

  if (!hasInvested) disqualifying.push("Missing or invalid amount_invested_usd");
  if (!hasLow) disqualifying.push("Missing or unreliable lowest_position_value_usd");
  if (!hasEnding) disqualifying.push("Missing or unreliable ending_value_usd");
  if (!low_after_entry) disqualifying.push("Low point did not occur after entry");
  if (!low_before_ending) disqualifying.push("Low point did not occur before the ending valuation");

  // If any required input is missing or unreliable, no comeback classification.
  if (!hasInvested || !hasLow || !hasEnding || !low_after_entry || !low_before_ending) {
    return {
      archetype_id: null,
      archetype_name: null,
      archetype_tier: null,
      classification_reason:
        "Comeback classification skipped: required inputs missing or unreliable.",
      amount_invested_usd: amount_invested_usd ?? 0,
      total_cost_basis_usd: total_cost_basis_usd ?? amount_invested_usd ?? 0,
      lowest_position_value_usd: lowest_position_value_usd ?? 0,
      ending_value_usd: ending_value_usd ?? 0,
      max_drawdown_pct: 0,
      final_return_pct: 0,
      price_recovery_multiple_from_bottom: null,
      cash_flow_adjusted_recovery_pct: null,
      recovered_loss_pct: null,
      data_confidence: "low",
      qualifying_evidence: qualifying,
      disqualifying_evidence: disqualifying,
    };
  }

  // ---- Compute metrics ----
  // Use total_cost_basis when available (entry + later buys); fall back to
  // entry-only cost for backward compatibility.
  const basis = total_cost_basis_usd !== null && total_cost_basis_usd > 0
    ? total_cost_basis_usd
    : amount_invested_usd;

  const max_drawdown_pct =
    ((lowest_position_value_usd - amount_invested_usd) / amount_invested_usd) * 100;
  const final_return_pct =
    ((ending_value_usd - basis) / basis) * 100;

  // Price-based recovery multiple (pure price ratio, capital-injection-honest).
  const price_recovery_multiple_from_bottom =
    trough_price_usd !== null && trough_price_usd > 0 && exit_price_usd !== null && exit_price_usd > 0
      ? exit_price_usd / trough_price_usd
      : null;

  // Cash-flow-adjusted recovery: how much of the trough loss was recovered by
  // price movement alone, excluding capital injected after the trough.
  const cash_flow_adjusted_recovery_pct =
    entry_price_usd !== null && trough_price_usd !== null && exit_price_usd !== null &&
    entry_price_usd > trough_price_usd
      ? ((exit_price_usd - trough_price_usd) / (entry_price_usd - trough_price_usd)) * 100
      : null;

  // recovered_loss_pct (legacy field) = cash_flow_adjusted_recovery_pct for
  // backward compatibility with stored metrics and Hall sorting. This is the
  // honest, price-based version — not the inflated value-based figure.
  const recovered_loss_pct = cash_flow_adjusted_recovery_pct;

  // ---- Check ending >= total cost basis (recovered to full cost basis) ----
  const recovered = ending_value_usd >= basis;
  if (!recovered) {
    disqualifying.push(
      `Ending value ($${ending_value_usd.toFixed(2)}) is below total cost basis ($${basis.toFixed(2)}) — comeback not completed`
    );
  }

  // ---- Check drawdown threshold for completed comebacks ----
  const ddRatio = max_drawdown_pct / 100; // convert to ratio for tier matching
  let matchedTier: ComebackTier | null = null;
  if (recovered) {
    for (const tier of COMEBACK_TIERS) {
      if (ddRatio <= tier.min_drawdown && (tier.max_drawdown === null || ddRatio > tier.max_drawdown)) {
        matchedTier = tier;
        break;
      }
    }
  }

  // ---- Check Almost Escaped (incomplete comeback) ----
  // Precedence: completed comebacks > Almost Escaped. Only check Almost Escaped
  // when no completed comeback was matched (position did not recover to total
  // cost basis, or drawdown doesn't meet a completed-comeback tier).
  //
  // Eligibility uses price_recovery_multiple_from_bottom (>= 5x) instead of the
  // inflated value-based recovered_loss_pct. This ensures capital injected
  // after the trough is not counted as market recovery.
  if (!matchedTier) {
    const almostEscaped =
      ddRatio <= -0.70 &&
      price_recovery_multiple_from_bottom !== null &&
      price_recovery_multiple_from_bottom >= 5 &&
      final_return_pct < 0 &&
      final_return_pct >= -20;
    if (almostEscaped) {
      qualifying.push(
        `Max drawdown of ${max_drawdown_pct.toFixed(1)}% meets the -70% Almost Escaped threshold`
      );
      qualifying.push(
        `Price recovery multiple of ${price_recovery_multiple_from_bottom!.toFixed(2)}x (≥ 5x required)`
      );
      qualifying.push(
        `Final return of ${final_return_pct.toFixed(1)}% (between -20% and 0%)`
      );
      return {
        archetype_id: ALMOST_ESCAPED.archetype_id,
        archetype_name: ALMOST_ESCAPED.archetype_name,
        archetype_tier: "recovery",
        classification_reason: `Almost Escaped: drawdown ${max_drawdown_pct.toFixed(1)}%, price recovery ${price_recovery_multiple_from_bottom!.toFixed(2)}x, final return ${final_return_pct.toFixed(1)}%.`,
        amount_invested_usd,
        total_cost_basis_usd: basis,
        lowest_position_value_usd,
        ending_value_usd,
        max_drawdown_pct,
        final_return_pct,
        price_recovery_multiple_from_bottom,
        cash_flow_adjusted_recovery_pct,
        recovered_loss_pct,
        data_confidence: "high",
        qualifying_evidence: qualifying,
        disqualifying_evidence: [],
      };
    }
  }

  if (!matchedTier) {
    return {
      archetype_id: null,
      archetype_name: null,
      archetype_tier: null,
      classification_reason: recovered
        ? "Drawdown does not meet any comeback tier threshold."
        : "Position has not recovered to total cost basis — comeback not completed.",
      amount_invested_usd,
      total_cost_basis_usd: basis,
      lowest_position_value_usd,
      ending_value_usd,
      max_drawdown_pct,
      final_return_pct,
      price_recovery_multiple_from_bottom,
      cash_flow_adjusted_recovery_pct,
      recovered_loss_pct,
      data_confidence: "high",
      qualifying_evidence: qualifying,
      disqualifying_evidence:
        disqualifying.length > 0
          ? disqualifying
          : [`Drawdown ${max_drawdown_pct.toFixed(1)}% does not meet the minimum -50% comeback threshold`],
    };
  }

  // ---- Comeback archetype selected! ----
  qualifying.push(
    `Max drawdown of ${max_drawdown_pct.toFixed(1)}% qualifies for ${matchedTier.archetype_name}`
  );
  qualifying.push(
    `Ending value ($${ending_value_usd.toFixed(2)}) recovered to total cost basis ($${basis.toFixed(2)})`
  );
  if (price_recovery_multiple_from_bottom !== null) {
    qualifying.push(`Price recovery multiple from bottom: ${price_recovery_multiple_from_bottom.toFixed(2)}x`);
  }

  return {
    archetype_id: matchedTier.archetype_id,
    archetype_name: matchedTier.archetype_name,
    archetype_tier: "comeback",
    classification_reason: `${matchedTier.archetype_name}: drawdown ${max_drawdown_pct.toFixed(1)}% with recovery to ${final_return_pct >= 0 ? "+" : ""}${final_return_pct.toFixed(1)}% final return.`,
    amount_invested_usd,
    total_cost_basis_usd: basis,
    lowest_position_value_usd,
    ending_value_usd,
    max_drawdown_pct,
    final_return_pct,
    price_recovery_multiple_from_bottom,
    cash_flow_adjusted_recovery_pct,
    recovered_loss_pct,
    data_confidence: "high",
    qualifying_evidence: qualifying,
    disqualifying_evidence: [],
  };
}

// ---- Dynamic roast generation ----
//
// The roast is generated deterministically from the archetype and verified
// metrics. No AI is involved in the classification or the core copy — only
// the numeric values are interpolated into fixed templates.
export function buildComebackRoast(
  tier: ComebackTier,
  result: ComebackResult
): string {
  const invested = result.amount_invested_usd;
  const lowest = result.lowest_position_value_usd;
  const ending = result.ending_value_usd;
  const drawdownPct = Math.round(Math.abs(result.max_drawdown_pct));
  const profit = ending - result.total_cost_basis_usd;

  const fmtMoney = (v: number) => {
    if (Math.abs(v) >= 1000) return `$${Math.round(v).toLocaleString()}`;
    return `$${Math.round(v)}`;
  };

  if (tier.archetype_id === "escape_artist") {
    return `You turned ${fmtMoney(invested)} into roughly ${fmtMoney(lowest)}, refused to panic, and climbed back to breakeven. After a ${drawdownPct}% drawdown, the position recovered to cost basis—and kept going. The Court finds you guilty of escaping a situation that would have buried a lesser trader.`;
  }

  if (tier.archetype_id === "comeback_kid") {
    return `You turned ${fmtMoney(invested)} into roughly ${fmtMoney(lowest)}, stared into the abyss, and somehow rode the position all the way back to profitability. After surviving an estimated ${drawdownPct}% collapse, the wallet recovered every dollar—and dragged another ${fmtMoney(profit)} out of the wreckage. The Court finds you guilty of achieving the correct result through methods no financial professional could responsibly endorse.`;
  }

  // back_from_the_dead
  return `You turned ${fmtMoney(invested)} into roughly ${fmtMoney(lowest)}, were pronounced dead at the scene, and then staged a recovery that defies the laws of markets and common sense. After surviving an estimated ${drawdownPct}% collapse, the wallet clawed its way back from the afterlife—and dragged another ${fmtMoney(profit)} out of the wreckage. The Court finds you guilty of necromancy.`;
}

// ---- Build a TradeVerdict from a comeback tier + result ----
//
// Returns an object compatible with the single-trade TradeVerdict interface,
// with the comeback archetype's code, name, charge, headline, roast, defense,
// and sentence.
export function buildComebackVerdict(tier: ComebackTier, result: ComebackResult) {
  return {
    code: tier.archetype_id,
    display_name: tier.archetype_name,
    charge: tier.charge,
    headline: tier.archetype_name,
    roast: buildComebackRoast(tier, result),
    defense: tier.defense,
    sentence: tier.sentence,
  };
}

// ---- Build a TradeVerdict from the Almost Escaped archetype + result ----
export function buildAlmostEscapedRoast(result: ComebackResult): string {
  const invested = result.amount_invested_usd;
  const lowest = result.lowest_position_value_usd;
  const ending = result.ending_value_usd;
  const drawdownPct = Math.round(Math.abs(result.max_drawdown_pct));
  // Shortfall is against total cost basis (entry + later buys), not just entry.
  const shortfall = result.total_cost_basis_usd - ending;

  const fmtMoney = (v: number) => {
    if (Math.abs(v) >= 1000) return `$${Math.round(v).toLocaleString()}`;
    return `$${Math.round(v)}`;
  };

  return `You turned ${fmtMoney(invested)} into roughly ${fmtMoney(lowest)}, clawed your way back to ${fmtMoney(ending)}, and then sold just ${fmtMoney(shortfall)} short of freedom. After surviving a ${drawdownPct}% collapse and recovering nearly everything, you completed one of crypto's greatest comebacks—except for the part where you actually came back.`;
}

export function buildAlmostEscapedVerdict(result: ComebackResult) {
  return {
    code: ALMOST_ESCAPED.archetype_id,
    display_name: ALMOST_ESCAPED.archetype_name,
    charge: ALMOST_ESCAPED.charge,
    headline: ALMOST_ESCAPED.display_headline,
    roast: buildAlmostEscapedRoast(result),
    defense: ALMOST_ESCAPED.defense,
    sentence: ALMOST_ESCAPED.sentence,
  };
}

// ---- Extract comeback inputs from trade metrics ----
//
// Derives the comeback inputs from the computed trade metrics. The metrics
// are expected to include:
//   purchase_cost_usd / amount_invested_usd — the USD cost of the entry
//   total_cost_basis_usd                    — entry + later buys (if available)
//   later_buys_cost_usd                     — total USD cost of later buys
//   max_drawdown_pct                       — ratio (e.g., -0.89 means -89%)
//   current_value_usd / ending_value_usd   — current value of remaining position
//   realized_exit_value_usd                 — total USD realized from sells
//   total_tokens_sold                       — total tokens sold (for exit price)
//   entry_price_usd                         — implied entry price
//   current_price_usd                       — current token price (for held)
//   conviction                              — "held" | "partial_exit" | "full_exit" | "averaged_down"
//   lowest_market_cap_timestamp             — timestamp of the lowest candle
//   last_sell_timestamp                     — timestamp of the last sell (for full exits)
export function extractComebackInputs(metrics: Record<string, any>): ComebackInputs {
  function num(v: any): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  const amount_invested_usd = num(metrics.purchase_cost_usd) ?? num(metrics.amount_invested_usd);
  const max_dd = num(metrics.max_drawdown_pct); // ratio

  // Total cost basis = entry + later buys cost.
  const later_buys_cost = num(metrics.later_buys_cost_usd);
  const total_cost_basis_usd =
    amount_invested_usd !== null && later_buys_cost !== null && later_buys_cost > 0
      ? amount_invested_usd + later_buys_cost
      : num(metrics.total_cost_basis_usd) ?? amount_invested_usd;

  // Prices for price-based recovery metrics.
  const entry_price_usd = num(metrics.entry_price_usd);
  const trough_price_usd = entry_price_usd !== null && max_dd !== null
    ? entry_price_usd * (1 + max_dd)
    : null;

  // Exit price: for full exits, derive from realized proceeds / tokens sold.
  // For held/partial positions, use the current token price.
  const conviction = metrics.conviction;
  const realized_exit_value_usd = num(metrics.realized_exit_value_usd);
  const total_tokens_sold = num(metrics.total_tokens_sold);
  const current_price_usd = num(metrics.current_price_usd);
  const exit_price_usd =
    conviction === "full_exit" && realized_exit_value_usd !== null && realized_exit_value_usd > 0 &&
    total_tokens_sold !== null && total_tokens_sold > 0
      ? realized_exit_value_usd / total_tokens_sold
      : current_price_usd;

  // Lowest position value = invested * (1 + max_drawdown_pct)
  // (max_drawdown_pct is the ratio decline from entry to the lowest point)
  const lowest_position_value_usd =
    amount_invested_usd !== null && max_dd !== null
      ? amount_invested_usd * (1 + max_dd)
      : null;

  // Ending value: for full exits, use realized exit value; otherwise current value.
  const current_value_usd = num(metrics.current_value_usd) ?? num(metrics.ending_value_usd);
  const ending_value_usd =
    conviction === "full_exit" && realized_exit_value_usd !== null
      ? realized_exit_value_usd
      : current_value_usd;

  // Chronological checks:
  // low_after_entry: the metrics are computed from post-entry candles, so the
  //   low is always after entry (true by construction).
  // low_before_ending: for held/partial positions, the ending is "now" which is
  //   after all candles (true). For full exits, check the low candle timestamp
  //   is before the last sell timestamp.
  const low_after_entry = max_dd !== null; // if we have a drawdown, we have post-entry candles
  let low_before_ending = true;
  if (conviction === "full_exit") {
    const lowTs = metrics.lowest_market_cap_timestamp;
    const lastSellTs = metrics.last_sell_timestamp;
    if (lowTs && lastSellTs) {
      low_before_ending = new Date(lowTs).getTime() < new Date(lastSellTs).getTime();
    }
  }

  return {
    amount_invested_usd,
    total_cost_basis_usd,
    lowest_position_value_usd,
    ending_value_usd,
    entry_price_usd,
    trough_price_usd,
    exit_price_usd,
    low_after_entry,
    low_before_ending,
  };
}

// ---- Classify comeback from trade metrics (convenience wrapper) ----
//
// Combines extractComebackInputs + classifyComeback into one call. Returns
// both the verdict (if a comeback was selected) and the full result record.
export function classifyComebackFromMetrics(metrics: Record<string, any>): {
  verdict: ReturnType<typeof buildComebackVerdict> | ReturnType<typeof buildAlmostEscapedVerdict> | null;
  result: ComebackResult;
} {
  const inputs = extractComebackInputs(metrics);
  const result = classifyComeback(inputs);
  if (!result.archetype_id) return { verdict: null, result };
  const tier = COMEBACK_TIERS.find((t) => t.archetype_id === result.archetype_id);
  if (tier) return { verdict: buildComebackVerdict(tier, result), result };
  if (result.archetype_id === ALMOST_ESCAPED.archetype_id) {
    return { verdict: buildAlmostEscapedVerdict(result), result };
  }
  return { verdict: null, result };
}

// ---- Whole-wallet archetype tier mapping ----
//
// Maps any verdict_code (whole-wallet or single-trade) to a canonical
// archetype tier. Used by the Hall of Fame for eligibility and display.
export function getArchetypeTier(verdictCode: string | null | undefined): ArchetypeTier {
  if (!verdictCode) return "neutral";
  // Comeback archetypes
  if (COMEBACK_TIERS.some((t) => t.archetype_id === verdictCode)) return "comeback";
  // Recovery archetype (incomplete comeback)
  if (verdictCode === ALMOST_ESCAPED.archetype_id) return "recovery";
  // Not-guilty (the only positive whole-wallet verdict)
  if (verdictCode === "suspiciously_competent") return "not_guilty";
  // Everything else with a verdict code is guilty
  return "guilty";
}