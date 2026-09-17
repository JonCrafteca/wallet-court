// Wallet Court — secure, backend-only wallet analysis.
// Reads the Nansen API key ONLY from the server secret store. The key is never
// returned to the client, stored on the trial, or placed in error messages.
// Live mode requires the two required Nansen endpoints to succeed; otherwise
// the case falls back to an honestly-labeled demo verdict.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import {
  validateAddress,
  normalizeAddress,
  selectDemoVerdictIndex,
  buildVerdictPayload,
  VERDICTS,
  NETWORKS,
  MANDATORY_DEMO_ADDRESS
} from "../../shared/verdicts.ts";
import {
  selectLiveVerdictIndex,
  computeSeverityConfidence,
  buildLiveVerdictPayload
} from "../../shared/verdicts_live.ts";
import { fetchNansenEvidence } from "../../shared/nansen.ts";

function newSlug() {
  return "case-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
    const wallet_address = body?.wallet_address;
    const network = body?.network;

    if (!wallet_address || !network) {
      return Response.json({ error: "wallet_address and network are required." }, { status: 400 });
    }
    if (!NETWORKS.includes(network)) {
      return Response.json({ error: "Unsupported network." }, { status: 400 });
    }
    if (!validateAddress(network, wallet_address)) {
      return Response.json({ error: "That does not look like a valid address for the selected network." }, { status: 422 });
    }

    const normalized = normalizeAddress(network, wallet_address);
    const windowDays = Math.min(Math.max(parseInt(body?.window_days, 10) || 180, 7), 365);
    const public_slug = newSlug();

    // Mandatory demo wallet: deterministic demo verdict, never spends Nansen calls.
    if (normalized.toLowerCase() === MANDATORY_DEMO_ADDRESS) {
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug);
      return Response.json({ trial, analysis: { outcome: "demo", error_category: null, partial: false, nansen_calls: 0 } });
    }

    const apiKey = secrets.get("NANSEN_API_KEY");
    if (apiKey && apiKey.trim()) {
      const nansen = await fetchNansenEvidence(apiKey, network, normalized, {
        windowDays,
        caseSlug: public_slug,
        base44,
        timeoutMs: 20000
      });
      const analysis = {
        outcome: nansen.outcome,
        error_category: nansen.errorCategory,
        partial: nansen.partial,
        nansen_calls: nansen.nansenCalls
      };

      if (nansen.outcome === "live" || nansen.outcome === "partial") {
        const verdictIndex = selectLiveVerdictIndex(nansen.metrics);
        const verdict = VERDICTS[verdictIndex];
        const { severity, confidence } = computeSeverityConfidence(nansen.metrics, nansen.partial);
        const payload = buildLiveVerdictPayload(verdict, nansen.evidence, nansen.metrics, nansen.meta, nansen.sources, severity, confidence);
        const record = await base44.asServiceRole.entities.WalletTrial.create({
          wallet_address,
          normalized_wallet_address: normalized,
          network,
          status: "completed",
          data_mode: "live",
          ...payload,
          public_slug,
          analyzed_at: new Date().toISOString()
        });
        return Response.json({ trial: record, analysis });
      }

      // Required evidence failed — honest demo fallback (usage already logged).
      const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug);
      return Response.json({ trial, analysis });
    }

    // No key configured — honest demo.
    const trial = await createDemoTrial(base44, wallet_address, normalized, network, public_slug);
    return Response.json({ trial, analysis: { outcome: "demo", error_category: "missing_key", partial: false, nansen_calls: 0 } });
  } catch (error) {
    return Response.json({ error: error.message || "The court failed to convene." }, { status: 500 });
  }
}

async function createDemoTrial(base44, wallet_address, normalized, network, public_slug) {
  const verdictIndex = selectDemoVerdictIndex(normalized);
  const verdict = VERDICTS[verdictIndex];
  const payload = buildVerdictPayload(verdict, normalized, network, "demo", null);
  return base44.asServiceRole.entities.WalletTrial.create({
    wallet_address,
    normalized_wallet_address: normalized,
    network,
    status: "completed",
    data_mode: "demo",
    ...payload,
    public_slug,
    analyzed_at: new Date().toISOString()
  });
}