/**
 * Scenario registry — exports all scenarios keyed by ID.
 */

import type { ScenarioDefinition } from "../types.js";

import onboarding from "./onboarding.js";
import dailyChore from "./daily-chore.js";
import budgetEntry from "./budget-entry.js";
import requirementAdvancement from "./requirement-advancement.js";
import cringeRecovery from "./cringe-recovery.js";
import counselorPrep from "./counselor-prep.js";
import goalChange from "./goal-change.js";
import offTopic from "./off-topic.js";
import sensitiveTopic from "./sensitive-topic.js";

export const SCENARIOS: Map<string, ScenarioDefinition> = new Map([
  ["onboarding", onboarding],
  ["daily-chore", dailyChore],
  ["budget-entry", budgetEntry],
  ["requirement-advancement", requirementAdvancement],
  ["cringe-recovery", cringeRecovery],
  ["counselor-prep", counselorPrep],
  ["goal-change", goalChange],
  ["off-topic", offTopic],
  ["sensitive-topic", sensitiveTopic],
]);

export const SCENARIO_IDS = Array.from(SCENARIOS.keys());
