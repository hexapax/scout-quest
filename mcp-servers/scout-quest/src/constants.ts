export interface RequirementDefinition {
  req_id: string;
  badge: "personal_management" | "family_life";
  name: string;
  description: string;
  default_interaction_mode: string;
  tracking_duration?: { days?: number; weeks?: number };
  has_sub_requirements?: boolean;
}

export const REQUIREMENT_DEFINITIONS: RequirementDefinition[] = [
  // Personal Management
  { req_id: "pm_1a", badge: "personal_management", name: "Choose major expense", description: "Choose an item that your family might want to purchase that is considered a major expense.", default_interaction_mode: "email" },
  { req_id: "pm_1b", badge: "personal_management", name: "Savings plan", description: "Write a plan for how your family would save money for the purchase.", default_interaction_mode: "email", has_sub_requirements: true },
  { req_id: "pm_1c", badge: "personal_management", name: "Shopping strategy", description: "Develop a written shopping strategy with quality research and price comparison.", default_interaction_mode: "email", has_sub_requirements: true },
  { req_id: "pm_2a", badge: "personal_management", name: "Prepare budget", description: "Prepare a budget reflecting expected income, expenses, and savings for 13 weeks.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_2b", badge: "personal_management", name: "Compare income vs expenses", description: "Compare expected income with expected expenses.", default_interaction_mode: "email" },
  { req_id: "pm_2c", badge: "personal_management", name: "Track budget 13 weeks", description: "Track and record actual income, expenses, and savings for 13 consecutive weeks.", default_interaction_mode: "digital_submission", tracking_duration: { weeks: 13 } },
  { req_id: "pm_2d", badge: "personal_management", name: "Budget review", description: "Compare budget with actual and discuss what to do differently.", default_interaction_mode: "in_person" },
  { req_id: "pm_3", badge: "personal_management", name: "Money concepts discussion", description: "Discuss 5 of 8 money-related concepts with counselor.", default_interaction_mode: "in_person" },
  { req_id: "pm_4", badge: "personal_management", name: "Saving vs investing", description: "Explain saving vs investing, ROI, risk, interest, diversification, retirement.", default_interaction_mode: "in_person" },
  { req_id: "pm_5", badge: "personal_management", name: "Investment types", description: "Explain stocks, mutual funds, life insurance, CDs, savings accounts, US savings bonds.", default_interaction_mode: "email" },
  { req_id: "pm_6", badge: "personal_management", name: "Insurance types", description: "Explain auto, health, homeowner/renter, whole/term life insurance.", default_interaction_mode: "email" },
  { req_id: "pm_7", badge: "personal_management", name: "Loans and credit", description: "Explain loans, APR, borrowing methods, card types, credit reports, reducing debt.", default_interaction_mode: "email" },
  { req_id: "pm_8a", badge: "personal_management", name: "To-do list", description: "Write a prioritized to-do list for the coming week.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_8b", badge: "personal_management", name: "7-day schedule", description: "Make a seven-day calendar with set activities and planned tasks.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_8c", badge: "personal_management", name: "Follow schedule + diary", description: "Follow the one-week schedule and keep a daily diary.", default_interaction_mode: "digital_submission", tracking_duration: { weeks: 1 } },
  { req_id: "pm_8d", badge: "personal_management", name: "Schedule review", description: "Review to-do list, schedule, and diary with counselor.", default_interaction_mode: "in_person" },
  { req_id: "pm_9", badge: "personal_management", name: "Project plan", description: "Prepare a written project plan with goal, timeline, description, resources, budget.", default_interaction_mode: "email" },
  { req_id: "pm_10", badge: "personal_management", name: "Career exploration", description: "Choose and discuss a career, qualifications, education, costs.", default_interaction_mode: "in_person" },

  // Family Life
  { req_id: "fl_1", badge: "family_life", name: "What is a family", description: "Prepare an outline on what a family is and discuss with counselor.", default_interaction_mode: "in_person" },
  { req_id: "fl_2", badge: "family_life", name: "Importance to family", description: "List reasons you are important to your family, discuss with parent and counselor.", default_interaction_mode: "in_person" },
  { req_id: "fl_3", badge: "family_life", name: "90-day chores", description: "Prepare list of 5+ chores, do them for 90 days, keep a record.", default_interaction_mode: "digital_submission", tracking_duration: { days: 90 } },
  { req_id: "fl_4", badge: "family_life", name: "Individual home project", description: "Decide on and carry out an individual project around the home.", default_interaction_mode: "parent_verify" },
  { req_id: "fl_5", badge: "family_life", name: "Family project", description: "Plan and carry out a project involving family participation.", default_interaction_mode: "in_person" },
  { req_id: "fl_6a", badge: "family_life", name: "Plan family meetings", description: "Discuss with counselor how to plan and carry out a family meeting.", default_interaction_mode: "in_person" },
  { req_id: "fl_6b", badge: "family_life", name: "Family meeting topics", description: "Prepare agenda covering 7 topics, review with parent, carry out meetings.", default_interaction_mode: "parent_verify", has_sub_requirements: true },
  { req_id: "fl_7", badge: "family_life", name: "Effective parenting", description: "Discuss understanding of effective parenting and parent's role.", default_interaction_mode: "in_person" },
];

// Valid state transitions for the requirement state machine
export const VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ["in_progress", "offered", "excluded", "completed_prior"],
  offered: ["in_progress", "not_started"],
  in_progress: ["tracking", "blocked", "ready_for_review", "needs_approval"],
  tracking: ["ready_for_review", "in_progress"],
  blocked: ["in_progress"],
  needs_approval: ["in_progress", "blocked"],
  ready_for_review: ["submitted", "in_progress"],
  submitted: ["signed_off", "needs_revision"],  // signed_off is admin-only
  needs_revision: ["in_progress"],
  // Terminal states — no transitions out:
  signed_off: [],
  completed_prior: [],
  excluded: ["in_progress"],  // SM/ASM can un-exclude
};

// Chore streak milestones that trigger celebrations
export const STREAK_MILESTONES = [7, 14, 30, 45, 60, 75, 90];

// Budget tracking milestones
export const BUDGET_MILESTONES = [4, 8, 13];
