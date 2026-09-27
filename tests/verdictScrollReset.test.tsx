// @vitest-environment jsdom
// Wallet Court — verdict-page scroll position regression tests.
// Proves the page scrolls to {top: 0, left: 0} when a verdict is first
// displayed (in-page transition or route change), and does NOT scroll on
// rerenders of the same verdict or on loading/error/recess transitions.
//
// No Nansen calls are made in any scenario.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useVerdictScrollReset } from "@/hooks/useVerdictScrollReset";

// --- Shared mocks -------------------------------------------------------

const mockBase44FunctionsInvoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: mockBase44FunctionsInvoke } },
}));

vi.mock("@/lib/attribution", () => ({
  captureReferral: vi.fn(),
  getAttributionContext: () => ({ ref_code: "", visitor_id: "" }),
}));

vi.mock("@/lib/featureFlags", () => ({
  getPublicFeatureFlags: vi.fn().mockResolvedValue({ robinhood_public_enabled: false }),
}));

vi.mock("@/lib/singleTradeAccess", () => ({
  getSingleTradeAccess: vi.fn().mockResolvedValue({
    public_enabled: false, is_admin: false, can_access: false,
    admin_preview: false, usage_enabled: true, emergency_stop: false,
  }),
}));

vi.mock("@/components/walletcourt/SingleTradeIntake", () => ({
  default: () => <div data-testid="single-trade-intake" />,
}));

vi.mock("@/components/walletcourt/IntakeStage", () => ({
  default: ({ address, setAddress, onSubmit, error }) => (
    <div data-testid="intake-stage">
      <label htmlFor="wallet-address">Wallet Address</label>
      <input
        id="wallet-address"
        value={address || ""}
        onChange={(e) => setAddress(e.target.value)}
      />
      <button data-testid="submit-subpoena" onClick={onSubmit}>EXECUTE SUBPOENA</button>
      {error && <p data-testid="intake-error">{error}</p>}
    </div>
  ),
}));

vi.mock("@/components/walletcourt/LoadingStage", () => ({
  default: () => <div data-testid="loading-stage" />,
}));

vi.mock("@/components/walletcourt/VerdictReveal", () => ({
  default: ({ trial }) => (
    <div data-testid="verdict-reveal" data-slug={trial?.public_slug} />
  ),
}));

vi.mock("@/components/walletcourt/CourtRecess", () => ({
  default: ({ recessType }) => (
    <div data-testid="court-recess" data-recess-type={recessType} />
  ),
}));

vi.mock("@/lib/walletValidation", () => ({
  validateWalletForChain: () => ({ ok: true }),
}));

vi.mock("@/lib/chains", () => ({
  NETWORK_OPTIONS: [{ id: "ethereum" }, { id: "solana" }, { id: "robinhood" }],
}));

vi.mock("@/lib/routeState", () => ({
  classifyCaseFetchResult: (result, status) => {
    if (status === 404) return "notfound";
    if (status >= 500) return "error";
    if (result?.trial) return "done";
    if (result?.error) return "error";
    return "done";
  },
}));

// --- Hook unit tests ----------------------------------------------------

function TestComp({ verdictKey }) {
  useVerdictScrollReset(verdictKey);
  return <div data-testid="test" />;
}

describe("useVerdictScrollReset — hook unit tests", () => {
  let scrollSpy;
  beforeEach(() => {
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => { scrollSpy.mockRestore(); });

  it("does not scroll when no verdict key (null)", () => {
    render(<TestComp verdictKey={null} />);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("scrolls to {top:0, left:0} instant when verdict key becomes truthy", () => {
    const { rerender } = render(<TestComp verdictKey={null} />);
    expect(scrollSpy).not.toHaveBeenCalled();
    rerender(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  it("does not scroll on rerender with the same verdict key", () => {
    const { rerender } = render(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    rerender(<TestComp verdictKey="case-abc" />);
    rerender(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("scrolls again when verdict key changes to a new value", () => {
    const { rerender } = render(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    rerender(<TestComp verdictKey="case-def" />);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when transitioning away from verdict (key → null)", () => {
    const { rerender } = render(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    rerender(<TestComp verdictKey={null} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("scrolls again after returning to a verdict from null", () => {
    const { rerender } = render(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    rerender(<TestComp verdictKey={null} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    rerender(<TestComp verdictKey="case-abc" />);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });
});

// --- Home (Whole Wallet) integration -----------------------------------

import Home from "@/pages/Home";

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Home />
    </MemoryRouter>
  );
}

async function submitSubpoena() {
  fireEvent.change(screen.getByLabelText(/wallet address/i), {
    target: { value: "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1" },
  });
  fireEvent.click(screen.getByTestId("submit-subpoena"));
}

describe("Home — Whole Wallet verdict scroll reset", () => {
  let scrollSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => { scrollSpy.mockRestore(); });

  // 1. Whole Wallet verdict completion scrolls to {top: 0, left: 0}.
  it("scrolls to {top:0, left:0} when a Whole Wallet verdict is displayed", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-ww-1", verdict_name: "One Pump Chump" } },
      status: 200,
    });
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toBeInTheDocument();
    }, { timeout: 6000 });
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  // 6a. Recess transition does not trigger a verdict scroll.
  it("does not scroll to top on a recess transition (no verdict key)", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
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
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("court-recess")).toBeInTheDocument();
    }, { timeout: 6000 });
    // No verdict was displayed, so no verdict-driven scroll.
    expect(screen.queryByTestId("verdict-reveal")).not.toBeInTheDocument();
    const verdictScrolls = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    );
    expect(verdictScrolls.length).toBe(0);
  });

  // 6b. Error transition (idle with inline error) does not trigger a verdict scroll.
  it("does not scroll to top on an error transition (inline error, no verdict)", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      new Error("Request failed with status code 500")
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("intake-error")).toBeInTheDocument();
    }, { timeout: 6000 });
    expect(screen.queryByTestId("verdict-reveal")).not.toBeInTheDocument();
    const verdictScrolls = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    );
    expect(verdictScrolls.length).toBe(0);
  });
});

// --- Case (direct route) integration -----------------------------------

import Case from "@/pages/Case";

let _navigateFn;
function NavCapture() {
  _navigateFn = useNavigate();
  return null;
}

function renderCaseRouter(initialSlug) {
  _navigateFn = null;
  return render(
    <MemoryRouter initialEntries={[`/case/${initialSlug}`]}>
      <NavCapture />
      <Routes>
        <Route path="/case/:slug" element={<Case />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Case — direct route and slug navigation scroll reset", () => {
  let scrollSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => { scrollSpy.mockRestore(); });

  // 3. Direct completed-case route starts at the top.
  it("scrolls to top when a completed case is loaded via direct route", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-direct-1" } },
      status: 200,
    });
    renderCaseRouter("case-direct-1");

    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toBeInTheDocument();
    });
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  // 4. Navigating from one case slug to another scrolls to the top.
  it("scrolls to top when navigating between different case slugs", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-aaa" } },
      status: 200,
    });
    renderCaseRouter("case-aaa");

    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toHaveAttribute("data-slug", "case-aaa");
    });
    const scrollCountAfterFirst = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    ).length;
    expect(scrollCountAfterFirst).toBeGreaterThanOrEqual(1);

    // Navigate to a different slug.
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-bbb" } },
      status: 200,
    });
    act(() => _navigateFn("/case/case-bbb"));

    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toHaveAttribute("data-slug", "case-bbb");
    });
    const scrollCountAfterSecond = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    ).length;
    expect(scrollCountAfterSecond).toBeGreaterThan(scrollCountAfterFirst);
  });

  // 5. Rerenders of the same case do not continually reset scroll position.
  it("does not scroll again on rerender of the same case", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-same" } },
      status: 200,
    });
    const { rerender } = renderCaseRouter("case-same");

    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toBeInTheDocument();
    });
    const scrollCountAfterVerdict = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    ).length;

    // Rerender the same case (same slug, same verdict key).
    rerender(
      <MemoryRouter initialEntries={["/case/case-same"]}>
        <NavCapture />
        <Routes>
          <Route path="/case/:slug" element={<Case />} />
        </Routes>
      </MemoryRouter>
    );
    // Allow any effects to settle.
    await new Promise((r) => setTimeout(r, 50));
    const scrollCountAfterRerender = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    ).length;
    expect(scrollCountAfterRerender).toBe(scrollCountAfterVerdict);
  });

  // 6c. Loading state does not trigger a verdict scroll.
  it("does not scroll to top during loading state (before verdict)", async () => {
    let resolveInvoke;
    mockBase44FunctionsInvoke.mockImplementation(
      () => new Promise((r) => { resolveInvoke = r; })
    );
    renderCaseRouter("case-loading");

    await waitFor(() => {
      expect(screen.getByTestId("loading-stage")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("verdict-reveal")).not.toBeInTheDocument();
    const verdictScrolls = scrollSpy.mock.calls.filter(
      (c) => c[0] && c[0].behavior === "instant"
    );
    expect(verdictScrolls.length).toBe(0);
    // Cleanup: resolve to avoid unhandled promise.
    if (resolveInvoke) resolveInvoke({ data: { trial: { public_slug: "x" } }, status: 200 });
  });
});