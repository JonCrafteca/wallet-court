// Wallet Court — platform-specific data access factories for the claim system.
// These wrap the Base44 SDK entities behind the pure interfaces defined in
// nonceLifecycle.ts and courtNameReservation.ts. Imported by backend
// functions; never imported by tests (tests use mocks that simulate CAS).

export function makeNonceDataAccess(base44) {
  return {
    async findValidNonce(params) {
      const results = await base44.asServiceRole.entities.WalletClaimNonce.filter(
        {
          owner_user_id: params.ownerUserId,
          normalized_wallet_address: params.normalizedAddress,
          message_hash: params.messageHash,
          purpose: params.purpose,
          used_at: null,
          expires_at: { $gte: params.nowIso },
        },
        "-created_date",
        5
      );
      return results && results[0];
    },
    async casConsumeNonce(id, nowIso) {
      const result = await base44.asServiceRole.entities.WalletClaimNonce.updateMany(
        { id, used_at: null },
        { $set: { used_at: nowIso } }
      );
      return { consumed: !!(result && result.updated === 1) };
    },
    async countRecentNonces(params) {
      const results = await base44.asServiceRole.entities.WalletClaimNonce.filter(
        {
          owner_user_id: params.ownerUserId,
          normalized_wallet_address: params.normalizedAddress,
          purpose: params.purpose,
          created_at: { $gte: params.sinceIso },
        },
        "-created_date",
        100
      );
      return (results || []).length;
    },
    async invalidatePendingNonces(params) {
      await base44.asServiceRole.entities.WalletClaimNonce.updateMany(
        {
          owner_user_id: params.ownerUserId,
          normalized_wallet_address: params.normalizedAddress,
          purpose: params.purpose,
          used_at: null,
        },
        { $set: { used_at: params.nowIso } }
      );
    },
  };
}

export function makeClaimDataAccess(base44) {
  return {
    async getClaim(claim_slug) {
      const results = await base44.asServiceRole.entities.WalletClaim.filter(
        { claim_slug, status: "active" },
        "-verified_at",
        5
      );
      return results && results[0];
    },
    async casUpdateClaim(id, expectedVersion, updates) {
      const filter = { id, status: "active" };
      // Old records may have null/missing court_name_version. When the caller
      // read 0 (the default), match null/missing/0 so the first update works.
      if (expectedVersion === 0) {
        filter.$or = [
          { court_name_version: 0 },
          { court_name_version: null },
          { court_name_version: { $exists: false } },
        ];
      } else {
        filter.court_name_version = expectedVersion;
      }
      const result = await base44.asServiceRole.entities.WalletClaim.updateMany(
        filter,
        { $set: updates }
      );
      return { updated: !!(result && result.updated === 1) };
    },
    async findActiveByName(normalized, excludeId) {
      const results = await base44.asServiceRole.entities.WalletClaim.filter(
        { court_name_normalized: normalized, status: "active" },
        "-verified_at",
        20
      );
      return (results || []).filter((c) => c.id !== excludeId);
    },
    async createHistoryRecord(record) {
      await base44.asServiceRole.entities.CourtNameHistory.create(record);
    },
  };
}