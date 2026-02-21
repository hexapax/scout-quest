import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQuestState } from "./questState.js";
import { registerRequirements } from "./requirements.js";
import { registerChoreStreak } from "./choreStreak.js";
import { registerBudgetSummary } from "./budgetSummary.js";
import { registerCharacter } from "./character.js";
import { registerReminders } from "./reminders.js";
import { registerQuestSummary } from "./questSummary.js";
import { registerAdminScouts } from "./adminScouts.js";

export function registerScoutResources(server: McpServer, scoutEmail: string): void {
  registerQuestState(server, scoutEmail);
  registerRequirements(server, scoutEmail);
  registerChoreStreak(server, scoutEmail);
  registerBudgetSummary(server, scoutEmail);
  registerCharacter(server, scoutEmail);
  registerReminders(server, scoutEmail);
  registerQuestSummary(server, scoutEmail);
}

export function registerAdminResources(server: McpServer): void {
  registerAdminScouts(server);
}
