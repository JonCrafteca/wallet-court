// Wallet Court — admin-only judge-ready proof export.
// Produces a JSON or CSV export of the verified Nansen call ledger. Exports
// contain only sanitized audit rows and aggregate totals — never wallet
// addresses, secrets, user identifiers, authorization material, or raw evidence.
//
// Authorization: 401 when unauthenticated, 403 when non-admin. Authorization is
// performed BEFORE any audit record is queried. Zero Nansen calls. Zero
// production data mutations.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  buildProofPayload,
  proofToCsv,
  proofFilename,
  CONTEST_TARGET
} from "../../shared/nansenTelemetry.ts";

const MAX_RECORDS = 1000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch { /* allow empty */ }
    const format = body?.format === "csv" ? "csv" : "json";

    const records = await base44.asServiceRole.entities.NansenApiCallAudit.list("-occurred_at", MAX_RECORDS);
    const all = records || [];

    const generatedAt = new Date().toISOString();
    const filename = proofFilename(generatedAt, format);

    if (format === "csv") {
      const csv = proofToCsv(all);
      return Response.json({ format, filename, content: csv, generated_at: generatedAt });
    }

    const proof = await buildProofPayload({ records: all, generatedAt, target: CONTEST_TARGET });
    return Response.json({ format, filename, content: proof, generated_at: generatedAt });
  } catch (error) {
    return Response.json({ error: error.message || "Proof export failed." }, { status: 500 });
  }
}