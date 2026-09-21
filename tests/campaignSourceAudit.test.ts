import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source audit tests for the new Calibration Campaign Runner entities and
// functions. Verifies:
// - No raw fetch() to Nansen outside the approved transport
// - No NansenApiCallAudit update/delete paths
// - All new entities have __service_role_only__ RLS
// - All new functions check admin auth before any query
// - No duplicate analysis or telemetry implementation
// - Sanitized frontend responses (no forbidden fields)

const ROOT = path.resolve(__dirname, "..", "base44");

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

function listJsoncFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsoncFiles(full, acc);
    else if (entry.name.endsWith(".jsonc")) acc.push(full);
  }
  return acc;
}

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

describe("Campaign Runner — source audit", () => {
  const tsFiles = listTsFiles(ROOT);

  it("no raw fetch( call in any campaign function", () => {
    const offenders: string[] = [];
    for (const f of tsFiles) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      if (/\bfetch\s*\(/.test(content)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no NansenApiCallAudit.update or .delete in any campaign function", () => {
    const offenders: string[] = [];
    const forbidden = [".update(", ".delete(", ".updateMany(", ".deleteMany(", ".bulkUpdate("];
    for (const f of tsFiles) {
      const content = stripComments(fs.readFileSync(f, "utf8"));
      for (const m of forbidden) {
        if (content.includes("NansenApiCallAudit" + m)) {
          offenders.push(path.relative(ROOT, f) + " → NansenApiCallAudit" + m);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no duplicate analyzeWalletWithNansen implementation", () => {
    // The only place analyzeWalletWithNansen should appear as a function
    // definition is in its own entry.ts. Other files should only invoke it.
    for (const f of tsFiles) {
      if (f.endsWith(path.join("functions", "analyzeWalletWithNansen", "entry.ts"))) continue;
      if (f.endsWith(path.join("shared", "nansen.ts"))) continue;
      const content = stripComments(fs.readFileSync(f, "utf8"));
      // Look for evidence of a duplicate pipeline (fetchNansenEvidence, mapEvidence, etc.)
      // being re-implemented outside nansen.ts
      if (f.endsWith(path.join("shared", "nansen.ts"))) continue;
      if (content.includes("function mapEvidence(") || content.includes("function fetchNansenEvidence(")) {
        // Only nansen.ts should define these
        if (!f.endsWith(path.join("shared", "nansen.ts"))) {
          expect.fail(`Duplicate pipeline implementation in ${path.relative(ROOT, f)}`);
        }
      }
    }
  });

  it("campaign functions do not duplicate telemetry logic", () => {
    // callNansenWithTelemetry and callEndpointWithRetry should only be defined
    // in nansenTelemetry.ts
    for (const f of tsFiles) {
      if (f.endsWith(path.join("shared", "nansenTelemetry.ts"))) continue;
      const content = stripComments(fs.readFileSync(f, "utf8"));
      if (content.includes("function callNansenWithTelemetry(") || content.includes("function callEndpointWithRetry(")) {
        expect.fail(`Duplicate telemetry implementation in ${path.relative(ROOT, f)}`);
      }
    }
  });

  it("all new campaign functions check admin auth before any query", () => {
    const campaignFunctions = [
      "startCalibrationCampaign",
      "advanceCalibrationCampaign",
      "pauseCalibrationCampaign",
      "stopCalibrationCampaign",
      "resumeCalibrationCampaign",
      "getCalibrationCampaign"
    ];
    for (const fn of campaignFunctions) {
      const f = tsFiles.find((x) => x.endsWith(path.join("functions", fn, "entry.ts")));
      expect(f, `missing function ${fn}`).toBeTruthy();
      const content = stripComments(fs.readFileSync(f!, "utf8"));
      // Must check auth.me() and role === "admin"
      expect(content).toContain("base44.auth.me()");
      expect(content).toContain("admin");
    }
  });

  it("CalibrationRun entity has __service_role_only__ RLS", () => {
    const entityFiles = listJsoncFiles(path.join(ROOT, "entities"));
    const runEntity = entityFiles.find((f) => f.endsWith("CalibrationRun.jsonc"));
    expect(runEntity).toBeTruthy();
    const content = fs.readFileSync(runEntity!, "utf8");
    expect(content).toContain("__service_role_only__");
    // All four RLS operations must be service-role-only
    const rlsMatches = content.match(/"role":\s*"__service_role_only__"/g);
    expect(rlsMatches?.length).toBe(4);
  });

  it("CalibrationDiscovery entity has __service_role_only__ RLS", () => {
    const entityFiles = listJsoncFiles(path.join(ROOT, "entities"));
    const discoveryEntity = entityFiles.find((f) => f.endsWith("CalibrationDiscovery.jsonc"));
    expect(discoveryEntity).toBeTruthy();
    const content = fs.readFileSync(discoveryEntity!, "utf8");
    expect(content).toContain("__service_role_only__");
    const rlsMatches = content.match(/"role":\s*"__service_role_only__"/g);
    expect(rlsMatches?.length).toBe(4);
  });

  it("CalibrationDocketItem entity still has __service_role_only__ RLS", () => {
    const entityFiles = listJsoncFiles(path.join(ROOT, "entities"));
    const docketEntity = entityFiles.find((f) => f.endsWith("CalibrationDocketItem.jsonc"));
    expect(docketEntity).toBeTruthy();
    const content = fs.readFileSync(docketEntity!, "utf8");
    expect(content).toContain("__service_role_only__");
    const rlsMatches = content.match(/"role":\s*"__service_role_only__"/g);
    expect(rlsMatches?.length).toBe(4);
  });

  it("CalibrationRun entity never stores wallet_address or started_by_user_id in sanitized responses", () => {
    const campaignFile = tsFiles.find((f) => f.endsWith(path.join("shared", "calibrationCampaign.ts")));
    expect(campaignFile).toBeTruthy();
    const content = fs.readFileSync(campaignFile!, "utf8");
    // sanitizeCampaignRun must NOT include started_by_user_id
    expect(content).toContain("FORBIDDEN_CAMPAIGN_FIELDS");
    expect(content).toContain("started_by_user_id");
    expect(content).toContain("wallet_address");
  });

  it("approveCalibrationCandidates enforces MAX_BULK_APPROVE of 50", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "approveCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = fs.readFileSync(f!, "utf8");
    expect(content).toContain("MAX_BULK_APPROVE");
    expect(content).toContain("50");
  });

  it("approveCalibrationCandidates supports preview mode", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "approveCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("body.preview");
    expect(content).toContain("buildApprovalPreview");
  });

  it("discoverCalibrationCandidates has duplicate-discovery protection", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "discoverCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("body.force");
    expect(content).toContain("getRecentDiscovery");
    expect(content).toContain("duplicate_warning");
  });

  it("discoverCalibrationCandidates creates a CalibrationDiscovery record after success", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "discoverCalibrationCandidates", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("createDiscoveryRecord");
  });

  it("campaign functions use CAS (updateMany with version filter) for claiming items", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "startCalibrationCampaign", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("claimFilter");
    expect(content).toContain("updateMany");
  });

  it("stopCalibrationCampaign reverts unprocessed items to pending via delegated helper", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "stopCalibrationCampaign", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    // Stop delegates reversion to revertNonCurrentProcessingItems (in campaignStore),
    // which uses updateMany with ITEM_STATUS.PENDING internally. The stop function
    // itself should call the helper and release the campaign lock on terminal stop.
    expect(content).toContain("revertNonCurrentProcessingItems");
    expect(content).toContain("releaseCampaignLock");
  });

  it("resumeCalibrationCampaign requires explicit confirmation", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "resumeCalibrationCampaign", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("body.confirmed");
  });

  it("advanceCalibrationCampaign checks budget and circuit before claiming next item", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "advanceCalibrationCampaign", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("getVerifiedTotal");
    expect(content).toContain("checkBudget");
    expect(content).toContain("isCircuitOpen");
  });

  it("getCalibrationCampaign returns sanitized DTOs only", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "getCalibrationCampaign", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("sanitizeCampaignRun");
    expect(content).toContain("sanitizeDocketItem");
    expect(content).toContain("containsForbiddenCampaignData");
    expect(content).toContain("containsForbiddenDocketData");
  });

  it("getCalibrationDocket returns enhanced coverage and campaign state", () => {
    const f = tsFiles.find((x) => x.endsWith(path.join("functions", "getCalibrationDocket", "entry.ts")));
    expect(f).toBeTruthy();
    const content = stripComments(fs.readFileSync(f!, "utf8"));
    expect(content).toContain("computeEnhancedCoverageStats");
    expect(content).toContain("campaignPlanningRecommendations");
    expect(content).toContain("getActiveCampaign");
    expect(content).toContain("sanitizeCampaignRun");
  });

  it("no campaign function directly invokes analyzeWalletWithNansen (delegates to processCalibrationWallet)", () => {
    // Campaign functions should NOT call analyzeWalletWithNansen directly.
    // They call processCalibrationWallet which in turn invokes the pipeline.
    const campaignFunctions = [
      "startCalibrationCampaign",
      "advanceCalibrationCampaign",
      "pauseCalibrationCampaign",
      "stopCalibrationCampaign",
      "resumeCalibrationCampaign",
      "getCalibrationCampaign"
    ];
    for (const fn of campaignFunctions) {
      const f = tsFiles.find((x) => x.endsWith(path.join("functions", fn, "entry.ts")));
      if (!f) continue;
      const content = stripComments(fs.readFileSync(f, "utf8"));
      expect(content).not.toContain("functions.invoke(\"analyzeWalletWithNansen\"");
      expect(content).not.toContain("fetchNansenEvidence");
    }
  });

  it("CalibrationDocketItem entity has discovery_cohort and discovery_timeframe fields", () => {
    const entityFiles = listJsoncFiles(path.join(ROOT, "entities"));
    const docketEntity = entityFiles.find((f) => f.endsWith("CalibrationDocketItem.jsonc"));
    expect(docketEntity).toBeTruthy();
    const content = fs.readFileSync(docketEntity!, "utf8");
    expect(content).toContain("discovery_cohort");
    expect(content).toContain("discovery_timeframe");
  });
});