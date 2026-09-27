// Regression tests for extractAnalysisError — the helper that prevents a
// structured backend Court Recess (or error) from being reduced to the generic
// axios message "Request failed with status code 503".
//
// Pure: no React, no network, no SDK. Tests every axios/SDK error shape the
// submission handler can receive.

import { describe, it, expect } from "vitest";
import { extractApiError, extractAnalysisError } from "../src/lib/apiError.js";

// Mimic the AxiosError shape the SDK throws on a non-2xx response: the parsed
// JSON body lives at error.response.data, with response.status and message.
function axiosError(status: number, data: any) {
  const e: any = new Error("Request failed with status code " + status);
  e.response = { status, data };
  return e;
}

describe("extractAnalysisError — Court Recess payload", () => {
  it("extracts court_recess from a 503 axios error", () => {
    const e = axiosError(503, {
      court_recess: true,
      recess_type: "court_recess_unknown",
      sanitized_reason: "Provider returned an unexpected response.",
      retry_after: "2026-09-27T16:56:55.838Z",
      retry_in_seconds: 20,
      http_status: 503,
    });
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("recess");
    expect(result.recess).toEqual({
      court_recess: true,
      recess_type: "court_recess_unknown",
      sanitized_reason: "Provider returned an unexpected response.",
      retry_after: "2026-09-27T16:56:55.838Z",
      retry_in_seconds: 20,
      http_status: 503,
    });
  });

  it("extracts court_recess from a 429 rate-limit axios error", () => {
    const e = axiosError(429, {
      court_recess: true,
      recess_type: "court_recess_rate_limit",
      sanitized_reason: "Provider rate limit reached.",
      retry_after: "2026-09-27T17:00:00.000Z",
      retry_in_seconds: 60,
      http_status: 429,
    });
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("recess");
    expect(result.recess.recess_type).toBe("court_recess_rate_limit");
    expect(result.recess.http_status).toBe(429);
  });

  it("extracts court_recess from the e.data SDK-wrapper shape", () => {
    // Some SDK wrappers expose the body at e.data instead of e.response.data.
    const e: any = new Error("Request failed with status code 503");
    e.data = {
      court_recess: true,
      recess_type: "court_recess_provider",
      sanitized_reason: "Provider temporarily unavailable.",
      retry_after: "2026-09-27T16:57:05.838Z",
      retry_in_seconds: 30,
      http_status: 503,
    };
    e.status = 503;
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("recess");
    expect(result.recess.recess_type).toBe("court_recess_provider");
    expect(result.recess.http_status).toBe(503);
  });

  it("falls back to e.response.status for http_status when body omits it", () => {
    const e = axiosError(503, {
      court_recess: true,
      recess_type: "court_recess_unknown",
      sanitized_reason: "Provider returned an unexpected response.",
      retry_after: "2026-09-27T16:56:55.838Z",
      retry_in_seconds: 20,
    });
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("recess");
    expect(result.recess.http_status).toBe(503);
  });

  it("never returns the raw axios message for a court_recess 503", () => {
    const e = axiosError(503, {
      court_recess: true,
      recess_type: "court_recess_unknown",
      sanitized_reason: "Provider returned an unexpected response.",
      retry_after: "2026-09-27T16:56:55.838Z",
      retry_in_seconds: 20,
      http_status: 503,
    });
    const result = extractAnalysisError(e);
    expect(result.kind).not.toBe("error");
    expect(JSON.stringify(result)).not.toContain("Request failed with status code");
  });
});

describe("extractAnalysisError — structured errors", () => {
  it("extracts { error, code } from a 503 axios error", () => {
    const e = axiosError(503, { error: "Provider outage.", code: "PROVIDER_OUTAGE" });
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("error");
    expect(result.message).toBe("Provider outage. [PROVIDER_OUTAGE]");
    expect(result.code).toBe("PROVIDER_OUTAGE");
    expect(result.status).toBe(503);
  });

  it("extracts { error, code } from a 400 validation error", () => {
    const e = axiosError(400, {
      error: "That does not look like a valid Solana address.",
      code: "INVALID_WALLET_FOR_CHAIN",
      chain: "solana",
    });
    const result = extractAnalysisError(e);
    expect(result.kind).toBe("error");
    expect(result.message).toContain("does not look like a valid Solana address");
    expect(result.code).toBe("INVALID_WALLET_FOR_CHAIN");
    expect(result.status).toBe(400);
  });

  it("uses the fallback for a plain Error with no response", () => {
    const e = new Error("network failure");
    const result = extractAnalysisError(e, "The court failed to convene. Try again.");
    expect(result.kind).toBe("error");
    expect(result.message).toBe("network failure");
    expect(result.code).toBeNull();
    expect(result.status).toBeNull();
  });

  it("uses the fallback for a bare axios message", () => {
    const e = new Error("Request failed with status code 503");
    const result = extractAnalysisError(e, "The court failed to convene. Try again.");
    expect(result.kind).toBe("error");
    // The raw axios message is suppressed in favor of the fallback.
    expect(result.message).toBe("The court failed to convene. Try again.");
  });

  it("uses the fallback for a null/undefined error", () => {
    expect(extractAnalysisError(null).message).toBe("The court failed to convene. Try again.");
    expect(extractAnalysisError(undefined).kind).toBe("error");
  });
});

describe("extractApiError — backward compatibility", () => {
  it("still extracts { error, code } from axios errors", () => {
    const e = axiosError(400, { error: "bad wallet", code: "INVALID_WALLET_FOR_CHAIN" });
    const result = extractApiError(e, "fallback");
    expect(result.message).toBe("bad wallet [INVALID_WALLET_FOR_CHAIN]");
    expect(result.code).toBe("INVALID_WALLET_FOR_CHAIN");
    expect(result.status).toBe(400);
  });
});