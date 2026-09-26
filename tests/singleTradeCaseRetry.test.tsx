// @vitest-environment jsdom
// Wallet Court — SingleTradeCase regression suite.
// Verifies the public /trade/:slug page NEVER shows a Retry Analysis button
// (retry was migrated to /admin/single-trade-usage). Also proves zero Nansen
// calls on page load, correct Reload Case behavior on 5xx, and no private
// field exposure.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Mocks -------------------------------------------------------------

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

describe("SingleTradeCase — no retry on public page (migrated to admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    defaultInvokeMock();
  });

  // 1. Failed/404 case → Case Unavailable with Back to Court, NO Retry Analysis
  it("404 → shows Case Unavailable and Back to Court, no Retry Analysis", async () => {
    renderCase();
    await waitFor(() => {
      expect(screen.getByText(/Case Unavailable/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Court/i })).toBeInTheDocument();
  });

  // 2. Initial page load → zero Nansen calls (only getSingleTradeBySlug)
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
    expect(calls).not.toContain("getSingleTradeAccess");
  });

  // 3. Network/5xx fetch failure → Reload Case shown, not Back to Court only
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

  // 4. No private fields exposed on the unavailable page
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

  // 5. Completed trial → renders verdict, no Retry Analysis
  it("completed trial → renders SingleTradeVerdict, no Retry Analysis", async () => {
    mockBase44FunctionsInvoke.mockImplementation(async (fn) => {
      if (fn === "getSingleTradeBySlug") return { data: { trial: COMPLETE_TRIAL }, status: 200 };
      throw new Error(`Unexpected: ${fn}`);
    });
    renderCase();
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-verdict")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Case Unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry Analysis/i })).not.toBeInTheDocument();
  });
});