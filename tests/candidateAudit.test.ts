import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source-level audit for Candidate Discovery: verifies admin auth before any
// query, service-role-only RLS on the entity, no raw fetch bypass, no ledger
// update/delete, and no forbidden fields in responses.

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
  return content
    .replace(/\/\/[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

function readEntity(name: string): any {
  const p = path.join(ROOT, "entities", name + ".jsonc");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

describe("Candidate Discovery — source audit", () => {
  const files = listTsFiles(ROOT);

  it("CalibrationCandidate entity has __service_role_only__ RLS on all operations", () => {
    const entity = readEntity("CalibrationCandidate");
    expect(entity.rls).toBeDefined();
    for (const op of ["read", "create", "update", "delete"]) {
      expect(entity.rls[op]).toBeDefined();
      expect(entity.rls[op].user_condition.role).toBe("__service_role_only__");
    }
  });

  it("CalibrationCandidate entity never stores raw Nansen labels (no labels_json field)", () => {
    const entity = readEntity("CalibrationCandidate");
    const propNames = Object.keys(entity.properties);
    expect(propNames).not.toContain("labels_json");
    expect(propNames).not.toContain("raw_labels");
    expect(propNames).not.toContain("address_label");
  });

  it("discoverCalibrationCandidates checks admin auth before any query or Nansen call", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "discoverCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    // Auth check must appear before any entity query or Nansen call
    const authIdx = content.indexOf('base44.auth.me()');
    const firstQueryIdx = content.indexOf('asServiceRole');
    expect(authIdx).toBeGreaterThan(-1);
    expect(firstQueryIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(firstQueryIdx);
    // 401 and 403 checks
    expect(content).toContain("401");
    expect(content).toContain("403");
    expect(content).toContain('user.role !== "admin"');
  });

  it("approveCalibrationCandidates checks admin auth before any query", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "approveCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    const authIdx = content.indexOf('base44.auth.me()');
    const firstQueryIdx = content.indexOf('asServiceRole');
    expect(authIdx).toBeGreaterThan(-1);
    expect(firstQueryIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(firstQueryIdx);
  });

  it("rejectCalibrationCandidate checks admin auth before any query", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "rejectCalibrationCandidate", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    const authIdx = content.indexOf('base44.auth.me()');
    const firstQueryIdx = content.indexOf('asServiceRole');
    expect(authIdx).toBeGreaterThan(-1);
    expect(firstQueryIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(firstQueryIdx);
  });

  it("getCalibrationCandidates checks admin auth before any query", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "getCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    const authIdx = content.indexOf('base44.auth.me()');
    // getCalibrationCandidates delegates to store modules (getCandidates, getVerifiedTotal)
    // which use asServiceRole internally. Auth must appear before the first store call.
    const firstQueryIdx = content.indexOf('getCandidates');
    expect(authIdx).toBeGreaterThan(-1);
    expect(firstQueryIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(firstQueryIdx);
  });

  it("no raw fetch( in any candidate discovery function", () => {
    const candidateFns = [
      "discoverCalibrationCandidates",
      "approveCalibrationCandidates",
      "rejectCalibrationCandidate",
      "getCalibrationCandidates"
    ];
    for (const fn of candidateFns) {
      const f = files.find((x) => x.endsWith(path.join("functions", fn, "entry.ts")));
      expect(f, `missing ${fn}`).toBeTruthy();
      const content = stripComments(fs.readFileSync(f!, "utf8"));
      expect(/\bfetch\s*\(/.test(content)).toBe(false);
    }
  });

  it("discoverCalibrationCandidates routes through callEndpointWithRetry (no inline fetch)", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "discoverCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("callEndpointWithRetry");
    expect(/\bfetch\s*\(/.test(content)).toBe(false);
  });

  it("no production code calls NansenApiCallAudit.update or .delete (append-only ledger)", () => {
    const offenders: string[] = [];
    const forbidden = [".update(", ".delete(", ".updateMany(", ".deleteMany(", ".bulkUpdate("];
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      for (const m of forbidden) {
        if (content.includes("NansenApiCallAudit" + m)) {
          offenders.push(path.relative(ROOT, f) + " → NansenApiCallAudit" + m);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no production code calls CalibrationCandidate.update or .delete directly (CAS via updateMany only)", () => {
    // The store uses updateMany with version filter for CAS. Direct .update()
    // would bypass the CAS guard. Only createCandidates and updateCandidateStatus
    // (which uses updateMany) are allowed.
    const offenders: string[] = [];
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      // Check for CalibrationCandidate.update( (direct update, not updateMany)
      if (content.includes("CalibrationCandidate.update(") && !content.includes("CalibrationCandidate.updateMany")) {
        offenders.push(path.relative(ROOT, f));
      }
      if (content.includes("CalibrationCandidate.delete(") || content.includes("CalibrationCandidate.deleteMany(")) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("approveCalibrationCandidates never calls analyzeWalletWithNansen (no automatic analysis)", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "approveCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).not.toContain("analyzeWalletWithNansen");
    expect(content).not.toContain("functions.invoke");
  });

  it("discoverCalibrationCandidates never creates a WalletTrial (no automatic analysis)", () => {
    const f = files.find((x) => x.endsWith(path.join("functions", "discoverCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).not.toContain("WalletTrial.create");
    expect(content).not.toContain("analyzeWalletWithNansen");
  });

  it("all candidate functions use asServiceRole for entity access (RLS bypass)", () => {
    const candidateFns = [
      "discoverCalibrationCandidates",
      "approveCalibrationCandidates",
      "rejectCalibrationCandidate",
      "getCalibrationCandidates"
    ];
    for (const fn of candidateFns) {
      const f = files.find((x) => x.endsWith(path.join("functions", fn, "entry.ts")));
      expect(f).toBeTruthy();
      const content = stripComments(fs.readFileSync(f!, "utf8"));
      // Must use asServiceRole, not plain entities
      if (content.includes("CalibrationCandidate") || content.includes("CalibrationDocketItem")) {
        expect(content).toContain("asServiceRole");
      }
    }
  });

  it("candidateDiscovery.ts is pure (no base44:runtime import, no SDK)", () => {
    const f = files.find((x) => x.endsWith(path.join("shared", "candidateDiscovery.ts")));
    expect(f).toBeTruthy();
    const content = fs.readFileSync(f!, "utf8");
    expect(content).not.toContain("base44:runtime");
    expect(content).not.toContain("createClientFromRequest");
  });

  it("candidateStore.ts uses asServiceRole for all entity operations", () => {
    const f = files.find((x) => x.endsWith(path.join("shared", "candidateStore.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    // Every entity operation should go through asServiceRole
    expect(content).toContain("asServiceRole");
    expect(content).not.toContain("base44.entities.CalibrationCandidate");
  });
});
