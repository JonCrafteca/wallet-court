// Frontend helper for campaign progress formatting. Mirrors the backend
// formatCampaignProgress but works with the sanitized DTO returned by
// getCalibrationCampaign / advanceCalibrationCampaign.

export const CAMPAIGN_SIZES = [5, 10, 25, 50];
export const ALL_WALLETS = null;

export const CAMPAIGN_STATUS_LABELS = {
  ready: "Ready",
  running: "Running",
  pausing: "Pausing…",
  paused: "Paused",
  stopping: "Stopping…",
  completed: "Completed",
  stopped: "Stopped",
  target_reached: "Target Reached",
  ceiling_reached: "Ceiling Reached",
  circuit_open: "Circuit Open",
  error: "Error"
};

export const CAMPAIGN_STATUS_COLORS = {
  ready: "text-court-mute",
  running: "text-court-chart",
  pausing: "text-yellow-400",
  paused: "text-yellow-400",
  stopping: "text-orange-400",
  completed: "text-court-chart",
  stopped: "text-court-red",
  target_reached: "text-court-chart",
  ceiling_reached: "text-court-red",
  circuit_open: "text-court-red",
  error: "text-court-red"
};

export const TERMINAL_STATUSES = new Set([
  "completed", "stopped", "target_reached", "ceiling_reached", "circuit_open", "error"
]);

export const ACTIVE_STATUSES = new Set(["running", "pausing", "paused", "stopping"]);

// Never show a numerator greater than its denominator.
export function safeProgress(done, total) {
  if (!total || total <= 0) return { done: 0, total: 0, label: "0 of 0" };
  const safeDone = Math.min(done, total);
  return { done: safeDone, total, label: `${safeDone} of ${total}` };
}

// The progress denominator is the campaign's immutable original wallet total
// (max_wallets). For "all approved" (max_wallets = null), fall back to
// wallets_selected as the best available denominator. Never derive the
// denominator from completed results or currently loaded result rows.
export function campaignProgressTotal(campaign) {
  if (!campaign) return 0;
  if (campaign.max_wallets != null) return campaign.max_wallets;
  return campaign.wallets_selected || 0;
}

// Classify a campaign status for stop-reason treatment.
// "success" = completed or target_reached (lime/chartreuse).
// "error" = error, circuit_open, or ceiling_reached (red — failed/error/safety-halt).
// "warning" = stopped (neutral — admin action, not an error).
export function isSuccessStatus(status) {
  return status === "completed" || status === "target_reached";
}

export function isErrorStatus(status) {
  return status === "error" || status === "circuit_open" || status === "ceiling_reached";
}

// Average physical Nansen calls per wallet analysis (4 profiler endpoints).
export const AVG_CALLS_PER_WALLET = 4;

export function estimateCalls(walletCount) {
  return walletCount * AVG_CALLS_PER_WALLET;
}