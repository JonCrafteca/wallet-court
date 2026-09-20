// Wallet Court — Hall request parser. Single source of truth for parsing the
// Base44 runtime JSON body into a validated Hall request.
//
// The Base44 runtime delivers req as a Web API Request whose body is a
// ReadableStream — NOT a pre-parsed object. Callers must `await req.json()`
// first, then pass the result here. This module validates and normalizes the
// parsed body so the handler and tests share one contract.
//
// Canonical category arguments (sent by the browser SDK):
//   { view: "category", category: "most_severe", offset: 0, limit: 12 }
//
// Summary arguments: { view: "summary" } (or any body without view: "category").

import { HALL_CATEGORIES, CATEGORY_PAGE_SIZE } from "./hallSelection.ts";

const VALID_CATEGORIES = new Set<string>(HALL_CATEGORIES as readonly string[]);
export const MAX_LIMIT = 48;

export interface ParsedHallRequest {
  view: "summary" | "category";
  category: string | null;
  offset: number;
  limit: number;
  error?: string;
  errorStatus?: number;
}

function parseInteger(v: any, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function parseHallRequest(body: any): ParsedHallRequest {
  const rawView = typeof body?.view === "string" ? body.view : "summary";
  const view: "summary" | "category" = rawView === "category" ? "category" : "summary";

  const category = typeof body?.category === "string" ? body.category : null;
  const offset = Math.max(0, parseInteger(body?.offset, 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInteger(body?.limit, CATEGORY_PAGE_SIZE)));

  if (view === "category") {
    if (!category || !VALID_CATEGORIES.has(category)) {
      return { view, category, offset, limit, error: "Invalid category.", errorStatus: 400 };
    }
  }

  return { view, category, offset, limit };
}