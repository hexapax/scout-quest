import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupScout } from "./setupScout.js";
import { registerSetupQuest } from "./setupQuest.js";
import { registerSetCharacterPreferences } from "./setCharacterPreferences.js";
import { registerGetOnboardingStatus } from "./getOnboardingStatus.js";
import { registerGetScoutDashboard } from "./getScoutDashboard.js";
import { registerGetConversationDetail } from "./getConversationDetail.js";
import { registerFlagConversation } from "./flagConversation.js";
import { registerSendNotificationGuide } from "./sendNotificationGuide.js";
import { registerAdjustScoutProfile } from "./adjustScoutProfile.js";
import { registerAdjustQuestGoal } from "./adjustQuestGoal.js";
import { registerAdjustCharacter } from "./adjustCharacter.js";
import { registerAdjustDelegation } from "./adjustDelegation.js";
import { registerSuggestIntervention } from "./suggestIntervention.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  // Onboarding tools (consolidated from 7 → 3 + 2 read tools)
  registerSetupScout(server, guideEmail);
  registerSetupQuest(server, guideEmail);
  registerSetCharacterPreferences(server, guideEmail);
  // Onboarding read tools
  registerGetOnboardingStatus(server, guideEmail);
  registerGetScoutDashboard(server, guideEmail);
  // Monitoring tools
  registerGetConversationDetail(server, guideEmail);
  registerFlagConversation(server, guideEmail);
  registerSendNotificationGuide(server, guideEmail);
  // Adjustment tools
  registerAdjustScoutProfile(server, guideEmail);
  registerAdjustQuestGoal(server, guideEmail);
  registerAdjustCharacter(server, guideEmail);
  registerAdjustDelegation(server, guideEmail);
  registerSuggestIntervention(server, guideEmail);
}
