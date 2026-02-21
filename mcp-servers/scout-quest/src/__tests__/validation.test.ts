import { describe, it, expect } from "vitest";
import { isValidTransition, validateCurrency, validateChoreBackdate, enforceYptCc, validateToneDial } from "../validation.js";

describe("isValidTransition", () => {
  it("allows not_started → in_progress", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
  });

  it("allows not_started → offered", () => {
    expect(isValidTransition("not_started", "offered")).toBe(true);
  });

  it("blocks in_progress → signed_off (must go through submitted)", () => {
    expect(isValidTransition("in_progress", "signed_off")).toBe(false);
  });

  it("blocks signed_off → anything (terminal)", () => {
    expect(isValidTransition("signed_off", "in_progress")).toBe(false);
  });

  it("allows submitted → needs_revision", () => {
    expect(isValidTransition("submitted", "needs_revision")).toBe(true);
  });

  it("allows submitted → signed_off", () => {
    expect(isValidTransition("submitted", "signed_off")).toBe(true);
  });

  it("allows excluded → in_progress (SM can un-exclude)", () => {
    expect(isValidTransition("excluded", "in_progress")).toBe(true);
  });

  it("blocks completed_prior → anything (terminal)", () => {
    expect(isValidTransition("completed_prior", "in_progress")).toBe(false);
  });
});

describe("validateCurrency", () => {
  it("rejects negative values", () => {
    expect(validateCurrency(-5)).toBe(false);
  });

  it("accepts zero", () => {
    expect(validateCurrency(0)).toBe(true);
  });

  it("accepts positive", () => {
    expect(validateCurrency(15.50)).toBe(true);
  });
});

describe("validateChoreBackdate", () => {
  it("allows today", () => {
    expect(validateChoreBackdate(new Date())).toBe(true);
  });

  it("allows 2 days ago", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    expect(validateChoreBackdate(twoDaysAgo)).toBe(true);
  });

  it("rejects 4 days ago", () => {
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    expect(validateChoreBackdate(fourDaysAgo)).toBe(false);
  });

  it("rejects future dates", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(validateChoreBackdate(tomorrow)).toBe(false);
  });
});

describe("enforceYptCc", () => {
  it("adds parent email if not present", () => {
    const result = enforceYptCc(["counselor@test.com"], "parent@test.com");
    expect(result).toContain("parent@test.com");
    expect(result).toContain("counselor@test.com");
  });

  it("does not duplicate parent email if already present", () => {
    const result = enforceYptCc(["parent@test.com"], "parent@test.com");
    expect(result.filter(e => e === "parent@test.com")).toHaveLength(1);
  });

  it("handles empty CC list", () => {
    const result = enforceYptCc([], "parent@test.com");
    expect(result).toEqual(["parent@test.com"]);
  });
});

describe("validateToneDial", () => {
  it("returns value when within bounds", () => {
    expect(validateToneDial(3, 1, 5)).toBe(3);
  });

  it("clamps to max when exceeding", () => {
    expect(validateToneDial(7, 1, 4)).toBe(4);
  });

  it("clamps to min when below", () => {
    expect(validateToneDial(0, 2, 5)).toBe(2);
  });

  it("rounds fractional values", () => {
    expect(validateToneDial(3.7, 1, 5)).toBe(4);
  });
});
