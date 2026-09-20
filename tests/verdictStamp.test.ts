// VerdictStamp high-contrast treatment test. Verifies that the "NOT GUILTY"
// stamp uses the canonical visual system: solid lime background, dark navy
// text, dark navy border, and dark offset shadow. Also verifies the canonical
// tokens from notGuiltyStamp.js are used so DOM and canvas cannot drift.
import { describe, it, expect } from "vitest";
import {
  getStampText,
  getStampClasses,
  NOT_GUILTY_VERDICT_CODE,
  NOT_GUILTY_STYLE,
  GUILTY_STYLE,
  isNotGuilty,
  getStampStyle,
} from "../src/lib/verdictStamp.js";

describe("VerdictStamp — canonical NOT GUILTY treatment", () => {
  it("shows 'NOT GUILTY' for suspiciously_competent", () => {
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).toBe("NOT GUILTY");
  });

  it("shows 'GUILTY' for all other verdicts", () => {
    expect(getStampText("one_pump_chump")).toBe("GUILTY");
    expect(getStampText("bagholder_emeritus")).toBe("GUILTY");
    expect(getStampText(undefined)).toBe("GUILTY");
  });

  it("Not Guilty stamp uses solid lime background (high contrast)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("bg-court-chart");
  });

  it("Not Guilty stamp uses dark navy text (readable on lime)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("text-court-navy");
  });

  it("Not Guilty stamp uses dark navy border", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("border-court-navy");
  });

  it("Not Guilty stamp does NOT use the old low-contrast lime-on-ice treatment", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).not.toContain("bg-court-ice");
    expect(classes).not.toContain("text-court-chart");
    expect(classes).not.toContain("border-court-chart");
  });

  it("Not Guilty stamp does NOT use outline-only treatment", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    // Must have a solid background fill, not just a border
    expect(classes).toContain("bg-court-chart");
  });

  it("Guilty stamp retains red-on-ice treatment", () => {
    const classes = getStampClasses("one_pump_chump");
    expect(classes).toContain("bg-court-ice");
    expect(classes).toContain("text-court-red");
    expect(classes).toContain("border-court-red");
  });
});

describe("VerdictStamp — canonical token re-exports", () => {
  it("re-exports NOT_GUILTY_STYLE with correct tokens", () => {
    expect(NOT_GUILTY_STYLE.bg).toBe("#D8FF32");
    expect(NOT_GUILTY_STYLE.text).toBe("#10142A");
    expect(NOT_GUILTY_STYLE.border).toBe("#10142A");
    expect(NOT_GUILTY_STYLE.shadow).toBe("#10142A");
  });

  it("re-exports GUILTY_STYLE with correct tokens", () => {
    expect(GUILTY_STYLE.bg).toBe("#F5F7FF");
    expect(GUILTY_STYLE.text).toBe("#FF3B30");
    expect(GUILTY_STYLE.border).toBe("#FF3B30");
  });

  it("re-exports isNotGuilty", () => {
    expect(isNotGuilty(NOT_GUILTY_VERDICT_CODE)).toBe(true);
    expect(isNotGuilty("other")).toBe(false);
  });

  it("re-exports getStampStyle", () => {
    expect(getStampStyle(NOT_GUILTY_VERDICT_CODE)).toBe(NOT_GUILTY_STYLE);
    expect(getStampStyle("other")).toBe(GUILTY_STYLE);
  });
});