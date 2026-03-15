/**
 * Chain registry — imports all session chain definitions.
 */

import type { SessionChain } from "../types.js";

import pmReq2aLifecycle from "./pm-req-2a-lifecycle.js";
import choreStreak from "./chore-streak.js";
import guideProgressCheck from "./guide-progress-check.js";
import oneMonthSprint from "./one-month-sprint.js";

export const CHAINS: Map<string, SessionChain> = new Map([
  [pmReq2aLifecycle.id, pmReq2aLifecycle],
  [choreStreak.id, choreStreak],
  [guideProgressCheck.id, guideProgressCheck],
  [oneMonthSprint.id, oneMonthSprint],
]);

export const CHAIN_IDS = Array.from(CHAINS.keys());
