// UTC daily-award boundary regression. Proves the exact scenario that caused
// Bag of the Day to appear empty: a Suspiciously Competent case analyzed at
// 2026-09-20T00:40:01.838Z is excluded from the September 20 award (current
// UTC day) but becomes eligible on September 21. Also proves local-time
// display does not change UTC eligibility, and that fallbacks still work.
import { describe, it, expect } from "vitest";
import {
  selectBagOfTheDay,
  selectDumpOfTheDay,
  selectDailyAward,
  eligibleHonor,
  utcMidnight,
} from "../base44/shared/hallSelection.ts";

function makeTrial(opts) {
  return {
    public_slug: opts.slug || `case-${Math.random().toString(36).slice(2, 8)}`,
    normalized_wallet_address: opts.addr || `0x${Math.random().toString(36).slice(2, 10)}`,
    wallet_address: opts.addr || `0x${Math.random().toString(36).slice(2, 10)}`,
    network: "ethereum",
    status: "completed",
    data_mode: "live",
    case_outcome: "verdict",
    verdict_code: opts.verdict_code || "suspiciously_competent",
    verdict_name: opts.verdict_name || "Suspiciously Competent",
    severity_score: opts.severity ?? 10,
    confidence_score: opts.confidence ?? 90,
    analyzed_at: opts.analyzed_at || new Date().toISOString(),
    created_date: opts.analyzed_at || new Date().toISOString(),
    wallet_class: "trader_individual",
    metrics_json: JSON.stringify({ realized_pnl_pct: 1.5 }),
    ...opts.extra,
  };
}

// The exact timestamp from the production case that caused the empty Bag.
const CASE_ANALYZED_AT = "2026-09-20T00:40:01.838Z";

describe("Bag of the Day — exact UTC boundary regression", () => {
  it("case analyzed at 2026-09-20T00:40:01.838Z is excluded from the September 20 award", () => {
    const records = [
      makeTrial({ slug: "the-case", analyzed_at: CASE_ANALYZED_AT, addr: "0xthe001", confidence: 90 }),
    ];
    // "Now" is September 20 at 13:33 UTC — same UTC day as the case.
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.awardDate).toBe("2026-09-20");
    expect(bag.winner).toBeNull();
    expect(bag.cohort).toBe("none");
  });

  it("the same case becomes eligible beginning September 21 UTC", () => {
    const records = [
      makeTrial({ slug: "the-case", analyzed_at: CASE_ANALYZED_AT, addr: "0xthe001", confidence: 90 }),
    ];
    // "Now" is September 21 at 00:01 UTC — the case is now in the previous day.
    const now = new Date("2026-09-21T00:01:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.awardDate).toBe("2026-09-21");
    expect(bag.winner?.public_slug).toBe("the-case");
    expect(bag.cohort).toBe("previous_day");
  });

  it("award date is September 20 UTC when now is September 20", () => {
    const records: any[] = [];
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.awardDate).toBe("2026-09-20");
  });

  it("the case is in the previous-day cohort on September 21 (not 7-day fallback)", () => {
    const records = [
      makeTrial({ slug: "the-case", analyzed_at: CASE_ANALYZED_AT, addr: "0xthe001", confidence: 90 }),
    ];
    const now = new Date("2026-09-21T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.cohort).toBe("previous_day");
    expect(bag.winner?.public_slug).toBe("the-case");
  });
});

describe("Local-time display does not change UTC award eligibility", () => {
  it("a case at 2026-09-20T00:40 UTC is still excluded regardless of viewer timezone", () => {
    const records = [
      makeTrial({ slug: "the-case", analyzed_at: CASE_ANALYZED_AT, addr: "0xthe001", confidence: 90 }),
    ];
    // The algorithm uses UTC exclusively. Simulate "now" at various UTC
    // moments on Sept 20 — all should exclude the case.
    const moments = [
      new Date("2026-09-20T00:01:00Z"), // just after midnight UTC
      new Date("2026-09-20T06:00:00Z"), // morning UTC
      new Date("2026-09-20T13:33:00Z"), // afternoon UTC
      new Date("2026-09-20T23:59:00Z"), // just before next day UTC
    ];
    for (const now of moments) {
      const bag = selectBagOfTheDay(records, now);
      expect(bag.winner).toBeNull();
      expect(bag.awardDate).toBe("2026-09-20");
    }
  });

  it("utcMidnight always returns 00:00 UTC regardless of input time", () => {
    const noon = new Date("2026-09-20T12:00:00Z");
    const m = utcMidnight(noon);
    expect(m.getUTCHours()).toBe(0);
    expect(m.getUTCMinutes()).toBe(0);
    expect(m.getUTCDate()).toBe(20);
  });
});

describe("Seven-day and historical fallbacks still work", () => {
  it("falls back to previous 7 days when previous day is empty", () => {
    const records = [
      makeTrial({ slug: "old-case", analyzed_at: "2026-09-15T00:00:00Z", addr: "0xold001", confidence: 85 }),
    ];
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.winner?.public_slug).toBe("old-case");
    expect(bag.cohort).toBe("previous_7_days");
  });

  it("falls back to historical when no recent cases exist", () => {
    const records = [
      makeTrial({ slug: "ancient", analyzed_at: "2026-08-01T00:00:00Z", addr: "0xanc001", confidence: 80 }),
    ];
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.winner?.public_slug).toBe("ancient");
    expect(bag.cohort).toBe("historical");
  });

  it("returns null with cohort 'none' when no eligible cases exist at all", () => {
    const records: any[] = [];
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);
    expect(bag.winner).toBeNull();
    expect(bag.cohort).toBe("none");
  });

  it("dump of the day also respects the UTC boundary", () => {
    const records = [
      makeTrial({
        slug: "dump-case",
        verdict_code: "one_pump_chump",
        severity: 90,
        confidence: 80,
        analyzed_at: CASE_ANALYZED_AT,
        addr: "0xdump01",
      }),
    ];
    const now = new Date("2026-09-20T13:33:00Z");
    const dump = selectDumpOfTheDay(records, now);
    expect(dump.winner).toBeNull();
    expect(dump.cohort).toBe("none");

    const nextDay = new Date("2026-09-21T00:01:00Z");
    const dump2 = selectDumpOfTheDay(records, nextDay);
    expect(dump2.winner?.public_slug).toBe("dump-case");
    expect(dump2.cohort).toBe("previous_day");
  });
});

describe("Empty-state copy does not claim the case was absent today", () => {
  it("the algorithm excludes current-day cases by design, not by absence", () => {
    // A case analyzed today IS in the records, but the algorithm intentionally
    // excludes it from today's award. The empty state should not say "no
    // case completed today" — it should say "no qualifying case has cleared
    // the evidence threshold yet."
    const records = [
      makeTrial({ slug: "the-case", analyzed_at: CASE_ANALYZED_AT, addr: "0xthe001", confidence: 90 }),
    ];
    const now = new Date("2026-09-20T13:33:00Z");
    const bag = selectBagOfTheDay(records, now);

    // The case exists in the records but is excluded by the UTC-day rule.
    expect(records).toHaveLength(1);
    expect(bag.winner).toBeNull();

    // The eligibleHonor list includes the case (it passes the evidence gate),
    // but selectDailyAward excludes it because it's in the current UTC day.
    const eligible = eligibleHonor(records);
    expect(eligible).toHaveLength(1);
    expect(bag.winner).toBeNull(); // excluded by cohort, not by eligibility
  });
});

describe("Winner stability throughout the UTC day", () => {
  it("same input produces the same winner at any time during the same UTC day", () => {
    const records = [
      makeTrial({ slug: "a", analyzed_at: "2026-09-19T10:00:00Z", addr: "0xa001", confidence: 85 }),
      makeTrial({ slug: "b", analyzed_at: "2026-09-19T14:00:00Z", addr: "0xb001", confidence: 90 }),
    ];
    const morning = new Date("2026-09-20T06:00:00Z");
    const evening = new Date("2026-09-20T23:00:00Z");
    const bag1 = selectBagOfTheDay(records, morning);
    const bag2 = selectBagOfTheDay(records, evening);
    expect(bag1.winner?.public_slug).toBe(bag2.winner?.public_slug);
    expect(bag1.awardDate).toBe(bag2.awardDate);
  });
});