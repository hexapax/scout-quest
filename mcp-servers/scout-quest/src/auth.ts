import { users } from "./db.js";
import type { Role } from "./types.js";

const ADMIN_WRITE_ACTIONS = [
  "create_scout", "configure_quest", "set_character", "set_counselors",
  "set_unit_leaders", "initialize_requirements", "override_requirement",
  "sign_off_requirement", "set_chore_list", "set_projected_budget",
  "approve_blue_card",
];

const SCOUT_ACTIONS = [
  "log_chore", "log_budget_entry", "advance_requirement", "compose_email",
  "log_diary_entry", "send_notification", "adjust_tone", "setup_time_mgmt",
  "update_quest_goal",
];

const READ_ACTIONS = ["view_scout", "view_requirements", "view_streak", "view_budget"];

export async function getUserRoles(email: string): Promise<Role[]> {
  const col = await users();
  const user = await col.findOne({ email });
  return user?.roles ?? [];
}

export function canAccess(
  roles: Role[],
  action: string,
  context: { troop?: string; scout_email?: string; user_email?: string },
): boolean {
  for (const role of roles) {
    if (role.type === "superuser") return true;

    if (role.type === "admin") {
      if (ADMIN_WRITE_ACTIONS.includes(action) || READ_ACTIONS.includes(action)) {
        if (!context.troop || context.troop === role.troop) return true;
      }
    }

    if (role.type === "adult_readonly") {
      if (READ_ACTIONS.includes(action)) {
        if (!context.troop || context.troop === role.troop) return true;
      }
    }

    if (role.type === "guide") {
      if (READ_ACTIONS.includes(action)) {
        if (context.scout_email && role.scout_emails.includes(context.scout_email)) return true;
      }
    }

    if (role.type === "scout" || role.type === "test_scout") {
      if (SCOUT_ACTIONS.includes(action) || READ_ACTIONS.includes(action)) {
        if (context.scout_email === context.user_email) return true;
      }
    }
  }
  return false;
}
