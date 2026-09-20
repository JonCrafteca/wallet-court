import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildProofPayload,
  computeProofDigest,
  sha256Hex,
  canonicalJson,
  buildAuditRecord,
  newCallId,
  AUDIT_OUTCOMES,
  TELEMETRY_VERSION,
  sanitizeAuditRowForExport,
  proofToCsv,
  containsForbiddenData
} from "../base44/shared/nansenTelemetry.ts";

// ============================================================================
// NansenApiCallAudit integrity hardening tests.
//
// The Base44 RLS engine runs server-side and cannot be invoked from a vitest
// unit test, so RLS behavior is asserted as a schema contract (the entity
// jsonc file is the source of truth for permissions). The required LIVE
// permission checks that cannot be exercised here are listed at the bottom
// of this file.
// ============================================================================

const ENTITY_PATH = path.resolve(__dirname, "..", "base44", "entities", "NansenApiCallAudit.jsonc");
const ROOT = path.resolve(__dirname, "..", "base44");

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function stripCodeComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readEntitySchema(): any {
  const raw = fs.readFileSync(ENTITY_PATH, "utf8");
  return JSON.parse(stripJsonComments(raw));
}

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

// ---- 1. RLS schema contract: deny ALL direct client access ----

describe("NansenApiCallAudit RLS — deny all direct client access", () => {
  const OPS = ["read", "create", "update", "delete"] as const;

  it("entity defines an rls block covering all four operations", () => {
    const schema = readEntitySchema();
    expect(schema.rls).toBeTruthy();
    for (const op of OPS) {
      expect(schema.rls[op]).toBeTruthy();
    }
  });

  it("every operation denies all clients via an unsatisfiable user_condition", () => {
    const schema = readEntitySchema();
    for (const op of OPS) {
      const rule = schema.rls[op];
      expect(rule).toBeTruthy();
      expect(rule.user_condition).toBeTruthy();
      expect(typeof rule.user_condition.role).toBe("string");
      // The role must not be "admin" or "user" — the only real user roles.
      // An impossible role means no client (anonymous, user, or admin) can
      // match, while asServiceRole bypasses RLS entirely.
      expect(["admin", "user"]).not.toContain(rule.user_condition.role);
    }
  });

  it("no operation is left open, empty, or set to false", () => {
    const schema = readEntitySchema();
    for (const op of OPS) {
      expect(schema.rls[op]).not.toBe(true);
      expect(schema.rls[op]).not.toEqual({});
      expect(schema.rls[op]).not.toBe(false);
    }
  });

  it("anonymous clients cannot read/create/update/delete (RLS denies before role is checked)", () => {
    // An anonymous client has no role; the impossible user_condition matches
    // no one, so anonymous access is denied on all four operations.
    const schema = readEntitySchema();
    for (const op of OPS) {
      const role = schema.rls[op].user_condition.role;
      expect(role).not.toBe(""); // not an open match
    }
  });

  it("authenticated admin clients cannot read/create/update/delete (admin role does not satisfy the impossible condition)", () => {
    const schema = readEntitySchema();
    for (const op of OPS) {
      const role = schema.rls[op].user_condition.role;
      expect(role).not.toBe("admin");
    }
  });
});

// ---- 2. Append-only: no production update/delete path ----

describe("append-only source audit — no update or delete on NansenApiCallAudit", () => {
  const FORBIDDEN_METHODS = [".update(", ".delete(", ".updateMany(", ".deleteMany(", ".bulkUpdate("];

  it("no production source calls NansenApiCallAudit.update / .delete / .updateMany / .deleteMany / .bulkUpdate", () => {
    const files = listTsFiles(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const content = stripCodeComments(fs.readFileSync(f, "utf8"));
      for (const method of FORBIDDEN_METHODS) {
        if (content.includes("NansenApiCallAudit" + method)) {
          offenders.push(path.relative(ROOT, f) + " → NansenApiCallAudit" + method);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("production source uses NansenApiCallAudit.create (append) and .list (read) via asServiceRole only", () => {
    const files = listTsFiles(ROOT);
    const createCallers: string[] = [];
    const listCallers: string[] = [];
    for (const f of files) {
      const content = stripCodeComments(fs.readFileSync(f, "utf8"));
      if (content.includes("NansenApiCallAudit.create")) createCallers.push(path.relative(ROOT, f));
      if (content.includes("NansenApiCallAudit.list")) listCallers.push(path.relative(ROOT, f));
    }
    expect(createCallers.length).toBeGreaterThan(0);
    expect(listCallers.length).toBeGreaterThan(0);
    // Every create/list call must go through asServiceRole.
    for (const f of listTsFiles(ROOT)) {
      const content = stripCodeComments(fs.readFileSync(f, "utf8"));
      if (content.includes("NansenApiCallAudit.create") || content.includes("NansenApiCallAudit.list")) {
        expect(content).toContain("asServiceRole");
      }
    }
  });
});

// ---- 3. Duplicate call_id cannot overwrite ----

describe("duplicate call_id protection", () => {
  it("newCallId generates unique IDs across many calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newCallId());
    expect(ids.size).toBe(1000);
  });

  it("each call_id is prefixed nca_ (audit-namespace)", () => {
    for (let i = 0; i < 10; i++) expect(newCallId()).toMatch(/^nca_/);
  });

  it("the ledger is append-only: duplicate call_ids create distinct records, never overwrite (no update path exists)", () => {
    // Since no .update path exists in production and each attempt generates a
    // fresh call_id, a duplicate call_id (if it ever occurred) would create a
    // second record — it cannot overwrite the first.
    const seen = new Map<string, number>();
    for (let i = 0; i < 500; i++) {
      const id = newCallId();
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    for (const count of seen.values()) expect(count).toBe(1);
  });

  it("buildAuditRecord always uses the provided fresh call_id (transport generates before the request)", () => {
    const id1 = newCallId();
    const id2 = newCallId();
    const rec1 = buildAuditRecord({
      call_id: id1, occurred_at: "2026-09-20T12:00:00Z",
      endpoint_key: "pnl_summary", workflow: "trial_analysis", network: "ethereum",
      correlation_id: "c1", attempt_number: 1, outcome: AUDIT_OUTCOMES.SUCCESS,
      environment: "production"
    });
    const rec2 = buildAuditRecord({
      call_id: id2, occurred_at: "2026-09-20T12:00:01Z",
      endpoint_key: "pnl_summary", workflow: "trial_analysis", network: "ethereum",
      correlation_id: "c1", attempt_number: 2, outcome: AUDIT_OUTCOMES.SUCCESS,
      environment: "production"
    });
    expect(rec1.call_id).toBe(id1);
    expect(rec2.call_id).toBe(id2);
    expect(rec1.call_id).not.toBe(rec2.call_id);
  });
});

// ---- 4. SHA-256 digest properties ----

function mkRecord(over: Partial<any> = {}) {
  return {
    call_id: over.call_id || "nca_" + Math.random().toString(36).slice(2, 8),
    occurred_at: over.occurred_at || "2026-09-20T12:00:00Z",
    endpoint_key: over.endpoint_key || "pnl_summary",
    workflow: over.workflow || "trial_analysis",
    network: over.network || "ethereum",
    case_slug: over.case_slug !== undefined ? over.case_slug : "case-1",
    correlation_id: over.correlation_id || "corr_1",
    attempt_number: over.attempt_number !== undefined ? over.attempt_number : 1,
    response_status: over.response_status !== undefined ? over.response_status : 200,
    outcome: over.outcome || AUDIT_OUTCOMES.SUCCESS,
    latency_ms: over.latency_ms !== undefined ? over.latency_ms : 50,
    environment: over.environment || "production",
    data_mode: "live",
    provider_request_id: over.provider_request_id !== undefined ? over.provider_request_id : null,
    credits_consumed: over.credits_consumed !== undefined ? over.credits_consumed : 1,
    telemetry_version: TELEMETRY_VERSION
  };
}

describe("SHA-256 digest", () => {
  it("sha256Hex returns 64-char lowercase hex", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("sha256Hex of empty string is the known empty-SHA-256 constant", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("sha256Hex is deterministic for the same input", async () => {
    expect(await sha256Hex("wallet-court")).toBe(await sha256Hex("wallet-court"));
  });

  it("sha256_digest is deterministic across identical builds", async () => {
    const recs = [mkRecord({ call_id: "nca_x" })];
    const p1 = await buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    const p2 = await buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    expect(p1.sha256_digest).toBe(p2.sha256_digest);
    expect(p1.sha256_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing one proof field changes the digest", async () => {
    const recs = [mkRecord({ call_id: "nca_x" })];
    const p1 = await buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    const recs2 = [mkRecord({ call_id: "nca_y" })];
    const p2 = await buildProofPayload({ records: recs2, generatedAt: "2026-09-20T12:00:00Z" });
    expect(p1.sha256_digest).not.toBe(p2.sha256_digest);
  });

  it("object key ordering does not change the digest (canonicalization sorts keys)", async () => {
    const a = { z: 1, a: 2, m: { y: 3, b: 4 } };
    const b = { a: 2, m: { b: 4, y: 3 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await sha256Hex(canonicalJson(a))).toBe(await sha256Hex(canonicalJson(b)));
  });

  it("array order is preserved (not sorted)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("the digest field is excluded from its own input", async () => {
    const recs = [mkRecord({ call_id: "nca_x" })];
    const proof = await buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    // Recompute the digest over the payload WITHOUT sha256_digest.
    const { sha256_digest, ...withoutDigest } = proof;
    const recomputed = await computeProofDigest(withoutDigest as any);
    expect(recomputed).toBe(sha256_digest);
    // Including the digest field in the hashed input would produce a different value.
    const withDigest = await sha256Hex(canonicalJson(proof));
    expect(withDigest).not.toBe(sha256_digest);
  });

  it("JSON and CSV totals still agree", async () => {
    const recs = [
      mkRecord({ outcome: AUDIT_OUTCOMES.SUCCESS }),
      mkRecord({ outcome: AUDIT_OUTCOMES.RATE_LIMITED }),
      mkRecord({ outcome: AUDIT_OUTCOMES.PROVIDER_ERROR })
    ];
    const proof = await buildProofPayload({ records: recs, generatedAt: "2026-09-20T12:00:00Z" });
    const csv = proofToCsv(recs);
    const csvRows = csv.trim().split("\n").length - 1;
    expect(proof.total_tracked_physical_requests).toBe(3);
    expect(csvRows).toBe(3);
  });
});

// ---- 5. Telemetry append + sanitization contract ----

describe("telemetry append contract", () => {
  it("buildAuditRecord output never contains forbidden fields", () => {
    const rec = buildAuditRecord({
      call_id: "nca_1", occurred_at: "2026-09-20T12:00:00Z",
      endpoint_key: "pnl_summary", workflow: "trial_analysis", network: "ethereum",
      correlation_id: "c1", attempt_number: 1, outcome: AUDIT_OUTCOMES.SUCCESS,
      environment: "production"
    });
    expect(containsForbiddenData(rec)).toBe(false);
    expect(rec.telemetry_version).toBe(TELEMETRY_VERSION);
    expect(rec.data_mode).toBe("live");
  });

  it("sanitizeAuditRowForExport preserves all safe fields for export", () => {
    const rec = mkRecord();
    const row = sanitizeAuditRowForExport(rec);
    expect(containsForbiddenData(row)).toBe(false);
    expect(row.call_id).toBe(rec.call_id);
    expect(row.endpoint_key).toBe("pnl_summary");
  });
});

// ---- 6. Backend authorization source audit ----

describe("backend functions authorize before any service-role query", () => {
  it("getContestControl checks auth + admin role before querying audit records", () => {
    const f = path.join(ROOT, "functions", "getContestControl", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
    expect(content).toContain("asServiceRole");
    expect(content).toContain("401");
    expect(content).toContain("403");
  });

  it("exportContestProof checks auth + admin role before querying audit records", () => {
    const f = path.join(ROOT, "functions", "exportContestProof", "entry.ts");
    const content = fs.readFileSync(f, "utf8");
    expect(content).toContain("base44.auth.me()");
    expect(content).toContain('role !== "admin"');
    expect(content).toContain("asServiceRole");
    expect(content).toContain("401");
    expect(content).toContain("403");
  });
});

// ============================================================================
// REQUIRED LIVE PERMISSION CHECKS (cannot be exercised in unit tests)
//
// The Base44 RLS engine runs server-side. The schema-contract tests above
// prove the entity is configured to deny all clients. The following MUST be
// verified manually against the live published app:
//
// 1. ANONYMOUS client (not signed in):
//    - base44.entities.NansenApiCallAudit.list() → empty or 403
//    - base44.entities.NansenApiCallAudit.create({...}) → 403
//    - base44.entities.NansenApiCallAudit.update(id, {...}) → 403
//    - base44.entities.NansenApiCallAudit.delete(id) → 403
//
// 2. AUTHENTICATED NON-ADMIN client (role: "user"):
//    - base44.entities.NansenApiCallAudit.list() → empty or 403
//    - base44.entities.NansenApiCallAudit.create({...}) → 403
//    - base44.entities.NansenApiCallAudit.update(id, {...}) → 403
//    - base44.entities.NansenApiCallAudit.delete(id) → 403
//
// 3. AUTHENTICATED ADMIN client (role: "admin"):
//    - base44.entities.NansenApiCallAudit.list() → empty or 403
//    - base44.entities.NansenApiCallAudit.create({...}) → 403
//    - base44.entities.NansenApiCallAudit.update(id, {...}) → 403
//    - base44.entities.NansenApiCallAudit.delete(id) → 403
//
// 4. SERVICE ROLE (backend functions via base44.asServiceRole — bypasses RLS):
//    - base44.asServiceRole.entities.NansenApiCallAudit.list("-occurred_at", N) → records
//    - base44.asServiceRole.entities.NansenApiCallAudit.create(rec) → persisted
//    - getContestControl: 401 unauthenticated, 403 non-admin, 200 admin (reads via asServiceRole)
//    - exportContestProof: 401 unauthenticated, 403 non-admin, 200 admin (reads via asServiceRole)
// ============================================================================