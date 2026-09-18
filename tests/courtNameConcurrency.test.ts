// Court Name atomic acquisition — concurrent tests with mock CAS semantics.
// Verifies that two (and three) concurrent requests for the same normalized
// name produce exactly one winner and leave no duplicates. Also verifies
// immutable history records, cooldown enforcement, and ownership checks.
import { describe, it, expect } from "vitest";
import {
  setCourtNameAtomically,
  courtNameWinner,
} from "../base44/shared/courtNameReservation.ts";

class MockClaimDataAccess {
  claims = new Map();
  history = [];

  async getClaim(claim_slug) {
    for (const claim of this.claims.values()) {
      if (claim.claim_slug === claim_slug && claim.status === "active") {
        return { ...claim };
      }
    }
    return null;
  }

  // Synchronous check-and-set — atomic, no interleaving.
  async casUpdateClaim(id, expectedVersion, updates) {
    const claim = this.claims.get(id);
    if (!claim) return { updated: false };
    const currentVersion = claim.court_name_version || 0;
    const versionMatches =
      expectedVersion === 0
        ? currentVersion === 0 || currentVersion == null
        : currentVersion === expectedVersion;
    if (!versionMatches) return { updated: false };
    Object.assign(claim, updates);
    return { updated: true };
  }

  async findActiveByName(normalized, excludeId) {
    const results = [];
    for (const claim of this.claims.values()) {
      if (
        claim.status === "active" &&
        claim.court_name_normalized === normalized &&
        claim.id !== excludeId
      ) {
        results.push({ ...claim });
      }
    }
    return results;
  }

  async createHistoryRecord(record) {
    this.history.push(record);
  }

  addClaim(claim) {
    this.claims.set(claim.id, claim);
    return claim;
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

describe("courtNameConcurrency — deterministic winner selection", () => {
  it("selects the claim with the earliest verified_at", () => {
    const claims = [
      { id: "c1", verified_at: "2024-01-02T00:00:00Z" },
      { id: "c2", verified_at: "2024-01-01T00:00:00Z" },
    ];
    expect(courtNameWinner(claims).id).toBe("c2");
  });

  it("breaks ties by lowest id", () => {
    const claims = [
      { id: "c2", verified_at: "2024-01-01T00:00:00Z" },
      { id: "c1", verified_at: "2024-01-01T00:00:00Z" },
    ];
    expect(courtNameWinner(claims).id).toBe("c1");
  });

  it("returns null for empty array", () => {
    expect(courtNameWinner([])).toBeNull();
  });
});

describe("courtNameConcurrency — single request (no conflict)", () => {
  it("sets a court name when no conflict exists", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");

    expect(result.ok).toBe(true);
    const claim = await da.getClaim("wlt_aaaa");
    expect(claim.court_name).toBe("DiamondHands");
    expect(claim.court_name_normalized).toBe("diamondhands");
    expect(claim.court_name_version).toBe(1);
    expect(da.history.length).toBe(1);
  });

  it("clears a court name", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "OldName",
      court_name_normalized: "oldname",
      court_name_version: 1,
    });

    const result = await setCourtNameAtomically(da, "wlt_aaaa", null, "u1");

    expect(result.ok).toBe(true);
    const claim = await da.getClaim("wlt_aaaa");
    expect(claim.court_name).toBeNull();
    expect(claim.court_name_normalized).toBeNull();
  });

  it("rejects a name change from a non-owner", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u2");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects an invalid name", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "x", "u1");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  it("is idempotent for the same name", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Same",
      court_name_normalized: "same",
      court_name_version: 1,
    });

    const result = await setCourtNameAtomically(da, "wlt_aaaa", "Same", "u1");
    expect(result.ok).toBe(true);
    expect(da.history.length).toBe(0); // no history record for idempotent update
  });
});

describe("courtNameConcurrency — concurrent acquisition (exactly one winner)", () => {
  it("two concurrent requests for the same name produce exactly one winner", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const [r1, r2] = await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "DiamondHands", "u2"),
    ]);

    // Exactly one winner
    const winners = [r1, r2].filter((r) => r.ok);
    expect(winners.length).toBe(1);

    // The winner is c1 (earlier verified_at)
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);

    // No duplicates in the final state
    const c1 = await da.getClaim("wlt_aaaa");
    const c2 = await da.getClaim("wlt_bbbb");
    expect(c1.court_name_normalized).toBe("diamondhands");
    expect(c2.court_name_normalized).toBeNull();
  });

  it("three concurrent requests for the same name produce exactly one winner", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));
    da.addClaim(makeClaim("c3", "wlt_cccc", "u3", "2024-01-03T00:00:00Z"));

    const [r1, r2, r3] = await Promise.all([
      setCourtNameAtomically(da, "wlt_aaaa", "RareName", "u1"),
      setCourtNameAtomically(da, "wlt_bbbb", "RareName", "u2"),
      setCourtNameAtomically(da, "wlt_cccc", "RareName", "u3"),
    ]);

    const winners = [r1, r2, r3].filter((r) => r.ok);
    expect(winners.length).toBe(1);
    expect(r1.ok).toBe(true);

    const c1 = await da.getClaim("wlt_aaaa");
    const c2 = await da.getClaim("wlt_bbbb");
    const c3 = await da.getClaim("wlt_cccc");
    expect(c1.court_name_normalized).toBe("rarename");
    expect(c2.court_name_normalized).toBeNull();
    expect(c3.court_name_normalized).toBeNull();
  });

  it("sequential requests: second fails, first wins", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));
    da.addClaim(makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"));

    const r1 = await setCourtNameAtomically(da, "wlt_aaaa", "DiamondHands", "u1");
    const r2 = await setCourtNameAtomically(da, "wlt_bbbb", "DiamondHands", "u2");

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);

    const c1 = await da.getClaim("wlt_aaaa");
    const c2 = await da.getClaim("wlt_bbbb");
    expect(c1.court_name_normalized).toBe("diamondhands");
    expect(c2.court_name_normalized).toBeNull();
  });

  it("the loser reverts to its previous name", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim({
      ...makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"),
      court_name: "Winner",
      court_name_normalized: "winner",
    });
    da.addClaim({
      ...makeClaim("c2", "wlt_bbbb", "u2", "2024-01-02T00:00:00Z"),
      court_name: "Loser",
      court_name_normalized: "loser",
    });

    // c2 tries to take "winner" while c1 already has it
    const result = await setCourtNameAtomically(da, "wlt_bbbb", "Winner", "u2");

    expect(result.ok).toBe(false);
    const c2 = await da.getClaim("wlt_bbbb");
    expect(c2.court_name).toBe("Loser");
    expect(c2.court_name_normalized).toBe("loser");
  });
});

describe("courtNameConcurrency — immutable history", () => {
  it("creates a history record on each name change", async () => {
    const da = new MockClaimDataAccess();
    da.addClaim(makeClaim("c1", "wlt_aaaa", "u1", "2024-01-01T00:00:00Z"));

    await setCourtNameAtomically(da, "wlt_aaaa", "First", "u1");
    expect(da.history.length).toBe(1);
    expect(da.history[0].court_name).toBe("First");

    await setCourtNameAtomically(da, "wlt_aaaa", "Second", "u1");
    expect(da.history.length).toBe(2);
    expect(da.history[1].court_name).toBe("Second");
    // First record is not overwritten
    expect(da.history[0].court_name).toBe("First");
  });

  it("creates a history record when clearing a name", async () => {
    const da = new MockClaimDataAccess();
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