// Wallet Court — public Hall data. Returns sanitized public fields per case
// (abbreviated address, network, verdict, scores, mode, date, slug, trial
// count). Supports two views:
//   - summary (default): max 3 cards per section + honor + daily awards
//   - category: paginated filtered view for dedicated routes
//
// Never returns full wallet addresses, roasts, evidence, metrics, or any
// internal/private record. Public app (no auth), so the service role reads.
// Zero Nansen calls — reads only saved WalletTrial records.
//
// REQUEST PARSING: The Base44 runtime delivers req as a Web API Request whose
// body is a ReadableStream. We must `await req.json()` to get the parsed JSON
// (NOT req.body, which is the unread stream). The parsed body is then
// validated by the shared parseHallRequest parser.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  HALL_CATEGORIES,
  SUMMARY_LIMIT,
  CATEGORY_TITLES,
  CATEGORY_ROUTES,
  getEligibleForCategory,
  selectBagOfTheDay,
  selectDumpOfTheDay,
  sanitizeForHall,
  sanitizeForHonor,
  keyOf,
} from "../../shared/hallSelection.ts";
import { parseHallRequest } from "../../shared/hallRequest.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // Parse the Web API Request body (ReadableStream → JSON object).
    let body: any = {};
    try {
      body = await req.json() || {};
    } catch {
      // allow empty body — defaults to summary
    }

    const parsed = parseHallRequest(body);
    if (parsed.error) {
      return Response.json(
        { error: parsed.error, view: parsed.view },
        { status: parsed.errorStatus || 400 }
      );
    }

    const { view, category, offset, limit } = parsed;

    // Fetch completed WalletTrial cases (capped at 500 for safety).
    const records = await base44.asServiceRole.entities.WalletTrial.filter(
      { status: "completed" },
      "-created_date",
      500
    );

    // Fetch completed SingleTradeTrial cases for the Recovery category
    // (journey archetypes are single-trade verdict codes).
    const tradeRecords = await base44.asServiceRole.entities.SingleTradeTrial.filter(
      { status: "completed" },
      "-created_date",
      500
    );

    // Trial count per wallet (without exposing the full address).
    const countMap: Record<string, number> = {};
    for (const t of records || []) {
      const k = keyOf(t);
      if (k) countMap[k] = (countMap[k] || 0) + 1;
    }

    if (view === "category") {
      // Recovery category uses SingleTradeTrial records; others use WalletTrial.
      const sourceRecords = category === "recovery" ? (tradeRecords || []) : (records || []);
      const eligible = getEligibleForCategory(sourceRecords, category);
      const page = eligible.slice(offset, offset + limit);
      return Response.json({
        view: "category",
        category,
        title: CATEGORY_TITLES[category],
        route: CATEGORY_ROUTES[category],
        items: page.map((t: any) =>
          category === "honor" ? sanitizeForHonor(t) : sanitizeForHall(t, countMap)
        ),
        total: eligible.length,
        offset,
        limit,
        has_more: offset + limit < eligible.length,
      });
    }

    // Summary view: max 3 per section + honor + daily awards
    const sections: Record<string, any[]> = {};
    for (const cat of HALL_CATEGORIES) {
      const sourceRecords = cat === "recovery" ? (tradeRecords || []) : (records || []);
      const eligible = getEligibleForCategory(sourceRecords, cat);
      sections[cat] = eligible.slice(0, SUMMARY_LIMIT).map((t: any) =>
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