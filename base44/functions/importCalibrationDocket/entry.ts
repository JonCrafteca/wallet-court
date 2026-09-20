// Wallet Court — admin-only Calibration Docket import.
// Parses CSV/paste input, runs a zero-Nansen-call preflight (validation,
// normalization, fingerprinting, deduplication), and optionally stores
// accepted items. Supports dry-run mode (validate without storing).
//
// Authorization: 401 unauthenticated, 403 non-admin. Auth before any query or
// write. Zero Nansen calls. Creates queue items only on explicit approve.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { waitUntil } from "base44:runtime";
import {
  parseCalibrationImport,
  preflightEntries,
  walletFingerprint,
  newDocketItemId,
  MAX_IMPORT
} from "../../shared/calibration.ts";
import { getExistingQueueFingerprints } from "../../shared/calibrationStore.ts";

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

    const text = body.text;
    if (!text || typeof text !== "string" || !text.trim()) {
      return Response.json({ error: "Import text is required." }, { status: 400 });
    }
    const dryRun = body.dry_run !== false;

    // Parse CSV/paste input
    const entries = parseCalibrationImport(text);
    if (entries.length === 0) {
      return Response.json({ error: "No entries found in input." }, { status: 400 });
    }
    if (entries.length > MAX_IMPORT) {
      return Response.json({ error: `Import exceeds maximum of ${MAX_IMPORT} entries. Found ${entries.length}.` }, { status: 400 });
    }

    // Collect existing fingerprints for dedup (zero Nansen calls)
    const [queueFingerprints, trialRecords] = await Promise.all([
      getExistingQueueFingerprints(base44),
      base44.asServiceRole.entities.WalletTrial.list("-created_date", 500)
    ]);

    // Compute fingerprints for existing trials
    const trialFingerprints = new Set<string>();
    for (const t of trialRecords || []) {
      if (t.normalized_wallet_address && t.network) {
        const fp = await walletFingerprint(t.network, t.normalized_wallet_address);
        trialFingerprints.add(fp);
      }
    }

    // Run preflight (zero Nansen calls)
    const preflight = await preflightEntries(entries, queueFingerprints, trialFingerprints);

    trackSafe(base44, "calibration_preflight_completed", {
      total: preflight.counts.total,
      accepted: preflight.counts.accepted,
      invalid: preflight.counts.invalid,
      duplicate_in_file: preflight.counts.duplicate_in_file,
      already_queued: preflight.counts.already_queued,
      already_tried: preflight.counts.already_tried,
      dry_run: dryRun
    });

    if (dryRun) {
      return Response.json({
        dry_run: true,
        preflight
      });
    }

    // Approve and queue: create CalibrationDocketItem records for accepted items
    const now = new Date().toISOString();
    const toCreate = preflight.accepted.map((item) => ({
      docket_item_id: newDocketItemId(),
      network: item.network,
      wallet_address: item.wallet_address,
      normalized_wallet_address: item.normalized_wallet_address,
      wallet_fingerprint: item.wallet_fingerprint,
      address_short: item.address_short,
      source_label: item.source_label,
      test_objective: item.test_objective,
      status: "pending",
      version: 0,
      attempt_count: 0,
      queued_at: now
    }));

    let created = 0;
    if (toCreate.length > 0) {
      const result = await base44.asServiceRole.entities.CalibrationDocketItem.bulkCreate(toCreate);
      created = Array.isArray(result) ? result.length : (result?.length || toCreate.length);
    }

    trackSafe(base44, "calibration_items_queued", { count: created });

    return Response.json({
      dry_run: false,
      preflight,
      queued: created
    });
  } catch (error) {
    return Response.json({ error: error.message || "Import failed." }, { status: 500 });
  }
}