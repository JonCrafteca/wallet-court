import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  validateRefCode,
  newEventId,
  newVisitorId,
  buildAttributionPayload,
  refreshTimestamp,
  serializePayload,
  signPayload,
  classifyReceiverResponse,
  computeBackoff,
  isEventTooOld,
  OUTBOX_STATUS,
  EVENT_TYPES,
} from "../base44/shared/attribution.ts";

describe("validateRefCode", () => {
  it("accepts a valid lowercase slug", () => {
    expect(validateRefCode("creatorname").ok).toBe(true);
    expect(validateRefCode("creatorname").value).toBe("creatorname");
  });

  it("normalizes to lowercase", () => {
    expect(validateRefCode("CreatorName").ok).toBe(true);
    expect(validateRefCode("CreatorName").value).toBe("creatorname");
  });

  it("accepts hyphens and underscores in the middle", () => {
    expect(validateRefCode("my-creator_1").ok).toBe(true);
  });

  it("accepts single character", () => {
    expect(validateRefCode("a").ok).toBe(true);
  });

  it("rejects empty", () => {
    expect(validateRefCode("").ok).toBe(false);
    expect(validateRefCode(null).ok).toBe(false);
    expect(validateRefCode(undefined).ok).toBe(false);
  });

  it("rejects excessively long values", () => {
    expect(validateRefCode("a".repeat(33)).ok).toBe(false);
  });

  it("accepts max 32 chars", () => {
    expect(validateRefCode("a".repeat(32)).ok).toBe(true);
  });

  it("rejects spaces and special chars", () => {
    expect(validateRefCode("my creator").ok).toBe(false);
    expect(validateRefCode("my/creator").ok).toBe(false);
    expect(validateRefCode("my@creator").ok).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(validateRefCode("-creator").ok).toBe(false);
    expect(validateRefCode("creator-").ok).toBe(false);
  });
});

describe("ID generation", () => {
  it("newEventId produces attr_ prefixed unique IDs", () => {
    const id1 = newEventId();
    const id2 = newEventId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("attr_")).toBe(true);
  });

  it("newVisitorId produces unique IDs", () => {
    const v1 = newVisitorId();
    const v2 = newVisitorId();
    expect(v1).not.toBe(v2);
    expect(v1.length).toBeGreaterThanOrEqual(8);
  });
});

describe("buildAttributionPayload", () => {
  it("includes all required fields", () => {
    const payload = buildAttributionPayload({
      event_id: "attr_123",
      event_type: "trial_started",
      ref_code: "creator",
      visitor_id: "vid_abc",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    expect(payload.event_id).toBe("attr_123");
    expect(payload.event_type).toBe("trial_started");
    expect(payload.ref_code).toBe("creator");
    expect(payload.visitor_id).toBe("vid_abc");
    expect(payload.occurred_at).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.timestamp).toBe(1767225600);
    expect(payload.metadata).toEqual({});
  });

  it("includes optional fields when provided", () => {
    const payload = buildAttributionPayload({
      event_id: "attr_123",
      event_type: "receipt_shared",
      ref_code: "creator",
      visitor_id: "vid_abc",
      occurred_at: "2026-01-01T00:00:00.000Z",
      external_trial_id: "case-abc",
      share_channel: "x",
      metadata: { user_initiated: true },
    });
    expect(payload.external_trial_id).toBe("case-abc");
    expect(payload.share_channel).toBe("x");
    expect(payload.metadata.user_initiated).toBe(true);
  });

  it("omits optional fields when not provided", () => {
    const payload = buildAttributionPayload({
      event_id: "attr_123",
      event_type: "trial_started",
      ref_code: "creator",
      visitor_id: "vid_abc",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    expect(payload.external_trial_id).toBeUndefined();
    expect(payload.share_channel).toBeUndefined();
  });
});

describe("refreshTimestamp", () => {
  it("updates timestamp to current time", () => {
    const payload = { event_id: "attr_123", occurred_at: "2026-01-01T00:00:00.000Z", timestamp: 1735689600 };
    const refreshed = refreshTimestamp(payload, new Date("2026-01-02T00:00:00.000Z").getTime());
    expect(refreshed.timestamp).toBe(1767312000);
  });

  it("preserves occurred_at and event_id", () => {
    const payload = { event_id: "attr_123", occurred_at: "2026-01-01T00:00:00.000Z", timestamp: 1735689600 };
    const refreshed = refreshTimestamp(payload, Date.now());
    expect(refreshed.occurred_at).toBe("2026-01-01T00:00:00.000Z");
    expect(refreshed.event_id).toBe("attr_123");
  });
});

describe("signPayload", () => {
  it("produces correct HMAC-SHA256 signature", async () => {
    const body = '{"test":true}';
    const secret = "test-secret";
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const result = await signPayload(body, secret);
    expect(result).toBe(expected);
    expect(result.startsWith("sha256=")).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const body = '{"event_id":"attr_123"}';
    const secret = "test-secret";
    const sig1 = await signPayload(body, secret);
    const sig2 = await signPayload(body, secret);
    expect(sig1).toBe(sig2);
  });

  it("differs for different inputs", async () => {
    const secret = "test-secret";
    const sig1 = await signPayload('{"a":1}', secret);
    const sig2 = await signPayload('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });
});

describe("classifyReceiverResponse", () => {
  it("treats 200 as delivered", () => {
    const r = classifyReceiverResponse(200, { attribution_status: "accepted" });
    expect(r.delivered).toBe(true);
    expect(r.retry).toBe(false);
  });

  it("treats 200 duplicate as delivered", () => {
    const r = classifyReceiverResponse(200, { duplicate: true });
    expect(r.delivered).toBe(true);
  });

  it("treats 200 no_match as delivered", () => {
    const r = classifyReceiverResponse(200, { attribution_status: "no_match" });
    expect(r.delivered).toBe(true);
  });

  it("treats 401 as permanent failure (invalid_signature)", () => {
    const r = classifyReceiverResponse(401, { error_code: "invalid_signature" });
    expect(r.delivered).toBe(false);
    expect(r.retry).toBe(false);
    expect(r.permanentFailure).toBe(true);
  });

  it("treats 400 replay_window_exceeded as retryable", () => {
    const r = classifyReceiverResponse(400, { error_code: "replay_window_exceeded" });
    expect(r.retry).toBe(true);
    expect(r.permanentFailure).toBe(false);
  });

  it("treats 400 missing_required_fields as permanent", () => {
    const r = classifyReceiverResponse(400, { error_code: "missing_required_fields" });
    expect(r.permanentFailure).toBe(true);
    expect(r.retry).toBe(false);
  });

  it("treats 400 invalid_event_type as permanent", () => {
    const r = classifyReceiverResponse(400, { error_code: "invalid_event_type" });
    expect(r.permanentFailure).toBe(true);
  });

  it("treats 400 event_too_old as permanent", () => {
    const r = classifyReceiverResponse(400, { error_code: "event_too_old" });
    expect(r.permanentFailure).toBe(true);
  });

  it("treats 400 other as permanent", () => {
    const r = classifyReceiverResponse(400, { error_code: "other_validation" });
    expect(r.permanentFailure).toBe(true);
  });

  it("treats 500 as retryable", () => {
    const r = classifyReceiverResponse(500, {});
    expect(r.retry).toBe(true);
    expect(r.permanentFailure).toBe(false);
  });

  it("treats 503 as retryable", () => {
    const r = classifyReceiverResponse(503, {});
    expect(r.retry).toBe(true);
  });

  it("treats 0 (network failure) as retryable", () => {
    const r = classifyReceiverResponse(0, null);
    expect(r.retry).toBe(true);
    expect(r.errorCode).toBe("network_error");
  });

  it("sanitizes signatures and addresses from error messages", () => {
    const r = classifyReceiverResponse(400, { message: "sha256=abcdef0123456789 and 0x1234567890abcdef1234567890abcdef12345678" });
    expect(r.errorSummary).not.toContain("sha256=abcdef");
    expect(r.errorSummary).not.toContain("0x1234");
  });
});

describe("computeBackoff", () => {
  it("returns 1 minute for first attempt", () => {
    expect(computeBackoff(0)).toBe(60);
  });

  it("returns 5 minutes for second attempt", () => {
    expect(computeBackoff(1)).toBe(300);
  });

  it("returns 15 minutes for third attempt", () => {
    expect(computeBackoff(2)).toBe(900);
  });

  it("returns 1 hour for fourth attempt", () => {
    expect(computeBackoff(3)).toBe(3600);
  });

  it("returns 6 hours for fifth+ attempt", () => {
    expect(computeBackoff(4)).toBe(21600);
    expect(computeBackoff(5)).toBe(21600);
    expect(computeBackoff(100)).toBe(21600);
  });
});

describe("isEventTooOld", () => {
  it("returns false for events within 24h", () => {
    const occurred = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    expect(isEventTooOld(occurred)).toBe(false);
  });

  it("returns true for events older than 24h", () => {
    const occurred = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isEventTooOld(occurred)).toBe(true);
  });

  it("returns true for invalid timestamps", () => {
    expect(isEventTooOld("invalid")).toBe(true);
  });
});

describe("constants", () => {
  it("EVENT_TYPES contains all five event types", () => {
    expect(EVENT_TYPES).toContain("trial_started");
    expect(EVENT_TYPES).toContain("trial_completed");
    expect(EVENT_TYPES).toContain("receipt_created");
    expect(EVENT_TYPES).toContain("receipt_shared");
    expect(EVENT_TYPES).toContain("wallet_claimed");
    expect(EVENT_TYPES.length).toBe(5);
  });

  it("OUTBOX_STATUS has all five statuses", () => {
    expect(OUTBOX_STATUS.PENDING).toBe("pending");
    expect(OUTBOX_STATUS.SENDING).toBe("sending");
    expect(OUTBOX_STATUS.DELIVERED).toBe("delivered");
    expect(OUTBOX_STATUS.RETRY_SCHEDULED).toBe("retry_scheduled");
    expect(OUTBOX_STATUS.PERMANENTLY_FAILED).toBe("permanently_failed");
  });
});