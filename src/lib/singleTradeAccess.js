// Wallet Court — Single Trade access client helper.
// Calls the getSingleTradeAccess backend function to get the authoritative
// access decision. The backend uses the canonical admin check
// (base44.auth.me + role === "admin") — the same logic that protects
// /admin/single-trade-usage. Never infers admin status from client user
// fields, routes, query strings, local storage, or UI state.
//
// Fails closed to all-false on any error (Coming Soon on the Home page).

import { base44 } from "@/api/base44Client";

const FAIL_CLOSED = {
  public_enabled: false,
  is_admin: false,
  can_access: false,
  admin_preview: false,
  usage_enabled: false,
  emergency_stop: false,
};

export async function getSingleTradeAccess() {
  try {
    const res = await base44.functions.invoke("getSingleTradeAccess", {});
    const data = res?.data;
    if (data && typeof data.can_access === "boolean") {
      return {
        public_enabled: !!data.public_enabled,
        is_admin: !!data.is_admin,
        can_access: !!data.can_access,
        admin_preview: !!data.admin_preview,
        usage_enabled: !!data.usage_enabled,
        emergency_stop: !!data.emergency_stop,
      };
    }
    return { ...FAIL_CLOSED };
  } catch {
    return { ...FAIL_CLOSED };
  }
}