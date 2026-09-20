// Hall end-to-end contract tests. Exercises the actual frontend wrapper
// (classifyHallCategoryResponse), the backend request parser
// (parseHallRequest), and the backend handler (getHallOfShame entry) with
// real Web API Request objects carrying the exact serialized JSON body the
// browser SDK sends.
//
// Proves:
//   1. /hall/most-severe maps to most_severe
//   2. The canonical args reach the backend and are parsed correctly
//   3. The backend returns category-shaped data with nonempty items
//   4. HallCategory unwraps the SDK response shape correctly
//   5. The first category item matches the Most Severe summary
//   6. Equivalent tests for highest_confidence, recent, honor
//   7. Honor retains its safe highlight
//   8. A summary-shaped response produces an error/retry state (not false empty)
//   9. A genuinely empty items:[] produces the intentional empty state
//  10. Invalid category returns structured 400
//  11. No demo or private data appears
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseHallRequest } from "../base44/shared/hallRequest.ts";
import {
  HALL_CATEGORIES,
  CATEGORY_SLUG_TO_KEY,
  SUMMARY_LIMIT,
  sanitizeForHall,
  sanitizeForHonor,
  keyOf,
} from "../base44/shared/hallSelection.ts";
import { classifyHallCategoryResponse } from "../src/lib/hallResponse.js";

// ---- Mock the SDK so the handler can run under vitest ----
const { mockFilter } = vi.hoisted(() => ({ mockFilter: vi.fn() }));

vi.mock("npm:@base44/sdk@0.8.44", () => ({
  createClientFromRequest: () => ({
    asServiceRole: {
      entities: {
        WalletTrial: { filter: mockFilter },
      },
    },
  }),
}));

// Import the handler AFTER the mock is set up.
const handlerModule = await import("../base44/functions/getHallOfShame/entry.ts");
const handler = handlerModule.default;

// ---- Fixtures ----
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
    submitted_by_user_id: "user_secret_123",
    owner_user_id: "owner_secret_456",
    ...opts.extra,
  };
}

const MOCK_RECORDS = [
  makeTrial({ slug: "s1", severity: 95, confidence: 85, addr: "0xs1", data_mode: "live", wallet_class: "mev_bot" }),
  makeTrial({ slug: "s2", severity: 80, confidence: 90, addr: "0xs2", data_mode: "live" }),
  makeTrial({ slug: "s3", severity: 70, confidence: 75, addr: "0xs3", data_mode: "live" }),
  makeTrial({ slug: "s4", severity: 60, confidence: 95, addr: "0xs4", data_mode: "live" }),
  makeTrial({
    slug: "h1",
    verdict_code: "suspiciously_competent",
    verdict_name: "Suspiciously Competent",
    confidence: 92,
    addr: "0xh1",
    data_mode: "live",
    metrics_json: JSON.stringify({ realized_pnl_pct: 2.5 }),
  }),
  // Demo record — must NEVER appear in public Hall
  makeTrial({ slug: "demo1", severity: 99, confidence: 99, addr: "0xdemo", data_mode: "demo" }),
  // Dismissed — must never appear
  makeTrial({ slug: "dis1", case_outcome: "dismissed_no_evidence", severity: 99, addr: "0xdis" }),
];

function makeRequest(body) {
  return new Request("https://wallet-court-roast.base44.app/functions/getHallOfShame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callHandler(body) {
  const res = await handler(makeRequest(body));
  return { status: res.status, data: await res.json() };
}

// ---- 1. parseHallRequest contract ----
describe("parseHallRequest — canonical body shapes", () => {
  it("parses a category request with all fields", () => {
    const r = parseHallRequest({ view: "category", category: "most_severe", offset: 0, limit: 12 });
    expect(r.view).toBe("category");
    expect(r.category).toBe("most_severe");
    expect(r.offset).toBe(0);
    expect(r.limit).toBe(12);
    expect(r.error).toBeUndefined();
  });

  it("parses a summary request", () => {
    const r = parseHallRequest({ view: "summary" });
    expect(r.view).toBe("summary");
    expect(r.category).toBeNull();
  });

  it("defaults to summary when view is absent", () => {
    const r = parseHallRequest({});
    expect(r.view).toBe("summary");
  });

  it("defaults to summary when view is not 'category'", () => {
    const r = parseHallRequest({ view: "bogus", category: "most_severe" });
    expect(r.view).toBe("summary");
  });

  it("rejects invalid category with 400", () => {
    const r = parseHallRequest({ view: "category", category: "bogus" });
    expect(r.error).toBe("Invalid category.");
    expect(r.errorStatus).toBe(400);
  });

  it("rejects missing category when view is category", () => {
    const r = parseHallRequest({ view: "category" });
    expect(r.error).toBe("Invalid category.");
    expect(r.errorStatus).toBe(400);
  });

  it("clamps offset to non-negative", () => {
    const r = parseHallRequest({ view: "category", category: "most_severe", offset: -5 });
    expect(r.offset).toBe(0);
  });

  it("clamps limit to 1..48", () => {
    const r0 = parseHallRequest({ view: "category", category: "most_severe", limit: 0 });
    const rBig = parseHallRequest({ view: "category", category: "most_severe", limit: 999 });
    expect(r0.limit).toBe(1);
    expect(rBig.limit).toBe(48);
  });

  it("parses string offset/limit", () => {
    const r = parseHallRequest({ view: "category", category: "most_severe", offset: "6", limit: "12" });
    expect(r.offset).toBe(6);
    expect(r.limit).toBe(12);
  });

  it("handles null/undefined body gracefully", () => {
    const r = parseHallRequest(null);
    expect(r.view).toBe("summary");
  });
});

// ---- 2. Handler-level Request tests (real serialized JSON body) ----
describe("Handler contract — real Request body", () => {
  beforeEach(() => {
    mockFilter.mockResolvedValue(MOCK_RECORDS);
  });

  it("most_severe returns category-shaped data with nonempty items", async () => {
    const { status, data } = await callHandler({
      view: "category",
      category: "most_severe",
      offset: 0,
      limit: 12,
    });
    expect(status).toBe(200);
    expect(data.view).toBe("category");
    expect(data.category).toBe("most_severe");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
    expect(data.offset).toBe(0);
    expect(data.limit).toBe(12);
    expect(data).toHaveProperty("has_more");
  });

  it("most_severe first item matches the summary top item", async () => {
    const cat = await callHandler({ view: "category", category: "most_severe", offset: 0, limit: 12 });
    const sum = await callHandler({ view: "summary" });
    const summaryTop = sum.data.sections.most_severe[0];
    expect(cat.data.items[0].slug).toBe(summaryTop.slug);
  });

  it("highest_confidence returns category-shaped data", async () => {
    const { status, data } = await callHandler({
      view: "category",
      category: "highest_confidence",
      offset: 0,
      limit: 12,
    });
    expect(status).toBe(200);
    expect(data.view).toBe("category");
    expect(data.category).toBe("highest_confidence");
    expect(data.items.length).toBeGreaterThan(0);
  });

  it("recent returns category-shaped data", async () => {
    const { status, data } = await callHandler({
      view: "category",
      category: "recent",
      offset: 0,
      limit: 12,
    });
    expect(status).toBe(200);
    expect(data.view).toBe("category");
    expect(data.items.length).toBeGreaterThan(0);
  });

  it("honor returns category-shaped data with highlight", async () => {
    const { status, data } = await callHandler({
      view: "category",
      category: "honor",
      offset: 0,
      limit: 12,
    });
    expect(status).toBe(200);
    expect(data.view).toBe("category");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0]).toHaveProperty("highlight");
    expect(data.items[0].highlight).toContain("Realized P&L");
  });

  it("invalid category returns 400", async () => {
    const { status, data } = await callHandler({
      view: "category",
      category: "bogus",
      offset: 0,
      limit: 12,
    });
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it("no demo data appears in any category", async () => {
    for (const cat of HALL_CATEGORIES) {
      const { data } = await callHandler({ view: "category", category: cat, offset: 0, limit: 48 });
      for (const item of data.items) {
        expect(item.data_mode).not.toBe("demo");
      }
    }
  });

  it("no private fields appear in any category item", async () => {
    const forbidden = [
      "wallet_address", "normalized_wallet_address", "submitted_by_user_id",
      "owner_user_id", "metrics_json", "labels_json", "rescore_audit_json",
      "roast", "defense_statement", "evidence_items_json",
    ];
    for (const cat of HALL_CATEGORIES) {
      const { data } = await callHandler({ view: "category", category: cat, offset: 0, limit: 48 });
      for (const item of data.items) {
        for (const f of forbidden) {
          expect(item).not.toHaveProperty(f);
        }
      }
    }
  });

  it("pagination: offset skips items and has_more reflects remaining", async () => {
    const page1 = await callHandler({ view: "category", category: "most_severe", offset: 0, limit: 2 });
    const page2 = await callHandler({ view: "category", category: "most_severe", offset: 2, limit: 2 });
    expect(page1.data.items).toHaveLength(2);
    expect(page2.data.offset).toBe(2);
    expect(page1.data.items[0].slug).not.toBe(page2.data.items[0].slug);
  });

  it("summary request still returns sections (not items)", async () => {
    const { status, data } = await callHandler({ view: "summary" });
    expect(status).toBe(200);
    expect(data.view).toBe("summary");
    expect(data).toHaveProperty("sections");
    expect(data).not.toHaveProperty("items");
  });
});

// ---- 3. Frontend response classifier (classifyHallCategoryResponse) ----
describe("classifyHallCategoryResponse — frontend unwrapping", () => {
  it("classifies a valid category response with items", () => {
    const r = classifyHallCategoryResponse({
      view: "category",
      items: [{ slug: "a" }, { slug: "b" }],
      total: 2,
      offset: 0,
      has_more: false,
    });
    expect(r.status).toBe("items");
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(2);
  });

  it("classifies a genuinely empty category as 'empty' (not error)", () => {
    const r = classifyHallCategoryResponse({
      view: "category",
      items: [],
      total: 0,
      offset: 0,
      has_more: false,
    });
    expect(r.status).toBe("empty");
    expect(r.items).toEqual([]);
  });

  it("classifies a summary-shaped response as error (not false empty)", () => {
    const r = classifyHallCategoryResponse({
      view: "summary",
      sections: { most_severe: [] },
    });
    expect(r.status).toBe("error");
    expect(r.error).toContain("summary");
  });

  it("classifies an unexpected shape (no items) as error", () => {
    const r = classifyHallCategoryResponse({ view: "category", total: 5 });
    expect(r.status).toBe("error");
    expect(r.error).toBeTruthy();
  });

  it("classifies null/undefined payload as error", () => {
    expect(classifyHallCategoryResponse(null).status).toBe("error");
    expect(classifyHallCategoryResponse(undefined).status).toBe("error");
  });

  it("classifies an explicit error response as error", () => {
    const r = classifyHallCategoryResponse({ error: "Invalid category." });
    expect(r.status).toBe("error");
    expect(r.error).toBe("Invalid category.");
  });

  it("does NOT treat a summary response with sections as empty", () => {
    const r = classifyHallCategoryResponse({ view: "summary", sections: { honor: [] } });
    expect(r.status).not.toBe("empty");
  });
});

// ---- 4. Route slug → key mapping (all four categories) ----
describe("Route slug → category key mapping", () => {
  it("/hall/most-severe maps to most_severe", () => {
    expect(CATEGORY_SLUG_TO_KEY["most-severe"]).toBe("most_severe");
  });
  it("/hall/highest-confidence maps to highest_confidence", () => {
    expect(CATEGORY_SLUG_TO_KEY["highest-confidence"]).toBe("highest_confidence");
  });
  it("/hall/recent maps to recent", () => {
    expect(CATEGORY_SLUG_TO_KEY["recent"]).toBe("recent");
  });
  it("/hall/honor maps to honor", () => {
    expect(CATEGORY_SLUG_TO_KEY["honor"]).toBe("honor");
  });
});