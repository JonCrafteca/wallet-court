// Wallet Court — Candidate Discovery pure logic. No SDK, no network, no side
// effects. Imported by backend functions; unit-tested in isolation.
//
// This module owns: discovery request building for the Nansen Smart Money PnL
// Leaderboard, response parsing, label-based screening, deduplication,
// query fingerprinting, privacy sanitization, and cohort mapping. The backend
// functions do the DB work and the Nansen call; this module does the decisions.

import { sha256Hex } from "./nansenTelemetry.ts";
import { normalizeAddress } from "./verdicts.ts";
import { validateWalletForChain } from "./walletValidation.ts";
import { NETWORKS } from "./chains.ts";
import { shortAddress, walletFingerprint, checkBudget, CALIBRATION_TARGET, CALIBRATION_CEILING } from "./calibration.ts";

// ---- Constants ----

export const DISCOVERY_ENDPOINT_KEY = "pnl_leaderboard";
export const DISCOVERY_WORKFLOW = "calibration_discovery";

export const DISCOVERY_TIMEFRAMES = [1, 7, 30, 90, 180] as const;
export const DEFAULT_TIMEFRAME = 30;
export const MAX_DISCOVERY_LIMIT = 50;
export const DEFAULT_DISCOVERY_LIMIT = 20;
export const MIN_DISCOVERY_LIMIT = 1;

export const COHORTS = [
  "top_performers",
  "bottom_performers",
  "high_activity",
  "lower_activity"
] as const;
export type Cohort = typeof COHORTS[number];

// Smart Money label filter types supported by the API.
export const SMART_MONEY_LABELS = [
  "Fund",
  "Smart Trader",
  "30D Smart Trader",
  "90D Smart Trader",
  "180D Smart Trader",
  "Smart HL Perps Trader"
];

// ---- Types ----

export interface DiscoveryRequest {
  network: string;
  cohort: Cohort;
  timeframe: number;
  limit: number;
}

export interface RawLeaderboardEntry {
  address: string;
  address_label: string | null;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  total_pnl_usd: number;
  avg_trade_roi: number | null;
  roi_percent_unrealised: number | null;
  win_rate: number | null;
  n_trades: number;
  n_tokens: number;
  open_trades: number;
  held_tokens_count: number;
}

export interface ParsedCandidate {
  network: string;
  wallet_address: string;
  normalized_wallet_address: string;
  wallet_fingerprint: string;
  address_short: string;
  wallet_class: string;
  ranking_metrics: Record<string, number | null>;
  cohort: Cohort;
}

export interface ScreeningResult {
  eligible: ParsedCandidate[];
  excluded_services: ParsedCandidate[];
  needs_review: ParsedCandidate[];
}

export interface DedupResult {
  unique: ParsedCandidate[];
  duplicate_in_batch: ParsedCandidate[];
  already_candidate: ParsedCandidate[];
  already_queued: ParsedCandidate[];
  already_tried: ParsedCandidate[];
}

export interface DiscoveryOutcome {
  total_returned: number;
  eligible: number;
  excluded_services: number;
  needs_review: number;
  duplicate_in_batch: number;
  already_candidate: number;
  already_queued: number;
  already_tried: number;
  stored: number;
  candidates: PublicCandidate[];
}

export interface PublicCandidate {
  candidate_id: string;
  address_short: string;
  wallet_fingerprint: string;
  network: string;
  source_endpoint: string;
  wallet_class: string;
  ranking_metrics: Record<string, number | null>;
  cohort: string;
  review_status: string;
  skip_reason: string | null;
  discovered_at: string | null;
  screening: string;
  version: number;
}

// ---- Cohort → order_by mapping ----

export function cohortOrderBy(cohort: Cohort): { field: string; direction: string }[] {
  switch (cohort) {
    case "top_performers":
      return [{ field: "total_pnl_usd", direction: "DESC" }];
    case "bottom_performers":
      return [{ field: "total_pnl_usd", direction: "ASC" }];
    case "high_activity":
      return [{ field: "n_trades", direction: "DESC" }];
    case "lower_activity":
      return [{ field: "n_trades", direction: "ASC" }];
    default:
      return [{ field: "total_pnl_usd", direction: "DESC" }];
  }
}

// ---- Request building ----

export function buildDiscoveryRequest(req: DiscoveryRequest): Record<string, any> {
  return {
    chains: [req.network],
    timeframe: req.timeframe,
    pagination: { page: 1, per_page: req.limit },
    order_by: cohortOrderBy(req.cohort)
  };
}

// ---- Validation ----

export function validateDiscoveryRequest(req: Partial<DiscoveryRequest>): { ok: boolean; reason: string; value: DiscoveryRequest | null } {
  if (!req.network || !NETWORKS.includes(req.network as string)) {
    return { ok: false, reason: "Network must be one of: " + NETWORKS.join(", ") + ".", value: null };
  }
  if (!req.cohort || !COHORTS.includes(req.cohort as Cohort)) {
    return { ok: false, reason: "Invalid cohort.", value: null };
  }
  const tf = parseInt(String(req.timeframe), 10);
  if (!Number.isFinite(tf) || !DISCOVERY_TIMEFRAMES.includes(tf as any)) {
    return { ok: false, reason: "Timeframe must be 1, 7, 30, 90, or 180 days.", value: null };
  }
  const limit = parseInt(String(req.limit), 10);
  if (!Number.isFinite(limit) || limit < MIN_DISCOVERY_LIMIT || limit > MAX_DISCOVERY_LIMIT) {
    return { ok: false, reason: `Limit must be ${MIN_DISCOVERY_LIMIT}–${MAX_DISCOVERY_LIMIT}.`, value: null };
  }
  return { ok: true, reason: "", value: { network: req.network as string, cohort: req.cohort as Cohort, timeframe: tf, limit } };
}

// ---- Label-based screening ----

// Keyword sets for classifying a single address_label string from the Smart
// Money PnL Leaderboard. Case-insensitive substring matching.
const LABEL_KEYWORDS_SCREEN = {
  mev_bot: ["mev", "sandwich", "flashbot", "flashbots", "arbitrage bot", "front-run", "frontrun", "back-run", "backrun", "searcher", "bundle"],
  cex_exchange: ["binance", "coinbase", "okx", "kraken", "bybit", "bitget", "gate.io", "huobi", "kucoin", "crypto.com", "exchange", "cex", "hot wallet", "cold wallet", "deposit", "withdrawal"],
  protocol_treasury: ["uniswap", "1inch", "sushi", "curve", "balancer", "aave", "compound", "router", "bridge", "multicall", "deployer", "treasury", "protocol", "dao", "foundation", "ecosystem fund", "grant fund", "team multisig", "official multisig"],
  market_maker: ["market maker", "market-maker", "liquidity provider", "lp provider", "dex mm", "prop shop", "wintermute", "jump trading", "gsr", "flow traders"],
  fund_institution: ["fund", "institution", "asset manager", "asset-management", "hedge fund", "venture", "otc desk", "family office", "index fund", "galaxy", "paradigm", "a16z"]
};

// Classify a single address_label string into a wallet class.
export function classifyLabelString(label: string | null): string {
  if (!label || typeof label !== "string") return "unknown";
  const t = label.toLowerCase();
  // Check in precedence order: mev → exchange → protocol → market_maker → fund
  for (const cls of ["mev_bot", "cex_exchange", "protocol_treasury", "market_maker", "fund_institution"] as const) {
    const terms = LABEL_KEYWORDS_SCREEN[cls];
    if (terms && terms.some((k) => t.includes(k))) return cls;
  }
  // ENS / .sol names → individual
  if (label.includes(".eth") || label.includes(".sol")) return "trader_individual";
  // Has a label but no service pattern → likely individual
  return "trader_individual";
}

// Screening result for a wallet class: "eligible", "excluded", or "needs_review".
export function screeningForClass(walletClass: string): string {
  if (["cex_exchange", "protocol_treasury", "mev_bot", "market_maker"].includes(walletClass)) return "excluded";
  if (walletClass === "fund_institution") return "needs_review";
  return "eligible";
}

// ---- Response parsing ----

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : null;
}

export async function parseDiscoveryResponse(json: any, network: string, cohort: Cohort): Promise<ParsedCandidate[]> {
  if (!json || !Array.isArray(json.data)) return [];
  const candidates: ParsedCandidate[] = [];
  for (const entry of json.data) {
    if (!entry || !entry.address || typeof entry.address !== "string") continue;
    const validation = validateWalletForChain(network, entry.address);
    if (!validation.ok) continue;
    const normalized = normalizeAddress(network, entry.address);
    const fingerprint = await walletFingerprint(network, normalized);
    const label = entry.address_label ?? null;
    const walletClass = classifyLabelString(label);
    candidates.push({
      network,
      wallet_address: entry.address.trim(),
      normalized_wallet_address: normalized,
      wallet_fingerprint: fingerprint,
      address_short: shortAddress(network, entry.address),
      wallet_class: walletClass,
      ranking_metrics: {
        total_pnl_usd: num(entry.total_pnl_usd),
        realized_pnl_usd: num(entry.realized_pnl_usd),
        unrealized_pnl_usd: num(entry.unrealized_pnl_usd),
        win_rate: num(entry.win_rate),
        n_trades: num(entry.n_trades),
        n_tokens: num(entry.n_tokens),
        avg_trade_roi: num(entry.avg_trade_roi)
      },
      cohort
    });
  }
  return candidates;
}

// ---- Screening ----

export function screenCandidates(candidates: ParsedCandidate[]): ScreeningResult {
  const eligible: ParsedCandidate[] = [];
  const excluded: ParsedCandidate[] = [];
  const needsReview: ParsedCandidate[] = [];
  for (const c of candidates) {
    const screening = screeningForClass(c.wallet_class);
    if (screening === "excluded") excluded.push(c);
    else if (screening === "needs_review") needsReview.push(c);
    else eligible.push(c);
  }
  return { eligible, excluded_services: excluded, needs_review: needsReview };
}

// ---- Deduplication ----

export function deduplicateCandidates(
  candidates: ParsedCandidate[],
  existingCandidateFingerprints: Set<string>,
  existingDocketFingerprints: Set<string>,
  existingTrialFingerprints: Set<string>
): DedupResult {
  const unique: ParsedCandidate[] = [];
  const duplicateInBatch: ParsedCandidate[] = [];
  const alreadyCandidate: ParsedCandidate[] = [];
  const alreadyQueued: ParsedCandidate[] = [];
  const alreadyTried: ParsedCandidate[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const fp = c.wallet_fingerprint;
    if (seen.has(fp)) { duplicateInBatch.push(c); continue; }
    seen.add(fp);
    if (existingCandidateFingerprints.has(fp)) { alreadyCandidate.push(c); continue; }
    if (existingDocketFingerprints.has(fp)) { alreadyQueued.push(c); continue; }
    if (existingTrialFingerprints.has(fp)) { alreadyTried.push(c); continue; }
    unique.push(c);
  }

  return {
    unique,
    duplicate_in_batch: duplicateInBatch,
    already_candidate: alreadyCandidate,
    already_queued: alreadyQueued,
    already_tried: alreadyTried
  };
}

// ---- Query fingerprinting ----

export async function sourceQueryFingerprint(req: DiscoveryRequest): Promise<string> {
  const canonical = JSON.stringify({
    network: req.network,
    cohort: req.cohort,
    timeframe: req.timeframe,
    limit: req.limit,
    endpoint: DISCOVERY_ENDPOINT_KEY
  });
  return sha256Hex(canonical);
}

// ---- Sanitization ----

export const FORBIDDEN_CANDIDATE_FIELDS = [
  "wallet_address", "normalized_wallet_address", "address",
  "api_key", "apikey", "authorization",
  "body", "request_body", "response_body",
  "labels", "raw_labels", "address_label"
];

export function containsForbiddenCandidateData(obj: any): boolean {
  if (!obj) return false;
  return FORBIDDEN_CANDIDATE_FIELDS.some((f) => obj[f] !== undefined);
}

export function sanitizeCandidate(candidate: any): PublicCandidate {
  return {
    candidate_id: candidate.candidate_id || "",
    address_short: candidate.address_short || "",
    wallet_fingerprint: candidate.wallet_fingerprint || "",
    network: candidate.network || "",
    source_endpoint: candidate.source_endpoint || DISCOVERY_ENDPOINT_KEY,
    wallet_class: candidate.wallet_class || "unknown",
    ranking_metrics: typeof candidate.ranking_metrics_json === "string"
      ? JSON.parse(candidate.ranking_metrics_json || "{}")
      : (candidate.ranking_metrics || {}),
    cohort: candidate.cohort || "",
    review_status: candidate.review_status || "discovered",
    skip_reason: candidate.skip_reason || null,
    discovered_at: candidate.discovered_at || candidate.created_at || null,
    screening: screeningForClass(candidate.wallet_class || "unknown"),
    version: candidate.version ?? 0
  };
}

export function sanitizeCandidates(candidates: any[]): PublicCandidate[] {
  return candidates.map(sanitizeCandidate);
}

// ---- ID generation ----

export function newCandidateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "cand_" + crypto.randomUUID();
  }
  return "cand_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// ---- Bulk approval preview ----

export const MAX_BULK_APPROVE = 50;

export interface ApprovalPreview {
  selected_count: number;
  new_unique: number;
  already_queued: number;
  already_tried: number;
  existing_candidate: number;
  invalid_or_excluded: number;
  estimated_analysis_calls: number;
  eligible_candidate_ids: string[];
}

// Build a preview of what would happen if the selected candidates were approved.
// Pure: takes resolved candidate records and existing fingerprint sets, returns
// the breakdown without creating any docket items. Used for the confirmation
// step before APPROVE & QUEUE.
export function buildApprovalPreview(
  candidates: Array<{
    candidate_id: string;
    wallet_fingerprint: string;
    review_status: string;
    network: string;
    wallet_address: string;
  }>,
  existingDocketFps: Set<string>,
  existingTrialFps: Set<string>
): ApprovalPreview {
  let newUnique = 0;
  let alreadyQueued = 0;
  let alreadyTried = 0;
  let existingCandidate = 0;
  let invalidOrExcluded = 0;
  const eligibleIds: string[] = [];
  const seenFps = new Set<string>();

  for (const c of candidates) {
    // Skip candidates that are not in "discovered" status (already queued/rejected/skipped)
    if (c.review_status !== "discovered") {
      existingCandidate++;
      continue;
    }
    // Validate address for chain
    const validation = validateWalletForChain(c.network, c.wallet_address);
    if (!validation.ok) {
      invalidOrExcluded++;
      continue;
    }
    const fp = c.wallet_fingerprint;
    // Duplicate within the batch
    if (seenFps.has(fp)) {
      invalidOrExcluded++;
      continue;
    }
    seenFps.add(fp);
    if (existingDocketFps.has(fp)) {
      alreadyQueued++;
      continue;
    }
    if (existingTrialFps.has(fp)) {
      alreadyTried++;
      continue;
    }
    newUnique++;
    eligibleIds.push(c.candidate_id);
  }

  return {
    selected_count: candidates.length,
    new_unique: newUnique,
    already_queued: alreadyQueued,
    already_tried: alreadyTried,
    existing_candidate: existingCandidate,
    invalid_or_excluded: invalidOrExcluded,
    estimated_analysis_calls: newUnique * 4,
    eligible_candidate_ids: eligibleIds
  };
}

// ---- Recent discovery info for duplicate-discovery detection ----

export interface RecentDiscoveryInfo {
  found: boolean;
  discovered_at: string | null;
  candidates_found: number | null;
  query_fingerprint: string;
  network: string;
  cohort: string;
  timeframe_days: number;
  result_limit: number;
  remaining_eligible: number;
  already_queued_or_tried: number;
}

// Format a recent discovery record for the duplicate-discovery warning.
// Pure: takes the discovery record and candidate stats, returns the info.
export function formatRecentDiscovery(
  discovery: any | null,
  queryFingerprint: string,
  remainingEligible: number,
  alreadyQueuedOrTried: number
): RecentDiscoveryInfo {
  if (!discovery) {
    return {
      found: false,
      discovered_at: null,
      candidates_found: null,
      query_fingerprint: queryFingerprint,
      network: "",
      cohort: "",
      timeframe_days: 0,
      result_limit: 0,
      remaining_eligible: 0,
      already_queued_or_tried: 0
    };
  }
  return {
    found: true,
    discovered_at: discovery.discovered_at || null,
    candidates_found: discovery.candidates_found ?? null,
    query_fingerprint: discovery.query_fingerprint || queryFingerprint,
    network: discovery.network || "",
    cohort: discovery.cohort || "",
    timeframe_days: discovery.timeframe_days ?? 0,
    result_limit: discovery.result_limit ?? 0,
    remaining_eligible: remainingEligible,
    already_queued_or_tried: alreadyQueuedOrTried
  };
}

// ---- Budget check (re-exported from calibration.ts for convenience) ----

export { checkBudget, CALIBRATION_TARGET, CALIBRATION_CEILING };

// ---- Build discovery outcome for response ----

export function buildDiscoveryOutcome(params: {
  totalReturned: number;
  screening: ScreeningResult;
  dedup: DedupResult;
  stored: any[];
}): DiscoveryOutcome {
  const storedSanitized = sanitizeCandidates(params.stored);
  return {
    total_returned: params.totalReturned,
    eligible: params.screening.eligible.length,
    excluded_services: params.screening.excluded_services.length,
    needs_review: params.screening.needs_review.length,
    duplicate_in_batch: params.dedup.duplicate_in_batch.length,
    already_candidate: params.dedup.already_candidate.length,
    already_queued: params.dedup.already_queued.length,
    already_tried: params.dedup.already_tried.length,
    stored: storedSanitized.length,
    candidates: storedSanitized
  };
}