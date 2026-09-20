// Wallet Court — Hall category response classifier. Pure function that
// inspects a getHallOfShame SDK response payload and returns a classified
// result for HallCategory. Used by HallCategory.jsx and tested directly.
//
// Distinguishes:
//   1. Valid category response with items       → { status: "items", ... }
//   2. Valid category response with zero items    → { status: "empty", ... }
//   3. Summary-shaped response (stale contract)   → { status: "error", ... }
//   4. Unexpected shape                           → { status: "error", ... }
//   5. Explicit error                              → { status: "error", ... }
//
// Never returns "empty" for a missing items array — that is a contract
// failure, not a legitimate empty category.

export function classifyHallCategoryResponse(payload) {
  // 5. Explicit error response
  if (payload?.error) {
    return { status: "error", error: payload.error };
  }

  // 3. Summary-shaped response accidentally returned to a category request
  if (payload && payload.view === "summary" && payload.sections && !Array.isArray(payload.items)) {
    return {
      status: "error",
      error: "The court returned a summary docket for a category request. Please retry.",
    };
  }

  // 4. Unexpected response shape (no items array)
  if (!payload || !Array.isArray(payload.items)) {
    return {
      status: "error",
      error: "Unexpected response from the court. Please retry.",
    };
  }

  // 1 & 2. Valid category response — items may be empty (intentional empty state)
  return {
    status: payload.items.length === 0 ? "empty" : "items",
    items: payload.items,
    total: payload.total || 0,
    offset: payload.offset || 0,
    has_more: !!payload.has_more,
  };
}