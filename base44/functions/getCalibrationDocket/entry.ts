// Wallet Court — admin-only Calibration Docket dashboard data.
// Returns sanitized queue items, coverage stats, control state, verified
// total, budget check, and coverage recommendations. Also handles the kill
// switch toggle action.
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query.
// Zero Nansen calls. Zero production data mutations (except the toggle action).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  sanitizeDocketItem,
  computeCoverageStats,
  computeEnhancedCoverageStats,
  coverageRecommendation,
  campaignPlanningRecommendations,
  checkBudget,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING,
  containsForbiddenDocketData
} from "../../shared/calibration.ts";
import { getControl, ensureControl, updateControl, getVerifiedTotal } from "../../shared/calibrationStore.ts";
import { getActiveCampaign } from "../../shared/campaignStore.ts";
import { sanitizeCampaignRun, containsForbiddenCampaignData } from "../../shared/calibrationCampaign.ts";

const MAX_ITEMS = 500;

function trackSafe(base44, eventName: string, props: Record<string, any>) {
  try { if (base44?.analytics?.track) waitUntil(base44.analytics.track({ eventName, properties: props })); } catch {}
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    let body: any = {};
    try { body = await req.json() || {}; } catch {}

    // ---- Kill switch toggle action ----
    if (body.action === "toggle_pause") {
      const control = await ensureControl(base44);
      const newEnabled = body.paused === false ? false : !control.calibration_enabled;
      const updated = await updateControl(base44, {
        calibration_enabled: newEnabled,
        paused_reason: newEnabled ? null : (body.reason || "Paused by administrator."),
        paused_at: newEnabled ? null : new Date().toISOString(),
        paused_by_user_id: newEnabled ? null : user.id
      });
      trackSafe(base44, "calibration_kill_switch_toggled", { enabled: newEnabled });
      return Response.json({
        control: sanitizeControl(updated),
        toggled: true
      });
    }

    // ---- Dashboard data ----
    const [items, control, verifiedTotal, activeCampaign] = await Promise.all([
      base44.asServiceRole.entities.CalibrationDocketItem.list("-queued_at", MAX_ITEMS),
      ensureControl(base44),
      getVerifiedTotal(base44),
      getActiveCampaign(base44)
    ]);

    const allItems = items || [];
    const sanitized = allItems.map(sanitizeDocketItem);
    // Privacy guard: never return forbidden fields.
    for (const s of sanitized) {
      if (containsForbiddenDocketData(s)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    const enhancedCoverage = computeEnhancedCoverageStats(allItems);
    const budget = checkBudget(verifiedTotal);
    const recs = coverageRecommendation(enhancedCoverage);
    const planningRecs = campaignPlanningRecommendations(enhancedCoverage);

    // Sanitize campaign state
    let sanitizedCampaign = null;
    if (activeCampaign) {
      sanitizedCampaign = sanitizeCampaignRun(activeCampaign);
      if (containsForbiddenCampaignData(sanitizedCampaign)) {
        return Response.json({ error: "Internal privacy error." }, { status: 500 });
      }
    }

    return Response.json({
      items: sanitized,
      coverage: enhancedCoverage,
      coverage_recommendations: recs,
      campaign_planning_recommendations: planningRecs,
      campaign: sanitizedCampaign,
      control: sanitizeControl(control),
      verified_total: verifiedTotal,
      target: CALIBRATION_TARGET,
      ceiling: CALIBRATION_CEILING,
      budget,
      total_items: allItems.length
    });
  } catch (error) {
    return Response.json({ error: error.message || "Calibration dashboard load failed." }, { status: 500 });
  }
}

// Sanitize the control record for dashboard response. Never includes paused_by_user_id.
function sanitizeControl(control: any): any {
  if (!control) return null;
  return {
    calibration_enabled: control.calibration_enabled,
    paused_reason: control.paused_reason || null,
    paused_at: control.paused_at || null,
    target_reached: !!control.target_reached,
    ceiling_reached: !!control.ceiling_reached,
    updated_at: control.updated_at || null
  };
}