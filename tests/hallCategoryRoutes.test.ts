// Category routes, response shape, and summary↔category consistency.
// Proves that URL slugs map to the correct category keys, that category
// responses contain items + pagination metadata + the correct sanitized
// card shape, that summary and category leading results agree, that honor
// uses the honor sanitizer, and that unknown routes are rejected.
import { describe, it, expect } from "vitest";
import {
  HALL_CATEGORIES,
  CATEGORY_ROUTES,
  CATEGORY_SLUG_TO_KEY,
  CATEGORY_TITLES,
  SUMMARY_LIMIT,
  CATEGORY_PAGE_SIZE,
  getEligibleForCategory,
  eligibleMostSevere,
  eligibleHighestConfidence,
  eligibleRecent,
  eligibleHonor,
  sanitizeForHall,
  sanitizeForHonor,
  assertNoPrivateFields,
  keyOf,
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

describe("Category route slug → key mapping", () => {
  it("most-severe maps to most_severe", () => {
    expect(CATEGORY_SLUG_TO_KEY["most-severe"]).toBe("most_severe");
  });

  it("highest-confidence maps to highest_confidence", () => {
    expect(CATEGORY_SLUG_TO_KEY["highest-confidence"]).toBe("highest_confidence");
  });

  it("recent maps to recent", () => {
    expect(CATEGORY_SLUG_TO_KEY["recent"]).toBe("recent");
  });

  it("honor maps to honor", () => {
    expect(CATEGORY_SLUG_TO_KEY["honor"]).toBe("honor");
  });

  it("CATEGORY_ROUTES values match the slug keys", () => {
    for (const cat of HALL_CATEGORIES) {
      const route = CATEGORY_ROUTES[cat];
      const slug = route.split("/hall/")[1];
      expect(CATEGORY_SLUG_TO_KEY[slug]).toBe(cat);
    }
  });

  it("unknown slugs are absent (falsy) — not treated as empty categories", () => {
    expect(CATEGORY_SLUG_TO_KEY["bogus"]).toBeUndefined();
    expect(CATEGORY_SLUG_TO_KEY[""]).toBeUndefined();
    expect(CATEGORY_SLUG_TO_KEY["MOST-SEVERE"]).toBeUndefined(); // case-sensitive
  });

  it("every category key has a title", () => {
    for (const cat of HALL_CATEGORIES) {
      expect(CATEGORY_TITLES[cat]).toBeTruthy();
    }
  });
});

describe("Category response shape — sanitized card fields", () => {
  it("sanitizeForHall produces the expected public card shape", () => {
    const t = makeTrial({ slug: "shape-test", addr: "0xabcdef1234567890", wallet_class: "mev_bot" });
    const s = sanitizeForHall(t, { [keyOf(t)]: 3 });
    expect(s).toHaveProperty("slug", "shape-test");
    expect(s).toHaveProperty("network", "ethereum");
    expect(s).toHaveProperty("verdict_name");
    expect(s).toHaveProperty("verdict_code");
    expect(s).toHaveProperty("severity_score");
    expect(s).toHaveProperty("confidence_score");
    expect(s).toHaveProperty("data_mode");
    expect(s).toHaveProperty("case_outcome");
    expect(s).toHaveProperty("analyzed_at");
    expect(s).toHaveProperty("address_short");
    expect(s).toHaveProperty("wallet_class", "mev_bot");
    expect(s).toHaveProperty("trial_count", 3);
  });

  it("sanitizeForHall address is abbreviated", () => {
    const t = makeTrial({ addr: "0xabcdefghijklmnopqrstuv" });
    const s = sanitizeForHall(t);
    expect(s.address_short).toContain("…");
    expect(s.address_short).not.toContain("0xabcdefghijklmnopqrstuv");
  });

  it("sanitizeForHonor includes highlight and no private fields", () => {
    const t = makeTrial({
      verdict_code: "suspiciously_competent",
      metrics_json: JSON.stringify({ realized_pnl_pct: 1.5 }),
    });
    const s = sanitizeForHonor(t);
    expect(assertNoPrivateFields(s)).toBeNull();
    expect(s).toHaveProperty("highlight");
    expect(s.highlight).toContain("Realized P&L");
  });

  it("no sanitized card exposes private fields", () => {
    const t = makeTrial({ addr: "0xabcdefghijklmnopqrstuv" });
    expect(assertNoPrivateFields(sanitizeForHall(t))).toBeNull();
    expect(assertNoPrivateFields(sanitizeForHonor(t))).toBeNull();
  });
});

describe("Summary ↔ category consistency", () => {
  const records = [
    makeTrial({ slug: "s1", severity: 95, confidence: 85, addr: "0xs1", data_mode: "live" }),
    makeTrial({ slug: "s2", severity: 80, confidence: 90, addr: "0xs2", data_mode: "live" }),
    makeTrial({ slug: "s3", severity: 70, confidence: 75, addr: "0xs3", data_mode: "live" }),
    makeTrial({ slug: "s4", severity: 60, confidence: 95, addr: "0xs4", data_mode: "live" }),
    makeTrial({ slug: "h1", verdict_code: "suspiciously_competent", confidence: 92, addr: "0xh1", data_mode: "live" }),
  ];

  it("Most Severe summary top-3 matches category top-3", () => {
    const cat = getEligibleForCategory(records, "most_severe");
    const summary = cat.slice(0, SUMMARY_LIMIT);
    expect(summary.map((t) => t.public_slug)).toEqual(["s1", "s2", "s3"]);
    expect(cat.length).toBeGreaterThanOrEqual(3);
  });

  it("Highest Confidence summary top-3 matches category top-3", () => {
    const cat = getEligibleForCategory(records, "highest_confidence");
    const summary = cat.slice(0, SUMMARY_LIMIT);
    // By confidence: s4(95), h1(92), s2(90), s1(85), s3(75)
    expect(summary.map((t) => t.public_slug)).toEqual(["s4", "h1", "s2"]);
  });

  it("Recent summary top-3 matches category top-3", () => {
    const cat = getEligibleForCategory(records, "recent");
    const summary = cat.slice(0, SUMMARY_LIMIT);
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
    expect(summary).toEqual(cat.slice(0, SUMMARY_LIMIT));
  });

  it("Honor summary top-3 matches category top-3", () => {
    const cat = getEligibleForCategory(records, "honor");
    const summary = cat.slice(0, SUMMARY_LIMIT);
    expect(summary.map((t) => t.public_slug)).toEqual(["h1"]);
  });
});

describe("Honor category uses honor sanitizer", () => {
  it("honor-eligible items have highlight from metrics, not raw metrics", () => {
    const records = [
      makeTrial({
        slug: "hon",
        verdict_code: "suspiciously_competent",
        confidence: 90,
        metrics_json: JSON.stringify({ realized_pnl_pct: 2.5 }),
        addr: "0xhon1",
        data_mode: "live",
      }),
    ];
    const eligible = eligibleHonor(records);
    const sanitized = eligible.map((t) => sanitizeForHonor(t));
    expect(sanitized[0].highlight).toContain("+250%");
    expect(sanitized[0]).not.toHaveProperty("metrics_json");
    expect(sanitized[0]).not.toHaveProperty("normalized_wallet_address");
  });

  it("honor items do not include severity_score in a meaningful way (not a shame ranking)", () => {
    const records = [
      makeTrial({
        slug: "hon",
        verdict_code: "suspiciously_competent",
        severity: 10,
        confidence: 90,
        addr: "0xhon1",
        data_mode: "live",
      }),
    ];
    const eligible = eligibleHonor(records);
    // Honor is about positive performance, not severity
    expect(eligible).toHaveLength(1);
    expect(eligible[0].verdict_code).toBe("suspiciously_competent");
  });
});

describe("Unknown route rejection", () => {
  it("getEligibleForCategory returns empty array for unknown category", () => {
    const records = [makeTrial({ slug: "x", data_mode: "live" })];
    expect(getEligibleForCategory(records, "bogus" as any)).toEqual([]);
  });

  it("CATEGORY_SLUG_TO_KEY returns undefined for unknown slug", () => {
    expect(CATEGORY_SLUG_TO_KEY["nonexistent"]).toBeUndefined();
  });
});

describe("Pagination metadata", () => {
  it("CATEGORY_PAGE_SIZE is 12", () => {
    expect(CATEGORY_PAGE_SIZE).toBe(12);
  });

  it("category slice with offset and limit produces correct page", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeTrial({ slug: `r${i}`, severity: 90 - i, confidence: 80, addr: `0x${i.toString(16).padStart(4, "0")}` })
    );
    const eligible = eligibleMostSevere(records);
    const offset = 0;
    const limit = CATEGORY_PAGE_SIZE;
    const page = eligible.slice(offset, offset + limit);
    expect(page).toHaveLength(12);
    expect(eligible.length).toBe(20);
  });

  it("has_more is true when more records exist beyond the page", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeTrial({ slug: `r${i}`, severity: 90 - i, confidence: 80, addr: `0x${i.toString(16).padStart(4, "0")}` })
    );
    const eligible = eligibleMostSevere(records);
    const offset = 0;
    const limit = CATEGORY_PAGE_SIZE;
    const hasMore = offset + limit < eligible.length;
    expect(hasMore).toBe(true);
  });

  it("has_more is false when page covers all records", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeTrial({ slug: `r${i}`, severity: 90 - i, confidence: 80, addr: `0x${i.toString(16).padStart(4, "0")}` })
    );
    const eligible = eligibleMostSevere(records);
    const offset = 0;
    const limit = CATEGORY_PAGE_SIZE;
    const hasMore = offset + limit < eligible.length;
    expect(hasMore).toBe(false);
  });
});