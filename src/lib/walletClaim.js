// Frontend wrappers for the wallet-claim backend functions. All go through
// base44.functions.invoke; function data is in res.data. Never put a full
// address, signature, nonce, email, or user id in an analytics payload.
import { base44 } from "@/api/base44Client";

export async function getClaimStatus(caseSlug) {
  const res = await base44.functions.invoke("getWalletClaimStatus", { case_slug: caseSlug });
  return res?.data;
}

export async function getRapSheet(claimSlug) {
  const res = await base44.functions.invoke("getWalletRapSheet", { claim_slug: claimSlug });
  return res?.data;
}

export async function createClaimNonce(caseSlug) {
  const res = await base44.functions.invoke("createWalletClaimNonce", { case_slug: caseSlug });
  return res?.data;
}

export async function verifyClaim(caseSlug, message, signature) {
  const res = await base44.functions.invoke("verifyWalletClaim", {
    case_slug: caseSlug,
    message,
    signature
  });
  return res?.data;
}

export async function updateProfile(claimSlug, fields) {
  const res = await base44.functions.invoke("updateWalletProfile", {
    claim_slug: claimSlug,
    ...fields
  });
  return res?.data;
}