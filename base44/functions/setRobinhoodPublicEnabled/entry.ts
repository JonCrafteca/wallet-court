// Wallet Court — admin-only feature flag setter.
// Sets robinhood_public_enabled on the FeatureFlag singleton.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any write.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { setRobinhoodPublicEnabled, ensureFeatureFlag } from "../../shared/featureFlags.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    const enabled = body?.robinhood_public_enabled;
    if (typeof enabled !== "boolean") {
      return Response.json({ error: "robinhood_public_enabled (boolean) is required." }, { status: 400 });
    }

    await setRobinhoodPublicEnabled(base44, enabled);
    const flag = await ensureFeatureFlag(base44);

    return Response.json({
      robinhood_public_enabled: flag.robinhood_public_enabled,
      updated_at: flag.updated_at
    });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to set feature flag." }, { status: 500 });
  }
}