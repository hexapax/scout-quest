export const SETUP_STEPS = [
  { id: "profile", label: "Scout profile" },
  { id: "interests", label: "Interests & preferences" },
  { id: "quest_goal", label: "Quest goal & budget target" },
  { id: "chore_list", label: "Chore list & income" },
  { id: "budget_plan", label: "Budget plan" },
  { id: "character", label: "Character personality" },
  { id: "session_limits", label: "Session limits" },
  { id: "notifications", label: "Notification setup" },
  { id: "contacts", label: "Counselor & leader contacts" },
  { id: "blue_card", label: "Blue card request" },
];

export function getAgeDefaults(age: number): Record<string, "guide" | "delegated"> {
  if (age < 12) {
    return {
      profile: "guide", interests: "guide", quest_goal: "guide",
      chore_list: "guide", budget_plan: "guide", character: "guide",
      session_limits: "guide", notifications: "guide", contacts: "guide",
      blue_card: "guide",
    };
  }
  if (age <= 14) {
    return {
      profile: "guide", interests: "guide", quest_goal: "guide",
      chore_list: "guide", budget_plan: "delegated", character: "guide",
      session_limits: "guide", notifications: "delegated", contacts: "guide",
      blue_card: "guide",
    };
  }
  return {
    profile: "guide", interests: "delegated", quest_goal: "delegated",
    chore_list: "guide", budget_plan: "delegated", character: "delegated",
    session_limits: "guide", notifications: "delegated", contacts: "delegated",
    blue_card: "delegated",
  };
}
