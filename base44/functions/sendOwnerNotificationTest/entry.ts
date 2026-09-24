// Wallet Court — admin-only test email. Sends a test email to the configured
// recipient and records the result (last_test_status, last_test_timestamp,
// last_test_error). Does NOT require master_enabled — the admin can test
// delivery independently of the notification system. Does require a
// non-empty recipient_email.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { getSettings, updateTestResult } from "../../shared/ownerNotificationStore.ts";
import { buildTestEmail } from "../../shared/ownerNotifications.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    const settings = await getSettings(base44);
    const recipient = settings?.recipient_email || "";
    if (!recipient.trim()) {
      return Response.json({ error: "Recipient email is not configured. Set a recipient email before sending a test." }, { status: 400 });
    }

    const email = buildTestEmail();
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: recipient.trim(),
        subject: email.subject,
        body: email.body
      });
      await updateTestResult(base44, "success", null);
      return Response.json({ sent: true, recipient: recipient.trim() });
    } catch (e) {
      const errorMsg = e?.message || "Email delivery failed.";
      await updateTestResult(base44, "failed", errorMsg);
      return Response.json({ sent: false, error: errorMsg }, { status: 500 });
    }
  } catch (error) {
    return Response.json({ error: error.message || "Test email failed." }, { status: 500 });
  }
}