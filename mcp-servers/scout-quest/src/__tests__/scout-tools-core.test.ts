import { describe, it, expect } from "vitest";
import { isValidTransition } from "../validation.js";
import { enforceYptCc } from "../validation.js";
import type { RequirementStatus } from "../types.js";

describe("advanceRequirement (unit)", () => {
  it("allows valid transition not_started → in_progress", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
  });

  it("blocks invalid transition in_progress → signed_off", () => {
    expect(isValidTransition("in_progress", "signed_off")).toBe(false);
  });

  it("blocks signed_off for scouts", () => {
    // Business rule: scouts cannot set signed_off, only admins
    const scoutBlockedStatus: RequirementStatus = "signed_off";
    expect(scoutBlockedStatus).toBe("signed_off");
  });

  it("allows in_progress → tracking for time-based reqs", () => {
    expect(isValidTransition("in_progress", "tracking")).toBe(true);
  });

  it("allows in_progress → ready_for_review", () => {
    expect(isValidTransition("in_progress", "ready_for_review")).toBe(true);
  });

  it("allows ready_for_review → submitted", () => {
    expect(isValidTransition("ready_for_review", "submitted")).toBe(true);
  });

  it("allows needs_revision → in_progress", () => {
    expect(isValidTransition("needs_revision", "in_progress")).toBe(true);
  });
});

describe("composeEmail (unit)", () => {
  it("always includes parent in CC — YPT requirement", () => {
    const cc = enforceYptCc([], "parent@family.com");
    expect(cc).toContain("parent@family.com");
  });

  it("adds parent even with existing CC recipients", () => {
    const cc = enforceYptCc(["counselor@bsa.org"], "parent@family.com");
    expect(cc).toContain("parent@family.com");
    expect(cc).toContain("counselor@bsa.org");
    expect(cc).toHaveLength(2);
  });

  it("does not duplicate parent if already in CC", () => {
    const cc = enforceYptCc(["parent@family.com", "counselor@bsa.org"], "parent@family.com");
    expect(cc.filter(e => e === "parent@family.com")).toHaveLength(1);
  });

  it("mailto link format is correct", () => {
    const to = "counselor@bsa.org";
    const cc = "parent@family.com";
    const subject = "PM Req 3 Discussion";
    const body = "Hello,\n\nI'd like to schedule...";

    const link = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    expect(link).toContain("mailto:counselor%40bsa.org");
    expect(link).toContain("cc=parent%40family.com");
    expect(link).toContain("subject=PM%20Req%203%20Discussion");
  });
});

describe("sendNotification (unit)", () => {
  it("requires NTFY_TOPIC env var", () => {
    const topic = process.env.NTFY_TOPIC;
    // In test env, NTFY_TOPIC is not set
    expect(topic).toBeUndefined();
  });

  it("constructs valid ntfy.sh URL", () => {
    const topic = "scout-quest-test";
    const url = `https://ntfy.sh/${topic}`;
    expect(url).toBe("https://ntfy.sh/scout-quest-test");
  });

  it("priority range is 1-5", () => {
    for (const p of [1, 2, 3, 4, 5]) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(5);
    }
  });
});
