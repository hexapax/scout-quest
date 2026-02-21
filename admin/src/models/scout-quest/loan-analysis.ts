import mongoose, { Schema } from "mongoose";

const loanAnalysisSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  shortfall: Number,
  options_explored: [
    {
      option: String,
      details: String,
      total_cost: Number,
      timeline: String,
    },
  ],
  selected_option: String,
  parent_loan: {
    principal: Number,
    interest_rate: Number,
    term_weeks: Number,
    weekly_payment: Number,
    total_cost_with_interest: Number,
    proposal_document: String,
    parent_approved: Boolean,
    repayment_log: [{ week: Number, amount_paid: Number, remaining_balance: Number }],
  },
});

export const LoanAnalysis = mongoose.model("LoanAnalysis", loanAnalysisSchema, "loan_analysis");
