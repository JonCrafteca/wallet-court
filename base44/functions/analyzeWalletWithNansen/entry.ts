// Wallet Court — secure, backend-only wallet analysis.
// Reads the Nansen API key ONLY from the server secret store. When no usable
// key is configured (or the live call fails), the function falls back to clearly
// labeled demo fixtures so the experience always produces a verdict.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import {
  validateAddress,
  normalizeAddress,
  selectDemoVerdictIndex,
  buildVerdictPayload,
  VERDICTS,
  NETWORKS
} from "../../shared/verdicts.ts";

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

    // Determine data mode. The key is read only from the server secret store and
    // never returned to the client. Live mode requires a real, working key AND
    // a successful Nansen call; otherwise we fall back to demo fixtures and label
    // the record honestly as demo.
    const apiKey = secrets.get("NANSEN_API_KEY");
    let dataMode = "demo";
    let nansenData = null;
    if (apiKey && apiKey.trim().length > 0) {
      try {
        nansenData = await fetchNansenEvidence(apiKey, network, normalized);
        // Only treat as live once the response is usable. Until the Nansen
        // endpoint contract is confirmed and mapped to verdict metrics, we do
        // not label results as live — demo verdicts must never pose as live.
        if (!nansenData) dataMode = "demo";
      } catch {
        nansenData = null;
        dataMode = "demo";
      }
    }

    // Verdict selection is deterministic and explainable. Demo mode hashes the
    // normalized address to a stable verdict; the mandatory demo address is
    // pinned to One Pump Chump. (Live mode will eventually compute the verdict
    // from real Nansen metrics — until that mapping is implemented, we keep the
    // honest demo label.)
    const verdictIndex = selectDemoVerdictIndex(normalized);
    const verdict = VERDICTS[verdictIndex];
    const payload = buildVerdictPayload(verdict, normalized, network, dataMode, nansenData);

    const public_slug =
      "case-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

    const record = await base44.asServiceRole.entities.WalletTrial.create({
      wallet_address,
      normalized_wallet_address: normalized,
      network,
      status: "completed",
      data_mode: dataMode,
      ...payload,
      public_slug,
      analyzed_at: new Date().toISOString()
    });

    return Response.json({ trial: record });
  } catch (error) {
    return Response.json({ error: error.message || "The court failed to convene." }, { status: 500 });
  }
}

// Best-effort live Nansen fetch. The exact endpoint contract is finalized with
// Nansen credentials; until then a failed/empty response simply returns null and
// the caller falls back to demo mode — never a broken page.
async function fetchNansenEvidence(apiKey, network, address) {
  const url = "https://api.nansen.ai/v1/wallet/profit-loss?network=" + encodeURIComponent(network) + "&address=" + encodeURIComponent(address);
  const res = await fetch(url, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" }
  });
  if (!res.ok) throw new Error("Nansen API error " + res.status);
  const json = await res.json();
  if (!json || (!json.data && !json.result)) return null;
  return json;
}