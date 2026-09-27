// @vitest-environment jsdom
// Wallet Court — Home page subpoena submission error-handling regression suite.
// Proves the EXECUTE SUBPOENA handler never reduces a structured backend error
// (Court Recess 503, validation 400, or network failure) to the generic axios
// message "Request failed with status code 503". The Court Recess payload is
// routed to the Court Recess UI; all other errors show a safe inline message.
//
// No Nansen calls are made in any scenario.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";

// --- Mocks -------------------------------------------------------------

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
  default: () => <div data-testid="verdict-reveal" />,
}));
vi.mock("@/components/walletcourt/CourtRecess", () => ({
  default: ({ recessType, retryAfter }) => (
    <div data-testid="court-recess" data-recess-type={recessType} data-retry-after={retryAfter} />
  ),
}));
vi.mock("@/lib/walletValidation", () => ({
  validateWalletForChain: () => ({ ok: true }),
}));
vi.mock("@/lib/chains", () => ({
  NETWORK_OPTIONS: [{ id: "ethereum" }, { id: "solana" }, { id: "robinhood" }],
}));

import Home from "@/pages/Home";

// --- Helpers -----------------------------------------------------------

function renderHome(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Home />
    </MemoryRouter>
  );
}

// Mimic the AxiosError the SDK throws on a non-2xx response.
function axiosError(status, data) {
  const e = new Error("Request failed with status code " + status);
  e.response = { status, data };
  return e;
}

// Submit a subpoena. Home reads the address from controlled state, so we type
// it then click. The walletValidation mock always returns ok.
async function submitSubpoena() {
  fireEvent.change(screen.getByLabelText(/wallet address/i), {
    target: { value: "8QisffwsucPzHL3afGWT1yCHsk3aGuYxkmwstwTuRqU1" },
  });
  fireEvent.click(screen.getByTestId("submit-subpoena"));
}

describe("Home — subpoena submission error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. 503 Court Recess → Court Recess UI, NOT the raw axios message.
  it("routes a 503 Court Recess to the Court Recess UI (not raw axios message)", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      axiosError(503, {
        court_recess: true,
        recess_type: "court_recess_unknown",
        sanitized_reason: "Provider returned an unexpected response.",
        retry_after: "2026-09-27T16:56:55.838Z",
        retry_in_seconds: 20,
        http_status: 503,
      })
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("court-recess")).toBeInTheDocument();
    });
    expect(screen.getByTestId("court-recess")).toHaveAttribute("data-recess-type", "court_recess_unknown");
    expect(screen.getByTestId("court-recess")).toHaveAttribute("data-retry-after", "2026-09-27T16:56:55.838Z");
    // The generic axios message must NEVER be shown to the visitor.
    expect(screen.queryByText(/Request failed with status code 503/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-error")).not.toBeInTheDocument();
  });

  // 2. 503 with { error, code } → safe inline error, not raw axios message.
  it("shows a safe inline message for a 503 with { error, code } (not raw axios)", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      axiosError(503, { error: "Provider outage.", code: "PROVIDER_OUTAGE" })
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("intake-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("intake-error")).toHaveTextContent("Provider outage. [PROVIDER_OUTAGE]");
    expect(screen.queryByText(/Request failed with status code 503/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("court-recess")).not.toBeInTheDocument();
  });

  // 3. 429 rate-limit Court Recess → Court Recess UI.
  it("routes a 429 rate-limit Court Recess to the Court Recess UI", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      axiosError(429, {
        court_recess: true,
        recess_type: "court_recess_rate_limit",
        sanitized_reason: "Provider rate limit reached.",
        retry_after: "2026-09-27T17:02:00.000Z",
        retry_in_seconds: 60,
        http_status: 429,
      })
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("court-recess")).toBeInTheDocument();
    });
    expect(screen.getByTestId("court-recess")).toHaveAttribute("data-recess-type", "court_recess_rate_limit");
    expect(screen.queryByText(/Request failed with status code 429/i)).not.toBeInTheDocument();
  });

  // 4. 400 validation error → safe inline message with code.
  it("shows a safe inline message for a 400 validation error", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      axiosError(400, {
        error: "That does not look like a valid Solana address.",
        code: "INVALID_WALLET_FOR_CHAIN",
        chain: "solana",
      })
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("intake-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("intake-error")).toHaveTextContent("does not look like a valid Solana address");
    expect(screen.queryByText(/Request failed with status code 400/i)).not.toBeInTheDocument();
  });

  // 5. Network failure (no response body) → fallback message, not raw axios.
  it("shows the fallback message for a network failure with no response", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(new Error("Network Error"));
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("intake-error")).toBeInTheDocument();
    });
    // "Network Error" is a real message, not the generic "Request failed" form,
    // so it is shown verbatim rather than the fallback.
    expect(screen.getByTestId("intake-error")).toHaveTextContent("Network Error");
    expect(screen.queryByTestId("court-recess")).not.toBeInTheDocument();
  });

  // 6. Bare "Request failed with status code 503" (no body) → fallback message.
  it("shows the fallback when the 503 has no parseable body", async () => {
    mockBase44FunctionsInvoke.mockRejectedValue(
      new Error("Request failed with status code 503")
    );
    renderHome();
    await submitSubpoena();

    await waitFor(() => {
      expect(screen.getByTestId("intake-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("intake-error")).toHaveTextContent("The court failed to convene. Try again.");
    expect(screen.queryByText(/Request failed with status code 503/i)).not.toBeInTheDocument();
  });

  // 7. A successful verdict still renders VerdictReveal (regression guard).
  it("renders the verdict on a successful 200 response", async () => {
    mockBase44FunctionsInvoke.mockResolvedValue({
      data: { trial: { public_slug: "case-test", verdict_name: "One Pump Chump" } },
      status: 200,
    });
    renderHome();
    await submitSubpoena();

    // The submission handler awaits a 2.8s UX delay alongside the invoke, so
    // the verdict state settles after that delay (real timers).
    await waitFor(() => {
      expect(screen.getByTestId("verdict-reveal")).toBeInTheDocument();
    }, { timeout: 6000 });
    expect(screen.queryByTestId("court-recess")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intake-error")).not.toBeInTheDocument();
  });

  // 8. A 200 body carrying court_recess (defensive) still routes to recess.
  it("routes a 2xx body carrying court_recess to the Court Recess UI", async () => {
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

    // The submission handler awaits a 2.8s UX delay alongside the invoke.
    await waitFor(() => {
      expect(screen.getByTestId("court-recess")).toBeInTheDocument();
    }, { timeout: 6000 });
    expect(screen.getByTestId("court-recess")).toHaveAttribute("data-recess-type", "court_recess_provider");
  });
});