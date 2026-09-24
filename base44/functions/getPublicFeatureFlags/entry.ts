// Wallet Court — public feature flags endpoint. No auth required.
// Returns only the flags that are safe for public consumption.
// Used by the frontend IntakeStage to hide Robinhood from the network selector
// when robinhood_public_enabled is false.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { isRobinhoodPublicEnabled } from "../../shared/featureFlags.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const robinhood_public_enabled = await isRobinhoodPublicEnabled(base44);
    return Response.json({ robinhood_public_enabled });
  } catch {
    // On any error, return the safe default (false).
    return Response.json({ robinhood_public_enabled: false });
  }
}