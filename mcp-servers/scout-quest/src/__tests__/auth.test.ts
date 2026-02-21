import { describe, it, expect } from "vitest";
import { canAccess } from "../auth.js";
import type { Role } from "../types.js";

describe("canAccess", () => {
  it("superuser can access anything", () => {
    const roles: Role[] = [{ type: "superuser" }];
    expect(canAccess(roles, "create_scout", {})).toBe(true);
    expect(canAccess(roles, "sign_off_requirement", {})).toBe(true);
    expect(canAccess(roles, "log_chore", { scout_email: "anyone@test.com" })).toBe(true);
  });

  it("admin can access own troop", () => {
    const roles: Role[] = [{ type: "admin", troop: "2024" }];
    expect(canAccess(roles, "create_scout", { troop: "2024" })).toBe(true);
    expect(canAccess(roles, "create_scout", { troop: "9999" })).toBe(false);
  });

  it("admin can read own troop", () => {
    const roles: Role[] = [{ type: "admin", troop: "2024" }];
    expect(canAccess(roles, "view_scout", { troop: "2024" })).toBe(true);
  });

  it("scout can only access own data", () => {
    const roles: Role[] = [{ type: "scout" }];
    expect(canAccess(roles, "log_chore", { scout_email: "will@test.com", user_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "log_chore", { scout_email: "other@test.com", user_email: "will@test.com" })).toBe(false);
  });

  it("adult_readonly cannot write", () => {
    const roles: Role[] = [{ type: "adult_readonly", troop: "2024" }];
    expect(canAccess(roles, "view_scout", { troop: "2024" })).toBe(true);
    expect(canAccess(roles, "create_scout", { troop: "2024" })).toBe(false);
  });

  it("parent can view own kids only", () => {
    const roles: Role[] = [{ type: "parent", scout_emails: ["will@test.com"] }];
    expect(canAccess(roles, "view_scout", { scout_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "view_scout", { scout_email: "other@test.com" })).toBe(false);
  });

  it("test_scout acts like scout", () => {
    const roles: Role[] = [{ type: "test_scout", test_account: true }];
    expect(canAccess(roles, "log_chore", { scout_email: "test@test.com", user_email: "test@test.com" })).toBe(true);
    expect(canAccess(roles, "create_scout", {})).toBe(false);
  });

  it("multi-role user gets union of permissions", () => {
    const roles: Role[] = [
      { type: "parent", scout_emails: ["will@test.com"] },
      { type: "admin", troop: "2024" },
    ];
    expect(canAccess(roles, "view_scout", { scout_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "create_scout", { troop: "2024" })).toBe(true);
  });

  it("no roles means no access", () => {
    expect(canAccess([], "view_scout", {})).toBe(false);
    expect(canAccess([], "log_chore", {})).toBe(false);
  });
});
