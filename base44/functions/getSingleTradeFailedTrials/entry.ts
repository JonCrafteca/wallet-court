// Wallet Court — Single Trade Trial: list failed trials for the admin
// dashboard. Admin-only. Returns safe display fields only — never the full
// wallet address or transaction hash.
//
// Used by the FAILED TRIALS section on /admin/single-trade-usage so admins
// can retry failed cases without leaving the authenticated admin area.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr || "";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function shortTx(hash) {
  if (!hash || hash.length < 12) return hash || "";
  return hash.slice(0, 6) + "…" + hash.slice(-4);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // ---- Admin-only ----
    let user = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Sign in to access the admin dashboard." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

    // ---- Query failed trials (service-role) ----
    const records = await base44.asServiceRole.entities.SingleTradeTrial.filter(
      { status: "failed" }, "-created_date", 50
    );

    // ---- Map to safe display fields ----
    const trials = (records || []).map((r) => ({
      public_slug: r.public_slug,
      network: r.network,
      token_symbol: r.token_symbol || "",
      token_mint: r.token_mint || "",
      address_short: shortAddress(r.wallet_address),
      transaction_hash_short: shortTx(r.transaction_hash),
      error_code: r.error_code || null,
      error_message: r.error_message || null,
      created_date: r.created_date
    }));

    return Response.json({ trials });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load failed trials." }, { status: 500 });
  }
}