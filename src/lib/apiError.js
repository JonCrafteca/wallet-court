// Extract a useful message + code from a base44 functions.invoke error.
// The SDK uses axios, which throws an AxiosError on non-2xx responses with the
// parsed JSON body at error.response.data. Backend functions return
// { error, code, status } in that body. Without this helper, callers only see
// the generic axios message "Request failed with status code 400".
export function extractApiError(e, fallback = "Request failed.") {
  const data = e?.response?.data;
  if (data && typeof data === "object") {
    const message = data.error || data.message || data.detail;
    if (message) {
      const code = data.code || null;
      const status = e?.response?.status ?? data.status ?? null;
      const text = code ? `${String(message)} [${code}]` : String(message);
      return { message: text, code, status };
    }
  }
  const status = e?.response?.status ?? null;
  const raw = e?.message;
  // Suppress the generic axios default message ("Request failed with status
  // code NNN") — it carries no useful information and is never what the visitor
  // should see. Any structured body was already handled above; reaching here
  // means there was no parseable body, so use the caller's fallback.
  const isAxiosDefault = typeof raw === "string" && /^Request failed with status code \d+$/.test(raw);
  const message = raw && !isAxiosDefault ? raw : fallback;
  return { message, code: null, status };
}

// Extract a Court Recess payload OR a safe inline error from a base44
// functions.invoke failure. The SDK uses axios, which throws an AxiosError on
// non-2xx responses with the parsed JSON body at error.response.data.
//
// Backend Court Recess responses (analyzeWalletWithNansen) carry:
//   { court_recess: true, recess_type, sanitized_reason, retry_after,
//     retry_in_seconds, http_status }
// Without this helper, a 503 Court Recess surfaces as the generic axios message
// "Request failed with status code 503" and the structured payload — including
// the retry window the Court Recess UI needs — is lost.
//
// Checks every shape the SDK/axios can produce: e.response.data, e.data,
// e.response.status, e.status. Returns one of:
//   { kind: "recess", recess: { court_recess, recess_type, sanitized_reason,
//     retry_after, retry_in_seconds, http_status } }  — route to Court Recess UI
//   { kind: "error", message, code, status } — show a safe inline error
export function extractAnalysisError(e, fallback = "The court failed to convene. Try again.") {
  const body = e?.response?.data ?? e?.data ?? null;
  if (body && typeof body === "object" && body.court_recess) {
    return {
      kind: "recess",
      recess: {
        court_recess: true,
        recess_type: body.recess_type || null,
        sanitized_reason: body.sanitized_reason || null,
        retry_after: body.retry_after || null,
        retry_in_seconds: body.retry_in_seconds ?? null,
        http_status: body.http_status ?? e?.response?.status ?? e?.status ?? null,
      },
    };
  }
  const { message, code, status } = extractApiError(e, fallback);
  return { kind: "error", message, code, status };
}