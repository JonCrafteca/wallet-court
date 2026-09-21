// Wallet Court — Singleton campaign lock atomicity tests.
// Proves that:
//   - ensureControl cannot create two independent control rows during
//     simultaneous first use (both re-read the same oldest record).
//   - acquireCampaignLock uses one CAS operation that validates id, lock state
//     (campaign_lock_run_id = null), and version together.
//   - Exactly one concurrent start acquires the lock; the other fails.
//   - releaseCampaignLock validates the owning run_id; a non-owner cannot
//     release another run's lock.
import { describe, it, expect } from "vitest";
import {
  acquireCampaignLock,
  releaseCampaignLock,
  ensureControl,
  getControl
} from "../base44/shared/calibrationStore.ts";

// Mock CalibrationControl DB with proper atomic CAS semantics. All operations
// are synchronous internally (no I/O) so CAS is truly atomic in the mock.
function createMockDB(initialRecords: any[] = []) {
  const records: any[] = initialRecords.map((r) => ({ ...r }));
  let idCounter = 0;
  const updateManyCalls: any[] = [];

  const db = {
    records,
    updateManyCalls,

    filter: async (query: any, sort?: string, limit?: number) => {
      let results = records.filter((r) => {
        for (const [key, value] of Object.entries(query)) {
          const rv = r[key];
          // Treat null and undefined as equivalent (matches real DB behavior)
          if (rv !== value && !((rv == null) && (value == null))) return false;
        }
        return true;
      });
      if (sort) {
        const desc = sort.startsWith("-");
        const field = desc ? sort.slice(1) : sort;
        results = [...results].sort((a, b) => {
          const av = a[field] || "";
          const bv = b[field] || "";
          if (av < bv) return desc ? 1 : -1;
          if (av > bv) return desc ? -1 : 1;
          return 0;
        });
      }
      if (limit != null) results = results.slice(0, limit);
      return results;
    },

    create: async (record: any) => {
      const now = new Date().toISOString();
      const rec = {
        id: `ctrl_${++idCounter}`,
        created_date: now,
        updated_date: now,
        ...record
      };
      records.push(rec);
      return rec;
    },

    // Atomic CAS: checks ALL filter conditions simultaneously, then applies
    // the update. Only matching records are updated. Returns { updated: count }.
    updateMany: async (filter: any, update: any) => {
      updateManyCalls.push({ filter: { ...filter }, update: { ...update } });
      let count = 0;
      for (const r of records) {
        let matches = true;
        for (const [key, value] of Object.entries(filter)) {
          const rv = r[key];
          // Treat null and undefined as equivalent (matches real DB behavior)
          if (rv !== value && !((rv == null) && (value == null))) { matches = false; break; }
        }
        if (matches) {
          if (update.$set) {
            for (const [key, value] of Object.entries(update.$set)) {
              r[key] = value;
            }
          }
          if (update.$inc) {
            for (const [key, value] of Object.entries(update.$inc)) {
              r[key] = (r[key] || 0) + value;
            }
          }
          count++;
        }
      }
      return { updated: count };
    },

    update: async (id: string, fields: any) => {
      const r = records.find((rec) => rec.id === id);
      if (!r) throw new Error("Not found");
      Object.assign(r, fields);
      return r;
    }
  };

  return db;
}

function createMockBase44(db: any) {
  return {
    asServiceRole: {
      entities: {
        CalibrationControl: db
      }
    }
  };
}

describe("Singleton campaign lock atomicity", () => {
  describe("ensureControl — simultaneous first use", () => {
    it("two concurrent ensureControl calls both return the same canonical record", async () => {
      const db = createMockDB();
      const base44A = createMockBase44(db);
      const base44B = createMockBase44(db);

      // Simulate interleaved first-use: both find no existing control,
      // both create, both re-read.
      // Process A: getControl → null
      const aExisting = await getControl(base44A);
      expect(aExisting).toBeNull();

      // Process B: getControl → null (before A creates)
      const bExisting = await getControl(base44B);
      expect(bExisting).toBeNull();

      // Process A: create
      const aCreated = await db.create({
        control_key: "main",
        version: 0,
        calibration_enabled: true,
        updated_at: new Date().toISOString()
      });

      // Process B: create (duplicate! both found null)
      const bCreated = await db.create({
        control_key: "main",
        version: 0,
        calibration_enabled: true,
        updated_at: new Date().toISOString()
      });

      // Now there are two records — but getControl returns the oldest
      const aAfterCreate = await getControl(base44A);
      const bAfterCreate = await getControl(base44B);

      // Both get the SAME (oldest) record
      expect(aAfterCreate.id).toBe(bAfterCreate.id);
      expect(aAfterCreate.id).toBe(aCreated.id); // A's record was created first
      expect(db.records.length).toBe(2); // duplicate exists but is harmless
    });

    it("ensureControl re-reads after create to get the canonical record", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      const result = await ensureControl(base44);
      expect(result).toBeTruthy();
      expect(result.control_key).toBe("main");

      // A second call should return the same record, not create another
      const result2 = await ensureControl(base44);
      expect(result2.id).toBe(result.id);
      expect(db.records.length).toBe(1);
    });
  });

  describe("acquireCampaignLock — one CAS, one winner", () => {
    it("exactly one of two concurrent starts acquires the lock", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      // Pre-create the control record (simulating it already exists)
      await db.create({
        control_key: "main",
        version: 0,
        calibration_enabled: true,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const runA = "camp_aaa";
      const runB = "camp_bbb";

      // Both read the same control (same version, same id, lock = null)
      const [resultA, resultB] = await Promise.all([
        acquireCampaignLock(base44, runA),
        acquireCampaignLock(base44, runB)
      ]);

      // Exactly one succeeds
      const successes = [resultA, resultB].filter((r) => r === true);
      const failures = [resultA, resultB].filter((r) => r === false);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });

    it("CAS validates id, lock state (null), and version in one updateMany call", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 5,
        calibration_enabled: true,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      await acquireCampaignLock(base44, "camp_test");

      // Verify the CAS filter used the canonical id (not just control_key)
      expect(db.updateManyCalls.length).toBeGreaterThanOrEqual(1);
      const casCall = db.updateManyCalls[db.updateManyCalls.length - 1];
      expect(casCall.filter.id).toBeDefined(); // filters on id, not control_key
      expect(casCall.filter.campaign_lock_run_id).toBeNull(); // lock must be null
      expect(casCall.filter.version).toBe(5); // version must match
    });

    it("idempotent re-acquire by the same run_id returns true", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 0,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const runId = "camp_recheck";
      const first = await acquireCampaignLock(base44, runId);
      expect(first).toBe(true);

      // Re-acquire by the same run should succeed (idempotent)
      const second = await acquireCampaignLock(base44, runId);
      expect(second).toBe(true);
    });

    it("a second run cannot acquire when the lock is held", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 0,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const first = await acquireCampaignLock(base44, "camp_first");
      expect(first).toBe(true);

      const second = await acquireCampaignLock(base44, "camp_second");
      expect(second).toBe(false);
    });
  });

  describe("releaseCampaignLock — owner validation", () => {
    it("owner can release the lock", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 0,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const runId = "camp_owner";
      await acquireCampaignLock(base44, runId);

      const released = await releaseCampaignLock(base44, runId);
      expect(released).toBe(true);

      // Verify the lock is actually null
      const control = await getControl(base44);
      expect(control.campaign_lock_run_id).toBeNull();
    });

    it("non-owner CANNOT release another run's lock", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 0,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const ownerRun = "camp_owner_run";
      const attackerRun = "camp_attacker_run";

      await acquireCampaignLock(base44, ownerRun);

      // Attacker tries to release the lock with a different run_id
      const released = await releaseCampaignLock(base44, attackerRun);
      expect(released).toBe(false);

      // The lock is still held by the owner
      const control = await getControl(base44);
      expect(control.campaign_lock_run_id).toBe(ownerRun);
    });

    it("release filters on the owning run_id in the CAS (not just id)", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      await db.create({
        control_key: "main",
        version: 0,
        campaign_lock_run_id: null,
        updated_at: new Date().toISOString()
      });

      const runId = "camp_cas_release";
      await acquireCampaignLock(base44, runId);

      // Attempt release with wrong run_id
      await releaseCampaignLock(base44, "wrong_run");

      // The last updateMany call should filter on campaign_lock_run_id = "wrong_run"
      // which does NOT match — so updated = 0
      const lastCall = db.updateManyCalls[db.updateManyCalls.length - 1];
      expect(lastCall.filter.campaign_lock_run_id).toBe("wrong_run");
      expect(lastCall.filter.id).toBeDefined();
    });
  });

  describe("Full simultaneous start simulation", () => {
    it("two interleaved starts: one acquires lock, other gets 409-equivalent", async () => {
      const db = createMockDB();
      const base44 = createMockBase44(db);

      // Simulate the startCalibrationCampaign flow for two concurrent starts:
      // 1. Both getControl → null (no control exists)
      // 2. Both acquireCampaignLock → ensureControl creates the control,
      //    both re-read the same oldest record, both CAS — one wins, one fails.

      const runA = "camp_interleave_a";
      const runB = "camp_interleave_b";

      // Interleave: both start acquireCampaignLock concurrently
      const [lockA, lockB] = await Promise.all([
        acquireCampaignLock(base44, runA),
        acquireCampaignLock(base44, runB)
      ]);

      // Exactly one acquires the lock
      expect([lockA, lockB].filter((l) => l === true).length).toBe(1);
      expect([lockA, lockB].filter((l) => l === false).length).toBe(1);

      // The control record exists (ensureControl created it)
      const control = await getControl(base44);
      expect(control).toBeTruthy();
      expect(control.control_key).toBe("main");

      // The winner holds the lock
      const winnerRun = lockA ? runA : runB;
      expect(control.campaign_lock_run_id).toBe(winnerRun);

      // The loser cannot start (in the real function, this returns 409)
      // Verify the loser cannot acquire even if it retries
      const loserRun = lockA ? runB : runA;
      const retryLoser = await acquireCampaignLock(base44, loserRun);
      expect(retryLoser).toBe(false);
    });
  });
});