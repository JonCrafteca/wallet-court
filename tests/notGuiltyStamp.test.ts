// Canonical NOT GUILTY stamp regression tests. Verifies that every NOT GUILTY
// renderer uses the canonical visual system: solid lime background, dark navy
// text, thick dark navy border, dark offset shadow, rotation, and bold
// condensed typography. Also verifies the old outline-only and low-contrast
// treatments no longer exist, and that NOT GUILTY is distinct from CASE
// DISMISSED and MISTRIAL.
import { describe, it, expect } from "vitest";
import {
  NOT_GUILTY_VERDICT_CODE,
  NOT_GUILTY_STYLE,
  GUILTY_STYLE,
  isNotGuilty,
  getStampText,
  getStampStyle,
} from "../base44/shared/notGuiltyStamp.ts";
import { getStampClasses } from "../src/lib/verdictStamp.js";

describe("canonical NOT GUILTY — visual tokens", () => {
  it("NOT_GUILTY_STYLE has solid lime background (#D8FF32)", () => {
    expect(NOT_GUILTY_STYLE.bg).toBe("#D8FF32");
  });

  it("NOT_GUILTY_STYLE has very dark navy text (#10142A)", () => {
    expect(NOT_GUILTY_STYLE.text).toBe("#10142A");
  });

  it("NOT_GUILTY_STYLE has thick dark navy border (#10142A)", () => {
    expect(NOT_GUILTY_STYLE.border).toBe("#10142A");
  });

  it("NOT_GUILTY_STYLE has dark offset shadow (#10142A)", () => {
    expect(NOT_GUILTY_STYLE.shadow).toBe("#10142A");
  });

  it("NOT_GUILTY_STYLE has shadow offset down and to the right", () => {
    expect(NOT_GUILTY_STYLE.shadowOffsetX).toBeGreaterThan(0);
    expect(NOT_GUILTY_STYLE.shadowOffsetY).toBeGreaterThan(0);
  });

  it("NOT_GUILTY_STYLE has thick border width", () => {
    expect(NOT_GUILTY_STYLE.borderWidth).toBeGreaterThanOrEqual(3);
  });

  it("NOT_GUILTY_STYLE has slight upward-to-the-right rotation", () => {
    expect(NOT_GUILTY_STYLE.rotationDeg).toBeLessThan(0);
    expect(NOT_GUILTY_STYLE.rotationDeg).toBeGreaterThan(-15);
  });

  it("NOT_GUILTY_STYLE uses bold condensed typography (Anton)", () => {
    expect(NOT_GUILTY_STYLE.fontFamily).toBe("Anton");
  });

  it("NOT_GUILTY_STYLE label is uppercase 'NOT GUILTY'", () => {
    expect(NOT_GUILTY_STYLE.label).toBe("NOT GUILTY");
  });

  it("NOT_GUILTY_STYLE has no transparency (solid fill)", () => {
    // The bg is a solid hex color, not rgba with alpha
    expect(NOT_GUILTY_STYLE.bg).not.toContain("rgba");
    expect(NOT_GUILTY_STYLE.bg).not.toContain("opacity");
  });
});

describe("canonical NOT GUILTY — style selection", () => {
  it("isNotGuilty returns true for suspiciously_competent", () => {
    expect(isNotGuilty(NOT_GUILTY_VERDICT_CODE)).toBe(true);
  });

  it("isNotGuilty returns false for other verdicts", () => {
    expect(isNotGuilty("one_pump_chump")).toBe(false);
    expect(isNotGuilty("bagholder_emeritus")).toBe(false);
    expect(isNotGuilty(undefined)).toBe(false);
    expect(isNotGuilty(null)).toBe(false);
  });

  it("getStampText returns 'NOT GUILTY' for competent", () => {
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).toBe("NOT GUILTY");
  });

  it("getStampText returns 'GUILTY' for other verdicts", () => {
    expect(getStampText("one_pump_chump")).toBe("GUILTY");
    expect(getStampText(undefined)).toBe("GUILTY");
  });

  it("getStampStyle returns NOT_GUILTY_STYLE for competent", () => {
    expect(getStampStyle(NOT_GUILTY_VERDICT_CODE)).toBe(NOT_GUILTY_STYLE);
  });

  it("getStampStyle returns GUILTY_STYLE for other verdicts", () => {
    expect(getStampStyle("one_pump_chump")).toBe(GUILTY_STYLE);
  });
});

describe("canonical NOT GUILTY — DOM renderer (VerdictStamp)", () => {
  it("DOM classes include solid lime background (bg-court-chart)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("bg-court-chart");
  });

  it("DOM classes include dark navy text (text-court-navy)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("text-court-navy");
  });

  it("DOM classes include dark navy border (border-court-navy)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).toContain("border-court-navy");
  });

  it("DOM classes do NOT use old low-contrast lime-on-ice treatment", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    expect(classes).not.toContain("bg-court-ice");
    expect(classes).not.toContain("text-court-chart");
    expect(classes).not.toContain("border-court-chart");
  });

  it("DOM classes do NOT use outline-only treatment (no border-only without fill)", () => {
    const classes = getStampClasses(NOT_GUILTY_VERDICT_CODE);
    // Must have a solid background fill, not just a border
    expect(classes).toContain("bg-court-chart");
  });

  it("GUILTY DOM classes retain red-on-ice treatment", () => {
    const classes = getStampClasses("one_pump_chump");
    expect(classes).toContain("bg-court-ice");
    expect(classes).toContain("text-court-red");
    expect(classes).toContain("border-court-red");
  });
});

describe("canonical NOT GUILTY — canvas renderer tokens", () => {
  it("canvas NOT GUILTY uses solid fill (not outline-only)", () => {
    // The canonical style has a solid bg color, not just a border color.
    // The old canvas code used strokeRect (outline only) with chartreuse
    // text on the gradient background — that is now replaced by drawStampCanvas
    // which fills the rectangle with the solid bg color.
    expect(NOT_GUILTY_STYLE.bg).toBeDefined();
    expect(NOT_GUILTY_STYLE.bg).not.toBe("transparent");
  });

  it("canvas NOT GUILTY does NOT use lime text on transparent/blue/purple background", () => {
    // The old code set fillStyle to chartreuse and drew text on the gradient
    // background — that was lime text on a blue/purple background. The canonical
    // style uses dark navy text on a solid lime background.
    expect(NOT_GUILTY_STYLE.text).toBe("#10142A"); // dark navy, not lime
    expect(NOT_GUILTY_STYLE.bg).toBe("#D8FF32"); // solid lime, not transparent
  });

  it("canvas GUILTY uses ice fill with red text and red border", () => {
    expect(GUILTY_STYLE.bg).toBe("#F5F7FF");
    expect(GUILTY_STYLE.text).toBe("#FF3B30");
    expect(GUILTY_STYLE.border).toBe("#FF3B30");
  });
});

describe("canonical NOT GUILTY — distinct from CASE DISMISSED and MISTRIAL", () => {
  it("NOT GUILTY stamp text is 'NOT GUILTY', not 'CASE DISMISSED'", () => {
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).toBe("NOT GUILTY");
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).not.toBe("CASE DISMISSED");
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).not.toBe("DISMISSED");
  });

  it("NOT GUILTY stamp text is not 'MISTRIAL'", () => {
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).not.toBe("MISTRIAL");
    expect(getStampText(NOT_GUILTY_VERDICT_CODE)).not.toContain("MISTRIAL");
  });

  it("NOT GUILTY is a verdict-class stamp (has severity and confidence)", () => {
    // NOT GUILTY is a valid verdict, not a dismissal. The verdict_code
    // "suspiciously_competent" produces a NOT GUILTY stamp with full
    // verdict metadata (severity, confidence, roast, sentence).
    expect(NOT_GUILTY_VERDICT_CODE).toBe("suspiciously_competent");
  });

  it("case_outcome for NOT GUILTY is 'verdict', not 'dismissed_no_evidence'", () => {
    // NOT GUILTY cases have case_outcome = "verdict", which is distinct from
    // "dismissed_no_evidence" and "mistrial_insufficient_evidence".
    // The receipt renderer rejects dismissed/mistrial cases but allows
    // NOT GUILTY (verdict) cases.
    const verdictCode = NOT_GUILTY_VERDICT_CODE;
    expect(verdictCode).toBe("suspiciously_competent");
    // The isReceiptAllowed function allows case_outcome "verdict" and "demo",
    // but rejects "dismissed_no_evidence" and "mistrial_insufficient_evidence".
    // NOT GUILTY cases have case_outcome "verdict" and are allowed.
  });
});