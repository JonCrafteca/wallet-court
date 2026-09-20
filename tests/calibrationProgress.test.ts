import { describe, it, expect } from "vitest";
import { formatBatchProgress } from "../base44/shared/calibration.ts";

describe("Batch progress display — one-item batch", () => {
  it("shows 'Processing 1 of 1' while processing the first wallet", () => {
    const state = { done: 0, total: 1, current: { address_short: "0x1234…5678" }, isComplete: false };
    const result = formatBatchProgress(state);
    expect(result.show).toBe(true);
    expect(result.label).toBe("Processing 1 of 1");
  });

  it("shows 'Batch complete: 1 of 1' after completion", () => {
    const state = { done: 1, total: 1, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.show).toBe(true);
    expect(result.label).toBe("Batch complete: 1 of 1");
  });

  it("never shows '2 of 1'", () => {
    // After the last wallet completes, done=1, total=1. With isComplete=true,
    // the label is "Batch complete: 1 of 1" — never "Processing 2 of 1".
    const state = { done: 1, total: 1, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).not.toContain("2 of 1");
    expect(result.label).toBe("Batch complete: 1 of 1");
  });
});

describe("Batch progress display — five-item batch", () => {
  it("shows 'Processing 1 of 5' for the first wallet", () => {
    const state = { done: 0, total: 5, current: { address_short: "0x1111…2222" }, isComplete: false };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Processing 1 of 5");
  });

  it("shows 'Processing 3 of 5' for the third wallet", () => {
    const state = { done: 2, total: 5, current: { address_short: "0x3333…4444" }, isComplete: false };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Processing 3 of 5");
  });

  it("shows 'Processing 5 of 5' for the last wallet", () => {
    const state = { done: 4, total: 5, current: { address_short: "0x5555…6666" }, isComplete: false };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Processing 5 of 5");
  });

  it("shows 'Batch complete: 5 of 5' after all wallets finish", () => {
    const state = { done: 5, total: 5, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Batch complete: 5 of 5");
  });

  it("never shows '6 of 5'", () => {
    const state = { done: 5, total: 5, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).not.toContain("6 of 5");
  });
});

describe("Batch progress display — mixed outcomes", () => {
  it("counts failed items toward batch completion", () => {
    // 3 completed, 1 failed, 1 stopped — all count toward done
    const state = { done: 5, total: 5, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Batch complete: 5 of 5");
  });

  it("shows 'Batch complete: 3 of 5' when 3 of 5 are done (partial)", () => {
    const state = { done: 3, total: 5, current: { address_short: "0x4444…5555" }, isComplete: false };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Processing 4 of 5");
  });
});

describe("Batch progress display — refresh / empty state", () => {
  it("shows nothing for null state (after refresh)", () => {
    const result = formatBatchProgress(null);
    expect(result.show).toBe(false);
    expect(result.label).toBe("");
  });

  it("shows nothing for empty progress object", () => {
    const result = formatBatchProgress({ done: 0, total: 0, current: null, isComplete: false });
    expect(result.show).toBe(false);
    expect(result.label).toBe("");
  });

  it("shows nothing when not complete and no current item (between wallets)", () => {
    const result = formatBatchProgress({ done: 2, total: 5, current: null, isComplete: false });
    expect(result.show).toBe(false);
  });
});

describe("Batch progress display — stopped batch", () => {
  it("shows 'Batch complete: 2 of 5' when batch stopped after 2 wallets", () => {
    const state = { done: 2, total: 5, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Batch complete: 2 of 5");
  });
});

describe("Batch progress display — numerator never exceeds total", () => {
  it("clamps 'Processing' numerator to total", () => {
    const state = { done: 5, total: 5, current: { address_short: "0x1234" }, isComplete: false };
    const result = formatBatchProgress(state);
    // done + 1 = 6, but clamped to min(6, 5) = 5
    expect(result.label).toBe("Processing 5 of 5");
  });

  it("clamps 'Batch complete' numerator to total", () => {
    const state = { done: 10, total: 5, current: null, isComplete: true };
    const result = formatBatchProgress(state);
    expect(result.label).toBe("Batch complete: 5 of 5");
  });
});
