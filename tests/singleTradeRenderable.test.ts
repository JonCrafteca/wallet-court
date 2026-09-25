// Regression tests for Single Trade Trial renderability gate.
// Verifies that failed/incomplete trials are never publicly rendered as
// verdicts, and that the gate uses the exact production SingleTradeTrial /
// getSingleTradeBySlug response shapes.

import { describe, it, expect } from "vitest";
import { isSingleTradeRenderable } from "../base44/shared/singleTradeRenderable.ts";
import { isSingleTradeRenderable as isSingleTradeRenderableClient } from "../src/lib/singleTradeRenderable.js";

// ---- Exact production SingleTradeTrial shape (raw, pre-sanitization) ----

const RAW_FAILED_TRIAL = {
  id: "6ab5d886d0fcf97bd9bf9b77",
  trial_type: "single_trade",
  wallet_address: "So11111111111111111111111111111111111111112RqU1",
  normalized_wallet_address: "so11111111111111111111111111111111111111112rqu1",
  network: "solana",
  token_mint: "GTBxUiw6XXXXXXXXXXXXXXXXXXXXpump",
  token_symbol: "JEANPHIL",
  transaction_hash: "5xX9…abcdef1234567890",
  trade_fingerprint: "sha256hash",
  purchase_timestamp: "2026-09-20T16:58:32Z",
  entry_price_usd: 0.009693795252134882,
  entry_market_cap_usd: null,
  tokens_received: 108118.481049,
  purchase_cost_usd: 1048.0784182608313,
  status: "failed",
  data_mode: "live",
  case_outcome: null,
  verdict_code: null,
  verdict_name: null,
  severity_score: null,
  confidence_score: null,
  headline: null,
  roast: null,
  defense_statement: null,
  sentence: null,
  evidence_items_json: "[]",
  metrics_json: "{}",
  ohlcv_snapshot_json: "[]",
  refresh_snapshots_json: "[]",
  source_endpoints_json: "[]",
  public_slug: "trade-6iitjk72sg68",
  error_code: "analysis_error",
  error_message: "Field 'ohlcv_snapshot_json' exceeds the maximum allowed size.",
  analyzed_at: "2026-09-25T02:12:26.828Z",
  version: 0,
};

const RAW_COMPLETED_VERDICT_TRIAL = {
  ...RAW_FAILED_TRIAL,
  status: "completed",
  case_outcome: "verdict",
  verdict_code: "bagholder",
  verdict_name: "Bagholder",
  severity_score: 72,
  confidence_score: 85,
  headline: "Bought the top, held the bag",
  roast: "You bought JEANPHIL at the peak and watched it bleed out.",
  defense_statement: "I believed in the project.",
  sentence: "Sentenced to eternal diamond hands.",
  evidence_items_json: JSON.stringify([
    { tag: "NANSEN · ENTRY", label: "Purchase Cost", value: "$1,048.08", detail: "USD value of the entry trade." },
    { tag: "NANSEN · OHLCV", label: "Maximum Drawdown", value: "-87.3%", detail: "Deepest decline from entry." },
  ]),
  metrics_json: JSON.stringify({ max_drawdown_pct: -0.873 }),
  ohlcv_snapshot_json: JSON.stringify([{ t: 1, c: 100 }, { t: 2, c: 12 }]),
  error_code: null,
  error_message: null,
};

const RAW_COMPLETED_DISMISSED_TRIAL = {
  ...RAW_FAILED_TRIAL,
  status: "completed",
  case_outcome: "dismissed_no_evidence",
  verdict_code: null,
  verdict_name: null,
  severity_score: null,
  confidence_score: null,
  roast: null,
  sentence: null,
  evidence_items_json: "[]",
  error_code: null,
  error_message: null,
};

const RAW_COMPLETED_MISTRIAL_TRIAL = {
  ...RAW_FAILED_TRIAL,
  status: "completed",
  case_outcome: "mistrial_insufficient_evidence",
  verdict_code: null,
  verdict_name: null,
  severity_score: null,
  confidence_score: null,
  roast: null,
  sentence: null,
  evidence_items_json: "[]",
  error_code: null,
  error_message: null,
};

// A completed verdict trial that is MISSING required fields (e.g. roast is null).
const RAW_COMPLETED_VERDICT_MISSING_ROAST = {
  ...RAW_COMPLETED_VERDICT_TRIAL,
  roast: null,
};

// A completed verdict trial with empty evidence array.
const RAW_COMPLETED_VERDICT_EMPTY_EVIDENCE = {
  ...RAW_COMPLETED_VERDICT_TRIAL,
  evidence_items_json: "[]",
};

// A pending trial (still analyzing).
const RAW_PENDING_TRIAL = {
  ...RAW_FAILED_TRIAL,
  status: "analyzing",
};

// ---- Exact sanitized getSingleTradeBySlug response shape (public) ----
// This is what the frontend receives. Note: no `status` field.

const SANITIZED_FAILED = {
  public_slug: "trade-6iitjk72sg68",
  trial_type: "single_trade",
  network: "solana",
  data_mode: "live",
  case_outcome: null,
  verdict_code: null,
  verdict_name: null,
  severity_score: null,
  confidence_score: null,
  headline: null,
  roast: null,
  defense_statement: null,
  sentence: null,
  evidence_items_json: "[]",
  metrics_json: "{}",
  source_endpoints_json: "[]",
  analyzed_at: "2026-09-25T02:12:26.828Z",
  address_short: "so1111…RqU1",
  token_symbol: "JEANPHIL",
  token_mint: "GTBxUiw6…pump",
  transaction_hash_short: "5xX9…7890",
  purchase_timestamp: "2026-09-20T16:58:32Z",
  entry_market_cap_usd: null,
  purchase_cost_usd: 1048.0784182608313,
  tokens_received: 108118.481049,
  entry_price_usd: 0.009693795252134882,
  current_price_usd: null,
  current_value_usd: null,
  conviction: null,
  refresh_snapshots_json: "[]",
};

const SANITIZED_VERDICT = {
  ...SANITIZED_FAILED,
  case_outcome: "verdict",
  verdict_code: "bagholder",
  verdict_name: "Bagholder",
  severity_score: 72,
  confidence_score: 85,
  headline: "Bought the top, held the bag",
  roast: "You bought JEANPHIL at the peak and watched it bleed out.",
  defense_statement: "I believed in the project.",
  sentence: "Sentenced to eternal diamond hands.",
  evidence_items_json: JSON.stringify([
    { tag: "NANSEN · ENTRY", label: "Purchase Cost", value: "$1,048.08" },
    { tag: "NANSEN · OHLCV", label: "Maximum Drawdown", value: "-87.3%" },
  ]),
};

// ---- Backend gate (raw trial with status field) ----

describe("Backend isSingleTradeRenderable (raw SingleTradeTrial)", () => {
  it("rejects the failed JEANPHIL trial (status=failed, all fields null)", () => {
    expect(isSingleTradeRenderable(RAW_FAILED_TRIAL)).toBe(false);
  });

  it("rejects a pending/analyzing trial", () => {
    expect(isSingleTradeRenderable(RAW_PENDING_TRIAL)).toBe(false);
  });

  it("rejects a completed verdict trial missing roast", () => {
    expect(isSingleTradeRenderable(RAW_COMPLETED_VERDICT_MISSING_ROAST)).toBe(false);
  });

  it("rejects a completed verdict trial with empty evidence", () => {
    expect(isSingleTradeRenderable(RAW_COMPLETED_VERDICT_EMPTY_EVIDENCE)).toBe(false);
  });

  it("accepts a completed verdict trial with all required fields", () => {
    expect(isSingleTradeRenderable(RAW_COMPLETED_VERDICT_TRIAL)).toBe(true);
  });

  it("accepts a completed dismissed trial (no verdict fields needed)", () => {
    expect(isSingleTradeRenderable(RAW_COMPLETED_DISMISSED_TRIAL)).toBe(true);
  });

  it("accepts a completed mistrial trial (no verdict fields needed)", () => {
    expect(isSingleTradeRenderable(RAW_COMPLETED_MISTRIAL_TRIAL)).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(isSingleTradeRenderable(null)).toBe(false);
    expect(isSingleTradeRenderable(undefined)).toBe(false);
  });

  it("rejects a completed verdict trial with severity_score = 0 (null check, not falsy)", () => {
    // severity_score of 0 is a valid value (not null) — should pass.
    const withZeroSeverity = { ...RAW_COMPLETED_VERDICT_TRIAL, severity_score: 0 };
    expect(isSingleTradeRenderable(withZeroSeverity)).toBe(true);
  });

  it("rejects a completed verdict trial with confidence_score = null", () => {
    const withNullConfidence = { ...RAW_COMPLETED_VERDICT_TRIAL, confidence_score: null };
    expect(isSingleTradeRenderable(withNullConfidence)).toBe(false);
  });

  it("rejects a completed verdict trial with malformed evidence_items_json", () => {
    const withBadJson = { ...RAW_COMPLETED_VERDICT_TRIAL, evidence_items_json: "not-json{" };
    expect(isSingleTradeRenderable(withBadJson)).toBe(false);
  });
});

// ---- Frontend safety net (sanitized response, no status field) ----

describe("Frontend isSingleTradeRenderable (sanitized public response)", () => {
  it("rejects the sanitized failed trial (case_outcome=null)", () => {
    expect(isSingleTradeRenderableClient(SANITIZED_FAILED)).toBe(false);
  });

  it("accepts the sanitized completed verdict trial", () => {
    expect(isSingleTradeRenderableClient(SANITIZED_VERDICT)).toBe(true);
  });

  it("rejects a sanitized verdict trial missing verdict_code", () => {
    const missingCode = { ...SANITIZED_VERDICT, verdict_code: null };
    expect(isSingleTradeRenderableClient(missingCode)).toBe(false);
  });

  it("rejects a sanitized verdict trial missing roast", () => {
    const missingRoast = { ...SANITIZED_VERDICT, roast: null };
    expect(isSingleTradeRenderableClient(missingRoast)).toBe(false);
  });

  it("rejects a sanitized verdict trial with empty evidence", () => {
    const emptyEvidence = { ...SANITIZED_VERDICT, evidence_items_json: "[]" };
    expect(isSingleTradeRenderableClient(emptyEvidence)).toBe(false);
  });

  it("accepts a sanitized dismissed trial", () => {
    const dismissed = { ...SANITIZED_FAILED, case_outcome: "dismissed_no_evidence" };
    expect(isSingleTradeRenderableClient(dismissed)).toBe(true);
  });

  it("accepts a sanitized mistrial trial", () => {
    const mistrial = { ...SANITIZED_FAILED, case_outcome: "mistrial_insufficient_evidence" };
    expect(isSingleTradeRenderableClient(mistrial)).toBe(true);
  });
});

// ---- findBySlug regression (pre-existing shorthand bug) ----

describe("singleTradeStore.findBySlug", () => {
  it("uses public_slug: publicSlug (not the broken shorthand { public_slug })", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("base44/shared/singleTradeStore.ts", "utf-8");
    // The shorthand { public_slug } would reference an undefined variable
    // (the param is publicSlug). Must be { public_slug: publicSlug }.
    expect(src).toContain("{ public_slug: publicSlug }");
    expect(src).not.toMatch(/\{\s*public_slug\s*\}/);
  });
});

// ---- getSingleTradeBySlug entry-point structural checks ----

describe("getSingleTradeBySlug renderability gate wiring", () => {
  it("imports isSingleTradeRenderable in the entry file", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("base44/functions/getSingleTradeBySlug/entry.ts", "utf-8");
    expect(src).toContain("isSingleTradeRenderable");
    expect(src).toMatch(/isSingleTradeRenderable\(trial\)/);
    // Must return 404 when not renderable.
    expect(src).toMatch(/not.*completed.*not available|not available for public/i);
  });

  it("SingleTradeCase imports the frontend safety net", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/pages/SingleTradeCase.jsx", "utf-8");
    expect(src).toContain("isSingleTradeRenderable");
    expect(src).toMatch(/isSingleTradeRenderable\(result\.trial\)/);
  });

  it("whole-wallet Case.jsx is NOT contaminated by the Single Trade gate", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/pages/Case.jsx", "utf-8");
    expect(src).not.toContain("isSingleTradeRenderable");
    expect(src).not.toContain("singleTradeRenderable");
  });
});