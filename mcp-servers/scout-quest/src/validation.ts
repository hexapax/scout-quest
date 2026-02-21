import { VALID_TRANSITIONS } from "./constants.js";
import type { RequirementStatus } from "./types.js";

export function isValidTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function validateCurrency(amount: number): boolean {
  return amount >= 0;
}

export function validateChoreBackdate(date: Date): boolean {
  const now = new Date();
  // Reject future dates
  if (date.getTime() > now.getTime()) return false;
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

export function enforceYptCc(cc: string[], parentEmail: string): string[] {
  if (!cc.includes(parentEmail)) {
    return [...cc, parentEmail];
  }
  return cc;
}

export function validateToneDial(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
