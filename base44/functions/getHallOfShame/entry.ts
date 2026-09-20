// Wallet Court — public Hall data. Returns sanitized public fields per case
// (abbreviated address, network, verdict, scores, mode, date, slug, trial
// count). Supports two views:
//   - summary (default): max 3 cards per section + honor + daily awards
//   - category: paginated filtered view for dedicated routes
//
// Never returns full wallet addresses, roasts, evidence, metrics, or any
// internal/private record. Public app (no auth), so the service role reads.
// Zero Nansen calls — reads only saved WalletTrial records.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  HALL_CATEGORIES,
  SUMMARY_LIMIT,
  CATEGORY_PAGE_SIZE,
  CATEGORY_TITLES,
  CATEGORY_ROUTES,
  getEligibleForCategory,
  selectBagOfTheDay,
  selectDumpOfTheDay,
  sanitizeForHall,
  sanitizeForHonor,
  keyOf,
} from "../../shared/hallSelection.ts";

const VALID_CATEGORIES = new Set(HALL_CATEGORIES);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = req.body || {};
    const view = body.view || "summary"; // "summary" | "category"
    const category = body.category || null;
    const offset = Math.max(0, parseInt(body.offset) || 0);
    const limit = Math.min(48, Math.max(1, parseInt(body.limit) || CATEGORY_PAGE_SIZE));

    // Fetch completed cases (capped at 500 for safety; never the full collection).
    const records = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" },
      "-created_date",
      500
    );

    // Trial count per wallet (without exposing the full address).
    const countMap = {};
    for (const t of records || []) {
      const k = keyOf(t);
      if (k) countMap[k] = (countMap[k] || 0) + 1;
    }

    if (view === "category") {
      if (!VALID_CATEGORIES.has(category)) {
        return Response.json({ error: "Invalid category." }, { status: 400 });
      }
      const eligible = getEligibleForCategory(records || [], category);
      const page = eligible.slice(offset, offset + limit);
      return Response.json({
        view: "category",
        category,
        title: CATEGORY_TITLES[category],
        route: CATEGORY_ROUTES[category],
        items: page.map((t) =>
          category === "honor" ? sanitizeForHonor(t) : sanitizeForHall(t, countMap)
        ),
        total: eligible.length,
        offset,
        limit,
        has_more: offset + limit < eligible.length,
      });
    }

    // Summary view: max 3 per section + honor + daily awards
    const sections = {};
    for (const cat of HALL_CATEGORIES) {
      const eligible = getEligibleForCategory(records || [], cat);
      sections[cat] = eligible.slice(0, SUMMARY_LIMIT).map((t) =>
        cat === "honor" ? sanitizeForHonor(t) : sanitizeForHall(t, countMap)
      );
    }

    // Daily awards (deterministic, frozen at UTC day start).
    const bag = selectBagOfTheDay(records || []);
    const dump = selectDumpOfTheDay(records || []);

    return Response.json({
      view: "summary",
      sections,
      daily_awards: {
        bag: bag.winner ? { ...sanitizeForHonor(bag.winner), cohort: bag.cohort, award_date: bag.awardDate } : null,
        dump: dump.winner ? { ...sanitizeForHall(dump.winner, countMap), cohort: dump.cohort, award_date: dump.awardDate } : null,
      },
      category_routes: CATEGORY_ROUTES,
    });
  } catch (error) {
    return Response.json({ error: error.message || "The docket could not be loaded." }, { status: 500 });
  }
}