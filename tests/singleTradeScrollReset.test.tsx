// @vitest-environment jsdom
// Wallet Court — Single Trade verdict scroll position regression test.
// Proves the page scrolls to {top: 0, left: 0} when a Single Trade verdict
// is first displayed through the in-page analyzing → done transition.
//
// No Nansen calls are made in any scenario (all backend calls are mocked).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";

// --- Mocks -------------------------------------------------------------

const mockBase44FunctionsInvoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: mockBase44FunctionsInvoke } },
}));

vi.mock("@/lib/walletValidation", () => ({
  validateWalletForChain: () => ({ ok: true }),
}));

vi.mock("@/lib/singleTradeCapability", () => ({
  SINGLE_TRADE_CAPABILITIES: [{ network: "solana", label: "Solana" }],
  isSingleTradeSupported: () => true,
}));

vi.mock("@/lib/singleTradeRenderable", () => ({
  isSingleTradeRenderable: () => true,
}));

vi.mock("@/lib/singleTradeErrors", () => ({
  getSingleTradeErrorMessage: () => "Discovery failed. Try again.",
  getSingleTradeErrorCode: () => null,
}));

vi.mock("@/components/walletcourt/SingleTradeVerdict", () => ({
  default: ({ trial }) => (
    <div data-testid="single-trade-verdict" data-slug={trial?.public_slug} />
  ),
}));

vi.mock("@/components/walletcourt/LoadingStage", () => ({
  default: () => <div data-testid="loading-stage" />,
}));

vi.mock("@/components/walletcourt/CourtRecess", () => ({
  default: ({ recessType }) => (
    <div data-testid="court-recess" data-recess-type={recessType} />
  ),
}));

import SingleTradeIntake from "@/components/walletcourt/SingleTradeIntake";

// --- Helpers ------------------------------------------------------------

function renderIntake() {
  return render(
    <MemoryRouter>
      <SingleTradeIntake onReset={() => {}} />
    </MemoryRouter>
  );
}

const SAMPLE_PURCHASES = [
  {
    selection_id: "sel_1",
    transaction_hash: "tx_abc",
    transaction_hash_short: "tx_ab…cd",
    block_timestamp: "2026-09-01T12:00:00Z",
    purchase_cost_usd: 100,
    tokens_received: 1000,
    entry_market_cap_usd: 500000,
  },
];

// --- Tests --------------------------------------------------------------

describe("SingleTradeIntake — Single Trade verdict scroll reset", () => {
  let scrollSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => { scrollSpy.mockRestore(); });

  // 2. Single Trade verdict completion scrolls to the top.
  it("scrolls to {top:0, left:0} when a Single Trade verdict is displayed", async () => {
    // Phase 1: discovery returns purchases.
    mockBase44FunctionsInvoke.mockResolvedValueOnce({
      data: { purchases: SAMPLE_PURCHASES },
      status: 200,
    });
    // Phase 2: analysis returns a completed trial.
    mockBase44FunctionsInvoke.mockResolvedValueOnce({
      data: { trial: { public_slug: "trade-verdict-1", case_outcome: "verdict" } },
      status: 200,
    });

    renderIntake();

    // Fill the intake form and discover purchases.
    fireEvent.change(screen.getByLabelText(/wallet address/i), {
      target: { value: "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1" },
    });
    fireEvent.change(screen.getByLabelText(/token mint address/i), {
      target: { value: "So11111111111111111111111111111111111111112" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find purchases/i }));

    // Wait for the purchase list to appear.
    await waitFor(() => {
      expect(screen.getByText(/1 purchase found/i)).toBeInTheDocument();
    }, { timeout: 6000 });

    // Select the purchase (radio).
    const radio = screen.getByRole("radio");
    fireEvent.click(radio);

    // Analyze the selected trade.
    fireEvent.click(screen.getByRole("button", { name: /put this trade on trial/i }));

    // Wait for the verdict to appear.
    await waitFor(() => {
      expect(screen.getByTestId("single-trade-verdict")).toBeInTheDocument();
    }, { timeout: 6000 });

    // The verdict hook should have scrolled to the top instantly.
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  // 6d. Recess transition in Single Trade does not trigger a verdict scroll.
  it("does not scroll to top on a recess transition (no verdict key)", async () => {
    mockBase44FunctionsInvoke.mockResolvedValueOnce({
      data: {
        court_recess: true,
        recess_type: "court_recess_provider",
        sanitized_reason: "Provider temporarily unavailable.",
        retry_after: "2026-09-27T17:02:00.000Z",
        retry_in_seconds: 30,
        http_status: 503,
      },
      status: 200,
    });

    renderIntake();

    fireEvent.change(screen.getByLabelText(/wallet address/i), {
      target: { value: "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1" },
    });
    fireEvent.change(screen.getByLabelText(/token mint address/i), {
      target: { value: "So11111111111111111111111111111111111111112" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find purchases/i }));

    await waitFor(() => {
      expect(screen.getByTestId("court-recess")).toBeInTheDocument();
    }, { timeout: 6000 });

    // No verdict was displayed, so no verdict-driven scroll.
    expect(screen.queryByTestId("single-trade-verdict")).not.toBeInTheDocument();
    const verdictScrolls = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    );
    expect(verdictScrolls.length).toBe(0);
  });
});