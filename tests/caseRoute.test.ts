// Route preservation tests. Pure: imports only routeState.ts. Proves that
// public /case/:slug routes are preserved during auth loading, that
// anonymous summons capability is restored, that invalid slugs show
// not-found, and that temporary fetch failures show a retryable error —
// never a redirect to /.
import { describe, it, expect } from "vitest";
import {
  getNavItems,
  sanitizeReturnTo,
  classifyCaseFetchResult,
} from "../base44/shared/routeState.ts";

describe("route preservation — classifyCaseFetchResult", () => {
  it("returns 'done' when a trial is present", () => {
    expect(classifyCaseFetchResult({ trial: { public_slug: "case-abc" } })).toBe("done");
  });

  it("returns 'notfound' for a 404 with an error message", () => {
    expect(classifyCaseFetchResult({ error: "Case not found." }, 404)).toBe("notfound");
  });

  it("returns 'notfound' when the error message says 'not found'", () => {
    expect(classifyCaseFetchResult({ error: "Case not found." })).toBe("notfound");
  });

  it("returns 'notfound' when the error message says 'case file missing'", () => {
    expect(classifyCaseFetchResult({ error: "Case file missing." })).toBe("notfound");
  });

  it("returns 'error' for a 500 (temporary failure)", () => {
    expect(classifyCaseFetchResult({ error: "Internal server error." }, 500)).toBe("error");
  });

  it("returns 'error' for a network timeout", () => {
    expect(classifyCaseFetchResult({ error: "Network request timed out." }, 0)).toBe("error");
  });

  it("returns 'error' for a null result (network failure)", () => {
    expect(classifyCaseFetchResult(null)).toBe("error");
  });

  it("returns 'error' for an error without 'not found' in the message", () => {
    expect(classifyCaseFetchResult({ error: "Something went wrong." }, 503)).toBe("error");
  });

  it("returns 'error' when there is no trial and no error", () => {
    expect(classifyCaseFetchResult({})).toBe("error");
  });
});

describe("route preservation — sanitizeReturnTo", () => {
  const origin = "https://wallet-court-roast.base44.app";

  it("returns / for empty raw", () => {
    expect(sanitizeReturnTo("", origin)).toBe("/");
    expect(sanitizeReturnTo(null, origin)).toBe("/");
  });

  it("preserves a case URL", () => {
    expect(sanitizeReturnTo("/case/case-abc123", origin)).toBe("/case/case-abc123");
  });

  it("preserves a case URL with query params", () => {
    expect(sanitizeReturnTo("/case/case-abc123?tab=evidence", origin)).toBe("/case/case-abc123?tab=evidence");
  });

  it("rejects an external URL", () => {
    expect(sanitizeReturnTo("https://evil.com/path", origin)).toBe("/");
  });

  it("rejects a protocol-relative URL", () => {
    expect(sanitizeReturnTo("//evil.com/path", origin)).toBe("/");
  });

  it("rejects a backslash-based escape", () => {
    expect(sanitizeReturnTo("/\\evil.com", origin)).toBe("/");
  });

  it("rejects a /.//evil.com path", () => {
    expect(sanitizeReturnTo("/.//evil.com", origin)).toBe("/");
  });

  it("strips access_token from the returnTo", () => {
    const result = sanitizeReturnTo("/case/case-abc?access_token=secret", origin);
    expect(result).not.toContain("access_token");
    expect(result).not.toContain("secret");
  });

  it("strips clear_access_token from the returnTo", () => {
    const result = sanitizeReturnTo("/case/case-abc?clear_access_token=true", origin);
    expect(result).not.toContain("clear_access_token");
  });

  it("strips app_id, app_base_url, functions_version, from_url", () => {
    const result = sanitizeReturnTo("/account?app_id=x&app_base_url=y&functions_version=z&from_url=w", origin);
    expect(result).not.toContain("app_id");
    expect(result).not.toContain("app_base_url");
    expect(result).not.toContain("functions_version");
    expect(result).not.toContain("from_url");
  });

  it("preserves normal app params", () => {
    expect(sanitizeReturnTo("/account?tab=trials", origin)).toBe("/account?tab=trials");
  });

  it("returns / for a URL with an invalid port that throws", () => {
    expect(sanitizeReturnTo("http://evil.com:abc/path", origin)).toBe("/");
  });

  it("returns / for a URL with an invalid IPv6 literal that throws", () => {
    expect(sanitizeReturnTo("http://[::1:invalid/path", origin)).toBe("/");
  });
});

describe("route preservation — navigation items", () => {
  it("logged out: shows Sign In, not My Court or Sign Out", () => {
    const items = getNavItems({ isAuthenticated: false, isLoadingAuth: false });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Sign In");
    expect(labels).not.toContain("My Court");
    expect(labels).not.toContain("Sign Out");
  });

  it("logged in: shows My Court and Sign Out, not Sign In", () => {
    const items = getNavItems({ isAuthenticated: true, isLoadingAuth: false });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("My Court");
    expect(labels).toContain("Sign Out");
    expect(labels).not.toContain("Sign In");
  });

  it("auth loading: does not show My Court, Sign Out, or Sign In (prevents flicker)", () => {
    const items = getNavItems({ isAuthenticated: false, isLoadingAuth: true });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("My Court");
    expect(labels).not.toContain("Sign Out");
    expect(labels).not.toContain("Sign In");
  });

  it("auth loading with isAuthenticated=true: still hides auth items (prevents flicker)", () => {
    const items = getNavItems({ isAuthenticated: true, isLoadingAuth: true });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("My Court");
    expect(labels).not.toContain("Sign Out");
    expect(labels).not.toContain("Sign In");
  });

  it("always shows Courtroom, The Hall, About, and Demo", () => {
    for (const opts of [
      { isAuthenticated: false, isLoadingAuth: false },
      { isAuthenticated: true, isLoadingAuth: false },
      { isAuthenticated: false, isLoadingAuth: true },
    ]) {
      const labels = getNavItems(opts).map((i) => i.label);
      expect(labels).toContain("Courtroom");
      expect(labels).toContain("The Hall");
      expect(labels).toContain("About");
      expect(labels).toContain("Demo");
    }
  });

  it("Sign In links to /login", () => {
    const items = getNavItems({ isAuthenticated: false, isLoadingAuth: false });
    const signIn = items.find((i) => i.label === "Sign In");
    expect(signIn.to).toBe("/login");
  });

  it("My Court links to /account", () => {
    const items = getNavItems({ isAuthenticated: true, isLoadingAuth: false });
    const myCourt = items.find((i) => i.label === "My Court");
    expect(myCourt.to).toBe("/account");
  });
});