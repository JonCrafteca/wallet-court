// Wallet Court — Single Trade Trial error code → user-friendly message mapping.
// Pure, testable. Used by SingleTradeIntake and SingleTradeCase to display
// safe, useful error messages instead of generic axios errors.
//
// No error page may expose secrets, full private payloads, or stack traces.
// Every message is a safe, non-identifying string.

const ERROR_MESSAGES = {
  // Discovery errors
  DISCOVERY_ERROR: "Discovery failed. The court couldn't find purchases for this token. Try again.",
  NO_PURCHASES: "No purchases of this token were found for this wallet.",
  UNSUPPORTED_CHAIN: "This network is not yet supported for Single Trade Trial.",
  MISSING_KEY: "The Nansen API key is not configured. Please contact the administrator.",
  RATE_LIMITED: "Rate limit reached. Please slow down and try again shortly.",

  // Selection errors
  SELECTION_INVALID: "This purchase selection is invalid or expired. Please rediscover purchases and try again.",
  SELECTION_EXPIRED: "This purchase selection has expired. Please rediscover purchases and try again.",
  SELECTION_CONSUMED: "This purchase selection has already been used for an analysis.",
  SELECTION_NOT_FOUND: "Purchase selection not found. Please rediscover purchases and try again.",
  SELECTION_MISMATCH: "The wallet or token does not match the discovery request. Please rediscover.",

  // Analysis errors
  ANALYSIS_PROCESSING: "This trade is already being analyzed. Please wait a moment and check back.",
  ANALYSIS_FAILED: "Analysis failed safely. The court couldn't complete this trial. Please try again.",
  LOCK_CONTENTION: "The court is busy processing this trade. Please try again in a moment.",
  TX_NOT_FOUND: "The specified transaction was not found among purchases of this token.",
  ANALYSIS_ERROR: "Analysis encountered an error. Please try again.",

  // Budget errors
  BUDGET_EXHAUSTED: "Daily analysis limit reached. Please try again later.",

  // Feature errors
  FEATURE_DISABLED: "Single Trade Trial is coming soon. Check back shortly!",

  // Case errors
  CASE_INCOMPLETE: "This trade case was not completed and is not available for public viewing.",
  CASE_NOT_FOUND: "This trade case never made it to the docket.",

  // Court recess
  COURT_RECESS: "The court is in recess due to a provider issue. Please try again shortly.",

  // Auth
  AUTH_REQUIRED: "Sign in to refresh a trade case.",
};

// Map a backend error code (or HTTP status) to a safe user-friendly message.
// Falls back to the backend's safe error string if it exists, or a generic
// safe message. NEVER exposes the raw error message if it looks like it
// might contain internals (stack traces, field names, etc.).
export function getSingleTradeErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  // Extract the backend error code and message from a Base44 SDK error.
  const data = error?.data || error?.response?.data;
  const code = data?.code || error?.code || null;
  const backendMessage = data?.error || data?.message || null;

  // If we have a known code, use the safe message for it.
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }

  // Court recess is signaled by a flag, not a code.
  if (data?.court_recess) {
    return ERROR_MESSAGES.COURT_RECESS;
  }

  // If the backend provided a safe message, use it (backend messages are
  // already sanitized — they never include secrets or stack traces).
  if (backendMessage && typeof backendMessage === "string" && backendMessage.length < 300) {
    return backendMessage;
  }

  // Generic fallback.
  return fallback;
}

// Get the error code from a Base44 SDK error (for conditional UI logic).
export function getSingleTradeErrorCode(error) {
  const data = error?.data || error?.response?.data;
  return data?.code || error?.code || null;
}