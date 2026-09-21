// Wallet Court — Calibration Docket pure logic. No SDK, no network, no side
// effects. Imported by backend functions; unit-tested in isolation.
//
// This module owns: CSV/paste parsing, zero-Nansen-call preflight validation,
// wallet fingerprinting, deduplication, CAS claim filters, call-budget
// enforcement, provider-stop classification, coverage stats, and privacy
// sanitization. The backend functions do the DB work; this module does the
// decisions.

import { validateWalletForChain, NETWORKS } from "./walletValidation.ts";
import { normalizeAddress } from "./verdicts.ts";
import { sha256Hex } from "./nansenTelemetry.ts";

// ---- Constants ----

export const MAX_IMPORT = 250;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 5;
export const DEFAULT_BATCH_SIZE = 5;
export const CALIBRATION_TARGET = 1000;
export const CALIBRATION_CEILING = 1020;
export const WALLET_INTERVAL_MS = 2000;
export const AUDIT_QUERY_LIMIT = 1021; // enough to distinguish target/ceiling exactly

export const ITEM_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  REJECTED: "rejected",
  FAILED: "failed",
  STOPPED: "stopped"
} as const;

// ---- Types ----

export interface RawEntry {
  network: string;
  wallet_address: string;
  source_label: string;
  test_objective: string;
  line: number;
}

export interface PreflightAcceptedItem {
  network: string;
  wallet_address: string;
  normalized_wallet_address: string;
  wallet_fingerprint: string;
  address_short: string;
  source_label: string;
  test_objective: string;
}

export interface PreflightRejection {
  line: number;
  network: string;
  address_short: string;
  reason: string;
  code: string;
}

export interface PreflightResult {
  accepted: PreflightAcceptedItem[];
  invalid: PreflightRejection[];
  duplicate_in_file: { line: number; fingerprint: string; address_short: string }[];
  already_queued: { line: number; fingerprint: string; address_short: string }[];
  already_tried: { line: number; fingerprint: string; address_short: string }[];
  counts: {
    total: number;
    accepted: number;
    invalid: number;
    duplicate_in_file: number;
    already_queued: number;
    already_tried: number;
  };
}

export interface BudgetCheck {
  allowed: boolean;
  reason: string;
  target_reached: boolean;
  ceiling_reached: boolean;
  verified_total: number;
}

export interface StopDecision {
  stop: boolean;
  reason: string;
  failure_category: string;
}

export interface PublicDocketItem {
  docket_item_id: string;
  network: string;
  address_short: string;
  wallet_fingerprint: string;
  source_label: string;
  test_objective: string;
  status: string;
  attempt_count: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  case_slug: string | null;
  calls_before: number | null;
  calls_after: number | null;
  physical_calls_used: number | null;
  verdict_code: string | null;
  verdict_name: string | null;
  case_outcome: string | null;
  data_mode: string | null;
  failure_category: string | null;
  failure_message_safe: string | null;
  run_id: string | null;
}

// ---- CSV / paste parsing ----

// Parse a single CSV line, handling quoted fields with embedded commas/quotes.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { fields.push(current); current = ""; }
      else current += c;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

// Parse pasted/CSV text into raw entries. Detects and skips a header row
// containing "network" and "wallet".
export function parseCalibrationImport(text: string): RawEntry[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const firstFields = parseCsvLine(lines[0]);
  const isHeader = firstFields.length >= 4 &&
    firstFields[0].toLowerCase().includes("network") &&
    firstFields[1].toLowerCase().includes("wallet");
  const dataLines = isHeader ? lines.slice(1) : lines;

  const entries: RawEntry[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseCsvLine(dataLines[i]);
    entries.push({
      network: (fields[0] || "").trim(),
      wallet_address: (fields[1] || "").trim(),
      source_label: (fields[2] || "").trim(),
      test_objective: (fields[3] || "").trim(),
      line: isHeader ? i + 2 : i + 1
    });
  }
  return entries;
}

// ---- Address helpers ----

export function shortAddress(network: string, address: string): string {
  if (!address) return "";
  const a = address.trim();
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Irreversible SHA-256 fingerprint of network + ':' + normalized address.
export async function walletFingerprint(network: string, normalizedAddress: string): Promise<string> {
  return sha256Hex(network + ":" + normalizedAddress);
}

// ---- Preflight (zero Nansen calls) ----

export async function preflightEntries(
  entries: RawEntry[],
  existingQueueFingerprints: Set<string>,
  existingTrialFingerprints: Set<string>
): Promise<PreflightResult> {
  const accepted: PreflightAcceptedItem[] = [];
  const invalid: PreflightRejection[] = [];
  const duplicateInFile: PreflightResult["duplicate_in_file"] = [];
  const alreadyQueued: PreflightResult["already_queued"] = [];
  const alreadyTried: PreflightResult["already_tried"] = [];

  const seenFingerprints = new Set<string>();

  for (const entry of entries) {
    const addrShort = shortAddress(entry.network, entry.wallet_address);

    // Validate network
    if (!NETWORKS.includes(entry.network as any)) {
      invalid.push({
        line: entry.line, network: entry.network, address_short: addrShort,
        reason: "Unsupported network. Use ethereum, base, or solana.",
        code: "UNSUPPORTED_CHAIN"
      });
      continue;
    }

    // Validate address for chain (structural, zero Nansen calls)
    const validation = validateWalletForChain(entry.network, entry.wallet_address);
    if (!validation.ok) {
      invalid.push({
        line: entry.line, network: entry.network, address_short: addrShort,
        reason: validation.message || "Invalid address for chain.",
        code: validation.code || "INVALID_WALLET_FOR_CHAIN"
      });
      continue;
    }

    // Reject blank source label
    if (!entry.source_label || !entry.source_label.trim()) {
      invalid.push({
        line: entry.line, network: entry.network, address_short: addrShort,
        reason: "Source label is required.",
        code: "BLANK_SOURCE_LABEL"
      });
      continue;
    }

    // Reject blank test objective
    if (!entry.test_objective || !entry.test_objective.trim()) {
      invalid.push({
        line: entry.line, network: entry.network, address_short: addrShort,
        reason: "Test objective is required.",
        code: "BLANK_TEST_OBJECTIVE"
      });
      continue;
    }

    // Normalize and fingerprint
    const normalized = normalizeAddress(entry.network, entry.wallet_address);
    const fingerprint = await walletFingerprint(entry.network, normalized);

    // Deduplicate within file
    if (seenFingerprints.has(fingerprint)) {
      duplicateInFile.push({ line: entry.line, fingerprint, address_short: addrShort });
      continue;
    }
    seenFingerprints.add(fingerprint);

    // Deduplicate against existing queue
    if (existingQueueFingerprints.has(fingerprint)) {
      alreadyQueued.push({ line: entry.line, fingerprint, address_short: addrShort });
      continue;
    }

    // Deduplicate against existing trials
    if (existingTrialFingerprints.has(fingerprint)) {
      alreadyTried.push({ line: entry.line, fingerprint, address_short: addrShort });
      continue;
    }

    accepted.push({
      network: entry.network,
      wallet_address: entry.wallet_address.trim(),
      normalized_wallet_address: normalized,
      wallet_fingerprint: fingerprint,
      address_short: addrShort,
      source_label: entry.source_label.trim(),
      test_objective: entry.test_objective.trim()
    });
  }

  // Cap at MAX_IMPORT
  const capped = accepted.slice(0, MAX_IMPORT);

  return {
    accepted: capped,
    invalid,
    duplicate_in_file: duplicateInFile,
    already_queued: alreadyQueued,
    already_tried: alreadyTried,
    counts: {
      total: entries.length,
      accepted: capped.length,
      invalid: invalid.length,
      duplicate_in_file: duplicateInFile.length,
      already_queued: alreadyQueued.length,
      already_tried: alreadyTried.length
    }
  };
}

// ---- Call-budget enforcement ----

export function checkBudget(verifiedTotal: number): BudgetCheck {
  const target_reached = verifiedTotal >= CALIBRATION_TARGET;
  const ceiling_reached = verifiedTotal >= CALIBRATION_CEILING;
  if (ceiling_reached) {
    return { allowed: false, reason: "Absolute safety ceiling (1,020) reached. Calibration locked.", target_reached: true, ceiling_reached: true, verified_total: verifiedTotal };
  }
  if (target_reached) {
    return { allowed: false, reason: "Contest target (1,000) reached. No new calibration wallets.", target_reached: true, ceiling_reached: false, verified_total: verifiedTotal };
  }
  return { allowed: true, reason: "", target_reached: false, ceiling_reached: false, verified_total: verifiedTotal };
}

// ---- Provider-stop classification ----

// Classify the result of invoking analyzeWalletWithNansen for one wallet.
// Returns whether the batch should stop, why, and the safe failure category.
export function classifyWalletResult(
  status: number,
  data: any,
  consecutiveFailures: number
): StopDecision {
  // Court recess → provider stop (429 rate-limit, 503 provider/auth/credit)
  if (data?.court_recess) {
    const recessType = data.recess_type || "court_recess_unknown";
    return {
      stop: true,
      reason: data.sanitized_reason || `Provider stop: ${recessType}`,
      failure_category: `provider_${recessType}`
    };
  }

  // Validation error (shouldn't happen after preflight, but handle safely)
  if (status === 400) {
    return { stop: false, reason: "", failure_category: "validation" };
  }

  // Server error or invocation failure
  if (status >= 500 || (status !== 200 && !data?.trial)) {
    if (consecutiveFailures >= 2) {
      return {
        stop: true,
        reason: "Two consecutive wallet-level failures. Remaining items stay pending.",
        failure_category: "consecutive_failures"
      };
    }
    return { stop: false, reason: "", failure_category: "provider_error" };
  }

  // Success
  return { stop: false, reason: "", failure_category: "" };
}

// ---- Coverage stats ----

export interface CoverageStats {
  by_network: Record<string, number>;
  by_status: Record<string, number>;
  by_objective: Record<string, number>;
  by_verdict_family: Record<string, number>;
  live_vs_dismissed: { live: number; dismissed: number; mistrial: number };
  successful_vs_failed: { successful: number; failed: number };
  pending: number;
  completed: number;
  failed: number;
  stopped: number;
  total: number;
}

function countBy(items: any[], field: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const it of items) {
    const k = String(it[field] || "unknown");
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

export function computeCoverageStats(items: any[]): CoverageStats {
  const byStatus = countBy(items, "status");
  const completed = items.filter((i) => i.status === ITEM_STATUS.COMPLETED);
  const failed = items.filter((i) => i.status === ITEM_STATUS.FAILED);
  const stopped = items.filter((i) => i.status === ITEM_STATUS.STOPPED);

  const live = completed.filter((i) => i.case_outcome === "verdict").length;
  const dismissed = completed.filter((i) => i.case_outcome === "dismissed_no_evidence").length;
  const mistrial = completed.filter((i) => i.case_outcome === "mistrial_insufficient_evidence").length;

  // Verdict family: group by verdict_code prefix or case_outcome
  const byVerdictFamily: Record<string, number> = {};
  for (const i of completed) {
    const key = i.verdict_code || i.case_outcome || "unknown";
    byVerdictFamily[key] = (byVerdictFamily[key] || 0) + 1;
  }

  return {
    by_network: countBy(items, "network"),
    by_status: byStatus,
    by_objective: countBy(items, "test_objective"),
    by_verdict_family: byVerdictFamily,
    live_vs_dismissed: { live, dismissed, mistrial },
    successful_vs_failed: { successful: completed.length, failed: failed.length + stopped.length },
    pending: byStatus[ITEM_STATUS.PENDING] || 0,
    completed: completed.length,
    failed: failed.length,
    stopped: stopped.length,
    total: items.length
  };
}

// ---- Privacy sanitization ----

// Strip all private fields from a docket item for dashboard/export. NEVER
// includes wallet_address or normalized_wallet_address.
export function sanitizeDocketItem(item: any): PublicDocketItem {
  return {
    docket_item_id: item.docket_item_id || "",
    network: item.network || "",
    address_short: item.address_short || "",
    wallet_fingerprint: item.wallet_fingerprint || "",
    source_label: item.source_label || "",
    test_objective: item.test_objective || "",
    status: item.status || ITEM_STATUS.PENDING,
    attempt_count: item.attempt_count ?? 0,
    queued_at: item.queued_at || null,
    started_at: item.started_at || null,
    completed_at: item.completed_at || null,
    case_slug: item.case_slug || null,
    calls_before: item.calls_before ?? null,
    calls_after: item.calls_after ?? null,
    physical_calls_used: item.physical_calls_used ?? null,
    verdict_code: item.verdict_code || null,
    verdict_name: item.verdict_name || null,
    case_outcome: item.case_outcome || null,
    data_mode: item.data_mode || null,
    failure_category: item.failure_category || null,
    failure_message_safe: item.failure_message_safe || null,
    discovery_cohort: item.discovery_cohort || null,
    discovery_timeframe: item.discovery_timeframe ?? null,
    run_id: item.run_id || null
  };
}

// Fields that must NEVER appear in a sanitized docket item or dashboard response.
export const FORBIDDEN_DOCKET_FIELDS = [
  "wallet_address", "normalized_wallet_address", "address",
  "paused_by_user_id", "api_key", "authorization"
];

export function containsForbiddenDocketData(obj: any): boolean {
  if (!obj) return false;
  return FORBIDDEN_DOCKET_FIELDS.some((f) => obj[f] !== undefined);
}

// ---- CAS claim filter ----

// Build the atomic CAS filter for claiming a pending item. The caller reads
// the item's current version, then calls updateMany with this filter. If the
// item is still pending at that version, exactly one document matches and the
// caller wins the claim. If another batch already claimed it (bumping version
// and changing status), zero documents match and the caller skips it.
export function claimFilter(docketItemId: string, expectedVersion: number): Record<string, any> {
  return {
    docket_item_id: docketItemId,
    status: ITEM_STATUS.PENDING,
    version: expectedVersion
  };
}

// ---- ID generators ----

export function newDocketItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "cdi_" + crypto.randomUUID();
  }
  return "cdi_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

export function newRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "run_" + crypto.randomUUID();
  }
  return "run_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- Batch size validation ----

export function validateBatchSize(size: any): { ok: boolean; value: number; reason: string } {
  const n = parseInt(size, 10);
  if (!Number.isFinite(n)) {
    return { ok: false, value: DEFAULT_BATCH_SIZE, reason: "Batch size must be a number." };
  }
  if (n < MIN_BATCH_SIZE || n > MAX_BATCH_SIZE) {
    return { ok: false, value: DEFAULT_BATCH_SIZE, reason: `Batch size must be ${MIN_BATCH_SIZE}–${MAX_BATCH_SIZE}.` };
  }
  return { ok: true, value: n, reason: "" };
}

// ---- Batch progress display (pure, testable) ----

export interface BatchProgressState {
  done: number;
  total: number;
  current: any | null;
  isComplete: boolean;
}

// Format the batch progress banner. Never shows a numerator greater than total.
// While processing: "Processing X of Y". After completion: "Batch complete: X of Y".
// Empty/null state: show=false.
export function formatBatchProgress(state: BatchProgressState | null): { label: string; show: boolean } {
  if (!state) return { label: "", show: false };
  if (state.isComplete) {
    return { label: `Batch complete: ${Math.min(state.done, state.total)} of ${state.total}`, show: true };
  }
  if (state.current) {
    return { label: `Processing ${Math.min(state.done + 1, state.total)} of ${state.total}`, show: true };
  }
  return { label: "", show: false };
}

// ---- Coverage recommendations ----

export function coverageRecommendation(stats: CoverageStats): string[] {
  const recs: string[] = [];
  const networks = ["ethereum", "base", "solana"];
  const missing = networks.filter((n) => !stats.by_network[n]);
  if (missing.length > 0) {
    recs.push(`Add wallets on missing networks: ${missing.join(", ")}.`);
  }
  if (stats.pending === 0 && stats.completed === 0 && stats.failed === 0) {
    recs.push("Queue is empty. Import wallets to begin calibration.");
  }
  if (stats.completed > 0 && stats.live_vs_dismissed.live === 0 && stats.live_vs_dismissed.dismissed === 0 && stats.live_vs_dismissed.mistrial === 0) {
    recs.push("No live verdicts yet. Consider adding active wallets with transaction history.");
  }
  const objectiveCount = Object.keys(stats.by_objective).length;
  if (objectiveCount === 1 && stats.total > 5) {
    recs.push("All items share one test objective. Consider diversifying objectives for broader coverage.");
  }
  return recs;
}

// ---- Enhanced coverage stats with cohort and timeframe ----

export interface EnhancedCoverageStats extends CoverageStats {
  by_cohort: Record<string, number>;
  by_timeframe: Record<string, number>;
  by_verdict: Record<string, number>;
  by_case_outcome: Record<string, number>;
}

// Compute enhanced coverage stats including cohort and timeframe dimensions.
// Cohort is parsed from test_objective ("Discovered via {cohort} on {network}")
// or from the discovery_cohort field if present. Timeframe is from
// discovery_timeframe if present, otherwise "unknown".
export function computeEnhancedCoverageStats(items: any[]): EnhancedCoverageStats {
  const base = computeCoverageStats(items);
  const byCohort: Record<string, number> = {};
  const byTimeframe: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  const byCaseOutcome: Record<string, number> = {};

  for (const it of items) {
    // Cohort: prefer discovery_cohort, fallback to parsing test_objective
    let cohort = it.discovery_cohort || "unknown";
    if (!it.discovery_cohort && it.test_objective) {
      const m = it.test_objective.match(/Discovered via (\w+) on/);
      if (m) cohort = m[1];
    }
    byCohort[cohort] = (byCohort[cohort] || 0) + 1;

    // Timeframe: prefer discovery_timeframe, fallback to "unknown"
    const tf = it.discovery_timeframe != null ? String(it.discovery_timeframe) : "unknown";
    byTimeframe[tf] = (byTimeframe[tf] || 0) + 1;

    // Verdict and case outcome (only for completed items)
    if (it.status === ITEM_STATUS.COMPLETED) {
      const verdict = it.verdict_code || it.verdict_name || "none";
      byVerdict[verdict] = (byVerdict[verdict] || 0) + 1;
      const outcome = it.case_outcome || "unknown";
      byCaseOutcome[outcome] = (byCaseOutcome[outcome] || 0) + 1;
    }
  }

  return {
    ...base,
    by_cohort: byCohort,
    by_timeframe: byTimeframe,
    by_verdict: byVerdict,
    by_case_outcome: byCaseOutcome
  };
}

// Coverage recommendations for campaign planning. Suggests missing networks
// and timeframes. These are recommendations only — never automatically run.
export function campaignPlanningRecommendations(stats: EnhancedCoverageStats): string[] {
  const recs: string[] = [];
  const networks = ["ethereum", "base", "solana"];
  const missing = networks.filter((n) => !stats.by_network[n]);
  if (missing.length > 0) {
    recs.push(`Missing networks: ${missing.join(", ")}. Consider discovering candidates on these chains.`);
  }

  // Suggest discovery sequence: 30-day first, then longer timeframes
  const timeframes = [30, 90, 180];
  const coveredTimeframes = new Set(Object.keys(stats.by_timeframe).filter((t) => t !== "unknown"));
  const missingTimeframes = timeframes.filter((t) => !coveredTimeframes.has(String(t)));
  if (missingTimeframes.length > 0 && stats.completed > 0) {
    recs.push(`Consider discovering with longer timeframes: ${missingTimeframes.map((t) => `${t}d`).join(", ")} to find additional unique candidates.`);
  }

  // Suggest cohorts that haven't been discovered yet
  const allCohorts = ["top_performers", "bottom_performers", "high_activity", "lower_activity"];
  const coveredCohorts = new Set(Object.keys(stats.by_cohort).filter((c) => c !== "unknown"));
  const missingCohorts = allCohorts.filter((c) => !coveredCohorts.has(c));
  if (missingCohorts.length > 0 && stats.completed > 0) {
    recs.push(`Unexplored cohorts: ${missingCohorts.join(", ")}.`);
  }

  // Network balance
  const networkCounts = networks.map((n) => stats.by_network[n] || 0);
  const maxCount = Math.max(...networkCounts);
  const minCount = Math.min(...networkCounts);
  if (maxCount > 0 && minCount === 0) {
    recs.push("Network coverage is unbalanced. Add wallets on underrepresented chains.");
  }

  return recs;
}