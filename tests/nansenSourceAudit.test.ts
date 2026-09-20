import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source audit: no production Nansen fetch may bypass the approved transport.
// The ONLY instrumented transport is callNansenWithTelemetry (inside
// nansenTelemetry.ts), invoked via callEndpointWithRetry. Any new direct
// `fetch(` to Nansen outside that module fails this test.

const ROOT = path.resolve(__dirname, "..", "base44");
const APPROVED_TRANSPORT = "nansenTelemetry.ts";

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

// Strip comments so the audit scans executable code only (not prose that
// mentions "fetch(" in a docstring).
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

describe("Nansen source audit — no bypass of approved transport", () => {
  const files = listTsFiles(ROOT);

  it("collects base44 .ts files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no raw fetch( call exists anywhere in base44/ (all HTTP goes through the transport)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      // Match "fetch(" as a call. The transport uses an injected fetchFn `f`,
      // so no literal fetch( should appear in executable code anywhere.
      if (/\bfetch\s*\(/.test(content)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("api.nansen.ai appears only in nansen.ts (NANSEN_BASE constant)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      if (content.includes("api.nansen.ai")) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual(["shared" + path.sep + "nansen.ts"]);
  });

  it("callEndpointWithRetry is the only retry transport and lives in the approved module", () => {
    const transportFile = files.find((f) => f.endsWith(APPROVED_TRANSPORT));
    expect(transportFile).toBeTruthy();
    const content = fs.readFileSync(transportFile!, "utf8");
    expect(content).toContain("callNansenWithTelemetry");
    expect(content).toContain("callEndpointWithRetry");
  });

  it("nansen.ts callEndpoint delegates to callEndpointWithRetry (no inline fetch)", () => {
    const nansenFile = files.find((f) => f.endsWith(path.join("shared", "nansen.ts")));
    expect(nansenFile).toBeTruthy();
    const content = stripComments(fs.readFileSync(nansenFile!, "utf8"));
    expect(content).toContain("callEndpointWithRetry");
    expect(/\bfetch\s*\(/.test(content)).toBe(false);
  });

  it("all Nansen-calling functions import the transport or fetchNansenEvidence/fetchAddressLabels", () => {
    const callers = [
      "functions" + path.sep + "analyzeWalletWithNansen" + path.sep + "entry.ts",
      "functions" + path.sep + "enrichCasesWithLabels" + path.sep + "entry.ts",
      "functions" + path.sep + "adminProviderHealthCheck" + path.sep + "entry.ts"
    ];
    for (const rel of callers) {
      const f = files.find((x) => x.endsWith(rel));
      expect(f, `missing caller ${rel}`).toBeTruthy();
      const content = stripComments(fs.readFileSync(f!, "utf8"));
      // Each must route through the shared nansen module (which delegates to the
      // transport) — no direct fetch.
      expect(content.includes("nansen")).toBe(true);
      expect(/\bfetch\s*\(/.test(content)).toBe(false);
    }
  });
});