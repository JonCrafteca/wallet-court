// Wallet Court — owner notification regression suite.
// 20+ scenarios covering the exactly-once outbox pattern for signup, claim,
// and verdict notifications.
//
// Pure logic tests import from ownerNotifications.ts directly.
// Store tests use an in-memory mock base44 to verify exactly-once enqueue,
// concurrent triggers, retry behavior, dead-lettering, and atomic claiming.
// Structural tests read source files to verify triggers are wired correctly
// and the admin page unwraps res.data and always exits the spinner.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  EVENT_TYPES,
  NOTIFICATION_STATUS,
  MAX_ATTEMPTS,
  STALE_LOCK_TIMEOUT_MS,
  ENQUEUE_LOCK_STALE_TIMEOUT_MS,
  buildEventKey,
  newEventId,
  newEnqueueLockId,
  canReclaimEnqueueLock,
  buildEnqueueLockCasFilter,
  computeBackoff,
  sanitizeMetadata,
  defaultSettings,
  shouldEnqueue,
  buildSignupEmail,
  buildClaimEmail,
  buildVerdictEmail,
  buildTestEmail,
  buildEmail,
  sanitizeEventForAdmin,
} from "../base44/shared/ownerNotifications.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Mock base44 factory ----

function createMockBase44(opts: { sendEmailShouldFail?: boolean } = {}) {
  const events: any[] = [];
  const settings: any[] = [];
  let sendEmailShouldFail = opts.sendEmailShouldFail || false;
  const sendEmailCalls: any[] = [];
  let idCounter = 0;

  function matchesQuery(r: any, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === "$or") {
        if (!Array.isArray(value) || !value.some((sub: any) => matchesQuery(r, sub))) return false;
        continue;
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        if ("$lte" in value) {
          if (!r[key] || r[key] > value.$lte) return false;
          continue;
        }
        if ("$exists" in value) {
          const has = r[key] !== undefined;
          if (has !== value.$exists) return false;
          continue;
        }
        if ("$in" in value) {
          if (!Array.isArray(value.$in) || !value.$in.includes(r[key])) return false;
          continue;
        }
        if ("$ne" in value) {
          if (r[key] === value.$ne) return false;
          continue;
        }
      }
      if (r[key] !== value) return false;
    }
    return true;
  }

  function filterArr(arr: any[], query: any): any[] {
    return arr.filter((r) => matchesQuery(r, query));
  }

  function sortArr(arr: any[], sort?: string): any[] {
    if (!sort) return arr;
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    return [...arr].sort((a, b) => {
      const av = String(a[key] || "");
      const bv = String(b[key] || "");
      return desc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }

  return {
    asServiceRole: {
      entities: {
        WalletCourtNotificationEvent: {
          filter: async (query: any, sort?: string, limit?: number) => {
            let results = sortArr(filterArr(events, query), sort);
            if (limit) results = results.slice(0, limit);
            return results;
          },
          create: async (data: any) => {
            const record = { id: `evt_${++idCounter}`, created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...data };
            events.push(record);
            return record;
          },
          upsert: async (records: any[], options: any) => {
            const keyFields = Array.isArray(options.key) ? options.key : [options.key];
            let created = 0, updated = 0;
            const resultRecords: any[] = [];
            for (const rec of records) {
              const existing = events.find((r) => keyFields.every((k: string) => r[k] === rec[k]));
              if (existing) {
                // Partial update: only set provided fields (preserves unprovided mutable fields)
                Object.assign(existing, rec, { updated_date: new Date().toISOString() });
                updated++;
                resultRecords.push(existing);
              } else {
                const record = { id: `evt_${++idCounter}`, created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...rec };
                events.push(record);
                created++;
                resultRecords.push(record);
              }
            }
            return { created, updated, records: resultRecords };
          },
          update: async (id: string, data: any) => {
            const idx = events.findIndex((r) => r.id === id);
            if (idx === -1) throw new Error("not found");
            events[idx] = { ...events[idx], ...data, updated_date: new Date().toISOString() };
            return events[idx];
          },
          updateMany: async (query: any, update: any) => {
            let updated = 0;
            for (const r of events) {
              if (matchesQuery(r, query)) {
                if (update.$set) Object.assign(r, update.$set);
                if (update.$inc) {
                  for (const [key, amount] of Object.entries(update.$inc)) {
                    r[key] = (r[key] || 0) + (amount as number);
                  }
                }
                updated++;
              }
            }
            return { updated };
          },
          deleteMany: async (query: any) => {
            let deleted = 0;
            for (let i = events.length - 1; i >= 0; i--) {
              if (matchesQuery(events[i], query)) {
                events.splice(i, 1);
                deleted++;
              }
            }
            return { deleted };
          },
          list: async (sort?: string, limit?: number) => {
            let results = sortArr([...events], sort);
            if (limit) results = results.slice(0, limit);
            return results;
          },
        },
        WalletCourtOwnerNotificationSettings: {
          filter: async (query: any, sort?: string, limit?: number) => {
            let results = sortArr(filterArr(settings, query), sort);
            if (limit) results = results.slice(0, limit);
            return results;
          },
          create: async (data: any) => {
            const record = { id: `set_${++idCounter}`, created_date: new Date().toISOString(), ...data };
            settings.push(record);
            return record;
          },
          update: async (id: string, data: any) => {
            const idx = settings.findIndex((r) => r.id === id);
            if (idx === -1) throw new Error("not found");
            settings[idx] = { ...settings[idx], ...data };
            return settings[idx];
          },
          updateMany: async (query: any, update: any) => {
            let updated = 0;
            for (const r of settings) {
              if (matchesQuery(r, query)) {
                if (update.$set) Object.assign(r, update.$set);
                if (update.$inc) {
                  for (const [key, amount] of Object.entries(update.$inc)) {
                    r[key] = (r[key] || 0) + (amount as number);
                  }
                }
                updated++;
              }
            }
            return { updated };
          },
        },
      },
      integrations: {
        Core: {
          SendEmail: async (params: any) => {
            sendEmailCalls.push(params);
            if (sendEmailShouldFail) throw new Error("Email delivery failed.");
            return { success: true };
          },
        },
      },
    },
    _events: events,
    _settings: settings,
    _sendEmailCalls: sendEmailCalls,
    _setSendEmailFailure: (fail: boolean) => { sendEmailShouldFail = fail; },
  };
}

// Helper: create settings with master enabled and a recipient
async function enableSettings(mockBase44, overrides: any = {}) {
  const { saveSettings } = await import("../base44/shared/ownerNotificationStore.ts");
  return saveSettings(mockBase44, {
    recipient_email: "owner@example.com",
    master_enabled: true,
    signup_enabled: true,
    claim_enabled: true,
    verdict_enabled: true,
    ...overrides
  });
}

function getEvent(mockBase44, eventId: string) {
  return mockBase44._events.find((r) => r.event_id === eventId);
}

// ---- Pure logic tests ----

describe("Owner Notifications — pure logic", () => {
  it("buildEventKey produces the correct format", () => {
    expect(buildEventKey("signup", "user_123")).toBe("walletcourt:signup:user_123");
    expect(buildEventKey("claim", "claim_456")).toBe("walletcourt:claim:claim_456");
    expect(buildEventKey("verdict", "trial_789")).toBe("walletcourt:verdict:trial_789");
  });

  it("newEventId starts with wnot_", () => {
    const id = newEventId();
    expect(id).toMatch(/^wnot_/);
    expect(id.length).toBeGreaterThan(10);
  });

  it("computeBackoff returns bounded delays", () => {
    expect(computeBackoff(0)).toBe(60);
    expect(computeBackoff(1)).toBe(300);
    expect(computeBackoff(2)).toBe(900);
    // Capped at 15m
    expect(computeBackoff(3)).toBe(900);
    expect(computeBackoff(99)).toBe(900);
  });

  it("defaultSettings has safe defaults (master disabled, all toggles enabled, empty recipient)", () => {
    const d = defaultSettings();
    expect(d.master_enabled).toBe(false);
    expect(d.recipient_email).toBe("");
    expect(d.signup_enabled).toBe(true);
    expect(d.claim_enabled).toBe(true);
    expect(d.verdict_enabled).toBe(true);
    expect(d.last_test_status).toBeNull();
  });

  it("shouldEnqueue blocks when master is disabled", () => {
    const s = { master_enabled: false, recipient_email: "a@b.com", signup_enabled: true };
    expect(shouldEnqueue(s, "signup").ok).toBe(false);
  });

  it("shouldEnqueue blocks when recipient is empty", () => {
    const s = { master_enabled: true, recipient_email: "", signup_enabled: true };
    expect(shouldEnqueue(s, "signup").ok).toBe(false);
  });

  it("shouldEnqueue blocks when specific event toggle is off", () => {
    const base = { master_enabled: true, recipient_email: "a@b.com" };
    expect(shouldEnqueue({ ...base, signup_enabled: false }, "signup").ok).toBe(false);
    expect(shouldEnqueue({ ...base, claim_enabled: false }, "claim").ok).toBe(false);
    expect(shouldEnqueue({ ...base, verdict_enabled: false }, "verdict").ok).toBe(false);
  });

  it("shouldEnqueue allows when all checks pass", () => {
    const s = { master_enabled: true, recipient_email: "a@b.com", signup_enabled: true, claim_enabled: true, verdict_enabled: true };
    expect(shouldEnqueue(s, "signup").ok).toBe(true);
    expect(shouldEnqueue(s, "claim").ok).toBe(true);
    expect(shouldEnqueue(s, "verdict").ok).toBe(true);
  });

  it("shouldEnqueue blocks when settings is null", () => {
    expect(shouldEnqueue(null, "signup").ok).toBe(false);
  });
});

// ---- Enqueue lock pure-logic tests ----

describe("Owner Notifications — enqueue lock pure logic", () => {
  it("newEnqueueLockId starts with enq_", () => {
    const id = newEnqueueLockId();
    expect(id).toMatch(/^enq_/);
    expect(id.length).toBeGreaterThan(10);
  });

  it("canReclaimEnqueueLock returns true when lock is free (null/missing)", () => {
    expect(canReclaimEnqueueLock(null)).toBe(true);
    expect(canReclaimEnqueueLock({})).toBe(true);
    expect(canReclaimEnqueueLock({ enqueue_lock_id: null })).toBe(true);
    expect(canReclaimEnqueueLock({ enqueue_lock_id: undefined })).toBe(true);
    expect(canReclaimEnqueueLock({ enqueue_lock_id: "", enqueue_lock_acquired_at: null })).toBe(true);
  });

  it("canReclaimEnqueueLock returns false when lock is freshly held", () => {
    const now = Date.now();
    const settings = {
      enqueue_lock_id: "enq_123",
      enqueue_lock_acquired_at: new Date(now).toISOString()
    };
    expect(canReclaimEnqueueLock(settings, now)).toBe(false);
    expect(canReclaimEnqueueLock(settings, now + 1000)).toBe(false);
  });

  it("canReclaimEnqueueLock returns true when lock is stale (held > ENQUEUE_LOCK_STALE_TIMEOUT_MS)", () => {
    const now = Date.now();
    const staleAcquired = new Date(now - ENQUEUE_LOCK_STALE_TIMEOUT_MS - 1000).toISOString();
    const settings = {
      enqueue_lock_id: "enq_stale",
      enqueue_lock_acquired_at: staleAcquired
    };
    expect(canReclaimEnqueueLock(settings, now)).toBe(true);
  });

  it("canReclaimEnqueueLock returns true when acquired_at is missing or invalid", () => {
    expect(canReclaimEnqueueLock({ enqueue_lock_id: "enq_x", enqueue_lock_acquired_at: null }, Date.now())).toBe(true);
    expect(canReclaimEnqueueLock({ enqueue_lock_id: "enq_x", enqueue_lock_acquired_at: "not-a-date" }, Date.now())).toBe(true);
  });

  it("buildEnqueueLockCasFilter returns null when lock is freshly held", () => {
    const now = Date.now();
    const settings = {
      control_key: "main",
      version: 5,
      enqueue_lock_id: "enq_fresh",
      enqueue_lock_acquired_at: new Date(now).toISOString()
    };
    expect(buildEnqueueLockCasFilter(settings, now)).toBeNull();
  });

  it("buildEnqueueLockCasFilter returns version-only filter when lock is free", () => {
    const settings = {
      control_key: "main",
      version: 3,
      enqueue_lock_id: null,
      enqueue_lock_acquired_at: null
    };
    const filter = buildEnqueueLockCasFilter(settings, Date.now());
    expect(filter).toBeTruthy();
    expect(filter.control_key).toBe("main");
    expect(filter.version).toBe(3);
    // Free lock: version guard only — no enqueue_lock_id in filter
    expect(filter).not.toHaveProperty("enqueue_lock_id");
    expect(filter.$or).toBeUndefined();
  });

  it("buildEnqueueLockCasFilter returns specific-lock filter when lock is stale (reclaim)", () => {
    const now = Date.now();
    const staleAcquired = new Date(now - ENQUEUE_LOCK_STALE_TIMEOUT_MS - 5000).toISOString();
    const settings = {
      control_key: "main",
      version: 7,
      enqueue_lock_id: "enq_stale_one",
      enqueue_lock_acquired_at: staleAcquired
    };
    const filter = buildEnqueueLockCasFilter(settings, now);
    expect(filter).toBeTruthy();
    expect(filter.control_key).toBe("main");
    expect(filter.version).toBe(7);
    expect(filter.enqueue_lock_id).toBe("enq_stale_one");
    expect(filter.$or).toBeUndefined();
  });

  it("buildEnqueueLockCasFilter returns null for null settings", () => {
    expect(buildEnqueueLockCasFilter(null)).toBeNull();
  });

  it("ENQUEUE_LOCK_STALE_TIMEOUT_MS is 30 seconds", () => {
    expect(ENQUEUE_LOCK_STALE_TIMEOUT_MS).toBe(30000);
  });
});

// ---- Sanitization tests ----

describe("Owner Notifications — sanitization", () => {
  it("sanitizeMetadata strips full EVM addresses", () => {
    const full = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    const result = sanitizeMetadata({ address: full, address_short: "0x742d…f44e" });
    expect(result.address).toBeUndefined();
    expect(result.address_short).toBe("0x742d…f44e");
  });

  it("sanitizeMetadata strips full Solana addresses", () => {
    const full = "7NQ4YqW2VtKEHFEbLn7mQ4g5KqXKfY2pLmNzZ3vQwR5o";
    const result = sanitizeMetadata({ address: full, address_short: "7NQ4…wR5o" });
    expect(result.address).toBeUndefined();
    expect(result.address_short).toBe("7NQ4…wR5o");
  });

  it("sanitizeMetadata keeps non-address values", () => {
    const result = sanitizeMetadata({ network: "ethereum", verdict_name: "One Pump Chump", severity: 75 });
    expect(result.network).toBe("ethereum");
    expect(result.verdict_name).toBe("One Pump Chump");
    expect(result.severity).toBe(75);
  });

  it("signup email never contains a full wallet address", () => {
    const email = buildSignupEmail({ user_email: "test@example.com", user_name: "Test", auth_method: "password" });
    expect(email.body).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(email.subject).toBe("⚖️ New Wallet Court signup");
  });

  it("claim email uses address_short, never the full address", () => {
    const email = buildClaimEmail({ court_name: "Test", network: "ethereum", address_short: "0x742d…f44e", claim_slug: "wlt_abc" });
    expect(email.body).toContain("0x742d…f44e");
    expect(email.body).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(email.subject).toBe("🔐 Wallet claimed in Wallet Court");
  });

  it("verdict email uses address_short and includes verdict name, severity, calls", () => {
    const email = buildVerdictEmail({
      verdict_name: "One Pump Chump", network: "ethereum", address_short: "0x742d…f44e",
      severity_score: 85, confidence_score: 92, physical_calls: 4, public_slug: "case-abc"
    });
    expect(email.body).toContain("One Pump Chump");
    expect(email.body).toContain("85/100");
    expect(email.body).toContain("92/100");
    expect(email.body).toContain("4");
    expect(email.body).toContain("case-abc");
    expect(email.body).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(email.subject).toBe("⚖️ New Wallet Court verdict: One Pump Chump");
  });
});

// ---- Store tests (exactly-once, concurrent, retry, dead-letter) ----

describe("Owner Notifications — store (exactly-once enqueue)", () => {
  it("enqueues one event when settings are enabled", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP,
      source_entity: "User",
      source_record_id: "user_1",
      metadata: { user_email: "test@example.com" }
    });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.event_id).toBeTruthy();
    expect(mock._events.length).toBe(1);
  });

  it("duplicate replay sends zero additional events (fast path)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: { user_email: "test@example.com" }
    });
    const result2 = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: { user_email: "test@example.com" }
    });
    expect(result2.ok).toBe(true);
    expect(result2.duplicate).toBe(true);
    expect(mock._events.length).toBe(1);
  });

  it("concurrent triggers produce one event (race-safe via CAS mutex lock)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    // Two concurrent enqueues for the same key
    const [r1, r2] = await Promise.all([
      enqueueNotification(mock, {
        event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
        metadata: { network: "ethereum", address_short: "0x742d…f44e" }
      }),
      enqueueNotification(mock, {
        event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
        metadata: { network: "ethereum", address_short: "0x742d…f44e" }
      }),
    ]);
    // Exactly one event was created
    expect(mock._events.length).toBe(1);
    // Exactly one is the winner, exactly one is a duplicate
    expect(r1.duplicate).not.toBe(r2.duplicate);
    expect(r1.ok && r2.ok).toBe(true);
  });

  it("disabled master sends zero events", async () => {
    const mock = createMockBase44();
    await enableSettings(mock, { master_enabled: false });
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    expect(result.ok).toBe(false);
    expect(mock._events.length).toBe(0);
  });

  it("disabled event toggle sends zero events", async () => {
    const mock = createMockBase44();
    await enableSettings(mock, { verdict_enabled: false });
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1",
      metadata: {}
    });
    expect(result.ok).toBe(false);
    expect(mock._events.length).toBe(0);
  });

  it("empty recipient sends zero events", async () => {
    const mock = createMockBase44();
    await enableSettings(mock, { recipient_email: "" });
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    expect(result.ok).toBe(false);
    expect(mock._events.length).toBe(0);
  });

  it("no settings record at all sends zero events (safe default)", async () => {
    const mock = createMockBase44();
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    expect(result.ok).toBe(false);
    expect(mock._events.length).toBe(0);
  });
});

describe("Owner Notifications — store (delivery + retry)", () => {
  it("successful delivery marks event as sent and sends one email", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, deliverOneEvent, markSent } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1",
      metadata: { verdict_name: "One Pump Chump", network: "ethereum", address_short: "0x742d…f44e", public_slug: "case-abc" }
    });
    const record = getEvent(mock, enq.event_id!);
    const result = await deliverOneEvent(mock, record);
    expect(result.sent).toBe(true);
    await markSent(mock, record);
    const updated = getEvent(mock, enq.event_id!);
    expect(updated.status).toBe(NOTIFICATION_STATUS.SENT);
    expect(updated.sent_at).toBeTruthy();
    expect(mock._sendEmailCalls.length).toBe(1);
  });

  it("email failure never breaks the originating action (enqueue still succeeds)", async () => {
    const mock = createMockBase44({ sendEmailShouldFail: true });
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    // The trigger (e.g. verifyWalletClaim) calls enqueueNotification wrapped in
    // waitUntil + .catch(() => {}). Even if the entire enqueue fails, the
    // claim/verdict has already been committed. Here we test that enqueue
    // itself succeeds even when SendEmail would fail later.
    const result = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
      metadata: { network: "ethereum", address_short: "0x742d…f44e" }
    });
    expect(result.ok).toBe(true);
    expect(mock._events.length).toBe(1);
  });

  it("retry succeeds without duplication (one email total)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, deliverOneEvent, markSent, markFailed } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: { user_email: "test@example.com" }
    });
    // First attempt fails
    mock._setSendEmailFailure(true);
    let record = getEvent(mock, enq.event_id!);
    let result = await deliverOneEvent(mock, record);
    expect(result.sent).toBe(false);
    await markFailed(mock, record, result.error);
    expect(mock._sendEmailCalls.length).toBe(1);

    // Second attempt succeeds
    mock._setSendEmailFailure(false);
    record = getEvent(mock, enq.event_id!);
    result = await deliverOneEvent(mock, record);
    expect(result.sent).toBe(true);
    await markSent(mock, record);
    expect(mock._sendEmailCalls.length).toBe(2); // 1 failed + 1 success

    // Third attempt (replay) — event is already sent, no more emails
    record = getEvent(mock, enq.event_id!);
    expect(record.status).toBe(NOTIFICATION_STATUS.SENT);
  });

  it("three failures produce dead letter", async () => {
    const mock = createMockBase44({ sendEmailShouldFail: true });
    await enableSettings(mock);
    const { enqueueNotification, deliverOneEvent, markFailed } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
      metadata: { network: "ethereum", address_short: "0x742d…f44e" }
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const record = getEvent(mock, enq.event_id!);
      const result = await deliverOneEvent(mock, record);
      expect(result.sent).toBe(false);
      const failResult = await markFailed(mock, record, result.error);
      if (i < MAX_ATTEMPTS - 1) {
        expect(failResult.dead_lettered).toBe(false);
      } else {
        expect(failResult.dead_lettered).toBe(true);
      }
    }
    const final = getEvent(mock, enq.event_id!);
    expect(final.status).toBe(NOTIFICATION_STATUS.DEAD_LETTER);
    expect(final.attempt_count).toBe(MAX_ATTEMPTS);
  });

  it("scheduled and manual workers cannot double-claim (atomic CAS)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, claimEvent } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1",
      metadata: { verdict_name: "Test", network: "ethereum", address_short: "0x1234…abcd" }
    });
    const record = getEvent(mock, enq.event_id!);
    // Two concurrent claim attempts
    const [c1, c2] = await Promise.all([
      claimEvent(mock, record, "lock_1"),
      claimEvent(mock, record, "lock_2"),
    ]);
    expect(c1).toBe(true);
    expect(c2).toBe(false); // CAS failed — already claimed
    const updated = getEvent(mock, enq.event_id!);
    expect(updated.processing_lock_id).toBe("lock_1");
    expect(updated.status).toBe(NOTIFICATION_STATUS.PROCESSING);
  });
});

// ---- CAS mutex-lock tests ----

describe("Owner Notifications — CAS mutex lock", () => {
  it("winner explicitly initializes ALL mutable lock fields (no schema-default reliance)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: { user_email: "test@example.com" }
    });
    expect(enq.duplicate).toBe(false);
    const record = getEvent(mock, enq.event_id!);
    // Every required lock field must be explicitly persisted
    expect(record.status).toBe(NOTIFICATION_STATUS.PENDING);
    expect(record.attempt_count).toBe(0);
    expect(record.max_attempts).toBe(MAX_ATTEMPTS);
    expect(record.next_retry_at).toBeTruthy();
    expect(record.processing_lock_id).toBeNull();
    expect(record.processing_lock_acquired_at).toBeNull();
    expect(record.last_attempt_at).toBeNull();
    expect(record.sent_at).toBeNull();
    expect(record.last_error).toBeNull();
  });

  it("duplicate enqueue does NOT overwrite mutable delivery state (lock-serialized check-then-find)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, markSent } = await import("../base44/shared/ownerNotificationStore.ts");
    // Enqueue + deliver + mark sent
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
      metadata: { network: "ethereum", address_short: "0x742d…f44e" }
    });
    const record = getEvent(mock, enq.event_id!);
    await markSent(mock, record);
    const sentRecord = getEvent(mock, enq.event_id!);
    expect(sentRecord.status).toBe(NOTIFICATION_STATUS.SENT);
    expect(sentRecord.sent_at).toBeTruthy();

    // Replay: duplicate enqueue with the same event_key
    const replay = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
      metadata: { network: "ethereum", address_short: "0x742d…f44e" }
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.ok).toBe(true);

    // The sent event's mutable state must NOT be reset. The lock-serialized
    // enqueue finds the existing event by event_key and returns duplicate
    // without modifying any fields.
    const afterReplay = mock._events.find((r) => r.event_key === "walletcourt:claim:claim_1");
    expect(afterReplay).toBeTruthy();
    expect(afterReplay.status).toBe(NOTIFICATION_STATUS.SENT);
    expect(afterReplay.sent_at).toBeTruthy();
    expect(afterReplay.attempt_count).toBe(0); // not reset
  });

  it("25 simultaneous enqueues with the same event_key produce exactly one row via CAS mutex lock (mock)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    const promises = Array.from({ length: 25 }, () =>
      enqueueNotification(mock, {
        event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1",
        metadata: { verdict_name: "Test", network: "ethereum", address_short: "0x1234…abcd" }
      })
    );
    const results = await Promise.all(promises);
    // Exactly one row
    expect(mock._events.length).toBe(1);
    // Exactly one winner
    const winners = results.filter((r) => !r.duplicate);
    const duplicates = results.filter((r) => r.duplicate);
    expect(winners.length).toBe(1);
    expect(duplicates.length).toBe(24);
    // All results are ok
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("claimEvent rejects sent and dead_letter events (defense-in-depth)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, claimEvent, markSent, markFailed } = await import("../base44/shared/ownerNotificationStore.ts");
    // Sent event
    const enq1 = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    const r1 = getEvent(mock, enq1.event_id!);
    await markSent(mock, r1);
    const sentRecord = getEvent(mock, enq1.event_id!);
    expect(await claimEvent(mock, sentRecord, "lock_x")).toBe(false);

    // Dead-letter event
    mock._setSendEmailFailure(true);
    const enq2 = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1",
      metadata: {}
    });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = getEvent(mock, enq2.event_id!);
      await markFailed(mock, r, "fail");
    }
    const dlRecord = getEvent(mock, enq2.event_id!);
    expect(dlRecord.status).toBe(NOTIFICATION_STATUS.DEAD_LETTER);
    expect(await claimEvent(mock, dlRecord, "lock_y")).toBe(false);
  });

  it("normalizeEventForClaiming sets missing lock fields to null (legacy events)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, normalizeEventForClaiming } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    const record = getEvent(mock, enq.event_id!);
    // Simulate a legacy event: delete lock fields
    delete record.processing_lock_id;
    delete record.processing_lock_acquired_at;
    delete record.attempt_count;
    // Normalize
    const normalized = await normalizeEventForClaiming(mock, record);
    expect(normalized.processing_lock_id).toBeNull();
    expect(normalized.processing_lock_acquired_at).toBeNull();
    expect(normalized.attempt_count).toBe(0);
    // The persisted record also has the fields
    const persisted = getEvent(mock, enq.event_id!);
    expect(persisted.processing_lock_id).toBeNull();
    expect(persisted.attempt_count).toBe(0);
  });

  it("normalizeEventForClaiming does not touch sent or dead_letter events", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, normalizeEventForClaiming, markSent } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1",
      metadata: {}
    });
    const record = getEvent(mock, enq.event_id!);
    await markSent(mock, record);
    const sentRecord = getEvent(mock, enq.event_id!);
    const before = { ...sentRecord };
    await normalizeEventForClaiming(mock, sentRecord);
    const after = getEvent(mock, enq.event_id!);
    // No changes
    expect(after.status).toBe(before.status);
    expect(after.sent_at).toBe(before.sent_at);
  });

  it("newly created event with explicit null lock fields is immediately claimable", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification, claimEvent } = await import("../base44/shared/ownerNotificationStore.ts");
    const enq = await enqueueNotification(mock, {
      event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1",
      metadata: { verdict_name: "Test", network: "ethereum", address_short: "0x1234…abcd" }
    });
    const record = getEvent(mock, enq.event_id!);
    // Lock fields are explicitly null
    expect(record.processing_lock_id).toBeNull();
    // Claim immediately
    const claimed = await claimEvent(mock, record, "lock_1");
    expect(claimed).toBe(true);
    const updated = getEvent(mock, enq.event_id!);
    expect(updated.processing_lock_id).toBe("lock_1");
    expect(updated.status).toBe(NOTIFICATION_STATUS.PROCESSING);
  });

  it("signup, claim, and verdict replays are permanent no-ops (exactly-once)", async () => {
    const mock = createMockBase44();
    await enableSettings(mock);
    const { enqueueNotification } = await import("../base44/shared/ownerNotificationStore.ts");
    // Signup
    await enqueueNotification(mock, { event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1", metadata: {} });
    for (let i = 0; i < 5; i++) {
      const r = await enqueueNotification(mock, { event_type: EVENT_TYPES.SIGNUP, source_entity: "User", source_record_id: "user_1", metadata: {} });
      expect(r.duplicate).toBe(true);
    }
    // Claim
    await enqueueNotification(mock, { event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1", metadata: {} });
    for (let i = 0; i < 5; i++) {
      const r = await enqueueNotification(mock, { event_type: EVENT_TYPES.CLAIM, source_entity: "WalletClaim", source_record_id: "claim_1", metadata: {} });
      expect(r.duplicate).toBe(true);
    }
    // Verdict
    await enqueueNotification(mock, { event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1", metadata: {} });
    for (let i = 0; i < 5; i++) {
      const r = await enqueueNotification(mock, { event_type: EVENT_TYPES.VERDICT, source_entity: "WalletTrial", source_record_id: "trial_1", metadata: {} });
      expect(r.duplicate).toBe(true);
    }
    // Exactly 3 events total
    expect(mock._events.length).toBe(3);
  });
});

// ---- Structural tests: trigger wiring ----

const verifyClaimSrc = readFileSync(join(__dirname, "../base44/functions/verifyWalletClaim/entry.ts"), "utf-8");
const analyzeWalletSrc = readFileSync(join(__dirname, "../base44/functions/analyzeWalletWithNansen/entry.ts"), "utf-8");
const adminPageSrc = readFileSync(join(__dirname, "../src/pages/AdminOwnerNotifications.jsx"), "utf-8");

describe("Owner Notifications — trigger wiring (structural)", () => {
  it("verifyWalletClaim enqueues a claim notification after claim creation", () => {
    expect(verifyClaimSrc).toContain("enqueueNotification");
    expect(verifyClaimSrc).toContain("EVENT_TYPES.CLAIM");
    expect(verifyClaimSrc).toContain("source_entity: \"WalletClaim\"");
    // Non-blocking: wrapped in waitUntil + catch
    expect(verifyClaimSrc).toMatch(/waitUntil\(enqueueNotification/);
  });

  it("verifyWalletClaim does NOT enqueue for refreshed claims (only new claims)", () => {
    // The enqueue is after WalletClaim.create, which is only called for new
    // claims. The "refreshed" branch returns early before reaching the enqueue.
    expect(verifyClaimSrc).toContain('status: "refreshed"');
    // The enqueue must come AFTER the create call, not before it
    const createIdx = verifyClaimSrc.indexOf("WalletClaim.create");
    const enqueueCallIdx = verifyClaimSrc.indexOf("enqueueNotification", createIdx);
    expect(enqueueCallIdx).toBeGreaterThan(createIdx);
  });

  it("analyzeWalletWithNansen enqueues a verdict notification after verdict trial creation", () => {
    expect(analyzeWalletSrc).toContain("enqueueNotification");
    expect(analyzeWalletSrc).toContain("EVENT_TYPES.VERDICT");
    expect(analyzeWalletSrc).toContain("source_entity: \"WalletTrial\"");
    expect(analyzeWalletSrc).toMatch(/waitUntil\(enqueueNotification/);
  });

  it("analyzeWalletWithNansen does NOT enqueue for dismissed or mistrial cases", () => {
    // The enqueue should only appear ONCE in the file (for the verdict block),
    // not in the dismissed/mistrial block.
    const enqueueCount = (analyzeWalletSrc.match(/enqueueNotification/g) || []).length;
    // One import + one call = 2 occurrences
    expect(enqueueCount).toBe(2);
    // The dismissed/mistrial block does not contain the verdict enqueue
    const dismissedIdx = analyzeWalletSrc.indexOf("dismissed_no_evidence");
    const verdictEnqueueIdx = analyzeWalletSrc.indexOf("EVENT_TYPES.VERDICT");
    expect(verdictEnqueueIdx).toBeGreaterThan(dismissedIdx);
  });

  it("analyzeWalletWithNansen does NOT enqueue for demo cases", () => {
    // The enqueue count is exactly 2 (import + verdict call), proving it's
    // not in the demo or dismissed/mistrial blocks. The demo path returns
    // before reaching the verdict enqueue.
    const enqueueCount = (analyzeWalletSrc.match(/enqueueNotification/g) || []).length;
    expect(enqueueCount).toBe(2);
    const demoReturnIdx = analyzeWalletSrc.indexOf('return Response.json({ trial, analysis: { outcome: "demo"');
    const verdictEnqueueIdx = analyzeWalletSrc.indexOf("EVENT_TYPES.VERDICT");
    expect(demoReturnIdx).toBeGreaterThan(-1);
    expect(verdictEnqueueIdx).toBeGreaterThan(demoReturnIdx);
  });

  it("verdict notification includes physical_calls from nansen.physicalCallCount", () => {
    expect(analyzeWalletSrc).toContain("physical_calls: nansen.physicalCallCount");
  });

  it("verdict notification uses shortAddr for address_short (never full address)", () => {
    expect(analyzeWalletSrc).toContain("shortAddr(record.normalized_wallet_address)");
    // The metadata must not store normalized_wallet_address as a key (only address_short)
    expect(analyzeWalletSrc).not.toMatch(/metadata:\s*\{[^}]*normalized_wallet_address:/s);
  });
});

// ---- Structural tests: admin page ----

describe("Owner Notifications — admin page (structural)", () => {
  it("correctly unwraps res.data from all function calls", () => {
    // Every base44.functions.invoke must unwrap res?.data
    expect(adminPageSrc).toContain("settingsRes?.data?.settings");
    expect(adminPageSrc).toContain("outboxRes?.data");
    expect(adminPageSrc).toContain("res?.data?.error");
  });

  it("loadData uses try/catch/finally and always exits the spinner", () => {
    expect(adminPageSrc).toContain("setLoading(true)");
    expect(adminPageSrc).toContain("setLoading(false)");
    // The finally block must contain setLoading(false)
    const finallyIdx = adminPageSrc.indexOf("} finally {", adminPageSrc.indexOf("async function loadData"));
    const setLoadingFalseIdx = adminPageSrc.indexOf("setLoading(false)", finallyIdx);
    expect(setLoadingFalseIdx).toBeGreaterThan(finallyIdx);
  });

  it("page loading performs zero sends, retries, or mutations (read-only)", () => {
    // loadData only calls getOwnerNotificationSettings and getOwnerNotificationOutbox
    const loadDataStart = adminPageSrc.indexOf("async function loadData");
    const loadDataEnd = adminPageSrc.indexOf("}", adminPageSrc.indexOf("} finally {", loadDataStart) + 1);
    const loadDataSrc = adminPageSrc.slice(loadDataStart, loadDataEnd);
    expect(loadDataSrc).toContain("getOwnerNotificationSettings");
    expect(loadDataSrc).toContain("getOwnerNotificationOutbox");
    expect(loadDataSrc).not.toContain("saveOwnerNotificationSettings");
    expect(loadDataSrc).not.toContain("sendOwnerNotificationTest");
    expect(loadDataSrc).not.toContain("retryOwnerNotification");
    expect(loadDataSrc).not.toContain("deliverOwnerNotifications");
  });

  it("missing settings/outbox never causes an infinite spinner", () => {
    // The page must handle null settings and null outbox gracefully
    expect(adminPageSrc).toContain("settingsRes?.data?.settings");
    expect(adminPageSrc).toContain("outboxRes?.data");
    // Default stats are used when outbox is null
    expect(adminPageSrc).toContain("outbox?.stats || {");
    expect(adminPageSrc).toContain("outbox?.recent || []");
  });

  it("includes all required UI elements", () => {
    expect(adminPageSrc).toContain("recipient_email");
    expect(adminPageSrc).toContain("master_enabled");
    expect(adminPageSrc).toContain("signup_enabled");
    expect(adminPageSrc).toContain("claim_enabled");
    expect(adminPageSrc).toContain("verdict_enabled");
    expect(adminPageSrc).toContain("Save Settings");
    expect(adminPageSrc).toContain("Send Test Email");
    expect(adminPageSrc).toContain("Retry Due Events");
  });
});

// ---- Structural tests: existing behavior unchanged ----

describe("Owner Notifications — existing behavior unchanged", () => {
  it("verifyWalletClaim still enqueues ShoutIt attribution (unchanged)", () => {
    expect(verifyClaimSrc).toContain("enqueueAttributionEvent");
    expect(verifyClaimSrc).toContain("wallet_claimed");
  });

  it("analyzeWalletWithNansen still enqueues ShoutIt attribution (unchanged)", () => {
    expect(analyzeWalletSrc).toContain("enqueueAttributionEvent");
    expect(analyzeWalletSrc).toContain("enqueueTrialAttribution");
  });

  it("analyzeWalletWithNansen does not modify Nansen, circuit, or verdict logic", () => {
    expect(analyzeWalletSrc).toContain("fetchNansenEvidence");
    expect(analyzeWalletSrc).toContain("assessRecess");
    expect(analyzeWalletSrc).toContain("classifyOutcome");
    expect(analyzeWalletSrc).toContain("selectEntityVerdict");
    expect(analyzeWalletSrc).toContain("computeSeverityConfidence");
  });

  it("notification imports do not interfere with existing imports", () => {
    // The new imports are additive, not replacing
    expect(analyzeWalletSrc).toContain('from "../../shared/attributionStore.ts"');
    expect(analyzeWalletSrc).toContain('from "../../shared/ownerNotificationStore.ts"');
    expect(analyzeWalletSrc).toContain('from "../../shared/featureFlags.ts"');
  });
});

// ---- Workflow structural tests ----

const signupWorkflowSrc = readFileSync(join(__dirname, "../base44/workflows/OnWalletCourtSignup.jsonc"), "utf-8");
const deliverWorkflowSrc = readFileSync(join(__dirname, "../base44/workflows/DeliverOwnerNotifications.jsonc"), "utf-8");

describe("Owner Notifications — workflows (structural)", () => {
  it("signup workflow only triggers on signup events (not login)", () => {
    const wf = JSON.parse(signupWorkflowSrc);
    expect(wf.trigger.config.trigger_type).toBe("app_user_auth");
    expect(wf.trigger.config.events).toEqual(["signup"]);
  });

  it("signup workflow calls onWalletCourtSignup with correct args", () => {
    const wf = JSON.parse(signupWorkflowSrc);
    const step = wf.definition.do[0];
    expect(step.enqueue_signup_notification.with.function_name).toBe("onWalletCourtSignup");
    expect(step.enqueue_signup_notification.with.args.user_id).toBe("${ .trigger.user_id }");
  });

  it("delivery workflow is scheduled every 5 minutes", () => {
    const wf = JSON.parse(deliverWorkflowSrc);
    expect(wf.trigger.config.trigger_type).toBe("scheduled");
    expect(wf.trigger.config.cron_expression).toBe("*/5 * * * *");
  });

  it("delivery workflow calls deliverOwnerNotifications", () => {
    const wf = JSON.parse(deliverWorkflowSrc);
    expect(wf.definition.do[0].deliver.with.function_name).toBe("deliverOwnerNotifications");
  });
});