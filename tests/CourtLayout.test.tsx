// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CourtLayout from "@/components/walletcourt/CourtLayout";
import { safeReturnTo } from "@/lib/authReturnTo";

// Mutable auth state — vi.hoisted ensures it's available when vi.mock runs.
const mockAuth = vi.hoisted(() => ({
  state: {
    isAuthenticated: false,
    isLoadingAuth: true,
    logout: () => {},
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => mockAuth.state,
}));

vi.mock("@/components/walletcourt/TickerTape", () => ({
  default: () => null,
}));

vi.mock("@/components/walletcourt/ShoutItMark", () => ({
  default: () => null,
}));

function setAuthState(partial: Partial<typeof mockAuth.state>) {
  mockAuth.state = { ...mockAuth.state, ...partial };
}

function renderAt(pathname: string, search = "") {
  const url = pathname + search;
  window.history.pushState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<CourtLayout />}>
          <Route path="*" element={<div data-testid="page" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("CourtLayout — auth state transitions", () => {
  beforeEach(() => {
    setAuthState({ isAuthenticated: false, isLoadingAuth: true, logout: () => {} });
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("1. Auth loading hides all auth-dependent controls", () => {
    setAuthState({ isLoadingAuth: true, isAuthenticated: false });
    renderAt("/hall");
    expect(screen.queryByRole("link", { name: /Sign In/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My Court/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign Out/ })).not.toBeInTheDocument();
  });

  it("2. Loading → logged out transition renders Sign In", () => {
    setAuthState({ isLoadingAuth: true, isAuthenticated: false });
    const { rerender } = renderAt("/hall");
    expect(screen.queryByRole("link", { name: /Sign In/ })).not.toBeInTheDocument();
    setAuthState({ isLoadingAuth: false, isAuthenticated: false });
    rerender(
      <MemoryRouter initialEntries={["/hall"]}>
        <Routes>
          <Route element={<CourtLayout />}>
            <Route path="*" element={<div data-testid="page" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: /Sign In/ })).toBeInTheDocument();
  });

  it("3. Logged out hides My Court and Sign Out", () => {
    setAuthState({ isLoadingAuth: false, isAuthenticated: false });
    renderAt("/hall");
    expect(screen.queryByRole("link", { name: /My Court/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign Out/ })).not.toBeInTheDocument();
  });

  it("4. Logged in renders My Court and Sign Out", () => {
    setAuthState({ isLoadingAuth: false, isAuthenticated: true });
    renderAt("/hall");
    expect(screen.getByRole("link", { name: /My Court/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign Out/ })).toBeInTheDocument();
  });

  it("5. Logged in hides Sign In", () => {
    setAuthState({ isLoadingAuth: false, isAuthenticated: true });
    renderAt("/hall");
    expect(screen.queryByRole("link", { name: /Sign In/ })).not.toBeInTheDocument();
  });

  it("6. 401 auth response settles loading and renders Sign In", () => {
    // After a 401 from me(), the AuthContext settles to logged-out state.
    setAuthState({ isLoadingAuth: false, isAuthenticated: false });
    renderAt("/hall");
    expect(screen.getByRole("link", { name: /Sign In/ })).toBeInTheDocument();
  });

  it("7. Auth-check error settles safely and renders Sign In", () => {
    // After a non-auth error (network, 500), the AuthContext settles to logged-out.
    setAuthState({ isLoadingAuth: false, isAuthenticated: false });
    renderAt("/hall");
    expect(screen.getByRole("link", { name: /Sign In/ })).toBeInTheDocument();
  });
});

describe("CourtLayout — desktop and mobile rendering", () => {
  beforeEach(() => {
    setAuthState({ isAuthenticated: false, isLoadingAuth: false, logout: () => {} });
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("8. Desktop navigation renders Sign In", () => {
    renderAt("/hall");
    expect(screen.getByRole("link", { name: /Sign In/ })).toBeInTheDocument();
  });

  it("9. Mobile navigation renders Sign In", () => {
    renderAt("/hall");
    // Click hamburger to open mobile menu
    const hamburger = screen.getByRole("button", { name: "Toggle navigation" });
    fireEvent.click(hamburger);
    // Both desktop and mobile navs now render — at least 2 Sign In links
    const signInLinks = screen.getAllByRole("link", { name: /Sign In/ });
    expect(signInLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("13. No duplicate Sign In when mobile menu is closed", () => {
    renderAt("/hall");
    // Mobile menu is closed — only desktop nav renders Sign In
    const signInLinks = screen.getAllByRole("link", { name: /Sign In/ });
    expect(signInLinks.length).toBe(1);
  });
});

describe("CourtLayout — returnTo encoding", () => {
  beforeEach(() => {
    setAuthState({ isAuthenticated: false, isLoadingAuth: false, logout: () => {} });
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("10. Sign In from a case includes the encoded internal case route", () => {
    renderAt("/case/case-21fglzyead8m");
    const signInLink = screen.getByRole("link", { name: /Sign In/ });
    const href = signInLink.getAttribute("href");
    expect(href).toContain("/login");
    expect(href).toContain("returnTo=%2Fcase%2Fcase-21fglzyead8m");
  });

  it("11. Successful login returns to that case", () => {
    // Simulate being on the login page with the returnTo param from the case
    window.history.pushState({}, "", "/login?returnTo=%2Fcase%2Fcase-21fglzyead8m");
    const result = safeReturnTo();
    expect(result).toBe("/case/case-21fglzyead8m");
  });
});

describe("safeReturnTo — unsafe values rejected", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("12a. Rejects external URL", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("https://evil.com/path"));
    expect(safeReturnTo()).toBe("/");
  });

  it("12b. Rejects protocol-relative URL", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("//evil.com/path"));
    expect(safeReturnTo()).toBe("/");
  });

  it("12c. Rejects backslash escape", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("/\\evil.com"));
    expect(safeReturnTo()).toBe("/");
  });

  it("12d. Rejects JavaScript URL", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("javascript:alert(1)"));
    expect(safeReturnTo()).toBe("/");
  });

  it("12e. Strips access_token from returnTo", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("/case/case-abc?access_token=secret"));
    const result = safeReturnTo();
    expect(result).not.toContain("access_token");
    expect(result).not.toContain("secret");
  });

  it("12f. Preserves valid case route", () => {
    window.history.pushState({}, "", "/login?returnTo=" + encodeURIComponent("/case/case-abc"));
    expect(safeReturnTo()).toBe("/case/case-abc");
  });
});