// Atomic Court Name reservation — tests that exercise the actual CAS
// persistence mechanism (a singleton registry record with version-guarded
// updateMany). The mock simulates Base44's updateMany CAS semantics: only
// one concurrent caller whose version matches can modify the record. This
// is NOT a mock that assumes uniqueness — it enforces it through the same
// compare-and-set mechanism the real database uses.
import { describe, it, expect } from "vitest";
import {
  setCourtNameAtomically,
  reserveName,
  releaseName,
  COURT_NAME_TAKEN,
} from "../base44/shared/courtNameReservation.ts";

// ─── Mock: simulates Base44 updateMany CAS semantics ──────────────────────
// The registry is a single in-memory record with a version field. The
// casUpdateRegistry method only succeeds if the expected version matches
// the current version — exactly like Base44's updateMany with a version
// filter. Two concurrent callers that read the same version will race: the
// first to call casUpdateRegistry increments the version, so the second
// caller's version check fails. This is the same atomicity guarantee the
// real database provides.

class MockRegistryDataAccess {
  claims = new Map();
  history = [];
  registry = { id: "reg_main", registry_key: "main", version: 0, names_json: "{}" };
  claimUpdateLog = [];
  failNextClaimUpdate = false;

  async getClaim(claim_slug) {
    for (const claim of this.claims.values()) {
      if (claim.claim_slug === claim_slug && claim.status === "active") {
        return { ...claim };
      }
    }
    return null;
  }

  async casUpdateClaim(id, expectedVersion, updates) {
    if (this.failNextClaimUpdate) {
      this.failNextClaimUpdate = false;
      return { updated: false };
    }
    const claim = this.claims.get(id);
    if (!claim) return { updated: false };
    const currentVersion = claim.court_name_version || 0;
    const versionMatches =
      expectedVersion === 0
        ? currentVersion === 0 || currentVersion == null
        : currentVersion === expectedVersion;
    if (!versionMatches) return { updated: false };
    this.claimUpdateLog.push({ id, updates: { ...updates } });
    Object.assign(claim, updates);
    return { updated: true };
  }

  async getRegistry() {
    return { ...this.registry };
  }

  async casUpdateRegistry(id, expectedVersion, updates) {
    if (this.registry.id !== id) return { updated: false };
    if (this.registry.version !== expectedVersion) return { updated: false };
    Object.assign(this.registry, updates);
    return { updated: true };
  }

  async createHistoryRecord(record) {
    this.history.push(record);
  }

  addClaim(claim) {
    this.claims.set(claim.id, claim);
    return claim;
  }

  getRegistryNames() {
    return JSON.parse(this.registry.names_json || "{}");
  }
}

function makeClaim(id, slug, userId, verifiedAt) {
  return {
    id,
    claim_slug: slug,
    owner_user_id: userId,
    status: "active",
    verified_at: verifiedAt,
    court_name_version: 0,
    court_name: null,
    court_name_normalized: null,
    court_name_changed_at: null,
  };
}

// ─── 1. Concurrent reservation: exactly one success ──────────────────────

describe("Atomic reservation — concurrent requests for the same name", () => {
  it("two truly concurrent requests produce exactly one successful reservation", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const [r1, r2] = await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "DiamondHands", "u2"),
    ]);

    const winners = [r1, r2].filter((r) => r.ok);
    expect(winners.length).toBe(1);

    // The registry has exactly one entry for the name
    const names = da.getRegistryNames();
    expect(Object.keys(names).length).toBe(1);
    expect(names.diamondhands).toBeDefined();
  });

  it("the loser never receives the name, even temporarily", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "DiamondHands", "u2"),
    ]);

    // Only ONE casUpdateClaim call ever set court_name_normalized to "diamondhands"
    const contestedUpdates = da.claimUpdateLog.filter(
      (log) => log.updates.court_name_normalized === "diamondhands"
    );
    expect(contestedUpdates.length).toBe(1);

    // The loser's claim was never updated with the contested name
    const c1 = await da.getClaim("wlt_aaaa");
    const c2 = await da.getClaim("wlt_bbbb");
    const claimsWithContestedName = [c1, c2].filter(
      (c) => c.court_name_normalized === "diamondhands"
    );
    expect(claimsWithContestedName.length).toBe(1);
  });

  it("three concurrent requests produce exactly one success", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));
    da.addClaim(makeClaim("c3", "wlt_cccc", "u3", "2024-01-03T00:00:00Z"));

    const [r1, r2, r3] = await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "RareName", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "RareName", "u2"),
      setCourtNameAtomically(da, "wlt_cccc", "RareName", "u3"),
    ]);

    expect([r1, r2, r3].filter((r) => r.ok).length).toBe(1);
    expect(da.getRegistryNames().rarename).toBeDefined();
  });

  it("sequential requests: second fails after first succeeds", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const r1 = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");
    const r2 = await setCourtNameAtomically(da, "wlt_bbbb", "DiamondHands", "u2");

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe(COURT_NAME_TAKEN);
  });
});

// ─── 2. Case-insensitive conflict ────────────────────────────────────────

describe("Atomic reservation — case-insensitive uniqueness", () => {
  it("DiamondHands and diamondhands conflict", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const r1 = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");
    expect(r1.ok).toBe(true);

    const r2 = await setCourtNameAtomically(da, "wlt_bbbb", "diamondhands", "u2");
    expect(r2.ok).toBe(false);

    // The registry has one entry under the normalized key
    const names = da.getRegistryNames();
    expect(names.diamondhands).toBe("wlt_aaaa");
    expect(Object.keys(names).length).toBe(1);

    // Display capitalization is preserved on the winner
    const c1 = await da.getClaim("wlt_aaaa");
    expect(c1.court_name).toBe("DiamondHands");
    expect(c1.court_name_normalized).toBe("diamondhands");
  });
});

// ─── 3. Name change: reserve new, release old ─────────────────────────────

describe("Atomic reservation — name changes", () => {
  it("changing names safely reserves the new name and releases the old name", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    // Set initial name
    await setCourtNameAtomically(da, "wlt_aaaa", "Alpha", "u1");
    expect(da.getRegistryNames().alpha).toBe("wlt_aaaa");

    // Backdate to bypass cooldown
    da.claims.get("c1").court_name_changed_at = new Date(
      Date.now() - 31 * 86400000
    ).toISOString();

    // Change to new name
    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Beta", "u1");
    expect(result.ok).toBe(true);

    // Old name is released, new name is reserved
    const names = da.getRegistryNames();
    expect(names.alpha).toBeUndefined();
    expect(names.beta).toBe("wlt_aaaa");

    // Claim has the new name
    const c1 = await da.getClaim("wlt_aaaa");
    expect(c1.court_name).toBe("Beta");
    expect(c1.court_name_normalized).toBe("beta");
  });

  it("clearing a name releases it from the registry", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_aaaa", "Alpha", "u1");
    expect(da.getRegistryNames().alpha).toBe("wlt_aaaa");

    const result = await setCourtNameAtomically(da, "wlt_aaaa", null, "u1");
    expect(result.ok).toBe(true);

    expect(da.getRegistryNames().alpha).toBeUndefined();
  });
});

// ─── 4. Failed claim update: no duplicates, no lost reservation ───────────

describe("Atomic reservation — failed claim update safety", () => {
  it("a failed claim update cannot create duplicates or lose the prior reservation", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Alpha",
      court_name_normalized: "alpha",
      court_name_version: 1,
      court_name_changed_at: new Date(Date.now() - 31 * 86400000).toISOString(),
    });
    // Pre-register the existing name in the registry
    da.registry.names_json = JSON.stringify({ alpha: "wlt_aaaa" });

    // Simulate a version conflict on the claim (another request changed it)
    da.failNextClaimUpdate = true;

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Beta", "u1");
    expect(result.ok).toBe(false);

    // The newly reserved "beta" was released (no duplicate leak)
    const names = da.getRegistryNames();
    expect(names.beta).toBeUndefined();

    // The prior "alpha" reservation is still intact
    expect(names.alpha).toBe("wlt_aaaa");

    // The claim still has its old name
    const c1 = await da.getClaim("wlt_aaaa");
    expect(c1.court_name).toBe("Alpha");
    expect(c1.court_name_normalized).toBe("alpha");
  });
});

// ─── 5. Revocation and cleanup: safe release ──────────────────────────────

describe("Atomic reservation — revocation and cleanup", () => {
  it("revocation releases the name from the registry", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Alpha",
      court_name_normalized: "alpha",
      court_name_version: 1,
    });

    // Reserve the name
    await reserveName(da, "alpha", "wlt_aaaa");
    expect(da.getRegistryNames().alpha).toBe("wlt_aaaa");

    // Simulate revocation: set status to revoked, then release
    da.claims.get("c1").status = "revoked";
    await releaseName(da, "alpha", "wlt_aaaa");

    expect(da.getRegistryNames().alpha).toBeUndefined();
  });

  it("releaseName is safe to call when the name is not reserved by this claim", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    await reserveName(da, "alpha", "wlt_aaaa");
    // c2 tries to release "alpha" — should be a no-op
    await releaseName(da, "alpha", "wlt_bbbb");
    expect(da.getRegistryNames().alpha).toBe("wlt_aaaa");
  });

  it("account cleanup releases all names for the deleted user's claims", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u_deleted", "2024-01-01T00:00:00Z"),
      court_name: "Name1",
      court_name_normalized: "name1",
      court_name_version: 1,
    });
    da.addClaim({
      ...makeClaim("c2", "wlt_bbbb", "u_deleted", "2024-01-02T00:00:00Z"),
      court_name: "Name2",
      court_name_normalized: "name2",
      court_name_version: 1,
    });

    await reserveName(da, "name1", "wlt_aaaa");
    await reserveName(da, "name2", "wlt_bbbb");

    // Simulate cleanup: revoke each claim and release its name
    for (const claim of da.claims.values()) {
      if (claim.owner_user_id === "u_deleted" && claim.status === "active") {
        claim.status = "revoked";
        if (claim.court_name_normalized) {
          await releaseName(da, claim.court_name_normalized, claim.claim_slug);
        }
      }
    }

    const names = da.getRegistryNames();
    expect(names.name1).toBeUndefined();
    expect(names.name2).toBeUndefined();
  });
});

// ─── 6. Immutable history ─────────────────────────────────────────────────

describe("Atomic reservation — immutable history", () => {
  it("creates a history record on each name change", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_aaaa", "First", "u1");
    expect(da.history.length).toBe(1);
    expect(da.history[0].court_name).toBe("First");

    // Backdate to bypass cooldown
    da.claims.get("c1").court_name_changed_at = new Date(
      Date.now() - 31 * 86400000
    ).toISOString();

    await setCourtNameAtomically(da, "wlt_aaaa", "Second", "u1");
    expect(da.history.length).toBe(2);
    expect(da.history[1].court_name).toBe("Second");
    // First record is not overwritten
    expect(da.history[0].court_name).toBe("First");
  });

  it("creates a history record when clearing a name", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Old",
      court_name_normalized: "old",
    });

    await setCourtNameAtomically(da, "wlt_aaaa", null, "u1");
    expect(da.history.length).toBe(1);
    expect(da.history[0].court_name).toBeNull();
  });
});

// ─── 7. Permanent wallet URLs ────────────────────────────────────────────

describe("Atomic reservation — permanent wallet URLs", () => {
  it("permanent wallet URL (claim_slug) remains unchanged when Court Name changes", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_permanent123", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_permanent123", "First", "u1");
    const after1 = await da.getClaim("wlt_permanent123");
    expect(after1.claim_slug).toBe("wlt_permanent123");
    expect(after1.court_name).toBe("First");

    // Backdate to bypass cooldown
    da.claims.get("c1").court_name_changed_at = new Date(
      Date.now() - 31 * 86400000
    ).toISOString();

    await setCourtNameAtomically(da, "wlt_permanent123", "Second", "u1");
    const after2 = await da.getClaim("wlt_permanent123");
    expect(after2.claim_slug).toBe("wlt_permanent123");
    expect(after2.court_name).toBe("Second");
  });
});

// ─── 8. Basic validation (preserved from prior tests) ─────────────────────

describe("Atomic reservation — basic validation", () => {
  it("sets a court name when no conflict exists", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");
    expect(result.ok).toBe(true);
    const claim = await da.getClaim("wlt_aaaa");
    expect(claim.court_name).toBe("DiamondHands");
    expect(claim.court_name_normalized).toBe("diamondhands");
  });

  it("rejects a name change from a non-owner", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u2");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects an invalid name", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "x", "u1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  it("is idempotent for the same name", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Same",
      court_name_name_normalized: "same",
      court_name_normalized: "same",
      court_name_version: 1,
    });

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Same", "u1");
    expect(result.ok).toBe(true);
    expect(da.history.length).toBe(0);
  });

  it("cooldown enforcement blocks rapid changes", async () => {
    const da = new MockRegistryDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "First",
      court_name_normalized: "first",
      court_name_version: 1,
      court_name_changed_at: new Date().toISOString(),
    });

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Second", "u1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });
});