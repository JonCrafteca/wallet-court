// Wallet Court — submit a Court Dispatch to the ShoutIt editorial desk.
// Public app (no auth). Requires explicit consent, validates input, confirms
// the case exists, and throttles rapid duplicate submissions. Stores only
// sanitized public fields (no full wallet addresses).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { findCaseBySlug, sanitizeHandle, isValidHandle } from "../../shared/caseUtils.ts";
import { getCaseOutcome } from "../../shared/evidenceGate.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch {}

    const case_slug = body?.case_slug;
    const submission_type = body?.submission_type;
    const approved_post_text = (body?.approved_post_text || "").trim();
    const optional_x_handle = sanitizeHandle(body?.optional_x_handle);
    const consent = body?.consent_to_publish === true;

    if (!case_slug || !submission_type) {
      return Response.json({ error: "case_slug and submission_type are required." }, { status: 400 });
    }
    if (!["court_dispatch", "self_roast", "challenge_post"].includes(submission_type)) {
      return Response.json({ error: "Invalid submission type." }, { status: 400 });
    }
    if (!consent) {
      return Response.json({ error: "Explicit consent to publish is required." }, { status: 400 });
    }
    if (!approved_post_text) {
      return Response.json({ error: "Post text cannot be empty." }, { status: 400 });
    }
    if (approved_post_text.length > 500) {
      return Response.json({ error: "Post text is too long (max 500 characters)." }, { status: 400 });
    }
    if (optional_x_handle && !isValidHandle(optional_x_handle)) {
      return Response.json({ error: "Invalid X handle." }, { status: 400 });
    }

    const trial = await findCaseBySlug(base44, case_slug);
    if (!trial) return Response.json({ error: "Case not found." }, { status: 404 });

    // Dismissed/mistrial cases have no verdict to share.
    const outcome = getCaseOutcome(trial);
    if (outcome === "dismissed_no_evidence" || outcome === "mistrial_insufficient_evidence") {
      return Response.json({ error: "This case has no verdict to share." }, { status: 422 });
    }

    // Throttle rapid duplicates: same case + text + pending within 10 minutes.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dup = await base44.asServiceRole.entities.CourtDispatchSubmission.filter(
      { case_slug, approved_post_text, status: "pending", submitted_at: { $gte: since } },
      "-submitted_at",
      1
    );
    if (dup && dup.length) {
      return Response.json({ error: "An identical submission is already pending review." }, { status: 409 });
    }

    // dry_run: run every validation (shape, consent, case lookup, duplicate
    // throttle) without persisting. Used by verification so tests never leave
    // production-visible Court Desk records behind.
    if (body?.dry_run === true) {
      return Response.json({ dry_run: true, submission: {
        case_slug, submission_type, approved_post_text,
        optional_x_handle: optional_x_handle || "",
        consent_to_publish: true, data_mode: trial.data_mode,
        verdict_name: trial.verdict_name, verdict_code: trial.verdict_code,
        network: trial.network, status: "pending",
        submitted_at: new Date().toISOString()
      }});
    }

    const record = await base44.asServiceRole.entities.CourtDispatchSubmission.create({
      case_slug,
      submission_type,
      approved_post_text,
      optional_x_handle: optional_x_handle || "",
      consent_to_publish: true,
      data_mode: trial.data_mode,
      verdict_name: trial.verdict_name,
      verdict_code: trial.verdict_code,
      network: trial.network,
      status: "pending",
      submitted_at: new Date().toISOString()
    });

    return Response.json({ submission: record });
  } catch (error) {
    return Response.json({ error: error.message || "Submission failed." }, { status: 500 });
  }
}