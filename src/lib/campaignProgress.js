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

// Average physical Nansen calls per wallet analysis (4 profiler endpoints).
export const AVG_CALLS_PER_WALLET = 4;

export function estimateCalls(walletCount) {
  return walletCount * AVG_CALLS_PER_WALLET;
}