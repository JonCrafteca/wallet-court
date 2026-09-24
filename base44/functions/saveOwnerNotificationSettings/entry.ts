// Wallet Court — admin-only save of owner notification settings. Creates or
// updates the singleton with the provided fields. Does NOT send any emails.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { saveSettings, getSettings } from "../../shared/ownerNotificationStore.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch {}
    const { recipient_email, master_enabled, signup_enabled, claim_enabled, verdict_enabled } = body || {};

    const saved = await saveSettings(base44, {
      recipient_email: typeof recipient_email === "string" ? recipient_email.trim() : undefined,
      master_enabled: typeof master_enabled === "boolean" ? master_enabled : undefined,
      signup_enabled: typeof signup_enabled === "boolean" ? signup_enabled : undefined,
      claim_enabled: typeof claim_enabled === "boolean" ? claim_enabled : undefined,
      verdict_enabled: typeof verdict_enabled === "boolean" ? verdict_enabled : undefined
    });

    return Response.json({ settings: saved });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to save settings." }, { status: 500 });
  }
}