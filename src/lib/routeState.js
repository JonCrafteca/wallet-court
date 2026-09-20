// Client-side mirror of base44/shared/routeState.ts. Provides pure,
// testable navigation and route-state logic for frontend components.
// The backend/shared TS version is the source of truth; this JS mirror
// must stay in sync.

// Return the navigation items for the header. When isLoadingAuth is true
// or auth has not been checked, show only the public links + DEMO badge —
// never My Court, Sign Out, or Sign In (prevents auth-loading flicker).
// When authenticated: Courtroom · The Hall · About · My Court · Demo · Sign Out
// When not authenticated: Courtroom · The Hall · About · Demo · Sign In
export function getNavItems({ isAuthenticated, isLoadingAuth }) {
  const items = [
    { to: "/", label: "Courtroom", type: "link", end: true },
    { to: "/hall", label: "The Hall", type: "link" },
    { to: "/about", label: "About", type: "link" },
  ];

  if (!isLoadingAuth && isAuthenticated) {
    items.push({ to: "/account", label: "My Court", type: "link", authRequired: true });
  }

  items.push({ to: "", label: "Demo", type: "badge" });

  if (!isLoadingAuth) {
    if (isAuthenticated) {
      items.push({ to: "", label: "Sign Out", type: "button", authRequired: true });
    } else {
      items.push({ to: "/login", label: "Sign In", type: "link" });
    }
  }

  return items;
}

// Sanitize a returnTo parameter to a safe same-origin path. Rejects external
// URLs, protocol-relative URLs, backslash escapes, and strips bootstrap
// params. Returns "/" for anything that fails validation.
export function sanitizeReturnTo(raw, origin) {
  if (!raw) return "/";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/";
    for (const p of ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"]) {
      url.searchParams.delete(p);
    }
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

// Classify a case fetch result: "done" (trial present), "notfound" (genuine
// 404 or "not found" message), or "error" (temporary failure — network,
// 500, timeout — user should be able to retry, not be sent home).
export function classifyCaseFetchResult(result, httpStatus) {
  if (!result) return "error";
  if (result.trial) return "done";
  if (!result.error) return "error";
  if (httpStatus === 404) return "notfound";
  const msg = String(result.error).toLowerCase();
  if (msg.includes("not found") || msg.includes("case file missing")) return "notfound";
  return "error";
}