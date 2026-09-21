// Wallet Court — Budget threshold separation tests.
// Proves that two distinct thresholds are enforced:
//   - checkBudget (campaign-level / "start wallet"): blocks at >= 1,000
//   - checkCeilingBudget (per-physical-attempt): blocks only at >= 1,020
// A wallet already in progress may finish crossing 1,000; no new wallet may
// start after reaching 1,000.
import { describe, it, expect } from "vitest";
import {
  checkBudget,
  checkCeilingBudget,
  CALIBRATION_TARGET,
  CALIBRATION_CEILING
} from "../base44/shared/calibration.ts";

describe("Budget threshold separation", () => {
  describe("checkBudget (campaign-level: start new wallet)", () => {
    it("allows at 999", () => {
      const r = checkBudget(999);
      expect(r.allowed).toBe(true);
      expect(r.target_reached).toBe(false);
      expect(r.ceiling_reached).toBe(false);
    });

    it("blocks at 1,000 (target reached — no new wallets)", () => {
      const r = checkBudget(1000);
      expect(r.allowed).toBe(false);
      expect(r.target_reached).toBe(true);
      expect(r.ceiling_reached).toBe(false);
    });

    it("blocks at 1,019 (still target reached)", () => {
      const r = checkBudget(1019);
      expect(r.allowed).toBe(false);
      expect(r.target_reached).toBe(true);
      expect(r.ceiling_reached).toBe(false);
    });

    it("blocks at 1,020 (ceiling reached)", () => {
      const r = checkBudget(1020);
      expect(r.allowed).toBe(false);
      expect(r.target_reached).toBe(true);
      expect(r.ceiling_reached).toBe(true);
    });
  });

  describe("checkCeilingBudget (per-physical-attempt: inside a wallet)", () => {
    it("allows at 999", () => {
      const r = checkCeilingBudget(999);
      expect(r.allowed).toBe(true);
      expect(r.ceiling_reached).toBe(false);
    });

    it("ALLOWS at 1,000 — a wallet in progress may continue past target", () => {
      const r = checkCeilingBudget(1000);
      expect(r.allowed).toBe(true);
      expect(r.target_reached).toBe(true);
      expect(r.ceiling_reached).toBe(false);
    });

    it("allows at 1,019 — wallet in progress may still make physical requests", () => {
      const r = checkCeilingBudget(1019);
      expect(r.allowed).toBe(true);
      expect(r.ceiling_reached).toBe(false);
    });

    it("blocks at 1,020 (absolute ceiling — no further physical requests)", () => {
      const r = checkCeilingBudget(1020);
      expect(r.allowed).toBe(false);
      expect(r.ceiling_reached).toBe(true);
    });
  });

  describe("Threshold separation invariant", () => {
    it("checkBudget blocks at 1,000 but checkCeilingBudget allows it", () => {
      expect(checkBudget(1000).allowed).toBe(false);
      expect(checkCeilingBudget(1000).allowed).toBe(true);
    });

    it("both block at 1,020", () => {
      expect(checkBudget(1020).allowed).toBe(false);
      expect(checkCeilingBudget(1020).allowed).toBe(false);
    });

    it("a wallet that crosses 1,000 may settle while the next attempt stays below 1,020", () => {
      // Wallet starts at 998. After 2 physical requests, total is 1,000.
      // checkBudget would block a NEW wallet, but checkCeilingBudget allows
      // the remaining physical requests in THIS wallet.
      const totalAfterTwoRequests = 1000;
      expect(checkBudget(totalAfterTwoRequests).allowed).toBe(false); // no new wallet
      expect(checkCeilingBudget(totalAfterTwoRequests).allowed).toBe(true); // this wallet continues

      // After 4 physical requests, total is 1,002 — still below ceiling.
      const totalAfterFourRequests = 1002;
      expect(checkCeilingBudget(totalAfterFourRequests).allowed).toBe(true);
    });

    it("constants are correct", () => {
      expect(CALIBRATION_TARGET).toBe(1000);
      expect(CALIBRATION_CEILING).toBe(1020);
    });
  });
});