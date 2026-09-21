// Wallet Court — Calibration Campaign Runner pure logic. No SDK, no network,
// no side effects. Imported by backend functions; unit-tested in isolation.
//
// This module owns: campaign size validation, status transitions, progress
// formatting (never shows impossible states), run sanitization, privacy guards,
// and the "should campaign continue" decision tree.

import { CALIBRATION_TARGET, CALIBRATION_CEILING, checkBudget } from "./calibration.ts";

// ---- Constants ----

export const CAMPAIGN_SIZES = [5, 10, 25, 50] as const;
export const ALL_WALLETS = null; // max_wallets = null means "all currently approved"

export const CAMPAIGN_STATUS = {
  READY: "ready",
  RUNNING: "running",
  PAUSING: "pausing",
  PAUSED: "paused",
  COMPLETED: "completed",
  STOPPED: "stopped",
  TARGET_REACHED: "target_reached",
  CEILING_REACHED: "ceiling_reached",
  CIRCUIT_OPEN: "circuit_open",
  ERROR: "error"
} as const;

export const TERMINAL_STATUSES = new Set<string>([
  CAMPAIGN_STATUS.COMPLETED,
  CAMPAIGN_STATUS.STOPPED,
  CAMPAIGN_STATUS.TARGET_REACHED,
  CAMPAIGN_STATUS.CEILING_REACHED,
  CAMPAIGN_STATUS.CIRCUIT_OPEN,
  CAMPAIGN_STATUS.ERROR
]);

export const ACTIVE_STATUSES = new Set<string>([
  CAMPAIGN_STATUS.RUNNING,
  CAMPAIGN_STATUS.PAUSING,
  CAMPAIGN_STATUS.PAUSED
]);

// Average physical Nansen calls per wallet analysis (4 profiler endpoints).
export const AVG_CALLS_PER_WALLET = 4;

// ---- Types ----

export interface CampaignRun {
  run_id: string;
  status: string;
  max_wallets: number | null;
  wallets_selected: number;
  wallets_completed: number;
  wallets_succeeded: number;
  wallets_dismissed: number;
  wallets_mistrial: number;
  wallets_failed: number;
  campaign_calls_used: number;
  current_item_id: string | null;
  current_address_short: string | null;
  current_network: string | null;
  current_result: string | null;
  current_calls_used: number | null;
  stop_reason: string | null;
  version: number;
  started_at: string;
  updated_at: string | null;
  completed_at: string | null;
  started_by_user_id: string | null;
}

export interface PublicCampaignRun {
  run_id: string;
  status: string;
  max_wallets: number | null;
  wallets_selected: number;
  wallets_completed: number;
  wallets_succeeded: number;
  wallets_dismissed: number;
  wallets_mistrial: number;
  wallets_failed: number;
  campaign_calls_used: number;
  current_item_id: string | null;
  current_address_short: string | null;
  current_network: string | null;
  current_result: string | null;
  current_calls_used: number | null;
  stop_reason: string | null;
  started_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface CampaignProgress {
  verified_total: number;
  target: number;
  ceiling: number;
  remaining_to_target: number;
  campaign_wallets_completed: number;
  campaign_wallets_selected: number;
  current_address_short: string | null;
  current_network: string | null;
  current_result: string | null;
  current_calls_used: number | null;
  campaign_calls_used: number;
  wallets_succeeded: number;
  wallets_dismissed: number;
  wallets_mistrial: number;
  wallets_failed: number;
  pending_queue: number;
  estimated_calls_remaining: number;
  status: string;
  stop_reason: string | null;
}

// ---- Validation ----

export function validateCampaignSize(size: any): { ok: boolean; value: number | null; reason: string } {
  if (size === null || size === undefined || size === "all") {
    return { ok: true, value: null, reason: "" };
  }
  const n = parseInt(size, 10);
  if (!Number.isFinite(n)) {
    return { ok: false, value: null, reason: "Campaign size must be a number or 'all'." };
  }
  if (!CAMPAIGN_SIZES.includes(n as any)) {
    return { ok: false, value: null, reason: `Campaign size must be ${CAMPAIGN_SIZES.join(", ")} or 'all'.` };
  }
  return { ok: true, value: n, reason: "" };
}

// ---- Status transitions ----

// Determine if a campaign can transition from one status to another.
export function canTransitionTo(currentStatus: string, newStatus: string): boolean {
  // Terminal statuses can only transition to "error" (recovery) or stay terminal.
  if (TERMINAL_STATUSES.has(currentStatus) && newStatus !== CAMPAIGN_STATUS.ERROR) {
    return false;
  }
  // Ready → running
  if (currentStatus === CAMPAIGN_STATUS.READY && newStatus === CAMPAIGN_STATUS.RUNNING) return true;
  // Running → pausing, paused, completed, stopped, target_reached, ceiling_reached, circuit_open, error
  if (currentStatus === CAMPAIGN_STATUS.RUNNING) {
    return [
      CAMPAIGN_STATUS.PAUSING,
      CAMPAIGN_STATUS.PAUSED,
      CAMPAIGN_STATUS.COMPLETED,
      CAMPAIGN_STATUS.STOPPED,
      CAMPAIGN_STATUS.TARGET_REACHED,
      CAMPAIGN_STATUS.CEILING_REACHED,
      CAMPAIGN_STATUS.CIRCUIT_OPEN,
      CAMPAIGN_STATUS.ERROR
    ].includes(newStatus as any);
  }
  // Pausing → paused, stopped, completed, target_reached, ceiling_reached, circuit_open, error
  if (currentStatus === CAMPAIGN_STATUS.PAUSING) {
    return [
      CAMPAIGN_STATUS.PAUSED,
      CAMPAIGN_STATUS.STOPPED,
      CAMPAIGN_STATUS.COMPLETED,
      CAMPAIGN_STATUS.TARGET_REACHED,
      CAMPAIGN_STATUS.CEILING_REACHED,
      CAMPAIGN_STATUS.CIRCUIT_OPEN,
      CAMPAIGN_STATUS.ERROR
    ].includes(newStatus as any);
  }
  // Paused → running (resume), stopped, error
  if (currentStatus === CAMPAIGN_STATUS.PAUSED) {
    return [CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.STOPPED, CAMPAIGN_STATUS.ERROR].includes(newStatus as any);
  }
  return false;
}

// ---- Should campaign continue? ----

export interface ContinueDecision {
  shouldContinue: boolean;
  newStatus: string | null;
  stopReason: string;
}

// Decide whether the campaign should claim the next wallet. Checks budget,
// circuit, max_wallets, and the current run status.
export function shouldCampaignContinue(
  run: CampaignRun,
  verifiedTotal: number,
  circuitOpen: boolean,
  pendingCount: number
): ContinueDecision {
  // If the admin requested pause, stop after current wallet.
  if (run.status === CAMPAIGN_STATUS.PAUSING) {
    return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.PAUSED, stopReason: "Paused by admin after current wallet." };
  }

  // If the admin requested stop, stop immediately.
  if (run.status === CAMPAIGN_STATUS.STOPPED) {
    return { shouldContinue: false, newStatus: null, stopReason: "Stopped by admin." };
  }

  // If the run is already in a terminal status, don't continue.
  if (TERMINAL_STATUSES.has(run.status)) {
    return { shouldContinue: false, newStatus: null, stopReason: run.stop_reason || "Campaign is in a terminal state." };
  }

  // Budget check: if target or ceiling reached, stop.
  const budget = checkBudget(verifiedTotal);
  if (!budget.allowed) {
    if (budget.ceiling_reached) {
      return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.CEILING_REACHED, stopReason: budget.reason };
    }
    return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.TARGET_REACHED, stopReason: budget.reason };
  }

  // Circuit check: if the provider circuit is open, pause.
  if (circuitOpen) {
    return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.CIRCUIT_OPEN, stopReason: "Provider is in Court Recess." };
  }

  // Max wallets check: if we've processed the max, complete.
  if (run.max_wallets !== null && run.wallets_completed >= run.max_wallets) {
    return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.COMPLETED, stopReason: `Completed ${run.max_wallets} wallets.` };
  }

  // No more pending items: complete.
  if (pendingCount === 0) {
    return { shouldContinue: false, newStatus: CAMPAIGN_STATUS.COMPLETED, stopReason: "No more pending wallets in the queue." };
  }

  return { shouldContinue: true, newStatus: null, stopReason: "" };
}

// ---- Progress formatting ----

// Build the campaign progress object for the frontend. Never shows a numerator
// greater than its denominator. Never shows impossible states like
// "Processing 2 of 1".
export function formatCampaignProgress(
  run: CampaignRun,
  verifiedTotal: number,
  pendingCount: number
): CampaignProgress {
  const remainingToTarget = Math.max(0, CALIBRATION_TARGET - verifiedTotal);
  const selected = run.wallets_selected;
  const completed = Math.min(run.wallets_completed, selected); // never exceed selected

  // Estimated calls remaining: remaining wallets × avg calls per wallet.
  // If max_wallets is null, use pending count as the remaining.
  const remainingWallets = run.max_wallets !== null
    ? Math.max(0, run.max_wallets - completed)
    : pendingCount;
  const estimatedCallsRemaining = remainingWallets * AVG_CALLS_PER_WALLET;

  return {
    verified_total: verifiedTotal,
    target: CALIBRATION_TARGET,
    ceiling: CALIBRATION_CEILING,
    remaining_to_target: remainingToTarget,
    campaign_wallets_completed: completed,
    campaign_wallets_selected: selected,
    current_address_short: run.current_address_short || null,
    current_network: run.current_network || null,
    current_result: run.current_result || null,
    current_calls_used: run.current_calls_used ?? null,
    campaign_calls_used: run.campaign_calls_used || 0,
    wallets_succeeded: run.wallets_succeeded || 0,
    wallets_dismissed: run.wallets_dismissed || 0,
    wallets_mistrial: run.wallets_mistrial || 0,
    wallets_failed: run.wallets_failed || 0,
    pending_queue: pendingCount,
    estimated_calls_remaining: estimatedCallsRemaining,
    status: run.status,
    stop_reason: run.stop_reason || null
  };
}

// ---- Sanitization ----

export const FORBIDDEN_CAMPAIGN_FIELDS = [
  "wallet_address",
  "normalized_wallet_address",
  "address",
  "started_by_user_id",
  "api_key",
  "authorization",
  "body",
  "request_body",
  "response_body"
];

export function containsForbiddenCampaignData(obj: any): boolean {
  if (!obj) return false;
  return FORBIDDEN_CAMPAIGN_FIELDS.some((f) => obj[f] !== undefined);
}

export function sanitizeCampaignRun(run: any): PublicCampaignRun {
  return {
    run_id: run.run_id || "",
    status: run.status || CAMPAIGN_STATUS.READY,
    max_wallets: run.max_wallets ?? null,
    wallets_selected: run.wallets_selected ?? 0,
    wallets_completed: run.wallets_completed ?? 0,
    wallets_succeeded: run.wallets_succeeded ?? 0,
    wallets_dismissed: run.wallets_dismissed ?? 0,
    wallets_mistrial: run.wallets_mistrial ?? 0,
    wallets_failed: run.wallets_failed ?? 0,
    campaign_calls_used: run.campaign_calls_used ?? 0,
    current_item_id: run.current_item_id || null,
    current_address_short: run.current_address_short || null,
    current_network: run.current_network || null,
    current_result: run.current_result || null,
    current_calls_used: run.current_calls_used ?? null,
    stop_reason: run.stop_reason || null,
    started_at: run.started_at || "",
    updated_at: run.updated_at || null,
    completed_at: run.completed_at || null
  };
}

// ---- ID generation ----

export function newCampaignId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "camp_" + crypto.randomUUID();
  }
  return "camp_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function newDiscoveryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "disc_" + crypto.randomUUID();
  }
  return "disc_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- Wallet result classification for campaign counters ----

export interface WalletResultCounters {
  succeeded: boolean;
  dismissed: boolean;
  mistrial: boolean;
  failed: boolean;
  callsUsed: number;
  resultLabel: string;
}

// Classify a wallet processing result into campaign counter increments.
// Pure: takes the processCalibrationWallet response data and returns counters.
export function classifyWalletForCampaign(data: any): WalletResultCounters {
  const status = data?.status || "failed";
  const callsUsed = typeof data?.physical_calls_used === "number" ? data.physical_calls_used : 0;

  if (status === "completed") {
    const outcome = data?.case_outcome || "verdict";
    if (outcome === "dismissed_no_evidence") {
      return { succeeded: false, dismissed: true, mistrial: false, failed: false, callsUsed, resultLabel: "Dismissed" };
    }
    if (outcome === "mistrial_insufficient_evidence") {
      return { succeeded: false, dismissed: false, mistrial: true, failed: false, callsUsed, resultLabel: "Mistrial" };
    }
    // verdict
    return {
      succeeded: true,
      dismissed: false,
      mistrial: false,
      failed: false,
      callsUsed,
      resultLabel: data?.verdict_name || "Verdict"
    };
  }

  // failed, stopped, or error
  return {
    succeeded: false,
    dismissed: false,
    mistrial: false,
    failed: true,
    callsUsed,
    resultLabel: data?.failure_message_safe || "Failed"
  };
}