// VerdictStamp high-contrast treatment test. Verifies that the "Not Guilty"
// stamp uses a solid lime background with dark navy text and border for
// accessible contrast on both desktop and mobile, while the "Guilty" stamp
// retains its original red-on-ice treatment.
import { describe, it, expect } from "vitest";
import {
  getStampText,
  getStampClasses,
  NOT_GUILTY_VERDICT_CODE,
} from "../src/lib/verdictStamp.js";

describe("VerdictStamp — high-contrast Not Guilty treatment", () => {
  it("shows 'Not Guilty' for suspiciously_competent", () => {
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).toBe("Not Guilty");
  });

  it("shows 'Guilty' for all other verdicts", () => {
    expect(getStampText("one_pump_chump")).toBe("Guilty");
    expect(getStampText("bagholder_emeritus")).toBe("Guilty");
    expect(getStampText(undefined)).toBe("Guilty");
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

  it("Guilty stamp retains red-on-ice treatment", () => {
    const classes = getStampClasses("one_pump_chump");
    expect(classes).toContain("bg-court-ice");
    expect(classes).toContain("text-court-red");
    expect(classes).toContain("border-court-red");
  });
});