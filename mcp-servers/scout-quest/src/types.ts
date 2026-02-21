import type { ObjectId } from "mongodb";

// --- Contact ---

export interface ContactInfo {
  name: string;
  email: string;
  preferred_contact?: "email" | "phone" | "text";
}

// --- Users ---

export type Role =
  | { type: "superuser" }
  | { type: "admin"; troop: string }
  | { type: "adult_readonly"; troop: string }
  | { type: "parent"; scout_emails: string[] }
  | { type: "scout" }
  | { type: "test_scout"; test_account: true };

export interface UserDocument {
  _id?: ObjectId;
  email: string;
  roles: Role[];
  created_at: Date;
  updated_at: Date;
}

// --- Scouts ---

export interface ScoutDocument {
  _id?: ObjectId;
  email: string;
  name: string;
  age: number;
  troop: string;
  patrol?: string;

  quest_state: {
    goal_item: string;
    goal_description: string;
    target_budget: number;
    savings_capacity: number;
    loan_path_active: boolean;
    quest_start_date: Date | null;
    current_savings: number;
    quest_status: "setup" | "active" | "paused" | "complete";
  };

  character: {
    base: "guide" | "pathfinder" | "trailblazer";
    quest_overlay: string;
    tone_dial: number;
    domain_intensity: number;
    tone_min: number;
    tone_max: number;
    domain_min: number;
    domain_max: number;
    sm_notes: string;
    parent_notes: string;
    avoid: string[];
    calibration_review_enabled: boolean;
    calibration_review_weeks: number[];
    custom_overlay?: {
      vocabulary: string[];
      analogies: string[];
      enthusiasm_triggers: string[];
    };
  };

  counselors: {
    personal_management: ContactInfo;
    family_life: ContactInfo;
  };

  unit_leaders: {
    scoutmaster: ContactInfo;
    asm?: ContactInfo;
  };

  parent_guardian: ContactInfo;

  blue_card: {
    personal_management: {
      requested_date: Date | null;
      approved_date: Date | null;
      approved_by: string | null;
    };
    family_life: {
      requested_date: Date | null;
      approved_date: Date | null;
      approved_by: string | null;
    };
  };

  chore_list: {
    id: string;
    name: string;
    frequency: string;
    earns_income: boolean;
    income_amount: number | null;
  }[];

  budget_projected?: {
    income_sources: { name: string; weekly_amount: number }[];
    expense_categories: { name: string; weekly_amount: number }[];
    savings_target_weekly: number;
  };

  created_at: Date;
  updated_at: Date;
}

// --- Requirements ---

export type RequirementStatus =
  | "not_started"
  | "in_progress"
  | "tracking"
  | "blocked"
  | "needs_approval"
  | "ready_for_review"
  | "submitted"
  | "needs_revision"
  | "signed_off"
  | "completed_prior"
  | "excluded"
  | "offered";

export type InteractionMode =
  | "in_person"
  | "video"
  | "email"
  | "digital_submission"
  | "parent_verify";

export interface RequirementDocument {
  _id?: ObjectId;
  scout_email: string;
  req_id: string;
  badge: "personal_management" | "family_life";
  status: RequirementStatus;
  quest_driven: boolean;
  interaction_mode: InteractionMode;

  tracking_start_date?: Date;
  tracking_duration?: { days?: number; weeks?: number };
  tracking_progress?: number;

  parent_approved?: boolean;
  counselor_approved?: boolean;

  documents?: {
    name: string;
    content: string;
    submitted_date?: Date;
  }[];

  submitted_to_counselor_date?: Date;
  counselor_feedback?: string;
  signed_off_date?: Date;
  signed_off_by?: string;

  notes: string;
  updated_at: Date;
}

// --- Chore Logs ---

export interface ChoreLogEntry {
  _id?: ObjectId;
  scout_email: string;
  date: Date;
  chores_completed: string[];
  income_earned: number;
  notes?: string;
  created_at: Date;
}

// --- Budget ---

export interface BudgetEntry {
  _id?: ObjectId;
  scout_email: string;
  week_number: number;
  week_start: Date;
  income: { source: string; amount: number }[];
  expenses: { category: string; amount: number; description: string }[];
  savings_deposited: number;
  running_savings_total: number;
  notes?: string;
  created_at: Date;
}

// --- Time Management ---

export interface TimeMgmtDocument {
  _id?: ObjectId;
  scout_email: string;
  exercise_week_start: Date;

  todo_list: {
    item: string;
    priority: number;
    category: string;
  }[];

  weekly_schedule: {
    day: string;
    fixed_activities: { time: string; activity: string }[];
    planned_tasks: { time: string; todo_item: string }[];
  }[];

  daily_diary: {
    day: string;
    entries: {
      scheduled_time: string;
      actual_time: string;
      task: string;
      completed: boolean;
      notes: string;
    }[];
  }[];

  reflection?: string;
}

// --- Loan Analysis ---

export interface LoanAnalysisDocument {
  _id?: ObjectId;
  scout_email: string;
  shortfall: number;
  options_explored: {
    option: string;
    details: string;
    total_cost: number;
    timeline: string;
  }[];
  selected_option?: string;
  parent_loan?: {
    principal: number;
    interest_rate: number;
    term_weeks: number;
    weekly_payment: number;
    total_cost_with_interest: number;
    proposal_document?: string;
    parent_approved: boolean;
    repayment_log: {
      week: number;
      amount_paid: number;
      remaining_balance: number;
    }[];
  };
}

// --- Emails ---

export interface EmailRecord {
  _id?: ObjectId;
  scout_email: string;
  date: Date;
  to: string;
  cc: string[];
  subject: string;
  context: string;
}

// --- Reminders ---

export interface ReminderDocument {
  _id?: ObjectId;
  scout_email: string;
  type: "chore" | "deadline" | "check_in" | "diary" | "budget_update";
  message: string;
  schedule: string;
  last_triggered: Date | null;
  next_trigger: Date | null;
  active: boolean;
  created_at: Date;
}
