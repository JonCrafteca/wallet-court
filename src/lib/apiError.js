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
  const message = raw && raw !== "Request failed" ? raw : fallback;
  return { message, code: null, status };
}