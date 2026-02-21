import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLogChore } from "./logChore.js";
import { registerLogBudgetEntry } from "./logBudgetEntry.js";
import { registerAdvanceRequirement } from "./advanceRequirement.js";
import { registerComposeEmail } from "./composeEmail.js";
import { registerSendNotification } from "./sendNotification.js";
import { registerAdjustTone } from "./adjustTone.js";
import { registerSetupTimeMgmt } from "./setupTimeMgmt.js";
import { registerLogDiaryEntry } from "./logDiaryEntry.js";
import { registerUpdateQuestGoal } from "./updateQuestGoal.js";

export function registerScoutTools(server: McpServer, scoutEmail: string): void {
  registerLogChore(server, scoutEmail);
  registerLogBudgetEntry(server, scoutEmail);
  registerAdvanceRequirement(server, scoutEmail);
  registerComposeEmail(server, scoutEmail);
  registerSendNotification(server);
  registerAdjustTone(server, scoutEmail);
  registerSetupTimeMgmt(server, scoutEmail);
  registerLogDiaryEntry(server, scoutEmail);
  registerUpdateQuestGoal(server, scoutEmail);
}
