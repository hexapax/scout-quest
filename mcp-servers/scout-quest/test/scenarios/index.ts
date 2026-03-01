/**
 * Scenario registry — imports all scenario definitions and exports them
 * as a lookup map for the harness runner.
 *
 * Includes both the original named scenarios (onboarding, daily-chore, etc.)
 * and the plan's S1-S13/G1-G5/X1-X2 numbering. Many overlap — the numbered
 * variants use the persona system for simulator prompts while the named
 * variants have embedded prompts.
 */

import type { ScenarioDefinition } from "../types.js";
import { PERSONAS, type PersonaDefinition } from "./personas.js";

// Original named scenarios (with embedded sim prompts)
import onboarding from "./onboarding.js";
import dailyChore from "./daily-chore.js";
import budgetEntry from "./budget-entry.js";
import requirementAdvancement from "./requirement-advancement.js";
import cringeRecovery from "./cringe-recovery.js";
import counselorPrep from "./counselor-prep.js";
import goalChange from "./goal-change.js";
import offTopic from "./off-topic.js";
import sensitiveTopic from "./sensitive-topic.js";

// New numbered scout scenarios
import s01 from "./scout/s01-session-start.js";
import s02 from "./scout/s02-log-chores.js";
import s03 from "./scout/s03-log-budget.js";
import s04 from "./scout/s04-ask-requirements.js";
import s05 from "./scout/s05-advance-requirement.js";
import s06 from "./scout/s06-compose-email.js";
import s07 from "./scout/s07-off-topic.js";
import s08 from "./scout/s08-quest-goal-update.js";
import s09 from "./scout/s09-time-management.js";
import s10 from "./scout/s10-diary-entry.js";
import s11 from "./scout/s11-tone-adjustment.js";
import s12 from "./scout/s12-session-wrapup.js";
import s13 from "./scout/s13-multi-turn-journey.js";

// Guide scenarios
import g01 from "./guide/g01-view-progress.js";
import g02 from "./guide/g02-onboard-scout.js";
import g03 from "./guide/g03-adjust-character.js";
import g04 from "./guide/g04-flag-conversation.js";
import g05 from "./guide/g05-review-chores.js";

// Cross-cutting scenarios
import x01 from "./cross/x01-model-comparison.js";
import x02 from "./cross/x02-system-prompt-ab.js";

// ---------------------------------------------------------------------------
// Scenario → persona mapping (from plan Section 4c)
// ---------------------------------------------------------------------------

export interface ScenarioWithPersona {
  scenario: ScenarioDefinition;
  persona: PersonaDefinition;
  role: "scout" | "guide";
}

const SCENARIO_PERSONA_MAP: Array<{
  scenario: ScenarioDefinition;
  personaId: string;
  role: "scout" | "guide";
}> = [
  // Original named scenarios (all scout-facing)
  { scenario: onboarding,              personaId: "eager_eddie",   role: "scout" },
  { scenario: dailyChore,              personaId: "vague_val",     role: "scout" },
  { scenario: budgetEntry,             personaId: "diligent_dana", role: "scout" },
  { scenario: requirementAdvancement,  personaId: "diligent_dana", role: "scout" },
  { scenario: cringeRecovery,          personaId: "resistant_rex", role: "scout" },
  { scenario: counselorPrep,           personaId: "diligent_dana", role: "scout" },
  { scenario: goalChange,              personaId: "eager_eddie",   role: "scout" },
  { scenario: offTopic,                personaId: "casual_chris",  role: "scout" },
  { scenario: sensitiveTopic,          personaId: "vague_val",     role: "scout" },

  // Numbered scout scenarios
  { scenario: s01, personaId: "eager_eddie",   role: "scout" },
  { scenario: s02, personaId: "vague_val",     role: "scout" },
  { scenario: s03, personaId: "diligent_dana", role: "scout" },
  { scenario: s04, personaId: "eager_eddie",   role: "scout" },
  { scenario: s05, personaId: "diligent_dana", role: "scout" },
  { scenario: s06, personaId: "casual_chris",  role: "scout" },
  { scenario: s07, personaId: "resistant_rex", role: "scout" },
  { scenario: s08, personaId: "vague_val",     role: "scout" },
  { scenario: s09, personaId: "eager_eddie",   role: "scout" },
  { scenario: s10, personaId: "casual_chris",  role: "scout" },
  { scenario: s11, personaId: "resistant_rex", role: "scout" },
  { scenario: s12, personaId: "diligent_dana", role: "scout" },
  { scenario: s13, personaId: "eager_eddie",   role: "scout" },

  // Guide scenarios
  { scenario: g01, personaId: "diligent_dana", role: "guide" },
  { scenario: g02, personaId: "diligent_dana", role: "guide" },
  { scenario: g03, personaId: "diligent_dana", role: "guide" },
  { scenario: g04, personaId: "diligent_dana", role: "guide" },
  { scenario: g05, personaId: "diligent_dana", role: "guide" },

  // Cross-cutting
  { scenario: x01, personaId: "vague_val", role: "scout" },
  { scenario: x02, personaId: "vague_val", role: "scout" },
];

// ---------------------------------------------------------------------------
// All scenarios keyed by ID
// ---------------------------------------------------------------------------

export const ALL_SCENARIOS: Record<string, ScenarioDefinition> = {
  // Original named
  "onboarding": onboarding,
  "daily-chore": dailyChore,
  "budget-entry": budgetEntry,
  "requirement-advancement": requirementAdvancement,
  "cringe-recovery": cringeRecovery,
  "counselor-prep": counselorPrep,
  "goal-change": goalChange,
  "off-topic": offTopic,
  "sensitive-topic": sensitiveTopic,
  // Numbered
  S1: s01, S2: s02, S3: s03, S4: s04, S5: s05, S6: s06, S7: s07,
  S8: s08, S9: s09, S10: s10, S11: s11, S12: s12, S13: s13,
  G1: g01, G2: g02, G3: g03, G4: g04, G5: g05,
  X1: x01, X2: x02,
};

// Legacy export for backward compatibility
export const SCENARIOS: Map<string, ScenarioDefinition> = new Map(
  Object.entries(ALL_SCENARIOS),
);
export const SCENARIO_IDS = Object.keys(ALL_SCENARIOS);

/** Scout-facing scenario IDs */
export const SCOUT_SCENARIO_IDS = [
  "onboarding", "daily-chore", "budget-entry", "requirement-advancement",
  "cringe-recovery", "counselor-prep", "goal-change", "off-topic", "sensitive-topic",
  "S1", "S2", "S3", "S4", "S5", "S6", "S7",
  "S8", "S9", "S10", "S11", "S12", "S13",
];

/** Guide-facing scenario IDs */
export const GUIDE_SCENARIO_IDS = ["G1", "G2", "G3", "G4", "G5"];

/** Cross-cutting scenario IDs */
export const CROSS_SCENARIO_IDS = ["X1", "X2"];

/** MVP scenario IDs (Phase 1 — original named + S1, S2, S4) */
export const MVP_SCENARIO_IDS = [
  "onboarding", "daily-chore", "budget-entry",
  "S1", "S2", "S4",
];

/**
 * Resolve a scenario ID to its definition + persona + role.
 */
export function resolveScenario(scenarioId: string): ScenarioWithPersona | null {
  const entry = SCENARIO_PERSONA_MAP.find(
    (e) => e.scenario.id === scenarioId,
  );
  if (!entry) return null;
  const persona = PERSONAS[entry.personaId];
  if (!persona) return null;
  return { scenario: entry.scenario, persona, role: entry.role };
}

/**
 * Get all scenarios for a given set of IDs (or all if no filter).
 */
export function getScenarios(filter?: string[]): ScenarioWithPersona[] {
  const ids = filter ?? Object.keys(ALL_SCENARIOS);
  const results: ScenarioWithPersona[] = [];
  for (const id of ids) {
    const resolved = resolveScenario(id);
    if (resolved) results.push(resolved);
  }
  return results;
}
