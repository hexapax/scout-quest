/**
 * G2: Onboard New Scout
 *
 * Full onboarding flow: setup_scout_profile → set_scout_interests →
 * set_quest_goal → set_chore_list_guide → set_budget_plan →
 * set_character_preferences → set_session_limits. Each tool called in order.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "G2",
  name: "Onboard New Scout",
  description:
    "Parent onboards a new scout through the full setup flow. AI should " +
    "guide the parent through each step, calling the appropriate setup " +
    "tools in sequence. All 7 setup tools should be called.",
  scoutSimPrompt: "",
  initialMessage: "I'd like to set up my son's account. His name is Jake and he's 13.",
  maxTurns: 8,
  expectedTools: [
    "set_scout_interests",
    "set_quest_goal",
    "set_chore_list_guide",
    "set_budget_plan",
    "set_character_preferences",
    "set_session_limits",
  ],
  expectedResources: [
    "guide://scouts",
  ],
};

export default scenario;
