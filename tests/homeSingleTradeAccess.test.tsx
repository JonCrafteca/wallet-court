// @vitest-environment jsdom
// Wallet Court — Home page Single Trade access regression suite.
// Proves the rendering condition uses getSingleTradeAccess (server-side
// canonical admin check) as the authoritative access decision — never
// client user fields, URL params, or UI state. No Nansen calls are made.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";

// --- Mocks -------------------------------------------------------------

// Mock the access helper — this is the single source of truth for the Home
// page's Single Trade access decision. Each test controls the return value.
const mockGetSingleTradeAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/singleTradeAccess", () => ({
  getSingleTradeAccess: mockGetSingleTradeAccess,
}));

const mockGetPublicFeatureFlags = vi.hoisted(() => vi.fn());
vi.mock("@/lib/featureFlags", () => ({
  getPublicFeatureFlags: mockGetPublicFeatureFlags,
}));

const mockBase44FunctionsInvoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: mockBase44FunctionsInvoke } },
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

const ADMIN_ACCESS = {
  public_enabled: false, is_admin: true, can_access: true,
  admin_preview: true, usage_enabled: true, emergency_stop: false,
};
const PUBLIC_ACCESS = {
  public_enabled: true, is_admin: false, can_access: true,
  admin_preview: false, usage_enabled: true, emergency_stop: false,
};
const ANON_ACCESS = {
  public_enabled: false, is_admin: false, can_access: false,
  admin_preview: false, usage_enabled: true, emergency_stop: false,
};
const FAIL_CLOSED = {
  public_enabled: false, is_admin: false, can_access: false,
  admin_preview: false, usage_enabled: false, emergency_stop: false,
};

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

describe("Home — Single Trade access via getSingleTradeAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicFeatureFlags.mockResolvedValue({
      single_trade_public_enabled: false,
      robinhood_public_enabled: false,
    });
  });

  // 1. anonymous + public disabled → Coming Soon
  it("anonymous + public disabled → Coming Soon", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ANON_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 2. ordinary user + public disabled → Coming Soon
  it("ordinary user + public disabled → Coming Soon", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ANON_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 3. server-recognized admin + public disabled → SingleTradeIntake + ADMIN PREVIEW
  it("server-recognized admin + public disabled → SingleTradeIntake with ADMIN PREVIEW label", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ADMIN_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.getByText(/Admin Preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Public Disabled/i)).toBeInTheDocument();
  });

  // 4. public enabled → SingleTradeIntake (no admin label)
  it("public enabled → SingleTradeIntake for anonymous (no admin label)", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(PUBLIC_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Admin Preview/i)).not.toBeInTheDocument();
  });

  // 4b. admin + public enabled → SingleTradeIntake (no admin label)
  it("admin + public enabled → SingleTradeIntake (no admin label)", async () => {
    mockGetSingleTradeAccess.mockResolvedValue({
      ...ADMIN_ACCESS, public_enabled: true, admin_preview: false,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Admin Preview/i)).not.toBeInTheDocument();
  });

  // 5. backend/auth failure fails closed → Coming Soon
  it("backend failure (rejected promise) fails closed to Coming Soon", async () => {
    mockGetSingleTradeAccess.mockRejectedValue(new Error("network"));
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  it("backend failure (all-false response) fails closed to Coming Soon", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(FAIL_CLOSED);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  it("loading (access not yet resolved) fails closed to Coming Soon", async () => {
    // Never-resolving promise simulates loading state.
    mockGetSingleTradeAccess.mockReturnValue(new Promise(() => {}));
    renderHome();
    switchToSingleTrade();
    expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 6. usage disabled → blocked state (no intake, no calls)
  it("admin + usage disabled → blocked state, no SingleTradeIntake", async () => {
    mockGetSingleTradeAccess.mockResolvedValue({
      ...ADMIN_ACCESS, usage_enabled: false,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Trial Paused/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 7. emergency stop → blocked state (no intake, no calls)
  it("admin + emergency stop → blocked state, no SingleTradeIntake", async () => {
    mockGetSingleTradeAccess.mockResolvedValue({
      ...ADMIN_ACCESS, emergency_stop: true,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Court Halted/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 8. zero Nansen calls in all scenarios
  it("makes zero Nansen calls for admin preview", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ADMIN_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(mockBase44FunctionsInvoke).not.toHaveBeenCalled();
  });

  it("makes zero Nansen calls for Coming Soon (anonymous)", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ANON_ACCESS);
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(mockBase44FunctionsInvoke).not.toHaveBeenCalled();
  });

  // 9. admin status not inferred from URL params
  it("admin status is not inferred from URL params", async () => {
    // Even with ?admin=1&role=admin, a non-admin access decision → Coming Soon
    mockGetSingleTradeAccess.mockResolvedValue(ANON_ACCESS);
    renderHome("/?admin=1&role=admin");
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByText(/Coming Soon/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("single-trade-intake")).not.toBeInTheDocument();
  });

  // 10. admin preview label only shows when admin_preview is true
  it("admin preview label shows only when admin_preview is true", async () => {
    // Admin + public enabled → no admin preview label
    mockGetSingleTradeAccess.mockResolvedValue({
      ...ADMIN_ACCESS, public_enabled: true, admin_preview: false,
    });
    renderHome();
    switchToSingleTrade();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-intake")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Admin Preview/i)).not.toBeInTheDocument();
  });
});