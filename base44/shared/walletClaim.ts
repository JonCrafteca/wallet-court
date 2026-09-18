// Shared helpers for wallet ownership claims. Server-side only (imported by
// backend functions). Keeps claim crypto, message building, sanitization, and
// alias validation in one place so the claim functions never duplicate it.

import { validateAddress, normalizeAddress } from "./verdicts.ts";
import { sanitizeHandlePublic } from "./handles.ts";

export const SUPPORTED_CLAIM_NETWORKS = ["ethereum", "base"];
export const CLAIM_PURPOSE = "wallet_claim";
export const REVOKE_PURPOSE = "wallet_revoke";
export const CLAIM_STATEMENT =
  "Signing proves control of this wallet only. It does not authorize transactions, approvals, transfers, or access to funds.";
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX = 6;
export const SIGNATURE_SCHEME = "eip191_personal_sign";

export function isClaimableNetwork(network) {
  return SUPPORTED_CLAIM_NETWORKS.includes(network);
}

export function isValidEvmAddress(address) {
  return validateAddress("ethereum", address);
}

export function normalizeClaimAddress(network, address) {
  return normalizeAddress(network, address);
}

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Permanent wallet identity slug: wlt_ + 24 hex chars (12 bytes of entropy).
// Cryptographically random, never derived from the address, account, Court
// Name, or case slug. Collision-checked by the caller.
export function newClaimSlug() {
  return "wlt_" + randomNonce().slice(0, 24);
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Build the server-generated, single-use signing challenge. Contains every
// field required by Phase N3: purpose, domain, account, wallet, network, case
// (or claim slug for revocation), nonce, issued, expires.
export function buildClaimMessage({ purpose, domain, account, address, network, caseSlug, nonce, issuedAt, expiresAt }) {
  return [
    "Wallet Court",
    `Purpose: ${purpose}`,
    `Domain: ${domain}`,
    `Account: ${account}`,
    `Wallet: ${address}`,
    `Network: ${network}`,
    `Case: ${caseSlug}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    `Expires: ${expiresAt}`,
    "",
    CLAIM_STATEMENT
  ].join("\n");
}

export function parseClaimMessage(message) {
  const out = {};
  if (!message) return out;
  for (const line of String(message).split("\n")) {
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === "purpose") out.purpose = val;
    else if (key === "domain") out.domain = val;
    else if (key === "account") out.account = val;
    else if (key === "wallet") out.wallet = val;
    else if (key === "network") out.network = val;
    else if (key === "case") out.case = val;
    else if (key === "nonce") out.nonce = val;
    else if (key === "issued") out.issued = val;
    else if (key === "expires") out.expires = val;
  }
  return out;
}

// Legacy alias validation (pre-N3). Retained for backward compatibility with
// updateWalletProfile. New Court Name validation lives in courtName.ts.
const RESERVED_TERMS = [
  "nansen", "wallet court", "walletcourt", "shoutit", "shout it", "shout-it",
  "admin", "administrator", "official", "support", "staff", "mod", "moderator",
  "court", "the court", "verified", "wallet control verified", "base44"
];
const PROFANITY = [
  "fuck", "shit", "cunt", "nigger", "faggot", "retard", "bitch", "asshole",
  "dick", "pussy", "whore", "slut", "bastard", "douche"
];

export function validateAlias(alias) {
  if (alias == null) return { ok: true, value: null };
  const s = String(alias).trim();
  if (s === "") return { ok: true, value: null };
  if (s.length < 3 || s.length > 24) return { ok: false, error: "Alias must be 3–24 characters." };
  if (!/^[A-Za-z0-9 _-]+$/.test(s)) return { ok: false, error: "Use letters, numbers, spaces, underscores, and hyphens only." };
  const lower = s.toLowerCase();
  for (const term of RESERVED_TERMS) {
    if (lower === term || lower.includes(term)) return { ok: false, error: "That alias is reserved. Choose another." };
  }
  for (const bad of PROFANITY) {
    if (lower.includes(bad)) return { ok: false, error: "That alias is not allowed." };
  }
  return { ok: true, value: s };
}

// Sanitize a claim for public/owner consumption. Never include owner_user_id,
// the full normalized address, signature data, or nonce data.
export function sanitizeClaim(claim, { isOwner = false } = {}) {
  if (!claim) return null;
  const out = {
    claim_slug: claim.claim_slug,
    network: claim.network,
    address_short: claim.address_short,
    public_alias: claim.public_alias || null,
    court_name: claim.court_name || null,
    profile_visibility: claim.profile_visibility,
    show_trial_history: !!claim.show_trial_history,
    show_badges: claim.show_badges !== false,
    status: claim.status,
    signature_scheme: claim.signature_scheme,
    verified_at: claim.verified_at,
    last_verified_at: claim.last_verified_at,
    latest_trial_slug: claim.latest_trial_slug || null,
    is_owner: isOwner
  };
  if (isOwner) out.court_name_changed_at = claim.court_name_changed_at || null;
  return out;
}

export function sanitizeTrialPublic(trial) {
  if (!trial) return null;
  return {
    public_slug: trial.public_slug,
    network: trial.network,
    data_mode: trial.data_mode,
    verdict_code: trial.verdict_code,
    verdict_name: trial.verdict_name,
    severity_score: trial.severity_score,
    confidence_score: trial.confidence_score,
    headline: trial.headline,
    roast: trial.roast,
    defense_statement: trial.defense_statement,
    sentence: trial.sentence,
    evidence_items_json: trial.evidence_items_json,
    created_date: trial.created_date,
    analyzed_at: trial.analyzed_at
  };
}

export function sanitizeDefensePublic(defense) {
  if (!defense) return null;
  return { version: defense.version, text: defense.text, submitted_at: defense.submitted_at };
}

export function sanitizeDefenseForOwner(defense) {
  if (!defense) return null;
  return {
    version: defense.version,
    text: defense.text,
    moderation_status: defense.moderation_status,
    replaces_version: defense.replaces_version || null,
    submitted_at: defense.submitted_at,
    moderated_at: defense.moderated_at || null
  };
}

export { sanitizeHandlePublic };