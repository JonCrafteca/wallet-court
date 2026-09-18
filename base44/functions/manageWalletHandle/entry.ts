// Wallet Court — owner-only social handle management. Supports add, hide,
// show, and remove actions. One handle per provider per claim. All handles are
// "Self-reported · Unverified" — no OAuth verification exists in Phase N3.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { validateHandle, sanitizeHandlePublic, isValidProvider } from "../../shared/handles.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const claim_slug = body?.claim_slug;
    const action = body?.action; // "add" | "hide" | "show" | "remove"
    const provider = body?.provider;
    if (!claim_slug) return Response.json({ error: "claim_slug is required." }, { status: 400 });
    if (!action) return Response.json({ error: "action is required." }, { status: 400 });
    if (!isValidProvider(provider)) return Response.json({ error: "Unknown social platform." }, { status: 422 });

    const claims = await base44.asServiceRole.entities.WalletClaim.filter(
      { claim_slug, status: "active" }, "-verified_at", 5
    );
    const claim = claims && claims[0];
    if (!claim) return Response.json({ error: "Claim not found." }, { status: 404 });
    if (claim.owner_user_id !== user.id) return Response.json({ error: "You do not own this claim." }, { status: 403 });

    // Find existing handle for this provider.
    const existing = await base44.asServiceRole.entities.WalletHandle.filter(
      { claim_slug, provider }, "-created_date", 5
    );
    const handleRec = existing && existing[0];

    if (action === "add") {
      const v = validateHandle(provider, body?.handle);
      if (!v.ok) return Response.json({ error: v.error }, { status: 422 });
      if (handleRec) {
        const updated = await base44.asServiceRole.entities.WalletHandle.update(handleRec.id, {
          display_handle: v.display, normalized_handle: v.normalized, visibility: "visible"
        });
        return Response.json({ handle: sanitizeHandlePublic(updated) });
      }
      const created = await base44.asServiceRole.entities.WalletHandle.create({
        claim_slug, owner_user_id: user.id, provider,
        normalized_handle: v.normalized, display_handle: v.display,
        verification_state: "unverified", visibility: "visible"
      });
      return Response.json({ handle: sanitizeHandlePublic(created) });
    }

    if (!handleRec) return Response.json({ error: "Handle not found." }, { status: 404 });

    if (action === "hide") {
      await base44.asServiceRole.entities.WalletHandle.update(handleRec.id, { visibility: "hidden" });
    } else if (action === "show") {
      await base44.asServiceRole.entities.WalletHandle.update(handleRec.id, { visibility: "visible" });
    } else if (action === "remove") {
      await base44.asServiceRole.entities.WalletHandle.delete(handleRec.id);
    } else {
      return Response.json({ error: "Invalid action." }, { status: 400 });
    }

    // Return the updated handle list.
    const all = await base44.asServiceRole.entities.WalletHandle.filter({ claim_slug }, "-created_date", 20);
    return Response.json({ handles: (all || []).filter((h) => h.visibility === "visible").map(sanitizeHandlePublic) });
  } catch (error) {
    return Response.json({ error: error.message || "Could not manage handle." }, { status: 500 });
  }
}