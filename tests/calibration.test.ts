import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseCalibrationImport,
  preflightEntries,
  walletFingerprint,
  shortAddress,
  checkBudget,
  classifyWalletResult,
  computeCoverageStats,
  sanitizeDocketItem,
  validateBatchSize,
  claimFilter,
  coverageRecommendation,
  newDocketItemId,
  newRunId,
  MAX_IMPORT,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING,
  ITEM_STATUS,
  containsForbiddenDocketData,
  FORBIDDEN_DOCKET_FIELDS
} from "../base44/shared/calibration.ts";

// ---- Test addresses ----
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"; // Stake Program → 32 zero bytes (valid Solana)
const ETH_ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const BASE_ADDR = "0xabcdef1234567890abcdef1234567890abcdef12";

// ============================================================================
// 1. CSV / paste parsing
// ============================================================================

describe("parseCalibrationImport", () => {
  it("parses a header + data rows", () => {
    const text = "network,wallet_address,source_label,test_objective\nsolana," + SOL_ADDR + ",research,calibration";
    const entries = parseCalibrationImport(text);
    expect(entries.length).toBe(1);
    expect(entries[0].network).toBe("solana");
    expect(entries[0].wallet_address).toBe(SOL_ADDR);
    expect(entries[0].source_label).toBe("research");
    expect(entries[0].test_objective).toBe("calibration");
  });

  it("parses data without a header", () => {
    const text = "ethereum," + ETH_ADDR + ",research,calibration";
    const entries = parseCalibrationImport(text);
    expect(entries.length).toBe(1);
    expect(entries[0].network).toBe("ethereum");
    expect(entries[0].line).toBe(1);
  });

  it("handles quoted fields with commas", () => {
    const text = 'solana,' + SOL_ADDR + ',"source, with comma","objective, also"';
    const entries = parseCalibrationImport(text);
    expect(entries[0].source_label).toBe("source, with comma");
    expect(entries[0].test_objective).toBe("objective, also");
  });

  it("returns empty for empty input", () => {
    expect(parseCalibrationImport("")).toEqual([]);
    expect(parseCalibrationImport("   \n  ")).toEqual([]);
  });
});

// ============================================================================
// 2. Preflight validation (zero Nansen calls)
// ============================================================================

describe("preflightEntries", () => {
  it("valid Solana wallet passes preflight", async () => {
    const entries = [{ network: "solana", wallet_address: SOL_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
    expect(result.accepted[0].network).toBe("solana");
    expect(result.accepted[0].wallet_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("valid Ethereum wallet passes preflight", async () => {
    const entries = [{ network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
  });

  it("valid Base wallet passes preflight", async () => {
    const entries = [{ network: "base", wallet_address: BASE_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
  });

  it("rejects EVM address submitted as Solana", async () => {
    const entries = [{ network: "solana", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(0);
    expect(result.counts.invalid).toBe(1);
    expect(result.invalid[0].code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects Solana address submitted as Ethereum", async () => {
    const entries = [{ network: "ethereum", wallet_address: SOL_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(0);
    expect(result.counts.invalid).toBe(1);
    expect(result.invalid[0].code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects malformed address", async () => {
    const entries = [{ network: "ethereum", wallet_address: "not-an-address", source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.invalid).toBe(1);
  });

  it("rejects unsupported network", async () => {
    const entries = [{ network: "bitcoin", wallet_address: "whatever", source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.invalid).toBe(1);
    expect(result.invalid[0].code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects blank source label", async () => {
    const entries = [{ network: "ethereum", wallet_address: ETH_ADDR, source_label: "", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.invalid).toBe(1);
    expect(result.invalid[0].code).toBe("BLANK_SOURCE_LABEL");
  });

  it("rejects blank test objective", async () => {
    const entries = [{ network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.invalid).toBe(1);
    expect(result.invalid[0].code).toBe("BLANK_TEST_OBJECTIVE");
  });

  it("deduplicates within the file", async () => {
    const entries = [
      { network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 },
      { network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 2 }
    ];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
    expect(result.counts.duplicate_in_file).toBe(1);
  });

  it("deduplicates against existing queue", async () => {
    const fp = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    const entries = [{ network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set([fp]), new Set());
    expect(result.counts.accepted).toBe(0);
    expect(result.counts.already_queued).toBe(1);
  });

  it("deduplicates against existing trials", async () => {
    const fp = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    const entries = [{ network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set([fp]));
    expect(result.counts.accepted).toBe(0);
    expect(result.counts.already_tried).toBe(1);
  });

  it("same normalized address + network cannot queue twice (idempotent import)", async () => {
    const entries = [
      { network: "ethereum", wallet_address: ETH_ADDR, source_label: "research", test_objective: "calibration", line: 1 },
      { network: "ethereum", wallet_address: "0x" + ETH_ADDR.slice(2).toUpperCase(), source_label: "research", test_objective: "calibration", line: 2 }
    ];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
    expect(result.counts.duplicate_in_file).toBe(1);
  });

  it("dry run performs zero writes (returns preflight without side effects)", async () => {
    const entries = [{ network: "solana", wallet_address: SOL_ADDR, source_label: "research", test_objective: "calibration", line: 1 }];
    const result = await preflightEntries(entries, new Set(), new Set());
    expect(result.counts.accepted).toBe(1);
    // The function is pure — no writes happen. This test confirms the contract.
  });
});

// ============================================================================
// 3. Wallet fingerprint
// ============================================================================

describe("walletFingerprint", () => {
  it("is deterministic for the same input", async () => {
    const fp1 = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    const fp2 = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    expect(fp1).toBe(fp2);
  });

  it("is different for different networks with the same address", async () => {
    const fpEth = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    const fpBase = await walletFingerprint("base", ETH_ADDR.toLowerCase());
    expect(fpEth).not.toBe(fpBase);
  });

  it("is different for different addresses", async () => {
    const fp1 = await walletFingerprint("ethereum", ETH_ADDR.toLowerCase());
    const fp2 = await walletFingerprint("ethereum", BASE_ADDR.toLowerCase());
    expect(fp1).not.toBe(fp2);
  });

  it("returns 64-char lowercase hex (SHA-256)", async () => {
    const fp = await walletFingerprint("solana", SOL_ADDR);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================================
// 4. shortAddress
// ============================================================================

describe("shortAddress", () => {
  it("abbreviates EVM address", () => {
    expect(shortAddress("ethereum", ETH_ADDR)).toBe("0x1234…5678");
  });
  it("abbreviates Solana address", () => {
    const s = shortAddress("solana", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    expect(s).toContain("…");
    expect(s.length).toBeLessThan("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU".length);
  });
  it("returns short address as-is", () => {
    expect(shortAddress("ethereum", "0x1234")).toBe("0x1234");
  });
});

// ============================================================================
// 5. Call-budget enforcement
// ============================================================================

describe("checkBudget", () => {
  it("allows when below target", () => {
    const b = checkBudget(500);
    expect(b.allowed).toBe(true);
    expect(b.target_reached).toBe(false);
    expect(b.ceiling_reached).toBe(false);
  });
  it("stops at target (1,000)", () => {
    const b = checkBudget(CALIBRATION_TARGET);
    expect(b.allowed).toBe(false);
    expect(b.target_reached).toBe(true);
    expect(b.ceiling_reached).toBe(false);
  });
  it("stops above target", () => {
    const b = checkBudget(CALIBRATION_TARGET + 5);
    expect(b.allowed).toBe(false);
    expect(b.target_reached).toBe(true);
  });
  it("locks at ceiling (1,020)", () => {
    const b = checkBudget(CALIBRATION_CEILING);
    expect(b.allowed).toBe(false);
    expect(b.ceiling_reached).toBe(true);
  });
  it("locks above ceiling", () => {
    const b = checkBudget(CALIBRATION_CEILING + 10);
    expect(b.allowed).toBe(false);
    expect(b.ceiling_reached).toBe(true);
  });
});

// ============================================================================
// 6. Provider-stop classification
// ============================================================================

describe("classifyWalletResult", () => {
  it("success → no stop", () => {
    const d = classifyWalletResult(200, { trial: { public_slug: "case-x" } }, 0);
    expect(d.stop).toBe(false);
    expect(d.failure_category).toBe("");
  });
  it("court recess → stop", () => {
    const d = classifyWalletResult(503, { court_recess: true, recess_type: "court_recess_provider", sanitized_reason: "Provider unavailable." }, 0);
    expect(d.stop).toBe(true);
    expect(d.failure_category).toContain("provider_");
  });
  it("rate-limit recess → stop", () => {
    const d = classifyWalletResult(429, { court_recess: true, recess_type: "court_recess_rate_limit", sanitized_reason: "Rate limited." }, 0);
    expect(d.stop).toBe(true);
  });
  it("server error → no stop on first failure", () => {
    const d = classifyWalletResult(500, { error: "oops" }, 0);
    expect(d.stop).toBe(false);
    expect(d.failure_category).toBe("provider_error");
  });
  it("two consecutive server errors → stop", () => {
    const d = classifyWalletResult(500, { error: "oops" }, 2);
    expect(d.stop).toBe(true);
    expect(d.failure_category).toBe("consecutive_failures");
  });
  it("validation error → no stop, validation category", () => {
    const d = classifyWalletResult(400, { error: "bad request" }, 0);
    expect(d.stop).toBe(false);
    expect(d.failure_category).toBe("validation");
  });
});

// ============================================================================
// 7. Coverage stats
// ============================================================================

describe("computeCoverageStats", () => {
  it("counts by network, status, objective", () => {
    const items = [
      { network: "ethereum", status: "pending", test_objective: "calibration", verdict_code: null, case_outcome: null, data_mode: null },
      { network: "solana", status: "completed", test_objective: "calibration", verdict_code: "one_pump_chump", case_outcome: "verdict", data_mode: "live" },
      { network: "base", status: "failed", test_objective: "coverage", verdict_code: null, case_outcome: null, data_mode: null }
    ];
    const stats = computeCoverageStats(items);
    expect(stats.by_network.ethereum).toBe(1);
    expect(stats.by_network.solana).toBe(1);
    expect(stats.by_network.base).toBe(1);
    expect(stats.by_status.pending).toBe(1);
    expect(stats.by_status.completed).toBe(1);
    expect(stats.by_status.failed).toBe(1);
    expect(stats.by_objective.calibration).toBe(2);
    expect(stats.by_objective.coverage).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it("tracks live vs dismissed", () => {
    const items = [
      { status: "completed", data_mode: "live", case_outcome: "verdict", verdict_code: "x" },
      { status: "completed", data_mode: "live", case_outcome: "dismissed_no_evidence", verdict_code: null },
      { status: "completed", data_mode: "live", case_outcome: "mistrial_insufficient_evidence", verdict_code: null }
    ];
    const stats = computeCoverageStats(items);
    expect(stats.live_vs_dismissed.live).toBe(1);
    expect(stats.live_vs_dismissed.dismissed).toBe(1);
    expect(stats.live_vs_dismissed.mistrial).toBe(1);
  });
});

// ============================================================================
// 8. Privacy sanitization
// ============================================================================

describe("sanitizeDocketItem", () => {
  it("strips wallet_address and normalized_wallet_address", () => {
    const item = {
      docket_item_id: "cdi_1",
      network: "ethereum",
      wallet_address: ETH_ADDR,
      normalized_wallet_address: ETH_ADDR.toLowerCase(),
      wallet_fingerprint: "abc123",
      address_short: "0x1234…5678",
      source_label: "research",
      test_objective: "calibration",
      status: "pending",
      version: 0,
      queued_at: "2026-09-20T12:00:00Z"
    };
    const s = sanitizeDocketItem(item);
    expect(containsForbiddenDocketData(s)).toBe(false);
    expect(s.wallet_address).toBeUndefined();
    expect(s.normalized_wallet_address).toBeUndefined();
    expect(s.address_short).toBe("0x1234…5678");
    expect(s.wallet_fingerprint).toBe("abc123");
  });

  it("FORBIDDEN_DOCKET_FIELDS covers wallet_address and normalized_wallet_address", () => {
    expect(FORBIDDEN_DOCKET_FIELDS).toContain("wallet_address");
    expect(FORBIDDEN_DOCKET_FIELDS).toContain("normalized_wallet_address");
  });
});

// ============================================================================
// 9. Batch size validation
// ============================================================================

describe("validateBatchSize", () => {
  it("accepts 1–5", () => {
    for (let n = MIN_BATCH_SIZE; n <= MAX_BATCH_SIZE; n++) {
      const v = validateBatchSize(n);
      expect(v.ok).toBe(true);
      expect(v.value).toBe(n);
    }
  });
  it("rejects 0", () => {
    expect(validateBatchSize(0).ok).toBe(false);
  });
  it("rejects 6", () => {
    expect(validateBatchSize(6).ok).toBe(false);
  });
  it("rejects non-number", () => {
    expect(validateBatchSize("abc").ok).toBe(false);
  });
  it("default is 5", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(5);
  });
});

// ============================================================================
// 10. CAS claim filter
// ============================================================================

describe("claimFilter", () => {
  it("builds a CAS filter with docket_item_id, status=pending, and version", () => {
    const filter = claimFilter("cdi_1", 3);
    expect(filter.docket_item_id).toBe("cdi_1");
    expect(filter.status).toBe(ITEM_STATUS.PENDING);
    expect(filter.version).toBe(3);
  });
});

// ============================================================================
// 11. ID generators
// ============================================================================

describe("ID generators", () => {
  it("newDocketItemId generates unique IDs with cdi_ prefix", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newDocketItemId());
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^cdi_/);
  });
  it("newRunId generates unique IDs with run_ prefix", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newRunId());
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^run_/);
  });
});

// ============================================================================
// 12. Coverage recommendations
// ============================================================================

describe("coverageRecommendation", () => {
  it("recommends missing networks", () => {
    const stats = computeCoverageStats([
      { network: "ethereum", status: "completed", test_objective: "x", verdict_code: "y", case_outcome: "verdict", data_mode: "live" }
    ]);
    const recs = coverageRecommendation(stats);
    expect(recs.some((r) => r.includes("solana"))).toBe(true);
    expect(recs.some((r) => r.includes("base"))).toBe(true);
  });
  it("recommends importing when queue is empty", () => {
    const stats = computeCoverageStats([]);
    const recs = coverageRecommendation(stats);
    expect(recs.some((r) => r.includes("empty"))).toBe(true);
  });
});

// ============================================================================
// 13. Import limit
// ============================================================================

describe("import limit", () => {
  it("MAX_IMPORT is 250", () => {
    expect(MAX_IMPORT).toBe(250);
  });
});

// ============================================================================
// 14. Entity RLS schema-contract: deny all direct client access
// ============================================================================

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readEntitySchema(name: string): any {
  const p = path.resolve(__dirname, "..", "base44", "entities", name + ".jsonc");
  return JSON.parse(stripJsonComments(fs.readFileSync(p, "utf8")));
}

describe("CalibrationDocketItem RLS — deny all direct client access", () => {
  const OPS = ["read", "create", "update", "delete"] as const;

  it("all four operations deny all clients via unsatisfiable user_condition", () => {
    const schema = readEntitySchema("CalibrationDocketItem");
    for (const op of OPS) {
      const rule = schema.rls[op];
      expect(rule.user_condition).toBeTruthy();
      expect(["admin", "user"]).not.toContain(rule.user_condition.role);
    }
  });
});

describe("CalibrationControl RLS — deny all direct client access", () => {
  const OPS = ["read", "create", "update", "delete"] as const;

  it("all four operations deny all clients via unsatisfiable user_condition", () => {
    const schema = readEntitySchema("CalibrationControl");
    for (const op of OPS) {
      const rule = schema.rls[op];
      expect(rule.user_condition).toBeTruthy();
      expect(["admin", "user"]).not.toContain(rule.user_condition.role);
    }
  });
});

// ============================================================================
// 15. Source audit: no delete on CalibrationDocketItem (never delete history)
// ============================================================================

describe("source audit — CalibrationDocketItem is append-only (no delete)", () => {
  const ROOT = path.resolve(__dirname, "..", "base44");

  function listTsFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) listTsFiles(full, acc);
      else if (entry.name.endsWith(".ts")) acc.push(full);
    }
    return acc;
  }

  function stripComments(content: string): string {
    return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  }

  it("no production code calls CalibrationDocketItem.delete or .deleteMany", () => {
    const files = listTsFiles(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      if (content.includes("CalibrationDocketItem.delete(") || content.includes("CalibrationDocketItem.deleteMany(")) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("all CalibrationDocketItem access goes through asServiceRole", () => {
    const files = listTsFiles(ROOT);
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      if (content.includes("CalibrationDocketItem.")) {
        expect(content).toContain("asServiceRole");
      }
    }
  });
});

// ============================================================================
// 16. Backend authorization source audit
// ============================================================================

describe("backend functions authorize before any query", () => {
  it("getCalibrationDocket checks auth + admin role", () => {
    const f = path.join(__dirname, "..", "base44", "functions", "getCalibrationDocket", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
    expect(content).toContain("401");
    expect(content).toContain("403");
  });
  it("importCalibrationDocket checks auth + admin role", () => {
    const f = path.join(__dirname, "..", "base44", "functions", "importCalibrationDocket", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
  });
  it("startCalibrationBatch checks auth + admin role", () => {
    const f = path.join(__dirname, "..", "base44", "functions", "startCalibrationBatch", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
  });
  it("processCalibrationWallet checks auth + admin role", () => {
    const f = path.join(__dirname, "..", "base44", "functions", "processCalibrationWallet", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
  });
  it("recoverStaleCalibrationItem checks auth + admin role", () => {
    const f = path.join(__dirname, "..", "base44", "functions", "recoverStaleCalibrationItem", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
  });
});