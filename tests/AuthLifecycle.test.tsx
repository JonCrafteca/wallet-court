// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";

// --- Mocks -------------------------------------------------------------

const mockBase44 = vi.hoisted(() => ({
  app: { getPublicSettings: vi.fn() },
  auth: { me: vi.fn(), logout: vi.fn(), redirectToLogin: vi.fn() },
}));

vi.mock("@/api/base44Client", () => ({
  base44: mockBase44,
}));

const mockAppParams = vi.hoisted(() => ({ token: "fake-token" }));

vi.mock("@/lib/app-params", () => ({
  appParams: mockAppParams,
}));

vi.mock("@/components/UserNotRegisteredError", () => ({
  default: () => <div data-testid="not-registered" />,
}));

// --- Helpers ------------------------------------------------------------

function AuthConsumer() {
  const { isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  return (
    <div>
      <span data-testid="isAuthenticated">{String(isAuthenticated)}</span>
      <span data-testid="isLoadingAuth">{String(isLoadingAuth)}</span>
      <span data-testid="authChecked">{String(authChecked)}</span>
    </div>
  );
}

function renderAuth() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    </MemoryRouter>
  );
}

// --- Tests ---------------------------------------------------------------

describe("AuthContext — settlement on failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppParams.token = "fake-token";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getPublicSettings() failure settles auth to logged-out", async () => {
    mockBase44.app.getPublicSettings.mockRejectedValue(new Error("Network error"));
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("isLoadingAuth").textContent).toBe("false");
      expect(screen.getByTestId("authChecked").textContent).toBe("true");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
    });
  });

  it("me() failure settles auth to logged-out", async () => {
    mockBase44.app.getPublicSettings.mockResolvedValue({});
    mockBase44.auth.me.mockRejectedValue({ status: 500, message: "Server error" });
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("isLoadingAuth").textContent).toBe("false");
      expect(screen.getByTestId("authChecked").textContent).toBe("true");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
    });
  });

  it("401 from me() settles auth to logged-out", async () => {
    mockBase44.app.getPublicSettings.mockResolvedValue({});
    mockBase44.auth.me.mockRejectedValue({ status: 401, message: "Unauthorized" });
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId("isLoadingAuth").textContent).toBe("false");
      expect(screen.getByTestId("authChecked").textContent).toBe("true");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
    });
    // me() should have been called exactly once — no retry loop
    expect(mockBase44.auth.me).toHaveBeenCalledTimes(1);
  });

  it("hanging request reaches bounded recovery via safety timeout", async () => {
    vi.useFakeTimers();
    // getPublicSettings never resolves — simulates a hung network request
    mockBase44.app.getPublicSettings.mockReturnValue(new Promise(() => {}));
    renderAuth();
    // Initially loading
    expect(screen.getByTestId("isLoadingAuth").textContent).toBe("true");
    expect(screen.getByTestId("authChecked").textContent).toBe("false");
    // Advance past the 8-second safety timeout
    await vi.advanceTimersByTimeAsync(8000);
    // Should be settled to logged-out
    expect(screen.getByTestId("isLoadingAuth").textContent).toBe("false");
    expect(screen.getByTestId("authChecked").textContent).toBe("true");
    expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
  });

  it("unmounting during auth loading produces no state-update or timer leak", async () => {
    vi.useFakeTimers();
    mockBase44.app.getPublicSettings.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderAuth();
    // Safety timeout is pending
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    // Unmount before the timeout fires
    unmount();
    // The safety timeout must be cleared on unmount — not still pending.
    // This proves the cleanup ran and the timer will not fire later to
    // update state on an unmounted component.
    expect(vi.getTimerCount()).toBe(0);
    // Advancing past the original timeout must NOT trigger settleLoggedOut
    // (which would log the timeout warning). We verify by checking that
    // no console.warn was emitted.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.advanceTimersByTime(8000);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("ProtectedRoute — no auth-check loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppParams.token = "fake-token";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cannot create an auth-check loop on me() failure", async () => {
    mockBase44.app.getPublicSettings.mockResolvedValue({});
    mockBase44.auth.me.mockRejectedValue({ status: 401, message: "Unauthorized" });

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <AuthProvider>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/account" element={<div data-testid="protected" />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    // Wait for auth to settle — ProtectedRoute should redirect to login
    await waitFor(() => {
      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    });

    // me() must have been called exactly once — no retry loop
    expect(mockBase44.auth.me).toHaveBeenCalledTimes(1);
  });
});