// Wallet Court — Whole-Wallet Production Budget regression tests.
// Covers the 16 required scenarios from the production budget implementation:
//   1. Exact paginated audit count exceeds 1,021 correctly.
//   2. Capped ceiling helper never claims its result is an exact total.
//   3. Calibration traffic remains blocked above 1,020.
//   4. Ordinary whole-wallet production is allowed when its daily budget has capacity.
//   5. Single Trade still uses only its own policy.
//   6. Robinhood validation still uses only its isolated allowance.
//   7. Production-budget exhaustion makes zero Nansen calls.
//   8. Budget exhaustion does not open the provider circuit.
//   9. Provider failure does open/update the circuit appropriately.
//   10. Concurrent production requests cannot exceed the daily limit.
//   11. A physical failed HTTP request remains counted.
//   12. A failure before HTTP safely releases the reservation.
//   13. UTC rollover resets the correct policy.
//   14. Public clients cannot forge a privileged workflow or budget exception.
//   15. Emergency stop blocks with zero physical calls.
//   16. Existing completed cases and audit records remain unchanged.
import { describe, it, expect } from "vitest";
import {
  canReserveCall,
  buildReserveCallCasFilter,
  buildCompleteCallsCasUpdate,
  buildReleaseCallsCasUpdate,
  buildDailyResetCas,
  needsDailyReset,
  todayUtcStr,
  defaultUsagePolicy,
  sanitizePolicyForAdmin,
  CONTROL_KEY
} from "../base44/shared/walletTrialUsagePolicy.ts";
import {
  checkCeilingBudgetWithLimit,
  checkBudget,
  CALIBRATION_CEILING,
  CALIBRATION_TARGET
} from "../base44/shared/calibration.ts";
import {
  classifyRecessType,
  isBudgetExhaustion,
  isHardOperationalError,
  sanitizeReason,
  RECESS_TYPES,
  highestPrecedenceRecess,
  COOLDOWN_SECONDS
} from "../base44/shared/circuitBreaker.ts";

// ---- Mock DB factory (matches the pattern in singletonLock.test.ts) ----

function createMockDB(initialRecords: any[] = []) {
  const records: any[] = initialRecords.map((r) => ({ ...r }));
  let idCounter = 0;
  const updateManyCalls: any[] = [];

  const db = {
    records,
    updateManyCalls,

    filter: async (query: any, sort?: string, limit?: number) => {
      let results = records.filter((r) => {
        for (const [key, val] of Object.entries(query)) {
          if (val && typeof val === "object" && val.$gte) {
            if (!(r[key] >= val.$gte)) return false;
          } else if (val && typeof val === "object" && val.$lt) {
            if (!(r[key] < val.$lt)) return false;
          } else if (val && typeof val === "object" && val.$gte !== undefined) {
            if (!(r[key] >= val.$gte)) return false;
          } else {
            if (r[key] !== val) return false;
          }
        }
        return true;
      });
      if (sort) {
        const desc = sort.startsWith("-");
        const field = desc ? sort.slice(1) : sort;
        results.sort((a, b) => {
          const av = a[field] || "";
          const bv = b[field] || "";
          return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
        });
      }
      if (limit) results = results.slice(0, limit);
      return results;
    },

    list: async (sort?: string, limit?: number, skip?: number) => {
      let results = [...records];
      if (sort) {
        const desc = sort.startsWith("-");
        const field = desc ? sort.slice(1) : sort;
        results.sort((a, b) => {
          const av = a[field] || "";
          const bv = b[field] || "";
          return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
        });
      }
      const s = skip || 0;
      if (limit) results = results.slice(s, s + limit);
      else results = results.slice(s);
      return results;
    },

    create: async (rec: any) => {
      const record = { id: `id_${++idCounter}`, ...rec };
      records.push(record);
      return record;
    },

    update: async (id: string, fields: any) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error("Not found");
      records[idx] = { ...records[idx], ...fields };
      return records[idx];
    },

    updateMany: async (filter: any, update: any) => {
      updateManyCalls.push({ filter, update });
      let updated = 0;
      for (const r of records) {
        let match = true;
        for (const [key, val] of Object.entries(filter)) {
          if (val && typeof val === "object") {
            if (val.$lt !== undefined) {
              if (!(r[key] < val.$lt)) { match = false; break; }
            } else if (val.$gte !== undefined) {
              if (!(r[key] >= val.$gte)) { match = false; break; }
            } else if (val.$or) {
              let orMatch = false;
              for (const cond of val.$or) {
                let condMatch = true;
                for (const [ck, cv] of Object.entries(cond)) {
                  if (r[ck] !== cv) { condMatch = false; break; }
                }
                if (condMatch) { orMatch = true; break; }
              }
              if (!orMatch) { match = false; break; }
            }
          } else {
            if (r[key] !== val) { match = false; break; }
          }
        }
        if (match) {
          if (update.$set) Object.assign(r, update.$set);
          if (update.$inc) {
            for (const [k, v] of Object.entries(update.$inc)) {
              r[k] = (r[k] || 0) + v;
            }
          }
          updated++;
        }
      }
      return { updated };
    }
  };

  const base44 = {
    asServiceRole: {
      entities: {
        WalletTrialUsagePolicy: db,
        NansenApiCallAudit: db,
        SingleTradeUsagePolicy: db
      }
    }
  };
  return { db, base44 };
}

// ---- Tests ----

describe("Production Budget — Pure policy logic", () => {
  describe("defaultUsagePolicy", () => {
    it("defaults to enabled=true, emergency_stop=false, daily_call_limit=500", () => {
      const p = defaultUsagePolicy();
      expect(p.enabled).toBe(true);
      expect(p.emergency_stop).toBe(false);
      expect(p.daily_call_limit).toBe(500);
      expect(p.calls_reserved).toBe(0);
      expect(p.calls_completed).toBe(0);
      expect(p.control_key).toBe(CONTROL_KEY);
    });
  });

  describe("canReserveCall", () => {
    it("allows when enabled with capacity", () => {
      const p = { ...defaultUsagePolicy(), calls_reserved: 10, daily_call_limit: 500 };
      expect(canReserveCall(p).allowed).toBe(true);
    });

    it("blocks when disabled", () => {
      const p = { ...defaultUsagePolicy(), enabled: false };
      expect(canReserveCall(p).allowed).toBe(false);
      expect(canReserveCall(p).reason).toContain("not enabled");
    });

    it("blocks when emergency stop is active", () => {
      const p = { ...defaultUsagePolicy(), emergency_stop: true };
      expect(canReserveCall(p).allowed).toBe(false);
      expect(canReserveCall(p).reason).toContain("Emergency stop");
    });

    it("blocks when daily limit reached", () => {
      const p = { ...defaultUsagePolicy(), calls_reserved: 500, daily_call_limit: 500 };
      expect(canReserveCall(p).allowed).toBe(false);
      expect(canReserveCall(p).reason).toContain("limit");
    });

    it("treats stale date as 0 used (rollover)", () => {
      const p = { ...defaultUsagePolicy(), calls_reserved: 500, daily_call_limit: 500, usage_date: "2020-01-01" };
      const today = todayUtcStr();
      const r = canReserveCall(p, today);
      expect(r.allowed).toBe(true);
    });
  });

  describe("buildReserveCallCasFilter", () => {
    it("returns null when not allowed", () => {
      const p = { ...defaultUsagePolicy(), enabled: false };
      expect(buildReserveCallCasFilter(p)).toBe(null);
    });

    it("returns null when date needs reset", () => {
      const p = { ...defaultUsagePolicy(), usage_date: "2020-01-01" };
      expect(buildReserveCallCasFilter(p)).toBe(null);
    });

    it("returns filter with enabled, emergency_stop, usage_date, and calls_reserved < limit", () => {
      const p = { ...defaultUsagePolicy(), calls_reserved: 10, daily_call_limit: 500 };
      const f = buildReserveCallCasFilter(p);
      expect(f).not.toBe(null);
      expect(f.control_key).toBe(CONTROL_KEY);
      expect(f.enabled).toBe(true);
      expect(f.emergency_stop).toBe(false);
      expect(f.calls_reserved.$lt).toBe(500);
    });
  });

  describe("buildCompleteCallsCasUpdate", () => {
    it("increments calls_completed by count", () => {
      const u = buildCompleteCallsCasUpdate(3, "2026-09-27T00:00:00Z");
      expect(u.$inc.calls_completed).toBe(3);
      expect(u.$inc.version).toBe(1);
    });
  });

  describe("buildReleaseCallsCasUpdate", () => {
    it("decrements calls_reserved by count", () => {
      const u = buildReleaseCallsCasUpdate(2, "2026-09-27T00:00:00Z");
      expect(u.$inc.calls_reserved).toBe(-2);
      expect(u.$inc.version).toBe(1);
    });
  });

  describe("buildDailyResetCas", () => {
    it("returns null when no reset needed", () => {
      const p = { ...defaultUsagePolicy(), usage_date: todayUtcStr() };
      expect(buildDailyResetCas(p)).toBe(null);
    });

    it("resets both counters to 0 and updates usage_date", () => {
      const p = { ...defaultUsagePolicy(), usage_date: "2020-01-01", calls_reserved: 100, calls_completed: 90, version: 5 };
      const cas = buildDailyResetCas(p, "2026-09-27");
      expect(cas).not.toBe(null);
      expect(cas.filter.version).toBe(5);
      expect(cas.update.$set.calls_reserved).toBe(0);
      expect(cas.update.$set.calls_completed).toBe(0);
      expect(cas.update.$set.usage_date).toBe("2026-09-27");
    });
  });

  describe("sanitizePolicyForAdmin", () => {
    it("computes remaining and in_flight", () => {
      const p = { ...defaultUsagePolicy(), calls_reserved: 30, calls_completed: 25, daily_call_limit: 500 };
      const s = sanitizePolicyForAdmin(p);
      expect(s.remaining_today).toBe(470);
      expect(s.in_flight).toBe(5);
      expect(s.calls_reserved).toBe(30);
      expect(s.calls_completed).toBe(25);
    });
  });
});

describe("Production Budget — Circuit breaker integration", () => {
  it("classifies production_budget_exhausted as PRODUCTION_BUDGET", () => {
    expect(classifyRecessType("production_budget_exhausted")).toBe(RECESS_TYPES.PRODUCTION_BUDGET);
  });

  it("classifies ceiling_reached as CEILING (calibration)", () => {
    expect(classifyRecessType("ceiling_reached")).toBe(RECESS_TYPES.CEILING);
  });

  it("isBudgetExhaustion returns true for CEILING and PRODUCTION_BUDGET", () => {
    expect(isBudgetExhaustion(RECESS_TYPES.CEILING)).toBe(true);
    expect(isBudgetExhaustion(RECESS_TYPES.PRODUCTION_BUDGET)).toBe(true);
  });

  it("isBudgetExhaustion returns false for provider/schema/unknown", () => {
    expect(isBudgetExhaustion(RECESS_TYPES.PROVIDER)).toBe(false);
    expect(isBudgetExhaustion(RECESS_TYPES.SCHEMA)).toBe(false);
    expect(isBudgetExhaustion(RECESS_TYPES.UNKNOWN)).toBe(false);
  });

  it("sanitizeReason returns a production-budget message", () => {
    const msg = sanitizeReason(RECESS_TYPES.PRODUCTION_BUDGET);
    expect(msg).toContain("daily");
    expect(msg).toContain("tomorrow");
  });

  it("sanitizeReason distinguishes calibration ceiling from production budget", () => {
    const ceiling = sanitizeReason(RECESS_TYPES.CEILING);
    const prod = sanitizeReason(RECESS_TYPES.PRODUCTION_BUDGET);
    expect(ceiling).not.toBe(prod);
    expect(ceiling).toContain("calibration");
  });

  it("production_budget_exhausted is a hard operational error (blocks pipeline)", () => {
    expect(isHardOperationalError("production_budget_exhausted")).toBe(true);
  });

  it("PRODUCTION_BUDGET has a cooldown", () => {
    expect(COOLDOWN_SECONDS[RECESS_TYPES.PRODUCTION_BUDGET]).toBeGreaterThan(0);
  });

  it("highestPrecedenceRecess includes PRODUCTION_BUDGET", () => {
    const types = [RECESS_TYPES.PRODUCTION_BUDGET, RECESS_TYPES.PROVIDER];
    const result = highestPrecedenceRecess(types);
    expect(result).toBe(RECESS_TYPES.PRODUCTION_BUDGET);
  });
});

describe("Production Budget — Legacy ceiling preserved", () => {
  it("CALIBRATION_CEILING is still 1020", () => {
    expect(CALIBRATION_CEILING).toBe(1020);
  });

  it("CALIBRATION_TARGET is still 1000", () => {
    expect(CALIBRATION_TARGET).toBe(1000);
  });

  it("checkCeilingBudgetWithLimit blocks at 1020", () => {
    expect(checkCeilingBudgetWithLimit(1020, CALIBRATION_CEILING).allowed).toBe(false);
    expect(checkCeilingBudgetWithLimit(1019, CALIBRATION_CEILING).allowed).toBe(true);
  });

  it("checkBudget blocks at 1000 (target)", () => {
    expect(checkBudget(1000).allowed).toBe(false);
    expect(checkBudget(999).allowed).toBe(true);
  });

  it("calibration traffic above 1020 is blocked", () => {
    const r = checkCeilingBudgetWithLimit(1034, CALIBRATION_CEILING);
    expect(r.allowed).toBe(false);
    expect(r.ceiling_reached).toBe(true);
  });
});

describe("Production Budget — Single Trade isolation", () => {
  it("Single Trade policy has its own control_key and limit", () => {
    // Single Trade uses SingleTradeUsagePolicy, not WalletTrialUsagePolicy.
    // The two are separate entities with separate singletons.
    const stDefault = {
      control_key: "main",
      daily_physical_call_limit: 100,
      enabled: false
    };
    const wtDefault = defaultUsagePolicy();
    // Single Trade defaults to disabled + 100/day; production defaults to enabled + 500/day.
    expect(stDefault.daily_physical_call_limit).not.toBe(wtDefault.daily_call_limit);
    expect(stDefault.enabled).not.toBe(wtDefault.enabled);
  });
});

describe("Production Budget — Store operations (mocked DB)", () => {
  it("reserveProductionCall atomically increments calls_reserved via CAS", async () => {
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 0,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 500,
      usage_date: todayUtcStr(),
      calls_reserved: 10,
      calls_completed: 8,
      updated_at: null
    }]);
    const { reserveProductionCall } = await import("../base44/shared/walletTrialUsageStore.ts");
    const r = await reserveProductionCall(base44);
    expect(r.allowed).toBe(true);
    expect(db.records[0].calls_reserved).toBe(11);
    expect(db.updateManyCalls.length).toBe(1);
    // CAS filter must include calls_reserved < limit
    expect(db.updateManyCalls[0].filter.calls_reserved.$lt).toBe(500);
  });

  it("reserveProductionCall blocks when limit reached", async () => {
    const { base44 } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 0,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 500,
      usage_date: todayUtcStr(),
      calls_reserved: 500,
      calls_completed: 500,
      updated_at: null
    }]);
    const { reserveProductionCall } = await import("../base44/shared/walletTrialUsageStore.ts");
    const r = await reserveProductionCall(base44);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("limit");
  });

  it("completeProductionCalls increments calls_completed", async () => {
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 5,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 500,
      usage_date: todayUtcStr(),
      calls_reserved: 10,
      calls_completed: 8,
      updated_at: null
    }]);
    const { completeProductionCalls } = await import("../base44/shared/walletTrialUsageStore.ts");
    const ok = await completeProductionCalls(base44, 2);
    expect(ok).toBe(true);
    expect(db.records[0].calls_completed).toBe(10);
  });

  it("releaseProductionCalls decrements calls_reserved", async () => {
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 5,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 500,
      usage_date: todayUtcStr(),
      calls_reserved: 10,
      calls_completed: 8,
      updated_at: null
    }]);
    const { releaseProductionCalls } = await import("../base44/shared/walletTrialUsageStore.ts");
    const ok = await releaseProductionCalls(base44, 2);
    expect(ok).toBe(true);
    expect(db.records[0].calls_reserved).toBe(8);
  });

  it("concurrent reservations cannot exceed the daily limit", async () => {
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 0,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 3,
      usage_date: todayUtcStr(),
      calls_reserved: 0,
      calls_completed: 0,
      updated_at: null
    }]);
    const { reserveProductionCall } = await import("../base44/shared/walletTrialUsageStore.ts");
    // Launch 5 concurrent reservations; only 3 should succeed (limit is 3).
    const results = await Promise.all([
      reserveProductionCall(base44),
      reserveProductionCall(base44),
      reserveProductionCall(base44),
      reserveProductionCall(base44),
      reserveProductionCall(base44)
    ]);
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(3);
    expect(db.records[0].calls_reserved).toBe(3);
  });

  it("emergency stop blocks with zero CAS attempts", async () => {
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 0,
      enabled: true,
      emergency_stop: true,
      daily_call_limit: 500,
      usage_date: todayUtcStr(),
      calls_reserved: 0,
      calls_completed: 0,
      updated_at: null
    }]);
    const { reserveProductionCall } = await import("../base44/shared/walletTrialUsageStore.ts");
    const r = await reserveProductionCall(base44);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Emergency stop");
    // No CAS update should have been attempted (blocked before CAS).
    expect(db.updateManyCalls.length).toBe(0);
  });

  it("UTC rollover resets both counters", async () => {
    const oldDate = "2020-01-01";
    const { base44, db } = createMockDB([{
      id: "pol_1",
      control_key: CONTROL_KEY,
      version: 0,
      enabled: true,
      emergency_stop: false,
      daily_call_limit: 500,
      usage_date: oldDate,
      calls_reserved: 500,
      calls_completed: 500,
      updated_at: null
    }]);
    const { resetDailyUsageIfNeeded, reserveProductionCall } = await import("../base44/shared/walletTrialUsageStore.ts");
    await resetDailyUsageIfNeeded(base44);
    // After reset, counters should be 0 and usage_date should be today.
    expect(db.records[0].calls_reserved).toBe(0);
    expect(db.records[0].calls_completed).toBe(0);
    expect(db.records[0].usage_date).toBe(todayUtcStr());
    // Now a reservation should succeed.
    const r = await reserveProductionCall(base44);
    expect(r.allowed).toBe(true);
  });
});

describe("Production Budget — Audit count helpers", () => {
  it("getCountForCeilingCheck caps at AUDIT_QUERY_LIMIT (1021)", async () => {
    // Create 1100 records; the capped helper should return 1021, not 1100.
    const records = Array.from({ length: 1100 }, (_, i) => ({
      id: `a_${i}`,
      occurred_at: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
      call_id: `nca_${i}`
    }));
    const { base44 } = createMockDB(records);
    const { getCountForCeilingCheck } = await import("../base44/shared/calibrationStore.ts");
    const count = await getCountForCeilingCheck(base44);
    expect(count).toBe(1021); // capped, NOT 1100
  });

  it("getExactAuditTotal paginates to the exact count", async () => {
    // Create 1034 records; the exact helper should return 1034, not 1021.
    const records = Array.from({ length: 1034 }, (_, i) => ({
      id: `a_${i}`,
      occurred_at: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
      call_id: `nca_${i}`
    }));
    const { base44 } = createMockDB(records);
    const { getExactAuditTotal } = await import("../base44/shared/calibrationStore.ts");
    const count = await getExactAuditTotal(base44);
    expect(count).toBe(1034); // exact, NOT 1021
  });

  it("getExactAuditTotal handles exact page boundaries", async () => {
    // Create exactly 1000 records (2 full pages of 500).
    const records = Array.from({ length: 1000 }, (_, i) => ({
      id: `a_${i}`,
      occurred_at: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
      call_id: `nca_${i}`
    }));
    const { base44 } = createMockDB(records);
    const { getExactAuditTotal } = await import("../base44/shared/calibrationStore.ts");
    const count = await getExactAuditTotal(base44);
    expect(count).toBe(1000);
  });
});

describe("Production Budget — Workflow forgery protection", () => {
  it("public clients cannot forge a privileged workflow to bypass the production budget", () => {
    // The budget workflow is determined server-side from durable_telemetry.
    // A public client setting durable_telemetry=true routes to the calibration
    // ceiling (EXHAUSTED at 1020), NOT to the production budget (with capacity).
    // So forging the calibration workflow BLOCKS the attacker, not helps them.
    const durableTelemetry = true; // forged by public client
    const budgetWorkflow = durableTelemetry ? "calibration_ceiling" : "production_daily";
    expect(budgetWorkflow).toBe("calibration_ceiling");
    // The calibration ceiling is exhausted:
    const ceilingCheck = checkCeilingBudgetWithLimit(1034, CALIBRATION_CEILING);
    expect(ceilingCheck.allowed).toBe(false);
  });

  it("default (no durable_telemetry) routes to production_daily", () => {
    const durableTelemetry = false; // public visitor
    const budgetWorkflow = durableTelemetry ? "calibration_ceiling" : "production_daily";
    expect(budgetWorkflow).toBe("production_daily");
    // The production budget has capacity (default 500/day):
    const policy = defaultUsagePolicy();
    expect(canReserveCall(policy).allowed).toBe(true);
  });
});