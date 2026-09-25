// @vitest-environment jsdom
// Wallet Court — Home page Single Trade admin-preview access regression suite.
// Proves the rendering condition `publicEnabled || authenticatedUserIsAdmin`
// using the server-backed AuthContext user (never URL params or client values).
// No Nansen calls are made in any scenario.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";

// --- Mocks -------------------------------------------------------------

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/AuthContext", () => ({
  useAuth: mockUseAuth,
  AuthProvider: ({ children }) => children,
}));

const mockGetPublicFeatureFlags = vi.hoisted(() => vi.fn());
vi.mock("@/lib/featureFlags", () => ({
  getPublicFeatureFlags: mockGetPublicFeatureFlags,
}));

const mockBase44AuthMe = vi.hoisted(() => vi.fn());
const mockBase44FunctionsInvoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: mockBase44AuthMe },
    functions: { invoke: mockBase44FunctionsInvoke },
  },
}));

vi.mock("@/lib/attribution", () => ({
  captureReferral: vi.fn(),
  getAttributionContext: () => ({ ref_code: "", visitor_id: "" }),
}));

vi.mock("@/components/walletcourt/SingleTradeIntake", () => ({
  default: () => <div data-testid="single-trade-intake">SingleTradeIntake</div>,
}));
vi.mock("@/components/walletcourt/IntakeStage", () => ({
  default: () => <div data-testid="intake-stage" />,
}));
vi.mock("@/components/walletcourt/LoadingStage", () => ({
  default: () => <div data-testid="loading-stage" />,
}));
vi.mock("@/components/walletcourt/VerdictReveal", () => ({
  default: () => <div data-testid="verdict-reveal" />,
}));
vi.mock("@/components/walletcourt/CourtRecess", () => ({
  default: () => <div data-testid="court-recess" />,
}));
vi.mock("@/lib/walletValidation", () => ({
  validateWalletForChain: () => ({ ok: true }),
}));
vi.mock("@/lib/chains", () => ({
  NETWORK_OPTIONS: [{ id: "ethereum" }, { id: "solana" }, { id: "robinhood" }],
}));

import Home from "@/pages/Home";

// --- Helpers ------------------------------------------------------------

function renderHome(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Home />
    </MemoryRouter>
  );
}

function switchToSingleTrade() {
  fireEvent.click(screen.getByRole("button", { name: /Single Trade/i }));
}

// --- Tests ---------------------------------------------------------------

describe("Home — Single Trade admin preview access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicFeatureFlags.mockResolvedValue({
      single_trade_public_enabled: false,
      robinhood_public_enabled: false,
    });
    mockBase44AuthMe.mockResolvedValue(null);
  });

  // 1. anonymous + public disabled → Coming Soon
  it("anonymous + public disabled → Coming Soon", async () => {
    mockUseAuth.mockReturnValue({ user: null, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 2. ordinary user + public disabled → Coming Soon
  it("ordinary user + public disabled → Coming Soon", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "user" }, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 3. admin + public disabled → SingleTradeIntake with ADMIN PREVIEW label
  it("admin + public disabled → SingleTradeIntake with ADMIN PREVIEW label", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.getByText(/Admin Preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Public Disabled/i)).toBeInTheDocument();
  });

  // 4. public enabled → SingleTradeIntake (no admin preview label)
  it("public enabled → SingleTradeIntake for anonymous (no admin label)", async () => {
    mockUseAuth.mockReturnValue({ user: null, isLoadingAuth: false });
    mockGetPublicFeatureFlags.mockResolvedValue({
      single_trade_public_enabled: true,
      robinhood_public_enabled: false,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Admin Preview/i)).not.toBeInTheDocument();
  });

  // 4b. admin + public enabled → SingleTradeIntake (no admin preview label)
  it("admin + public enabled → SingleTradeIntake (no admin label)", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: false });
    mockGetPublicFeatureFlags.mockResolvedValue({
      single_trade_public_enabled: true,
      robinhood_public_enabled: false,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Admin Preview/i)).not.toBeInTheDocument();
  });

  // 5. loading defaults safely to Coming Soon
  it("loading defaults safely to Coming Soon (auth still loading)", async () => {
    // Even if user would be admin, isLoadingAuth=true → Coming Soon
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: true });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  it("loading defaults safely to Coming Soon (flags still loading)", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: false });
    // Deferred promise — flags haven't resolved yet
    let resolveFlags;
    mockGetPublicFeatureFlags.mockReturnValue(
      new Promise((r) => { resolveFlags = r; })
    );
    renderHome();
    switchToSingleTrade();
    // flagsLoaded=false → Coming Soon
    expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
    // Resolve flags → admin access kicks in
    resolveFlags({ single_trade_public_enabled: false, robinhood_public_enabled: false });
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
  });

  it("auth failure defaults safely to Coming Soon", async () => {
    // Auth failed → user is null, isLoadingAuth is false
    mockUseAuth.mockReturnValue({ user: null, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 6. admin status comes from authenticated server-backed user data
  it("admin status comes from useAuth (server-backed), not base44.auth.me()", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    // Home must NOT call base44.auth.me() directly — it uses useAuth()
    expect(mockBase44AuthMe).not.toHaveBeenCalled();
    // useAuth must have been called (proving it's the source)
    expect(mockUseAuth).toHaveBeenCalled();
  });

  it("admin status is not inferred from URL params or client-controlled values", async () => {
    // Even with ?admin=1&role=admin query params, a non-admin user gets Coming Soon
    mockUseAuth.mockReturnValue({ user: { role: "user" }, isLoadingAuth: false });
    renderHome("/?admin=1&role=admin");
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 7. Zero Nansen calls in all access scenarios
  it("makes zero Nansen calls (base44.functions.invoke never called) for admin preview", async () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin" }, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(mockBase44FunctionsInvoke).not.toHaveBeenCalled();
  });

  it("makes zero Nansen calls for Coming Soon (anonymous)", async () => {
    mockUseAuth.mockReturnValue({ user: null, isLoadingAuth: false });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(mockBase44FunctionsInvoke).not.toHaveBeenCalled();
  });
});