import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupScoutProfile } from "./setupScoutProfile.js";
import { registerSetScoutInterests } from "./setScoutInterests.js";
import { registerSetQuestGoal } from "./setQuestGoal.js";
import { registerSetChoreListGuide } from "./setChoreListGuide.js";
import { registerSetBudgetPlan } from "./setBudgetPlan.js";
import { registerSetCharacterPreferences } from "./setCharacterPreferences.js";
import { registerSetSessionLimits } from "./setSessionLimits.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  registerSetupScoutProfile(server, guideEmail);
  registerSetScoutInterests(server, guideEmail);
  registerSetQuestGoal(server, guideEmail);
  registerSetChoreListGuide(server, guideEmail);
  registerSetBudgetPlan(server, guideEmail);
  registerSetCharacterPreferences(server, guideEmail);
  registerSetSessionLimits(server, guideEmail);
}
