/**
 * Synthetic test scout profile for the evaluation harness.
 *
 * This profile is inserted into MongoDB before test runs and cleaned up
 * afterwards.  It matches the ScoutDocument shape from src/types.ts.
 */

import type { ScoutDocument, RequirementDocument, UserDocument } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test scout profile
// ---------------------------------------------------------------------------

export const TEST_SCOUT_EMAIL = "test-scout@scoutquest.test";
export const TEST_GUIDE_EMAIL = "test-guide@scoutquest.test";
export const TEST_TROOP = "T999";

export const TEST_SCOUT: Omit<ScoutDocument, "_id"> = {
  email: TEST_SCOUT_EMAIL,
  name: "Test Scout Will",
  age: 14,
  troop: TEST_TROOP,
  patrol: "Eagles",
  interests: {
    likes: ["gaming", "building PCs", "coding"],
    dislikes: ["running", "cleaning"],
    motivations: ["save up for a gaming PC", "finish Personal Management"],
  },
  quest_state: {
    goal_item: "Gaming PC",
    goal_description: "Build a custom gaming PC with RTX 4070 and Ryzen 7",
    target_budget: 800,
    savings_capacity: 50,
    loan_path_active: false,
    quest_start_date: new Date("2026-01-15"),
    current_savings: 120,
    quest_status: "active",
  },
  character: {
    base: "pathfinder",
    quest_overlay: "gamer_hardware",
    tone_dial: 3,
    domain_intensity: 3,
    tone_min: 1,
    tone_max: 5,
    domain_min: 1,
    domain_max: 5,
    sm_notes: "",
    parent_notes: "Keep it encouraging but don't overdo the gaming references",
    avoid: ["cringe memes", "excessive emoji"],
    calibration_review_enabled: true,
    calibration_review_weeks: [4, 8],
  },
  counselors: {
    personal_management: {
      name: "Mr. Chen",
      email: "chen@example.com",
      preferred_contact: "email",
    },
    family_life: {
      name: "Mrs. Johnson",
      email: "johnson@example.com",
      preferred_contact: "email",
    },
  },
  unit_leaders: {
    scoutmaster: {
      name: "SM Rodriguez",
      email: "sm@troop999.example.com",
      preferred_contact: "email",
    },
  },
  parent_guardian: {
    name: "Sarah Thompson",
    email: "parent@example.com",
    preferred_contact: "email",
  },
  guide_email: TEST_GUIDE_EMAIL,
  blue_card: {
    personal_management: {
      requested_date: new Date("2026-01-10"),
      approved_date: new Date("2026-01-12"),
      approved_by: "SM Rodriguez",
    },
    family_life: {
      requested_date: new Date("2026-01-10"),
      approved_date: new Date("2026-01-12"),
      approved_by: "SM Rodriguez",
    },
  },
  chore_list: [
    { id: "dishes", name: "Wash dishes", frequency: "daily", earns_income: true, income_amount: 2 },
    { id: "trash", name: "Take out trash", frequency: "daily", earns_income: false, income_amount: null },
    { id: "laundry", name: "Do laundry", frequency: "weekly", earns_income: true, income_amount: 5 },
  ],
  budget_projected: {
    income_sources: [
      { name: "Chore income", weekly_amount: 19 },
      { name: "Allowance", weekly_amount: 10 },
    ],
    expense_categories: [
      { name: "Snacks", weekly_amount: 5 },
      { name: "Games (digital)", weekly_amount: 3 },
    ],
    savings_target_weekly: 21,
  },
  session_limits: {
    max_minutes_per_day: 30,
    allowed_days: ["Monday", "Wednesday", "Friday", "Saturday"],
  },
  created_at: new Date("2026-01-15"),
  updated_at: new Date("2026-01-15"),
};

// ---------------------------------------------------------------------------
// Test user document (for role checks)
// ---------------------------------------------------------------------------

export const TEST_SCOUT_USER: Omit<UserDocument, "_id"> = {
  email: TEST_SCOUT_EMAIL,
  name: "Test Scout Will",
  roles: [{ type: "test_scout", test_account: true }],
  created_at: new Date("2026-01-15"),
  updated_at: new Date("2026-01-15"),
};

export const TEST_GUIDE_USER: Omit<UserDocument, "_id"> = {
  email: TEST_GUIDE_EMAIL,
  name: "Test Guide Parent",
  roles: [{ type: "guide", scout_emails: [TEST_SCOUT_EMAIL] }],
  created_at: new Date("2026-01-15"),
  updated_at: new Date("2026-01-15"),
};

// ---------------------------------------------------------------------------
// Baseline requirements (subset — key ones for test scenarios)
// ---------------------------------------------------------------------------

export function buildTestRequirements(): Omit<RequirementDocument, "_id">[] {
  const now = new Date();
  const base = {
    scout_email: TEST_SCOUT_EMAIL,
    notes: "",
    updated_at: now,
  };

  return [
    // PM requirements relevant to scenarios
    { ...base, req_id: "pm_1a", badge: "personal_management", status: "signed_off", quest_driven: true, interaction_mode: "email" },
    { ...base, req_id: "pm_1b", badge: "personal_management", status: "in_progress", quest_driven: true, interaction_mode: "email" },
    { ...base, req_id: "pm_1c", badge: "personal_management", status: "not_started", quest_driven: true, interaction_mode: "email" },
    { ...base, req_id: "pm_2a", badge: "personal_management", status: "in_progress", quest_driven: true, interaction_mode: "digital_submission" },
    { ...base, req_id: "pm_2b", badge: "personal_management", status: "not_started", quest_driven: true, interaction_mode: "email" },
    { ...base, req_id: "pm_2c", badge: "personal_management", status: "tracking", quest_driven: true, interaction_mode: "digital_submission", tracking_start_date: new Date("2026-02-01"), tracking_duration: { weeks: 13 }, tracking_progress: 4 },
    { ...base, req_id: "pm_2d", badge: "personal_management", status: "not_started", quest_driven: true, interaction_mode: "in_person" },
    { ...base, req_id: "pm_3", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "pm_4", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "pm_5", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "email" },
    { ...base, req_id: "pm_6", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "email" },
    { ...base, req_id: "pm_7", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "email" },
    { ...base, req_id: "pm_8a", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "digital_submission" },
    { ...base, req_id: "pm_8b", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "digital_submission" },
    { ...base, req_id: "pm_8c", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "digital_submission" },
    { ...base, req_id: "pm_8d", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "pm_9", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "email" },
    { ...base, req_id: "pm_10", badge: "personal_management", status: "not_started", quest_driven: false, interaction_mode: "in_person" },

    // FL requirements
    { ...base, req_id: "fl_1", badge: "family_life", status: "in_progress", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "fl_2", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "fl_3", badge: "family_life", status: "tracking", quest_driven: true, interaction_mode: "digital_submission", tracking_start_date: new Date("2026-02-01"), tracking_duration: { days: 90 }, tracking_progress: 28 },
    { ...base, req_id: "fl_4", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "parent_verify" },
    { ...base, req_id: "fl_5", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "fl_6a", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
    { ...base, req_id: "fl_6b", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "parent_verify" },
    { ...base, req_id: "fl_7", badge: "family_life", status: "not_started", quest_driven: false, interaction_mode: "in_person" },
  ];
}

// ---------------------------------------------------------------------------
// Baseline chore history (for streak testing)
// ---------------------------------------------------------------------------

export function buildTestChoreHistory(): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Create 10 consecutive days of chore history ending yesterday
  for (let i = 1; i <= 10; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    entries.push({
      scout_email: TEST_SCOUT_EMAIL,
      date,
      chores_completed: ["dishes", "trash"],
      income_earned: 2,
      notes: null,
      created_at: date,
      _test_seeded: true,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Baseline budget entries (weeks 1-4)
// ---------------------------------------------------------------------------

export function buildTestBudgetHistory(): Record<string, unknown>[] {
  return [1, 2, 3, 4].map((week) => ({
    scout_email: TEST_SCOUT_EMAIL,
    week_number: week,
    week_start: new Date(`2026-02-0${week}`),
    income: [{ source: "Chore income", amount: 19 }, { source: "Allowance", amount: 10 }],
    expenses: [{ category: "Snacks", amount: 5, description: "Weekly snacks" }, { category: "Games", amount: 3, description: "Steam sale" }],
    savings_deposited: 21,
    running_savings_total: week * 21,
    notes: null,
    created_at: new Date(`2026-02-0${week}`),
    _test_seeded: true,
  }));
}
