// Wallet Court — nonce lifecycle: rate limiting, atomic one-time consumption,
// and replay rejection. Pure, unit-testable: takes a NonceDataAccess
// interface so the logic can be tested with a mock that simulates CAS
// semantics without the Base44 platform runtime.
//
// The key behavioral guarantee: a nonce can be consumed by exactly one
// concurrent request. This is enforced by casConsumeNonce, which uses
// updateMany with { used_at: null } in the filter — a CAS guard. Two
// concurrent requests that both find the same unused nonce will race to
// consume it; only the first CAS succeeds (sets used_at), the second
// matches 0 documents and is rejected.

export async function enforceRateLimit(da, params) {
  const sinceIso = new Date(Date.now() - params.windowMs).toISOString();
  const count = await da.countRecentNonces({
    ownerUserId: params.ownerUserId,
    normalizedAddress: params.normalizedAddress,
    purpose: params.purpose,
    sinceIso,
  });
  if (count >= params.max) {
    return {
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    };
  }
  return { ok: true };
}

export async function acquireValidNonce(da, params) {
  const nowIso = params.nowIso || new Date().toISOString();
  const nonce = await da.findValidNonce({
    ownerUserId: params.ownerUserId,
    normalizedAddress: params.normalizedAddress,
    messageHash: params.messageHash,
    purpose: params.purpose,
    nowIso,
  });
  if (!nonce) {
    return {
      ok: false,
      error: "Claim session expired or already used. Please start again.",
      code: "nonce_invalid",
    };
  }
  // CAS consume — only one concurrent request can set used_at.
  const result = await da.casConsumeNonce(nonce.id, nowIso);
  if (!result.consumed) {
    return {
      ok: false,
      error: "Claim session was already used. Please start again.",
      code: "nonce_consumed",
    };
  }
  return { ok: true, nonce };
}

// Validate every parsed field against the expected values. Any mismatch
// means the message was tampered, replayed from a different context, or
// belongs to a different nonce — all are rejected.
export function validateNonceFields(parsed, expected) {
  if (parsed.purpose !== expected.purpose) return "Purpose mismatch.";
  if (parsed.account !== expected.account) return "Account mismatch.";
  if (parsed.case !== expected.caseSlug) return "Case mismatch.";
  if (parsed.network !== expected.network) return "Network mismatch.";
  if (parsed.wallet !== expected.wallet) return "Wallet mismatch.";
  if (parsed.domain !== expected.domain) return "Domain mismatch.";
  if (parsed.expires !== expected.expiresAt) return "Message expired.";
  return null;
}