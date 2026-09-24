// Wallet Court — admin-only read of owner notification settings. Returns the
// singleton settings record, or safe defaults if no record exists yet.
// NEVER creates or mutates settings — viewing the page must be side-effect-free.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getSettingsOrDefault } from "../../shared/ownerNotificationStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const settings = await getSettingsOrDefault(base44);
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load settings." }, { status: 500 });
  }
}