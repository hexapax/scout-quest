/**
 * Chain: PM Req 2a — Budget Lifecycle
 *
 * Tests the full requirement lifecycle from checking status through
 * budget logging to advancement to ready_for_review. Six sessions
 * that share DB state.
 *
 * Baseline state: pm_2a is "in_progress", 4 budget weeks already logged,
 * scout has $120 savings.
 */

import type { SessionChain } from "../types.js";

const chain: SessionChain = {
  id: "pm-req-2a-lifecycle",
  name: "PM Req 2a — Budget Lifecycle",
  description:
    "Full lifecycle test: scout checks requirement status, logs budget entries " +
    "over multiple sessions, then submits for review. Tests state persistence, " +
    "accurate progress reporting, correct tool calls, and advancement tracking.",

  steps: [
    // ─── Step 1: Check where I stand ──────────────────────────
    {
      id: "check-status",
      description:
        "Scout asks about their PM requirements. Coach should read state and " +
        "accurately report pm_2a as in_progress, mention budget tracking at week 4 of 13.",
      scoutSimPrompt: `You are a 14-year-old scout named Will checking on your merit badge progress.

YOUR PERSONALITY: Casual, a bit distracted, just wants a quick status update.

CONVERSATION FLOW:
1. Ask where you stand on Personal Management
2. When told about pm_2a status, ask how many weeks you've logged so far
3. Say "cool, thanks" and wrap up

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey, where am I at with my Personal Management stuff?",
      maxTurns: 6,
      expectedTools: ["log_session_notes"],
      evaluatorContext:
        "The coach should accurately report pm_2a as in_progress. Budget tracking is at week 4 of 13. " +
        "The coach should NOT call advance_requirement in this step.",
      expectedMutations: ["session_notes: +1"],
    },

    // ─── Step 2: Log budget week 5 ───────────────────────────
    {
      id: "log-budget-5",
      description:
        "Scout wants to log week 5 budget. Coach should guide through the " +
        "data collection and call log_budget_entry with week_number=5.",
      scoutSimPrompt: `You are a 14-year-old scout named Will ready to log your weekly budget.

YOUR PERSONALITY: Cooperative, has the numbers ready, wants to get it done.

CONVERSATION FLOW:
1. Say you want to log your budget for week 5
2. When asked for details, provide: $19 chore income, $10 allowance = $29 income. $5 snacks, $3 games = $8 expenses. Saved $21.
3. Confirm the numbers when the coach reads them back
4. Ask how much you've saved total

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I need to log my budget for this week. It's week 5.",
      maxTurns: 8,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluationWeights: {
        state_management: 0.30,
        socratic_method: 0.20,
        requirement_accuracy: 0.15,
        engagement_quality: 0.15,
        character_consistency: 0.10,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach must call log_budget_entry with week_number=5. After logging, the running " +
        "savings total should reflect weeks 1-5 (4 prior weeks × $21 = $84, plus $21 = $105).",
      expectedMutations: ["budget_entries: +1", "budget_total: $84 → $105"],
    },

    // ─── Step 3: Log budget week 6 ───────────────────────────
    {
      id: "log-budget-6",
      description:
        "Scout returns to log week 6. Tests that the coach correctly sees " +
        "the updated state (week 5 now exists) and doesn't duplicate it.",
      scoutSimPrompt: `You are a 14-year-old scout named Will logging another budget week.

YOUR PERSONALITY: Getting into the routine, confident with the process now.

CONVERSATION FLOW:
1. Say you want to log week 6
2. Provide numbers: $19 chores + $10 allowance = $29 income. $7 snacks + $5 movie = $12 expenses. Saved $17.
3. Confirm when asked
4. React to the running total

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "week 6 budget time! let's do this",
      maxTurns: 8,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluatorContext:
        "Coach must call log_budget_entry with week_number=6. Should NOT re-log week 5. " +
        "Running total after this: $105 + $17 = $122.",
      expectedMutations: ["budget_entries: +1", "budget_total: $105 → $122"],
    },

    // ─── Step 4: Check progress mid-journey ──────────────────
    {
      id: "mid-journey-check",
      description:
        "Scout asks for a progress check. Coach should report accurate state: " +
        "6 of 13 weeks logged, current savings, and time remaining.",
      scoutSimPrompt: `You are a 14-year-old scout named Will wanting a progress report.

YOUR PERSONALITY: Curious, wants to see how close you are to finishing.

CONVERSATION FLOW:
1. Ask how close you are to finishing the budget tracking
2. Ask what you need to do to get pm_2a marked as done
3. Say thanks and you'll keep logging

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey, how am I doing on the budget tracking? am I close to done?",
      maxTurns: 6,
      expectedTools: ["log_session_notes"],
      evaluationWeights: {
        requirement_accuracy: 0.30,
        state_management: 0.20,
        socratic_method: 0.15,
        engagement_quality: 0.15,
        character_consistency: 0.10,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach should accurately state: 6 of 13 weeks logged for pm_2c tracking, " +
        "pm_2a is still in_progress (the budget plan requirement), and explain what's " +
        "needed to advance pm_2a to ready_for_review. Should NOT call advance_requirement.",
      expectedMutations: ["session_notes: +1"],
    },

    // ─── Step 5: Submit budget plan for review ───────────────
    {
      id: "submit-for-review",
      description:
        "Scout says the budget plan is done and wants to submit pm_2a. " +
        "Coach should verify readiness and call advance_requirement(pm_2a, ready_for_review).",
      scoutSimPrompt: `You are a 14-year-old scout named Will who finished a budget plan document.

YOUR PERSONALITY: Proud of the work, eager to move forward.

CONVERSATION FLOW:
1. Say you finished your 13-week budget projection document and want to submit pm_2a
2. When asked about what you included, describe: income sources, expense categories, savings target, and a 13-week projection table
3. Confirm you're ready to submit
4. Ask what happens next (counselor review)

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I finished my budget plan document! Can we submit pm_2a for review?",
      maxTurns: 10,
      expectedTools: ["advance_requirement", "log_session_notes"],
      evaluationWeights: {
        state_management: 0.30,
        requirement_accuracy: 0.25,
        socratic_method: 0.20,
        engagement_quality: 0.10,
        character_consistency: 0.10,
        scope_adherence: 0.025,
        ypt_compliance: 0.025,
      },
      evaluatorContext:
        "Coach MUST call advance_requirement with req_id='pm_2a' and new_status='ready_for_review'. " +
        "Should verify the scout's work before advancing (Socratic method). " +
        "Should explain that Mr. Chen will review it next.",
      expectedMutations: ["req pm_2a: in_progress → ready_for_review", "session_notes: +1"],
    },

    // ─── Step 6: Verify final state ─────────────────────────
    {
      id: "verify-final-state",
      description:
        "Scout comes back and asks for a full status report. Coach should " +
        "accurately reflect that pm_2a is now ready_for_review.",
      scoutSimPrompt: `You are a 14-year-old scout named Will checking in after submitting work.

YOUR PERSONALITY: Satisfied, just wants confirmation everything is on track.

CONVERSATION FLOW:
1. Ask for a quick update on where things stand with PM requirements
2. Confirm you see pm_2a is pending review
3. Ask what you should focus on next
4. Say thanks and sign off

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey just checking in — did my budget plan submission go through?",
      maxTurns: 6,
      expectedTools: ["log_session_notes"],
      evaluationWeights: {
        requirement_accuracy: 0.35,
        state_management: 0.20,
        engagement_quality: 0.15,
        socratic_method: 0.10,
        character_consistency: 0.10,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach must accurately report pm_2a as ready_for_review (NOT in_progress anymore). " +
        "Should mention the counselor (Mr. Chen) will review. Should suggest next steps " +
        "(other requirements to work on). Must NOT call advance_requirement again.",
      expectedMutations: ["session_notes: +1"],
    },
  ],
};

export default chain;
