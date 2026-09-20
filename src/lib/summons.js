// Frontend wrappers for the summons backend functions. All go through
// base44.functions.invoke; function data is in res.data.
import { base44 } from "@/api/base44Client";

export async function createSummons({ case_slug, display_handle }) {
  const res = await base44.functions.invoke("createSummons", {
    case_slug,
    display_handle: display_handle || null,
  });
  return res?.data;
}

export async function updateSummonsStatus({ summons_id, status, share_method, confirmed_post_url }) {
  const res = await base44.functions.invoke("updateSummonsStatus", {
    summons_id,
    status,
    share_method: share_method || null,
    confirmed_post_url: confirmed_post_url || null,
  });
  return res?.data;
}

export async function getSummonsForCase(case_slug) {
  const res = await base44.functions.invoke("getSummonsForCase", { case_slug });
  return res?.data;
}