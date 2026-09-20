// Wallet Court — route and navigation state logic. Pure, testable, shared
// between the frontend components and unit tests. Extracted from
// CourtLayout.jsx (nav items), authReturnTo.js (returnTo sanitization), and
// Case.jsx (fetch result classification) so route-level behavior can be
// verified without a browser.

export interface NavItem {
  to: string;
  label: string;
  type: "link" | "button";
  end?: boolean;
  authRequired?: boolean;
}

// Return the navigation items for the header. When isLoadingAuth is true or
// auth has not been checked, show only the public links + DEMO badge — never
// My Court or Sign Out (prevents auth-loading flicker that incorrectly exposes
// signed-in controls). When authenticated, show My Court + Sign Out but never
// Sign In. When not authenticated, show Sign In but never My Court or Sign Out.
export function getNavItems(opts: { isAuthenticated: boolean; isLoadingAuth: boolean }): NavItem[] {
  const { isAuthenticated, isLoadingAuth } = opts;
  const items: NavItem[] = [
    { to: "/", label: "Courtroom", type: "link", end: true },
    { to: "/hall", label: "The Hall", type: "link" },
    { to: "/about", label: "About", type: "link" },
  ];

  // During auth loading, do NOT show auth-dependent items — prevents flicker.
  if (!isLoadingAuth && isAuthenticated) {
    items.push({ to: "/account", label: "My Court", type: "link", authRequired: true });
  }

  // DEMO badge is always shown (not auth-dependent).
  items.push({ to: "", label: "Demo", type: "badge" } as NavItem);

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
// URLs, protocol-relative URLs (//evil.com), backslash-based escapes, and
// strips bootstrap params that must not be re-injected. Returns "/" for
// anything that fails validation.
export function sanitizeReturnTo(raw: string, origin: string): string {
  if (!raw) return "/";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/";
    // Strip bootstrap params that must not be re-injected via returnTo.
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

// Classify a case fetch result into a UI status. Distinguishes a genuine 404
// (case not found) from a temporary error (network, 500, timeout) so the UI
// can show Retry for the latter and Not Found only for the former.
export function classifyCaseFetchResult(
  result: { error?: string; trial?: any } | null,
  httpStatus?: number
): "done" | "notfound" | "error" {
  if (!result) return "error";
  if (result.trial) return "done";
  if (!result.error) return "error";
  // A 404 or an explicit "not found" message is a genuine not-found.
  if (httpStatus === 404) return "notfound";
  const msg = String(result.error).toLowerCase();
  if (msg.includes("not found") || msg.includes("case file missing")) return "notfound";
  // Everything else (network error, 500, timeout, malformed response) is a
  // temporary error — the user should be able to retry, not be sent home.
  return "error";
}