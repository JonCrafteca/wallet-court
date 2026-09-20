// Demo exclusion from all public Hall rankings. Proves that demo/mock records
// are excluded server-side from Recent summary, Recent category, Most Severe,
// Highest Confidence, Hall of Honor, Bag of the Day, and Dump of the Day.
// Also confirms the dedicated Demo experience and existing demo data are
// preserved (demo cases still exist in the DB; they are just not ranked).
import { describe, it, expect } from "vitest";
import {
  eligibleMostSevere,
  eligibleHighestConfidence,
  eligibleRecent,
  eligibleHonor,
  eligibleDump,
  selectBagOfTheDay,
  selectDumpOfTheDay,
  sanitizeForHall,
  getEligibleForCategory,
  HALL_CATEGORIES,
} from "../base44/shared/hallSelection.ts";

function makeTrial(opts) {
  return {
    public_slug: opts.slug || `case-${Math.random().toString(36).slice(2, 8)}`,
    normalized_wallet_address: opts.addr || `0x${Math.random().toString(36).slice(2, 10)}`,
    wallet_address: opts.addr || `0x${Math.random().toString(36).slice(2, 10)}`,
    network: opts.network || "ethereum",
    status: "completed",
    data_mode: opts.data_mode || "live",
    case_outcome: opts.case_outcome || "verdict",
    verdict_code: opts.verdict_code || "one_pump_chump",
    verdict_name: opts.verdict_name || "One Pump Chump",
    severity_score: opts.severity ?? 50,
    confidence_score: opts.confidence ?? 80,
    analyzed_at: opts.analyzed_at || "2026-09-19T00:00:00Z",
    created_date: opts.created_date || "2026-09-19T00:00:00Z",
    wallet_class: opts.wallet_class || "trader_individual",
    metrics_json: opts.metrics_json || JSON.stringify({ realized_pnl_pct: -0.1 }),
    ...opts.extra,
  };
}

const YESTERDAY = "2026-09-19T12:00:00Z";
const NOW = new Date("2026-09-20T13:33:00Z");

describe("Demo exclusion — Recent", () => {
  it("eligibleRecent excludes demo records", () => {
    const records = [
      makeTrial({ slug: "live", data_mode: "live", addr: "0xlive1" }),
      makeTrial({ slug: "demo", data_mode: "demo", addr: "0xdemo1" }),
    ];
    const result = eligibleRecent(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("live");
  });

  it("eligibleRecent excludes demo even when demo is the only record", () => {
    const records = [makeTrial({ slug: "demo-only", data_mode: "demo", addr: "0xdemo1" })];
    const result = eligibleRecent(records);
    expect(result).toHaveLength(0);
  });

  it("Recent category via getEligibleForCategory also excludes demo", () => {
    const records = [
      makeTrial({ slug: "live", data_mode: "live", addr: "0xlive1" }),
      makeTrial({ slug: "demo", data_mode: "demo", addr: "0xdemo1" }),
    ];
    const result = getEligibleForCategory(records, "recent");
    expect(result).toHaveLength(1);
    expect(result[0].data_mode).toBe("live");
  });
});

describe("Demo exclusion — Most Severe", () => {
  it("eligibleMostSevere excludes demo records", () => {
    const records = [
      makeTrial({ slug: "live", severity: 80, data_mode: "live", addr: "0xlive1" }),
      makeTrial({ slug: "demo", severity: 99, data_mode: "demo", addr: "0xdemo1" }),
    ];
    const result = eligibleMostSevere(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("live");
  });

  it("demo with higher severity than live is still excluded", () => {
    const records = [
      makeTrial({ slug: "live", severity: 50, data_mode: "live", addr: "0xlive1" }),
      makeTrial({ slug: "demo", severity: 99, data_mode: "demo", addr: "0xdemo1" }),
    ];
    const result = eligibleMostSevere(records);
    expect(result).toHaveLength(1);
    expect(result[0].severity_score).toBe(50);
  });
});

describe("Demo exclusion — Highest Confidence", () => {
  it("eligibleHighestConfidence excludes demo records", () => {
    const records = [
      makeTrial({ slug: "live", confidence: 80, data_mode: "live", addr: "0xlive1" }),
      makeTrial({ slug: "demo", confidence: 99, data_mode: "demo", addr: "0xdemo1" }),
    ];
    const result = eligibleHighestConfidence(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("live");
  });
});

describe("Demo exclusion — Hall of Honor", () => {
  it("eligibleHonor excludes demo not-guilty records", () => {
    const records = [
      makeTrial({ slug: "live-honor", verdict_code: "suspiciously_competent", confidence: 90, data_mode: "live", addr: "0xhon1" }),
      makeTrial({ slug: "demo-honor", verdict_code: "suspiciously_competent", confidence: 99, data_mode: "demo", addr: "0xhon2" }),
    ];
    const result = eligibleHonor(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("live-honor");
  });
});

describe("Demo exclusion — Bag of the Day", () => {
  it("selectBagOfTheDay excludes demo records", () => {
    const records = [
      makeTrial({ slug: "live-bag", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: YESTERDAY, data_mode: "live", addr: "0xbag1" }),
      makeTrial({ slug: "demo-bag", verdict_code: "suspiciously_competent", confidence: 99, analyzed_at: YESTERDAY, data_mode: "demo", addr: "0xbag2" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("live-bag");
  });

  it("demo-only records produce no Bag winner", () => {
    const records = [
      makeTrial({ slug: "demo-bag", verdict_code: "suspiciously_competent", confidence: 99, analyzed_at: YESTERDAY, data_mode: "demo", addr: "0xbag2" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner).toBeNull();
  });
});

describe("Demo exclusion — Dump of the Day", () => {
  it("selectDumpOfTheDay excludes demo records", () => {
    const records = [
      makeTrial({ slug: "live-dump", verdict_code: "one_pump_chump", severity: 80, confidence: 80, analyzed_at: YESTERDAY, data_mode: "live", addr: "0xdmp1" }),
      makeTrial({ slug: "demo-dump", verdict_code: "one_pump_chump", severity: 99, confidence: 99, analyzed_at: YESTERDAY, data_mode: "demo", addr: "0xdmp2" }),
    ];
    const dump = selectDumpOfTheDay(records, NOW);
    expect(dump.winner?.public_slug).toBe("live-dump");
  });

  it("demo-only records produce no Dump winner", () => {
    const records = [
      makeTrial({ slug: "demo-dump", verdict_code: "one_pump_chump", severity: 99, analyzed_at: YESTERDAY, data_mode: "demo", addr: "0xdmp2" }),
    ];
    const dump = selectDumpOfTheDay(records, NOW);
    expect(dump.winner).toBeNull();
  });
});

describe("Demo exclusion — all categories via getEligibleForCategory", () => {
  it("no category returns demo records", () => {
    const records = [
      makeTrial({ slug: "demo", data_mode: "demo", verdict_code: "one_pump_chump", severity: 99, confidence: 99, addr: "0xdemo1" }),
    ];
    for (const cat of HALL_CATEGORIES) {
      const result = getEligibleForCategory(records, cat);
      expect(result).toHaveLength(0);
    }
  });

  it("mixed records produce only live results in every category", () => {
    const records = [
      makeTrial({ slug: "live-g", severity: 70, confidence: 80, data_mode: "live", addr: "0xl1" }),
      makeTrial({ slug: "demo-g", severity: 99, confidence: 99, data_mode: "demo", addr: "0xd1" }),
      makeTrial({ slug: "live-h", verdict_code: "suspiciously_competent", confidence: 85, data_mode: "live", addr: "0xl2" }),
    ];
    for (const cat of HALL_CATEGORIES) {
      const result = getEligibleForCategory(records, cat);
      for (const t of result) {
        expect(t.data_mode).toBe("live");
      }
    }
  });
});

describe("Demo data preservation", () => {
  it("demo records still exist in the input (not deleted by filtering)", () => {
    const records = [
      makeTrial({ slug: "live", data_mode: "live", addr: "0xl1" }),
      makeTrial({ slug: "demo", data_mode: "demo", addr: "0xd1" }),
    ];
    // eligibleRecent filters out demo, but the original array is unchanged.
    eligibleRecent(records);
    expect(records).toHaveLength(2);
    expect(records.find((t) => t.data_mode === "demo")).toBeDefined();
  });

  it("sanitizeForHall still works on demo records (for the dedicated Demo experience)", () => {
    const t = makeTrial({ slug: "demo-case", data_mode: "demo", addr: "0xdemo1" });
    const s = sanitizeForHall(t);
    expect(s.slug).toBe("demo-case");
    expect(s.data_mode).toBe("demo");
  });
});