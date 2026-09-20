// Wallet Court — create a summons for a case. Auth is optional (anonymous
// users may create summons). Validates the case exists and has a verdict
// outcome, normalizes the X handle, enforces rate limits, prevents duplicates,
// and returns a sanitized summons record. Never auto-posts or sends DMs.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  normalizeXHandleInput,
  generateSummonsId,
  isDuplicateSummons,
  checkSummonsRateLimit,
  sanitizeSummonsPublic,
  SUMMONS_RATE_LIMIT_WINDOW_MS,
} from "../../shared/summons.ts";
import { findCaseBySlug } from "../../shared/caseUtils.ts";
import { resolveCaseOutcome } from "../../shared/accountDashboard.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // Auth is optional — anonymous users may create summons
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      // not authenticated — anonymous
    }

    let body = {};
    try { body = await req.json(); } catch {}
    const { case_slug, display_handle } = body || {};
    if (!case_slug) return Response.json({ error: "case_slug is required." }, { status: 400 });

    // Verify the case exists and has a verdict outcome
    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });
    const outcome = resolveCaseOutcome(trial);
    if (outcome === "dismissed_no_evidence" || outcome === "mistrial_insufficient_evidence") {
      return Response.json({ error: "Summons are not available for dismissed or mistrial cases." }, { status: 400 });
    }

    // Normalize the handle (optional — null means anonymous defendant)
    let normalizedHandle = null;
    let displayHandle = null;
    if (display_handle) {
      const result = normalizeXHandleInput(display_handle);
      if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
      displayHandle = result.handle;
      normalizedHandle = result.normalized;
    }

    // Check for duplicate summons (same case + same handle)
    if (normalizedHandle) {
      const existing = await base44.asServiceRole.entities.Summons.filter(
        { case_slug, normalized_target_handle: normalizedHandle, abuse_status: "clean" },
        "-created_at",
        5
      );
      if (isDuplicateSummons(existing, normalizedHandle)) {
        return Response.json({
          error: "A summons for this handle and case already exists.",
          duplicate: true,
        }, { status: 409 });
      }
    }

    // Rate limit: check recent summons by this user (or anonymous)
    const isAnonymous = !user;
    const creatorFilter = user ? { creator_user_id: user.id } : { creator_user_id: null };
    const recentSummons = await base44.asServiceRole.entities.Summons.filter(
      creatorFilter,
      "-created_at",
      50
    );
    const rateLimit = checkSummonsRateLimit(recentSummons, isAnonymous, normalizedHandle);
    if (!rateLimit.ok) {
      return Response.json({ error: rateLimit.error }, { status: 429 });
    }

    // Create the summons
    const nowIso = new Date().toISOString();
    const summonsId = generateSummonsId();
    const status = displayHandle ? "summons_ready" : "anonymous_defendant";

    const summons = await base44.asServiceRole.entities.Summons.create({
      summons_id: summonsId,
      case_slug,
      normalized_target_handle: normalizedHandle,
      display_handle: displayHandle,
      creator_user_id: user?.id || null,
      status,
      share_method: "none",
      confirmed_post_url: null,
      abuse_status: "clean",
      created_at: nowIso,
      updated_at: nowIso,
    });

    return Response.json({ summons: sanitizeSummonsPublic(summons) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not create summons." }, { status: 500 });
  }
}