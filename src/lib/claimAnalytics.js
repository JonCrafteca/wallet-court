// Privacy-safe wallet-claim analytics. No wallet addresses, signatures, nonces,
// emails, or user ids are ever placed in the properties.
import { base44 } from "@/api/base44Client";

export const CLAIM_EVENTS = {
  CLAIM_STARTED: "wallet_claim_started",
  WALLET_CONNECTED: "wallet_connected_for_claim",
  SIGNATURE_REQUESTED: "wallet_claim_signature_requested",
  CLAIM_VERIFIED: "wallet_claim_verified",
  CLAIM_FAILED: "wallet_claim_failed",
  RAP_SHEET_VIEWED: "rap_sheet_viewed",
  VISIBILITY_CHANGED: "rap_sheet_visibility_changed",
  RAP_SHEET_SHARED: "rap_sheet_shared"
};

export function trackClaim(event, properties = {}) {
  try {
    base44.analytics.track({ eventName: event, properties });
  } catch {
    // analytics must never break the claim flow
  }
}