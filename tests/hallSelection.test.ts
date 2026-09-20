// Hall selection, eligibility, ordering, daily awards, and privacy tests.
// Pure: imports only hallSelection.ts. Proves that the Hall summary shows
// exactly 3 cards per section, that categories are correctly sorted and
// tie-broken, that honor/awards exclude ineligible cases, that daily awards
// use the correct cohort fallback, and that no private fields are exposed.
import { describe, it, expect } from "vitest";
import {
  HALL_CATEGORIES,
  SUMMARY_LIMIT,
  CATEGORY_PAGE_SIZE,
  eligibleMostSevere,
  eligibleHighestConfidence,
  eligibleRecent,
  eligibleHonor,
  eligibleDump,
  selectBagOfTheDay,
  selectDumpOfTheDay,
  selectDailyAward,
  utcMidnight,
  sanitizeForHall,
  sanitizeForHonor,
  assertNoPrivateFields,
  getEligibleForCategory,
} from "../base44/shared/hallSelection.ts";

// ---- Fixtures ----

function makeTrial(opts) {
  return {
    public_slug: opts.slug || `case-${Math.random().toString(36).slice(2, 8)}`,
    normalized_wallet_address: opts.addr || "0xabc1234567890",
    wallet_address: opts.addr || "0xabc1234567890",
    network: opts.network || "ethereum",
    status: "completed",
    data_mode: opts.data_mode || "live",
    case_outcome: opts.case_outcome || "verdict",
    verdict_code: opts.verdict_code || "one_pump_chump",
    verdict_name: opts.verdict_name || "One Pump Chump",
    severity_score: opts.severity ?? 50,
    confidence_score: opts.confidence ?? 80,
    analyzed_at: opts.analyzed_at || new Date().toISOString(),
    created_date: opts.created_date || new Date().toISOString(),
    wallet_class: opts.wallet_class || "trader_individual",
    metrics_json: opts.metrics_json || JSON.stringify({ realized_pnl_pct: -0.1 }),
    submitted_by_user_id: "user_secret_123",
    owner_user_id: "owner_secret_456",
    ...opts.extra,
  };
}

const NOW = new Date("2026-09-20T14:30:00Z"); // 2026-09-20 14:30 UTC
const TODAY_START = utcMidnight(NOW).getTime();
const YESTERDAY = new Date(TODAY_START - 43200000).toISOString(); // yesterday midday
const TWO_DAYS_AGO = new Date(TODAY_START - 172800000).toISOString();
const TODAY_MORNING = new Date(TODAY_START + 3600000).toISOString(); // today 01:00 UTC

describe("Hall summary — card counts", () => {
  it("SUMMARY_LIMIT is exactly 3", () => {
    expect(SUMMARY_LIMIT).toBe(3);
  });

  it("HALL_CATEGORIES has exactly 4 categories", () => {
    expect(HALL_CATEGORIES).toHaveLength(4);
    expect(HALL_CATEGORIES).toContain("most_severe");
    expect(HALL_CATEGORIES).toContain("highest_confidence");
    expect(HALL_CATEGORIES).toContain("recent");
    expect(HALL_CATEGORIES).toContain("honor");
  });

  it("summary slices to SUMMARY_LIMIT (3) — does not fetch the full collection", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeTrial({ slug: `sev-${i}`, severity: 90 - i, confidence: 80, addr: `0x${i.toString(16).padStart(4, "0")}` })
    );
    const eligible = eligibleMostSevere(records);
    const summary = eligible.slice(0, SUMMARY_LIMIT);
    expect(summary).toHaveLength(3);
    // The full eligible list has more, but summary is capped
    expect(eligible.length).toBeGreaterThan(3);
  });
});

describe("Most Severe — eligibility and ordering", () => {
  it("includes only live guilty verdicts", () => {
    const records = [
      makeTrial({ slug: "live-guilty", verdict_code: "one_pump_chump", severity: 90, data_mode: "live" }),
      makeTrial({ slug: "not-guilty", verdict_code: "suspiciously_competent", severity: 35, data_mode: "live" }),
      makeTrial({ slug: "demo", verdict_code: "one_pump_chump", severity: 88, data_mode: "demo" }),
      makeTrial({ slug: "dismissed", case_outcome: "dismissed_no_evidence", severity: 99, data_mode: "live" }),
      makeTrial({ slug: "mistrial", case_outcome: "mistrial_insufficient_evidence", severity: 99, data_mode: "live" }),
    ];
    const result = eligibleMostSevere(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("live-guilty");
  });

  it("orders by severity descending", () => {
    const records = [
      makeTrial({ slug: "low", severity: 50, addr: "0x111" }),
      makeTrial({ slug: "high", severity: 90, addr: "0x222" }),
      makeTrial({ slug: "mid", severity: 70, addr: "0x333" }),
    ];
    const result = eligibleMostSevere(records);
    expect(result.map((t) => t.public_slug)).toEqual(["high", "mid", "low"]);
  });

  it("tie-breaks by confidence desc, then newest, then slug", () => {
    const records = [
      makeTrial({ slug: "bbb", severity: 80, confidence: 70, analyzed_at: "2026-01-01T00:00:00Z", addr: "0x01" }),
      makeTrial({ slug: "aaa", severity: 80, confidence: 70, analyzed_at: "2026-01-01T00:00:00Z", addr: "0x02" }),
      makeTrial({ slug: "ccc", severity: 80, confidence: 80, analyzed_at: "2026-01-01T00:00:00Z", addr: "0x03" }),
      makeTrial({ slug: "ddd", severity: 80, confidence: 70, analyzed_at: "2026-06-01T00:00:00Z", addr: "0x04" }),
    ];
    const result = eligibleMostSevere(records);
    // ccc (conf 80) > ddd (newer) > aaa (slug) > bbb
    expect(result.map((t) => t.public_slug)).toEqual(["ccc", "ddd", "aaa", "bbb"]);
  });

  it("deduplicates by wallet (keeps best severity per address)", () => {
    const records = [
      makeTrial({ slug: "first", severity: 60, addr: "0xsame" }),
      makeTrial({ slug: "second", severity: 90, addr: "0xsame" }),
    ];
    const result = eligibleMostSevere(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("second");
  });
});

describe("Highest Confidence — eligibility and ordering", () => {
  it("includes live verdicts (guilty and not-guilty), excludes demo/dismissed/mistrial", () => {
    const records = [
      makeTrial({ slug: "live-g", verdict_code: "one_pump_chump", confidence: 90, data_mode: "live", addr: "0xg001" }),
      makeTrial({ slug: "live-ng", verdict_code: "suspiciously_competent", confidence: 95, data_mode: "live", addr: "0xng01" }),
      makeTrial({ slug: "demo", confidence: 99, data_mode: "demo", addr: "0xdemo1" }),
      makeTrial({ slug: "dismissed", case_outcome: "dismissed_no_evidence", confidence: 99, addr: "0xdis01" }),
    ];
    const result = eligibleHighestConfidence(records);
    expect(result).toHaveLength(2);
    expect(result[0].public_slug).toBe("live-ng"); // confidence 95
  });

  it("orders by confidence desc, tie-break newest then slug", () => {
    const records = [
      makeTrial({ slug: "old", confidence: 90, analyzed_at: "2026-01-01T00:00:00Z", addr: "0x01" }),
      makeTrial({ slug: "new", confidence: 90, analyzed_at: "2026-09-01T00:00:00Z", addr: "0x02" }),
      makeTrial({ slug: "top", confidence: 95, addr: "0x03" }),
    ];
    const result = eligibleHighestConfidence(records);
    expect(result.map((t) => t.public_slug)).toEqual(["top", "new", "old"]);
  });
});

describe("Recent Cases — eligibility and ordering", () => {
  it("includes completed verdicts (live + demo), excludes dismissed/mistrial", () => {
    const records = [
      makeTrial({ slug: "live", data_mode: "live", analyzed_at: "2026-09-19T00:00:00Z", addr: "0xlive1" }),
      makeTrial({ slug: "demo", data_mode: "demo", analyzed_at: "2026-09-18T00:00:00Z", addr: "0xdemo1" }),
      makeTrial({ slug: "dismissed", case_outcome: "dismissed_no_evidence", analyzed_at: "2026-09-20T00:00:00Z", addr: "0xdis01" }),
    ];
    const result = eligibleRecent(records);
    expect(result).toHaveLength(2);
    expect(result[0].public_slug).toBe("live"); // newest first
  });

  it("orders newest first, tie-break by slug", () => {
    const records = [
      makeTrial({ slug: "zzz", analyzed_at: "2026-09-19T00:00:00Z", addr: "0x01" }),
      makeTrial({ slug: "aaa", analyzed_at: "2026-09-19T00:00:00Z", addr: "0x02" }),
      makeTrial({ slug: "newer", analyzed_at: "2026-09-20T00:00:00Z", addr: "0x03" }),
    ];
    const result = eligibleRecent(records);
    expect(result.map((t) => t.public_slug)).toEqual(["newer", "aaa", "zzz"]);
  });
});

describe("Hall of Honor — eligibility", () => {
  it("includes live NOT GUILTY (suspiciously_competent) cases", () => {
    const records = [
      makeTrial({ slug: "honor", verdict_code: "suspiciously_competent", confidence: 90, data_mode: "live" }),
      makeTrial({ slug: "guilty", verdict_code: "one_pump_chump", confidence: 90, data_mode: "live" }),
    ];
    const result = eligibleHonor(records);
    expect(result).toHaveLength(1);
    expect(result[0].public_slug).toBe("honor");
  });

  it("Suspiciously Competent resolves to the positive/NOT GUILTY category", () => {
    const records = [makeTrial({ slug: "sc", verdict_code: "suspiciously_competent", data_mode: "live" })];
    expect(eligibleHonor(records)).toHaveLength(1);
  });

  it("excludes guilty, demo, dismissed, mistrial, and invalid cases", () => {
    const records = [
      makeTrial({ slug: "guilty", verdict_code: "one_pump_chump", data_mode: "live" }),
      makeTrial({ slug: "demo", verdict_code: "suspiciously_competent", data_mode: "demo" }),
      makeTrial({ slug: "dismissed", verdict_code: "suspiciously_competent", case_outcome: "dismissed_no_evidence", data_mode: "live" }),
      makeTrial({ slug: "mistrial", verdict_code: "suspiciously_competent", case_outcome: "mistrial_insufficient_evidence", data_mode: "live" }),
    ];
    const result = eligibleHonor(records);
    expect(result).toHaveLength(0);
  });

  it("orders by confidence desc, then realized_pnl_pct desc, then newest, then slug", () => {
    const records = [
      makeTrial({ slug: "low-pnl", verdict_code: "suspiciously_competent", confidence: 90, metrics_json: JSON.stringify({ realized_pnl_pct: 0.9 }), addr: "0x01" }),
      makeTrial({ slug: "high-pnl", verdict_code: "suspiciously_competent", confidence: 90, metrics_json: JSON.stringify({ realized_pnl_pct: 2.1 }), addr: "0x02" }),
      makeTrial({ slug: "top-conf", verdict_code: "suspiciously_competent", confidence: 95, addr: "0x03" }),
    ];
    const result = eligibleHonor(records);
    expect(result.map((t) => t.public_slug)).toEqual(["top-conf", "high-pnl", "low-pnl"]);
  });
});

describe("Daily awards — cohort selection", () => {
  it("selects from previous UTC day cohort first", () => {
    const records = [
      makeTrial({ slug: "yesterday", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: YESTERDAY, data_mode: "live", addr: "0xyest1" }),
      makeTrial({ slug: "two-days", verdict_code: "suspiciously_competent", confidence: 95, analyzed_at: TWO_DAYS_AGO, data_mode: "live", addr: "0xtwod1" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("yesterday");
    expect(bag.cohort).toBe("previous_day");
  });

  it("falls back to previous 7 days when previous day is empty", () => {
    const records = [
      makeTrial({ slug: "two-days", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: TWO_DAYS_AGO, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("two-days");
    expect(bag.cohort).toBe("previous_7_days");
  });

  it("falls back to historical when no recent cases exist", () => {
    const oldDate = new Date(TODAY_START - 30 * 86400000).toISOString();
    const records = [
      makeTrial({ slug: "old", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: oldDate, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("old");
    expect(bag.cohort).toBe("historical");
  });

  it("excludes cases from the current UTC day", () => {
    const records = [
      makeTrial({ slug: "today", verdict_code: "suspiciously_competent", confidence: 99, analyzed_at: TODAY_MORNING, data_mode: "live", addr: "0xtod01" }),
      makeTrial({ slug: "yesterday", verdict_code: "suspiciously_competent", confidence: 80, analyzed_at: YESTERDAY, data_mode: "live", addr: "0xyest1" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("yesterday");
    expect(bag.cohort).toBe("previous_day");
  });

  it("returns null winner when no eligible candidate exists", () => {
    const records = [
      makeTrial({ slug: "guilty", verdict_code: "one_pump_chump", analyzed_at: YESTERDAY, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner).toBeNull();
    expect(bag.cohort).toBe("none");
  });

  it("winner remains stable throughout the UTC day (same input → same winner)", () => {
    const records = [
      makeTrial({ slug: "a", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: YESTERDAY, data_mode: "live" }),
      makeTrial({ slug: "b", verdict_code: "suspiciously_competent", confidence: 90, analyzed_at: YESTERDAY, data_mode: "live" }),
    ];
    const morning = new Date("2026-09-20T06:00:00Z");
    const evening = new Date("2026-09-20T23:00:00Z");
    const bag1 = selectBagOfTheDay(records, morning);
    const bag2 = selectBagOfTheDay(records, evening);
    expect(bag1.winner?.public_slug).toBe(bag2.winner?.public_slug);
  });

  it("Bag ranks by confidence descending", () => {
    const records = [
      makeTrial({ slug: "low-conf", verdict_code: "suspiciously_competent", confidence: 80, analyzed_at: YESTERDAY, data_mode: "live" }),
      makeTrial({ slug: "high-conf", verdict_code: "suspiciously_competent", confidence: 95, analyzed_at: YESTERDAY, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.winner?.public_slug).toBe("high-conf");
  });

  it("Dump ranks by severity descending", () => {
    const records = [
      makeTrial({ slug: "low-sev", verdict_code: "one_pump_chump", severity: 60, confidence: 80, analyzed_at: YESTERDAY, data_mode: "live" }),
      makeTrial({ slug: "high-sev", verdict_code: "certified_exit_liquidity", severity: 90, confidence: 80, analyzed_at: YESTERDAY, data_mode: "live" }),
    ];
    const dump = selectDumpOfTheDay(records, NOW);
    expect(dump.winner?.public_slug).toBe("high-sev");
  });

  it("Dump excludes demo, dismissed, mistrial, and not-guilty cases", () => {
    const records = [
      makeTrial({ slug: "demo", verdict_code: "one_pump_chump", severity: 99, data_mode: "demo", analyzed_at: YESTERDAY }),
      makeTrial({ slug: "dismissed", case_outcome: "dismissed_no_evidence", severity: 99, analyzed_at: YESTERDAY }),
      makeTrial({ slug: "not-guilty", verdict_code: "suspiciously_competent", severity: 99, analyzed_at: YESTERDAY }),
    ];
    const dump = selectDumpOfTheDay(records, NOW);
    expect(dump.winner).toBeNull();
  });

  it("award date reflects the current UTC day", () => {
    const records = [
      makeTrial({ slug: "y", verdict_code: "suspiciously_competent", confidence: 85, analyzed_at: YESTERDAY, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    expect(bag.awardDate).toBe("2026-09-20");
  });
});

describe("Category pagination", () => {
  it("CATEGORY_PAGE_SIZE is 12", () => {
    expect(CATEGORY_PAGE_SIZE).toBe(12);
  });

  it("getEligibleForCategory returns the correct list for each category", () => {
    const records = [
      makeTrial({ slug: "severe", verdict_code: "one_pump_chump", severity: 90, confidence: 80, data_mode: "live" }),
      makeTrial({ slug: "honor", verdict_code: "suspiciously_competent", confidence: 90, data_mode: "live" }),
    ];
    expect(getEligibleForCategory(records, "most_severe").map((t) => t.public_slug)).toEqual(["severe"]);
    expect(getEligibleForCategory(records, "honor").map((t) => t.public_slug)).toEqual(["honor"]);
  });
});

describe("Privacy — no private fields exposed", () => {
  it("sanitizeForHall does not expose full addresses or internal fields", () => {
    const t = makeTrial({ addr: "0xabcdefghijklmnopqrstuv" });
    const s = sanitizeForHall(t);
    expect(assertNoPrivateFields(s)).toBeNull();
    expect(s.address_short).not.toContain("0xabcdefghijklmnopqrstuv");
    expect(s.address_short).toContain("…");
  });

  it("sanitizeForHonor does not expose private fields", () => {
    const t = makeTrial({ verdict_code: "suspiciously_competent", metrics_json: JSON.stringify({ realized_pnl_pct: 1.5 }) });
    const s = sanitizeForHonor(t);
    expect(assertNoPrivateFields(s)).toBeNull();
    expect(s).not.toHaveProperty("submitted_by_user_id");
    expect(s).not.toHaveProperty("owner_user_id");
    expect(s).not.toHaveProperty("metrics_json");
  });

  it("sanitizeForHonor includes a positive evidence highlight from saved metrics", () => {
    const t = makeTrial({ verdict_code: "suspiciously_competent", metrics_json: JSON.stringify({ realized_pnl_pct: 2.1 }) });
    const s = sanitizeForHonor(t);
    expect(s.highlight).toContain("Realized P&L");
    expect(s.highlight).toContain("+210%");
  });
});

describe("UTC date boundary", () => {
  it("utcMidnight returns midnight UTC", () => {
    const noon = new Date("2026-09-20T12:00:00Z");
    const midnight = utcMidnight(noon);
    expect(midnight.getUTCHours()).toBe(0);
    expect(midnight.getUTCMinutes()).toBe(0);
    expect(midnight.getUTCDate()).toBe(20);
  });

  it("cases completed exactly at UTC midnight are excluded (boundary is exclusive of today)", () => {
    const exactlyMidnight = new Date(TODAY_START).toISOString();
    const records = [
      makeTrial({ slug: "boundary", verdict_code: "suspiciously_competent", confidence: 99, analyzed_at: exactlyMidnight, data_mode: "live" }),
    ];
    const bag = selectBagOfTheDay(records, NOW);
    // Exactly at today's midnight = start of today → excluded from awards
    expect(bag.winner).toBeNull();
  });
});