import mongoose, { Schema } from "mongoose";

const contactInfoSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    preferred_contact: { type: String, enum: ["email", "phone", "text"] },
  },
  { _id: false }
);

const scoutSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    troop: { type: String, required: true },
    patrol: String,

    quest_state: {
      goal_item: String,
      goal_description: String,
      target_budget: Number,
      savings_capacity: Number,
      loan_path_active: { type: Boolean, default: false },
      quest_start_date: Date,
      current_savings: { type: Number, default: 0 },
      quest_status: {
        type: String,
        enum: ["setup", "active", "paused", "complete"],
        default: "setup",
      },
    },

    character: {
      base: { type: String, enum: ["guide", "pathfinder", "trailblazer"] },
      quest_overlay: String,
      tone_dial: Number,
      domain_intensity: Number,
      tone_min: Number,
      tone_max: Number,
      domain_min: Number,
      domain_max: Number,
      sm_notes: String,
      parent_notes: String,
      avoid: [String],
      calibration_review_enabled: Boolean,
      calibration_review_weeks: [Number],
      custom_overlay: {
        vocabulary: [String],
        analogies: [String],
        enthusiasm_triggers: [String],
      },
    },

    counselors: {
      personal_management: contactInfoSchema,
      family_life: contactInfoSchema,
    },

    unit_leaders: {
      scoutmaster: contactInfoSchema,
      asm: contactInfoSchema,
    },

    parent_guardian: contactInfoSchema,

    blue_card: {
      personal_management: {
        requested_date: Date,
        approved_date: Date,
        approved_by: String,
      },
      family_life: {
        requested_date: Date,
        approved_date: Date,
        approved_by: String,
      },
    },

    chore_list: [
      {
        id: String,
        name: String,
        frequency: String,
        earns_income: Boolean,
        income_amount: Number,
      },
    ],

    budget_projected: {
      income_sources: [{ name: String, weekly_amount: Number }],
      expense_categories: [{ name: String, weekly_amount: Number }],
      savings_target_weekly: Number,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Scout = mongoose.model("Scout", scoutSchema, "scouts");
