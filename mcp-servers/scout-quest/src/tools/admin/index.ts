import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateScout } from "./createScout.js";
import { registerConfigureQuest } from "./configureQuest.js";
import { registerSetCharacter } from "./setCharacter.js";
import { registerSetCounselors } from "./setCounselors.js";
import { registerSetUnitLeaders } from "./setUnitLeaders.js";
import { registerInitializeRequirements } from "./initializeRequirements.js";
import { registerOverrideRequirement } from "./overrideRequirement.js";
import { registerSignOffRequirement } from "./signOffRequirement.js";
import { registerSetChoreList } from "./setChoreList.js";
import { registerSetProjectedBudget } from "./setProjectedBudget.js";
import { registerApproveBlueCard } from "./approveBlueCard.js";

export function registerAdminTools(server: McpServer): void {
  registerCreateScout(server);
  registerConfigureQuest(server);
  registerSetCharacter(server);
  registerSetCounselors(server);
  registerSetUnitLeaders(server);
  registerInitializeRequirements(server);
  registerOverrideRequirement(server);
  registerSignOffRequirement(server);
  registerSetChoreList(server);
  registerSetProjectedBudget(server);
  registerApproveBlueCard(server);
}
