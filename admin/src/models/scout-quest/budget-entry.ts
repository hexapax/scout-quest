import mongoose, { Schema } from "mongoose";

const budgetEntrySchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  week_number: { type: Number, required: true },
  week_start: { type: Date, required: true },
  income: [{ source: String, amount: Number }],
  expenses: [{ category: String, amount: Number, description: String }],
  savings_deposited: { type: Number, default: 0 },
  running_savings_total: { type: Number, default: 0 },
  notes: String,
  created_at: { type: Date, default: Date.now },
});

export const BudgetEntry = mongoose.model("BudgetEntry", budgetEntrySchema, "budget_entries");
