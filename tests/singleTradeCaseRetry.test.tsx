// @vitest-environment jsdom
// Wallet Court — SingleTradeCase admin retry regression suite.
// Proves the Retry Analysis button on a failed/404 case page is gated by the
// server-authoritative getSingleTradeAccess function — never by client-side
// admin inference, the returned trial object, or the failed fetch. Also
// proves zero Nansen calls on page load, double-click prevention, and
// correct redirect/error behavior on retry.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Mocks -------------------------------------------------------------

const mockGetSingleTradeAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/singleTradeAccess", () => ({
  getSingleTradeAccess: mockGetSingleTradeAccess,
}));

const mockBase44FunctionsInvoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: mockBase44FunctionsInvoke } },
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/walletcourt/LoadingStage", () => ({
  default: () => <div data-testid="loading-stage" />,
}));
vi.mock("@/components/walletcourt/SingleTradeVerdict", () => ({
  default: ({ trial }) => <div data-testid="single-trade-verdict">{trial?.public_slug}</div>,
}));

import SingleTradeCase from "@/pages/SingleTradeCase";

// --- Fixtures ----------------------------------------------------------

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

const FAILED_SLUG = "trade-6iitjk72sg68";

function makeAxiosError(status, data) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data };
  return error;
}

const CASE_404_ERROR = makeAxiosError(404, {
  error: "This trade case was not completed and is not available for public viewing.",
  code: "CASE_INCOMPLETE",
});

const CASE_500_ERROR = makeAxiosError(500, {
  error: "Internal server error.",
  code: "INTERNAL_ERROR",
});

const COMPLETE_TRIAL = {
  public_slug: "trade-newverdict123",
  case_outcome: "verdict",
  verdict_code: "bag_holder",
  verdict_name: "Bag Holder",
  severity_score: 72,
  confidence_score: 88,
  headline: "Held the bag to the bottom",
  roast: "The court finds the defendant guilty of maximum bag-holding.",
  defense_statement: "I believed in the tech.",
  sentence: "Sentenced to hold until zero.",
  evidence_items_json: JSON.stringify([{ tag: "drawdown", label: "-80%", value: -80 }]),
  metrics_json: JSON.stringify({ max_drawdown_pct: -0.8, holding_duration_days: 30, conviction: "diamond", candle_count: 100, current_unrealized_pnl_pct: -80, lowest_market_cap_usd: 1000 }),
  source_endpoints_json: JSON.stringify(["nansen:dex_trades:live", "nansen:token_ohlcv:live", "nansen:current_balance:live"]),
  purchase_cost_usd: 1048,
  tokens_received: 108118,
};

const RETRY_SELECTION = {
  selection_token: "sel_retry123",
  wallet_address: "0xabc",
  network: "solana",
  token_mint: "mint1",
};

// --- Helpers ------------------------------------------------------------

function renderCase(slug = FAILED_SLUG) {
  return render(<SingleTradeCase />);
}

// Default invoke mock: getSingleTradeBySlug → 404 (the failed case).
function defaultInvokeMock() {
  mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
    if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
    throw new Error(`Unexpected invoke: ${fn}`);
  });
}

// --- Tests ---------------------------------------------------------------

describe("SingleTradeCase — admin retry via getSingleTradeAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mockGetSingleTradeAccess.mockResolvedValue(ADMIN_ACCESS);
    defaultInvokeMock();
  });

  // 1. Admin + failed slug/404 → Retry Analysis visible
  it("admin + 404 → shows Retry Analysis and Back to Court", async () => {
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Court/i })).toBeInTheDocument();
  });

  // 2. Public user + failed slug/404 → Retry Analysis hidden
  it("public user + 404 → shows Back to Court only, no Retry Analysis", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(PUBLIC_ACCESS);
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Court/i })).toBeInTheDocument();
  });

  // 2b. Anonymous user + 404 → Retry Analysis hidden
  it("anonymous user + 404 → no Retry Analysis", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(ANON_ACCESS);
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 3. Access loading → retry hidden (fail closed)
  it("access loading → retry hidden (fail closed)", async () => {
    mockGetSingleTradeAccess.mockReturnValue(new Promise(() => {}));
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 3b. Access failure → retry hidden (fail closed)
  it("access failure → retry hidden (fail closed)", async () => {
    mockGetSingleTradeAccess.mockResolvedValue(FAIL_CLOSED);
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 3c. Admin + usage disabled → retry hidden
  it("admin + usage disabled → retry hidden", async () => {
    mockGetSingleTradeAccess.mockResolvedValue({ ...ADMIN_ACCESS, usage_enabled: false });
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 3d. Admin + emergency stop → retry hidden
  it("admin + emergency stop → retry hidden", async () => {
    mockGetSingleTradeAccess.mockResolvedValue({ ...ADMIN_ACCESS, emergency_stop: true });
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 4. Initial page load → zero Nansen calls
  it("initial page load makes zero Nansen calls (only getSingleTradeBySlug)", async () => {
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    const calls = mockBase44FunctionsInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["getSingleTradeBySlug"]);
    expect(calls).not.toContain("retrySingleTradeTrial");
    expect(calls).not.toContain("analyzeSingleTrade");
    expect(calls).not.toContain("discoverTokenPurchases");
  });

  // 5. One retry click → exactly one analysis invocation
  it("one retry click → exactly one retrySingleTradeTrial + one analyzeSingleTrade", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
      if (fn === "retrySingleTradeTrial") return { data: RETRY_SELECTION };
      if (fn === "analyzeSingleTrade") return { data: { trial: COMPLETE_TRIAL } };
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry Analysis/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/trade/${COMPLETE_TRIAL.public_slug}`, { replace: true });
    });
    const retryCalls = mockBase44FunctionsInvoke.mock.calls.filter((c) => c[0] === "retrySingleTradeTrial");
    const analyzeCalls = mockBase44FunctionsInvoke.mock.calls.filter((c) => c[0] === "analyzeSingleTrade");
    expect(retryCalls).toHaveLength(1);
    expect(analyzeCalls).toHaveLength(1);
  });

  // 6. Double click → no duplicate invocation
  it("double click → only one retrySingleTradeTrial invocation", async () => {
    let retryResolve;
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
      if (fn === "retrySingleTradeTrial") {
        return new Promise((res) => { retryResolve = () => res({ data: RETRY_SELECTION }); });
      }
      if (fn === "analyzeSingleTrade") return { data: { trial: COMPLETE_TRIAL } };
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    const retryBtn = await screen.findByRole("button", { name: /Retry Analysis/i });
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn); // second click while first is in-flight
    // Only one retry call should have been made.
    const retryCalls = mockBase44FunctionsInvoke.mock.calls.filter((c) => c[0] === "retrySingleTradeTrial");
    expect(retryCalls).toHaveLength(1);
    // Resolve to let the flow complete.
    retryResolve();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  // 7. Successful retry → redirect to new slug
  it("successful retry → navigate to new slug", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
      if (fn === "retrySingleTradeTrial") return { data: RETRY_SELECTION };
      if (fn === "analyzeSingleTrade") return { data: { trial: COMPLETE_TRIAL } };
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry Analysis/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/trade/${COMPLETE_TRIAL.public_slug}`, { replace: true });
    });
  });

  // 8. Backend retry rejection → safe error shown
  it("backend retry rejection (NOT_FAILED) → safe error shown, button blocked", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
      if (fn === "retrySingleTradeTrial") {
        throw makeAxiosError(400, { error: "Only failed cases can be retried.", code: "NOT_FAILED" });
      }
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry Analysis/i }));
    await waitFor(() => {
      expect(screen.getByText(/Only failed cases can be retried/i)).toBeInTheDocument();
    });
    // Button should be disabled (permanent error → retryBlocked).
    const retryBtn = screen.getByRole("button", { name: /Retry Analysis/i });
    expect(retryBtn).toBeDisabled();
  });

  // 8b. Backend retry rejection (FORBIDDEN) → safe error, button blocked
  it("backend retry rejection (FORBIDDEN) → safe error shown, button blocked", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_404_ERROR;
      if (fn === "retrySingleTradeTrial") {
        throw makeAxiosError(403, { error: "Admin access required to retry a failed case.", code: "FORBIDDEN" });
      }
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry Analysis/i }));
    await waitFor(() => {
      expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry Analysis/i })).toBeDisabled();
  });

  // 9. Network/5xx fetch failure → Reload Case, not Retry Analysis
  it("5xx fetch failure → Reload Case shown, Retry Analysis hidden", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") throw CASE_500_ERROR;
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Reload Case/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });

  // 10. No private fields exposed on the unavailable page
  it("unavailable page does not expose transaction hash, wallet, or selection token", async () => {
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    const body = document.body.textContent || "";
    expect(body).not.toContain("sel_");
    expect(body).not.toContain("transaction_hash");
    expect(body).not.toContain("wallet_address");
    expect(body).not.toContain("0xabc");
  });
});