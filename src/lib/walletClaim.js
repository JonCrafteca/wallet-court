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

export async function createRevokeNonce(claimSlug) {
  const res = await base44.functions.invoke("createWalletClaimNonce", { claim_slug: claimSlug, purpose: "wallet_revoke" });
  return res?.data;
}

export async function verifyClaim(caseSlug, message, signature, refCode, visitorId) {
  const res = await base44.functions.invoke("verifyWalletClaim", { case_slug: caseSlug, message, signature, ref_code: refCode, visitor_id: visitorId });
  return res?.data;
}

export async function revokeClaim(claimSlug, message, signature) {
  const res = await base44.functions.invoke("revokeWalletClaim", { claim_slug: claimSlug, message, signature });
  return res?.data;
}

export async function updateProfile(claimSlug, fields) {
  const res = await base44.functions.invoke("updateWalletProfile", { claim_slug: claimSlug, ...fields });
  return res?.data;
}

export async function setCourtName(claimSlug, courtName) {
  const res = await base44.functions.invoke("setCourtName", { claim_slug: claimSlug, court_name: courtName });
  return res?.data;
}

export async function manageHandle(claimSlug, action, provider, handle) {
  const res = await base44.functions.invoke("manageWalletHandle", { claim_slug: claimSlug, action, provider, handle });
  return res?.data;
}

export async function submitDefense(claimSlug, text) {
  const res = await base44.functions.invoke("submitOfficialDefense", { claim_slug: claimSlug, text });
  return res?.data;
}

export async function hideDefense(claimSlug) {
  const res = await base44.functions.invoke("hideOfficialDefense", { claim_slug: claimSlug });
  return res?.data;
}

export async function getDefenseQueue(status) {
  const res = await base44.functions.invoke("getDefenseQueue", { status });
  return res?.data;
}

export async function moderateDefense(id, action, note) {
  const res = await base44.functions.invoke("moderateDefense", { id, action, note });
  return res?.data;
}

export async function createDisputeNonce(caseSlug) {
  const res = await base44.functions.invoke("createWalletClaimNonce", { case_slug: caseSlug, purpose: "wallet_dispute" });
  return res?.data;
}

export async function submitDispute(caseSlug, message, signature) {
  const res = await base44.functions.invoke("submitClaimDispute", { case_slug: caseSlug, message, signature });
  return res?.data;
}

export async function adminOverrideClaim(claimSlug, action, reason) {
  const res = await base44.functions.invoke("adminOverrideClaim", { claim_slug: claimSlug, action, reason });
  return res?.data;
}

export async function cleanupDeletedAccount(userId) {
  const res = await base44.functions.invoke("cleanupDeletedAccount", { user_id: userId });
  return res?.data;
}