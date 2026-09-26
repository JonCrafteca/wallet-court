// Boundary tests for the canonical comeback archetype classification.
// Tests classifyComeback directly — no SDK, no network, no side effects.

import { describe, it, expect } from "vitest";
import {
  classifyComeback,
  COMEBACK_TIERS,
  classifyComebackFromMetrics,
  getArchetypeTier,
  isJourneyArchetype,
  ALMOST_ESCAPED,
} from "../base44/shared/archetypes.ts";

// Helper: build inputs with sensible defaults.
function inputs(overrides = {}) {
  return {
    amount_invested_usd: 1000,
    total_cost_basis_usd: null,
    lowest_position_value_usd: 400,
    ending_value_usd: 1200,
    entry_price_usd: null,
    trough_price_usd: null,
    exit_price_usd: null,
    low_after_entry: true,
    low_before_ending: true,
    ...overrides,
  };
}

describe("classifyComeback — fixture case", () => {
  it("matches the specified fixture: $1,100 / $120 / $1,250 → COMEBACK KID", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1100,
        lowest_position_value_usd: 120,
        ending_value_usd: 1250,
        // Price-based recovery: entry=1.0, trough=120/1100≈0.1091, exit=1250/1100≈1.1364
        entry_price_usd: 1.0,
        trough_price_usd: 120 / 1100,
        exit_price_usd: 1250 / 1100,
      })
    );

    expect(result.archetype_id).toBe("comeback_kid");
    expect(result.archetype_name).toBe("COMEBACK KID");
    expect(result.archetype_tier).toBe("comeback");

    // max_drawdown_pct ≈ -89.1%
    expect(result.max_drawdown_pct).toBeCloseTo(-89.1, 0);

    // final_return_pct ≈ +13.6%
    expect(result.final_return_pct).toBeCloseTo(13.6, 0);

    // price_recovery_multiple_from_bottom ≈ 10.4x (pure price ratio)
    expect(result.price_recovery_multiple_from_bottom).toBeCloseTo(10.4, 0);

    expect(result.data_confidence).toBe("high");
    expect(result.disqualifying_evidence).toHaveLength(0);
  });

  it("does NOT return STUCK IN THE MIDDLE (comeback overrides generic classification)", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1100,
        lowest_position_value_usd: 120,
        ending_value_usd: 1250,
      })
    );
    // The comeback system returns a comeback archetype, never a generic
    // final-P&L classification like "stuck_in_the_middle".
    expect(result.archetype_id).not.toBe("stuck_in_the_middle");
    expect(result.archetype_id).not.toBeNull();
  });
});

describe("classifyComeback — boundary tests", () => {
  it("-49.9% drawdown with profit: NOT Escape Artist", () => {
    // invested=1000, low=501 → dd = -49.9%
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 501,
        ending_value_usd: 1200,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("-50% drawdown with break-even ending: Escape Artist", () => {
    // invested=1000, low=500 → dd = -50%, ending=1000 (break-even)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 500,
        ending_value_usd: 1000,
      })
    );
    expect(result.archetype_id).toBe("escape_artist");
    expect(result.archetype_name).toBe("ESCAPE ARTIST");
  });

  it("-69.9% drawdown with profit: Escape Artist", () => {
    // invested=1000, low=301 → dd = -69.9%
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 301,
        ending_value_usd: 1100,
      })
    );
    expect(result.archetype_id).toBe("escape_artist");
  });

  it("-70% drawdown with break-even ending: Comeback Kid", () => {
    // invested=1000, low=300 → dd = -70%, ending=1000 (break-even)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 300,
        ending_value_usd: 1000,
      })
    );
    expect(result.archetype_id).toBe("comeback_kid");
    expect(result.archetype_name).toBe("COMEBACK KID");
  });

  it("-89.9% drawdown with profit: Comeback Kid", () => {
    // invested=1000, low=101 → dd = -89.9%
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 101,
        ending_value_usd: 1150,
      })
    );
    expect(result.archetype_id).toBe("comeback_kid");
  });

  it("-90% drawdown with break-even ending: Back From the Dead", () => {
    // invested=1000, low=100 → dd = -90%, ending=1000 (break-even)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 100,
        ending_value_usd: 1000,
      })
    );
    expect(result.archetype_id).toBe("back_from_the_dead");
    expect(result.archetype_name).toBe("BACK FROM THE DEAD");
  });

  it("extreme drawdown but ending below cost basis: no completed comeback", () => {
    // invested=1000, low=50 → dd = -95%, ending=800 (below cost basis)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 50,
        ending_value_usd: 800,
      })
    );
    expect(result.archetype_id).toBeNull();
    expect(result.disqualifying_evidence.length).toBeGreaterThan(0);
  });

  it("missing/unreliable low-point data: no comeback classification", () => {
    const result = classifyComeback(
      inputs({
        lowest_position_value_usd: null,
      ending_value_usd: 1200,
      amount_invested_usd: 1000,
      low_after_entry: true,
        low_before_ending: true,
      })
    );
    expect(result.archetype_id).toBeNull();
    expect(result.data_confidence).toBe("low");
  });

  it("low point occurring before entry: invalid for classification", () => {
    const result = classifyComeback(
      inputs({
        low_after_entry: false,
        amount_invested_usd: 1000,
        lowest_position_value_usd: 200,
        ending_value_usd: 1200,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("low point occurring after ending (full exit): invalid for classification", () => {
    const result = classifyComeback(
      inputs({
        low_before_ending: false,
        amount_invested_usd: 1000,
        lowest_position_value_usd: 200,
        ending_value_usd: 1200,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("final modest profit after severe drawdown: comeback overrides generic", () => {
    // dd=-89%, final_return=+13.6% — the fixture values
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1100,
        lowest_position_value_usd: 120,
        ending_value_usd: 1250,
      })
    );
    expect(result.archetype_id).toBe("comeback_kid");
    expect(result.final_return_pct).toBeCloseTo(13.6, 0);
  });

  it("-95% drawdown with full recovery: Back From the Dead (no upper bound)", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 50,
        ending_value_usd: 1500,
      })
    );
    expect(result.archetype_id).toBe("back_from_the_dead");
  });

  it("missing amount_invested_usd: no comeback classification", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: null,
        lowest_position_value_usd: 200,
        ending_value_usd: 1200,
      })
    );
    expect(result.archetype_id).toBeNull();
    expect(result.data_confidence).toBe("low");
  });

  it("missing ending_value_usd: no comeback classification", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 200,
        ending_value_usd: null,
      })
    );
    expect(result.archetype_id).toBeNull();
    expect(result.data_confidence).toBe("low");
  });
});

describe("classifyComebackFromMetrics — integration with trade metrics", () => {
  it("classifies from metrics with purchase_cost_usd and current_value_usd (held)", () => {
    const metrics = {
      purchase_cost_usd: 1100,
      max_drawdown_pct: -0.8909, // ratio
      current_value_usd: 1250,
      conviction: "held",
    };
    const { verdict, result } = classifyComebackFromMetrics(metrics);
    expect(result.archetype_id).toBe("comeback_kid");
    expect(verdict).not.toBeNull();
    expect(verdict!.code).toBe("comeback_kid");
    expect(verdict!.display_name).toBe("COMEBACK KID");
    expect(verdict!.charge).toBe("REFUSING TO DIE");
  });

  it("classifies from metrics with full_exit and realized_exit_value_usd", () => {
    const metrics = {
      purchase_cost_usd: 1000,
      max_drawdown_pct: -0.75, // -75%
      realized_exit_value_usd: 1100,
      conviction: "full_exit",
      lowest_market_cap_timestamp: "2026-01-15T00:00:00Z",
      last_sell_timestamp: "2026-03-01T00:00:00Z",
    };
    const { verdict, result } = classifyComebackFromMetrics(metrics);
    expect(result.archetype_id).toBe("comeback_kid");
    expect(verdict).not.toBeNull();
  });

  it("rejects full_exit where low occurred after the sell", () => {
    const metrics = {
      purchase_cost_usd: 1000,
      max_drawdown_pct: -0.75,
      realized_exit_value_usd: 1100,
      conviction: "full_exit",
      lowest_market_cap_timestamp: "2026-04-01T00:00:00Z", // after sell
      last_sell_timestamp: "2026-03-01T00:00:00Z",
    };
    const { verdict, result } = classifyComebackFromMetrics(metrics);
    expect(result.archetype_id).toBeNull();
    expect(verdict).toBeNull();
  });

  it("returns null verdict when drawdown is shallow", () => {
    const metrics = {
      purchase_cost_usd: 1000,
      max_drawdown_pct: -0.30, // -30%, below -50% threshold
      current_value_usd: 1200,
      conviction: "held",
    };
    const { verdict, result } = classifyComebackFromMetrics(metrics);
    expect(result.archetype_id).toBeNull();
    expect(verdict).toBeNull();
  });

  it("dynamic roast includes actual dollar values", () => {
    const metrics = {
      purchase_cost_usd: 1100,
      max_drawdown_pct: -0.8909,
      current_value_usd: 1250,
      conviction: "held",
      entry_price_usd: 1.0,
      current_price_usd: 1250 / 1100,
    };
    const { verdict } = classifyComebackFromMetrics(metrics);
    expect(verdict).not.toBeNull();
    expect(verdict!.roast).toContain("$1,100");
    expect(verdict!.roast).toContain("89%");
    expect(verdict!.roast).toContain("$150");
  });
});

describe("getArchetypeTier — whole-wallet mapping", () => {
  it("maps comeback archetype IDs to 'comeback' tier", () => {
    expect(getArchetypeTier("escape_artist")).toBe("comeback");
    expect(getArchetypeTier("comeback_kid")).toBe("comeback");
    expect(getArchetypeTier("back_from_the_dead")).toBe("comeback");
  });

  it("maps suspiciously_competent to 'not_guilty' tier", () => {
    expect(getArchetypeTier("suspiciously_competent")).toBe("not_guilty");
  });

  it("maps other verdict codes to 'guilty' tier", () => {
    expect(getArchetypeTier("one_pump_chump")).toBe("guilty");
    expect(getArchetypeTier("certified_exit_liquidity")).toBe("guilty");
    expect(getArchetypeTier("bag_holder_of_the_court")).toBe("guilty");
  });

  it("maps null/undefined to 'neutral' tier", () => {
    expect(getArchetypeTier(null)).toBe("neutral");
    expect(getArchetypeTier(undefined)).toBe("neutral");
    expect(getArchetypeTier("")).toBe("neutral");
  });
});

describe("Almost Escaped — incomplete comeback archetype", () => {
  it("qualifies: -85.1% drawdown, 5.44x price recovery, -17.1% final return", () => {
    // The actual TRADE-580FR5OT3D1I case values with honest price-based metrics.
    // total_cost_basis = entry ($1,048.08) + later buy ($52.53) = $1,100.61
    // price_recovery = exit_price / trough_price = $0.007866 / $0.001447 ≈ 5.44x
    // final_return = ($912.72 - $1,100.61) / $1,100.61 ≈ -17.1%
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1048.08,
        total_cost_basis_usd: 1100.61,
        lowest_position_value_usd: 156.41,
        ending_value_usd: 912.72,
        entry_price_usd: 0.009694,
        trough_price_usd: 0.001447,
        exit_price_usd: 0.007866,
      })
    );
    expect(result.archetype_id).toBe("almost_escaped");
    expect(result.archetype_name).toBe("Almost Escaped");
    expect(result.archetype_tier).toBe("recovery");
    expect(result.max_drawdown_pct).toBeCloseTo(-85.1, 0);
    expect(result.final_return_pct).toBeCloseTo(-17.1, 0);
    expect(result.price_recovery_multiple_from_bottom).toBeCloseTo(5.44, 1);
    expect(result.cash_flow_adjusted_recovery_pct).toBeCloseTo(77.8, 0);
    expect(result.data_confidence).toBe("high");
    expect(result.disqualifying_evidence).toHaveLength(0);
  });

  it("qualifies at boundary: -85% drawdown, 5.5x price recovery, -17.5% final return", () => {
    // invested=1000, low=150 → dd=-85%
    // entry=1.0, trough=0.15, exit=0.825 → price_recovery=5.5x (≥ 5x)
    // final_return = (825-1000)/1000 = -17.5% (between -20% and 0%)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 150,
        ending_value_usd: 825,
        entry_price_usd: 1.0,
        trough_price_usd: 0.15,
        exit_price_usd: 0.825,
      })
    );
    expect(result.archetype_id).toBe("almost_escaped");
    expect(result.price_recovery_multiple_from_bottom).toBeCloseTo(5.5, 1);
    expect(result.final_return_pct).toBeCloseTo(-17.5, 0);
  });

  it("does NOT qualify: severe drawdown but price recovery below 5x", () => {
    // invested=1000, low=250 → dd=-75%
    // entry=1.0, trough=0.25, exit=0.875 → price_recovery=3.5x (< 5x)
    // final_return = (875-1000)/1000 = -12.5% (between -20% and 0%)
    // Price recovery insufficient despite acceptable final return.
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 250,
        ending_value_usd: 875,
        entry_price_usd: 1.0,
        trough_price_usd: 0.25,
        exit_price_usd: 0.875,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("does NOT qualify: -85% drawdown but final return below -20%", () => {
    // invested=1000, low=150 → dd=-85%, ending=750
    // entry=1.0, trough=0.15, exit=0.75 → price_recovery=5.0x (≥ 5x)
    // final_return = (750-1000)/1000 = -25% → below -20% → does NOT qualify
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 150,
        ending_value_usd: 750,
        entry_price_usd: 1.0,
        trough_price_usd: 0.15,
        exit_price_usd: 0.75,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("does NOT qualify: drawdown above -70% (Escape Artist range)", () => {
    // invested=1000, low=400 → dd=-60%, ending=900
    // entry=1.0, trough=0.40, exit=0.90 → price_recovery=2.25x
    // dd=-60% > -70% → does NOT meet the -70% Almost Escaped threshold
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 400,
        ending_value_usd: 900,
        entry_price_usd: 1.0,
        trough_price_usd: 0.40,
        exit_price_usd: 0.90,
      })
    );
    expect(result.archetype_id).toBeNull();
  });

  it("ending at break-even routes to completed comeback, not Almost Escaped", () => {
    // invested=1000, low=150 → dd=-85%, ending=1000 (break-even)
    // recovered = true → completed comeback tier (comeback_kid)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 150,
        ending_value_usd: 1000,
      })
    );
    expect(result.archetype_id).toBe("comeback_kid");
    expect(result.archetype_tier).toBe("comeback");
  });

  it("ending at profit routes to completed comeback, not Almost Escaped", () => {
    // invested=1000, low=150 → dd=-85%, ending=1100 (profit)
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: 150,
        ending_value_usd: 1100,
      })
    );
    expect(result.archetype_id).toBe("comeback_kid");
    expect(result.archetype_tier).toBe("comeback");
  });

  it("missing/unreliable path data does not qualify", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1000,
        lowest_position_value_usd: null,
        ending_value_usd: 900,
      })
    );
    expect(result.archetype_id).toBeNull();
    expect(result.data_confidence).toBe("low");
  });

  it("Almost Escaped overrides Stuck in the Middle (not a generic classification)", () => {
    const result = classifyComeback(
      inputs({
        amount_invested_usd: 1048.08,
        total_cost_basis_usd: 1100.61,
        lowest_position_value_usd: 156.41,
        ending_value_usd: 912.72,
        entry_price_usd: 0.009694,
        trough_price_usd: 0.001447,
        exit_price_usd: 0.007866,
      })
    );
    expect(result.archetype_id).toBe("almost_escaped");
    expect(result.archetype_id).not.toBe("stuck_in_the_middle");
  });

  it("classifyComebackFromMetrics produces Almost Escaped verdict with correct copy", () => {
    const metrics = {
      purchase_cost_usd: 1048.08,
      max_drawdown_pct: -0.851,
      realized_exit_value_usd: 912.72,
      conviction: "full_exit",
      lowest_market_cap_timestamp: "2026-09-21T16:00:00Z",
      last_sell_timestamp: "2026-09-25T13:36:54Z",
      entry_price_usd: 0.009694,
      total_tokens_sold: 116076.44,
      later_buys_cost_usd: 52.53,
      current_price_usd: null,
    };
    const { verdict, result } = classifyComebackFromMetrics(metrics);
    expect(result.archetype_id).toBe("almost_escaped");
    expect(result.price_recovery_multiple_from_bottom).toBeCloseTo(5.44, 1);
    expect(result.final_return_pct).toBeCloseTo(-17.1, 0);
    expect(verdict).not.toBeNull();
    expect(verdict!.code).toBe("almost_escaped");
    expect(verdict!.display_name).toBe("Almost Escaped");
    expect(verdict!.charge).toBe("SELLING AT THE FINISH LINE");
    expect(verdict!.headline).toBe("FUMBLED THE COMEBACK");
    expect(verdict!.roast).toContain("$1,048");
    expect(verdict!.roast).toContain("85%");
    expect(verdict!.roast).toContain("short of freedom");
    expect(verdict!.sentence).toContain("watching the chart continue without you");
  });
});

describe("isJourneyArchetype — journey archetype check", () => {
  it("returns true for all comeback archetype IDs", () => {
    expect(isJourneyArchetype("escape_artist")).toBe(true);
    expect(isJourneyArchetype("comeback_kid")).toBe(true);
    expect(isJourneyArchetype("back_from_the_dead")).toBe(true);
  });

  it("returns true for almost_escaped", () => {
    expect(isJourneyArchetype("almost_escaped")).toBe(true);
  });

  it("returns false for generic verdict codes", () => {
    expect(isJourneyArchetype("stuck_in_the_middle")).toBe(false);
    expect(isJourneyArchetype("one_pump_chump")).toBe(false);
    expect(isJourneyArchetype("suspiciously_competent")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isJourneyArchetype(null)).toBe(false);
    expect(isJourneyArchetype(undefined)).toBe(false);
    expect(isJourneyArchetype("")).toBe(false);
  });
});

describe("getArchetypeTier — recovery tier mapping", () => {
  it("maps almost_escaped to 'recovery' tier", () => {
    expect(getArchetypeTier("almost_escaped")).toBe("recovery");
  });
});

describe("ALMOST_ESCAPED — definition", () => {
  it("has the correct archetype_id and name", () => {
    expect(ALMOST_ESCAPED.archetype_id).toBe("almost_escaped");
    expect(ALMOST_ESCAPED.archetype_name).toBe("Almost Escaped");
  });

  it("has the correct display_headline and charge", () => {
    expect(ALMOST_ESCAPED.display_headline).toBe("FUMBLED THE COMEBACK");
    expect(ALMOST_ESCAPED.charge).toBe("SELLING AT THE FINISH LINE");
  });

  it("has tier 'recovery' and hall_eligible true", () => {
    expect(ALMOST_ESCAPED.tier).toBe("recovery");
    expect(ALMOST_ESCAPED.hall_eligible).toBe(true);
  });
});

describe("COMEBACK_TIERS — tier definitions", () => {
  it("has exactly 3 tiers", () => {
    expect(COMEBACK_TIERS).toHaveLength(3);
  });

  it("tiers are ordered by increasing drawdown severity", () => {
    expect(COMEBACK_TIERS[0].min_drawdown).toBe(-0.50);
    expect(COMEBACK_TIERS[1].min_drawdown).toBe(-0.70);
    expect(COMEBACK_TIERS[2].min_drawdown).toBe(-0.90);
  });

  it("each tier has a unique archetype_id", () => {
    const ids = COMEBACK_TIERS.map((t) => t.archetype_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});