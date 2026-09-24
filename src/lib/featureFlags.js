// Wallet Court — client-side public feature flags helper.
// Fetches the public feature flags from the getPublicFeatureFlags backend
// function. Used by Home to filter Robinhood from the network selector when
// robinhood_public_enabled is false.
import { base44 } from "@/api/base44Client";

let cached = null;

export async function getPublicFeatureFlags() {
  try {
    const res = await base44.functions.invoke("getPublicFeatureFlags", {});
    cached = res?.data || { robinhood_public_enabled: false };
    return cached;
  } catch {
    return { robinhood_public_enabled: false };
  }
}

export function getCachedFeatureFlags() {
  return cached || { robinhood_public_enabled: false };
}