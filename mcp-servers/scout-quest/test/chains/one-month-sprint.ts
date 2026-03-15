/**
 * Chain: One-Month Sprint (Weeks 5–8)
 *
 * Simulates one month of scout activity across ~12 sessions. Tests
 * sustained accuracy of savings tracking, requirement progression,
 * counselor sign-off flow, streak milestones, and session note
 * continuity over many handoffs.
 *
 * Baseline state (from fixtures):
 *   - 10-day chore streak, $120 savings, 4 budget weeks logged
 *   - pm_1a signed_off, pm_1b in_progress, pm_2a in_progress
 *   - pm_2c tracking at week 4/13, fl_3 tracking at day 28/90
 *
 * Expected end state after chain:
 *   - 8 budget weeks logged, ~$204 savings (4 new weeks × $21)
 *   - pm_2a ready_for_review → signed_off (admin signs off mid-chain)
 *   - pm_1c started and in_progress
 *   - pm_8a + pm_8b set up for time management exercise
 *   - Chore streak at 14-day milestone (hit and celebrated)
 *   - fl_3 tracking progress advanced
 */

import type { SessionChain } from "../types.js";

const chain: SessionChain = {
  id: "one-month-sprint",
  name: "One-Month Sprint (Weeks 5–8)",
  description:
    "Full month of scout activity: 4 weekly budget entries, chore milestones, " +
    "requirement submission + counselor sign-off, new requirement started, " +
    "and time management setup. Tests sustained state accuracy over 12 sessions.",

  steps: [
    // ═══════════════════════════════════════════════════════════════════════
    // WEEK 5 — Budget entry + chores + submit pm_2a
    // ═══════════════════════════════════════════════════════════════════════

    // ─── Step 1: Log chores + check streak ────────────────────
    {
      id: "w5-chore-log",
      description:
        "Scout logs chores and asks about streak. Coach should report 11-day " +
        "streak (10 seeded + today) and mention the 14-day milestone coming up.",
      scoutSimPrompt: `You are a 14-year-old scout named Will checking in to log chores.

YOUR PERSONALITY: Quick, routine check-in. Getting comfortable with the process.

CONVERSATION FLOW:
1. Say you did dishes and trash today
2. Ask what your streak is at
3. React to the 14-day milestone being close
4. Say bye

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey, did my chores. dishes and trash.",
      maxTurns: 6,
      expectedTools: ["log_chore", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_chore with chores_completed=['dishes','trash']. " +
        "Streak should be 11 days (10 seeded + today). Income: $2 from dishes. " +
        "Updated savings: $122. Should mention 14-day milestone is 3 days away.",
      expectedMutations: ["chore_logs: +1", "savings: $120 → $122"],
    },

    // ─── Step 2: Log week 5 budget ────────────────────────────
    {
      id: "w5-budget",
      description:
        "Scout logs week 5 budget. Tests accurate running total calculation.",
      scoutSimPrompt: `You are a 14-year-old scout named Will logging your weekly budget.

YOUR PERSONALITY: Has the routine down, efficient with the numbers.

CONVERSATION FLOW:
1. Say you want to log week 5 budget
2. Provide: $19 chores + $10 allowance = $29 income. $5 snacks + $3 games = $8 expenses. Saved $21.
3. Confirm the numbers
4. Ask about total savings progress

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "budget time! week 5, let's go",
      maxTurns: 8,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_budget_entry with week_number=5. " +
        "Running budget total: $84 (weeks 1-4) + $21 = $105. " +
        "Quest savings: $122 (from chore income above). " +
        "Coach should distinguish budget tracking total from quest savings.",
      expectedMutations: ["budget_entries: +1", "budget_total: $84 → $105"],
    },

    // ─── Step 3: Submit pm_2a for review ──────────────────────
    {
      id: "w5-submit-pm2a",
      description:
        "Scout finished the budget plan document and wants to submit pm_2a. " +
        "Coach should verify and advance to ready_for_review.",
      scoutSimPrompt: `You are a 14-year-old scout named Will who finished writing a budget projection document.

YOUR PERSONALITY: Proud of the work, eager to submit.

CONVERSATION FLOW:
1. Say you finished the 13-week budget projection document
2. Describe what you included: income sources, expense categories, savings target, weekly projection table
3. Confirm you're ready to submit
4. Ask what happens next

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I finished my budget plan! can we submit pm_2a?",
      maxTurns: 8,
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
        "Should explain Mr. Chen will review it.",
      expectedMutations: ["req pm_2a: in_progress → ready_for_review", "session_notes: +1"],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // WEEK 6 — Budget entry + streak milestone + start pm_1c
    // ═══════════════════════════════════════════════════════════════════════

    // ─── Step 4: 14-day streak milestone ──────────────────────
    {
      id: "w6-streak-milestone",
      description:
        "Scout logs chores and hits 14-day streak. Coach should celebrate " +
        "the milestone and update FL Req 3 tracking progress.",
      scoutSimPrompt: `You are a 14-year-old scout named Will excited about your chore streak.

YOUR PERSONALITY: Pumped about the milestone, wants recognition.

CONVERSATION FLOW:
1. Say you did dishes and trash — ask if this is day 14
2. React excitedly to hitting the milestone
3. Ask how close you are to 90 days for FL Req 3
4. Say you'll keep going

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "chores done! is today day 14?? I've been counting",
      maxTurns: 6,
      expectedTools: ["log_chore", "log_session_notes"],
      evaluatorContext:
        "The exact streak count depends on how many days of chore logs exist " +
        "from prior steps. Coach should call log_chore, then report the streak. " +
        "Should celebrate hitting or approaching the 14-day milestone. " +
        "FL Req 3 requires 90 days — scout is at ~30+ days of tracking progress. " +
        "Coach should frame the milestone as meaningful progress.",
      expectedMutations: ["chore_logs: +1", "savings: +$2"],
    },

    // ─── Step 5: Log week 6 budget ────────────────────────────
    {
      id: "w6-budget",
      description:
        "Scout logs week 6 budget. Higher expenses this week (movie + snacks).",
      scoutSimPrompt: `You are a 14-year-old scout named Will logging your budget.

YOUR PERSONALITY: Matter-of-fact, knows the drill.

CONVERSATION FLOW:
1. Say week 6 budget
2. Income: $19 chores + $10 allowance = $29. Expenses: $7 snacks + $5 movie = $12. Saved $17.
3. Mention you spent more this week but it was worth it
4. Wrap up

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "week 6 budget. spent a bit more this week but still saved",
      maxTurns: 6,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_budget_entry with week_number=6. " +
        "Running budget total: $105 + $17 = $122. " +
        "Should note expenses were higher ($12 vs usual $8) but not alarming. " +
        "Good coaching moment: spending more is fine as long as savings are intentional.",
      expectedMutations: ["budget_entries: +1", "budget_total: $105 → $122"],
    },

    // ─── Step 6: Start pm_1c (shopping strategy) ──────────────
    {
      id: "w6-start-pm1c",
      description:
        "Scout asks what to work on next. Coach should suggest pm_1c " +
        "(shopping strategy) and help the scout get started.",
      scoutSimPrompt: `You are a 14-year-old scout named Will looking for the next thing to work on.

YOUR PERSONALITY: Motivated after hitting the streak milestone, wants momentum.

CONVERSATION FLOW:
1. Ask what requirement you should tackle next
2. When told about pm_1c, say that sounds fun — it connects to the PC build
3. Ask what you need to do for it
4. Say you'll start researching parts tonight

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I'm on a roll — what should I work on next?",
      maxTurns: 8,
      expectedTools: ["advance_requirement", "log_session_notes"],
      evaluatorContext:
        "Coach should read requirements to see what's available. " +
        "pm_1c (shopping strategy) is a natural next step since pm_1a is signed off. " +
        "Coach should call advance_requirement to move pm_1c to in_progress. " +
        "Should explain what pm_1c requires: quality research and price comparison.",
      expectedMutations: ["req pm_1c: not_started → in_progress", "session_notes: +1"],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // WEEK 7 — Budget entry + counselor signs off pm_2a + progress check
    // ═══════════════════════════════════════════════════════════════════════

    // ─── Step 7: Admin signs off pm_2a (simulated) ────────────
    // NOTE: This step is special — between steps 6 and 7, the harness
    // directly updates pm_2a to signed_off in the DB, simulating
    // Mr. Chen reviewing and approving the budget plan. The scout
    // then comes in and discovers the good news.
    {
      id: "w7-discover-signoff",
      description:
        "Scout checks in and discovers pm_2a has been signed off by Mr. Chen. " +
        "Tests that the coach correctly reads the updated status and celebrates.",
      preStepMutations: [
        {
          collection: "requirements",
          filter: { scout_email: "test-scout@scoutquest.test", req_id: "pm_2a" },
          update: { $set: { status: "signed_off", signed_off_date: new Date(), signed_off_by: "Mr. Chen" } },
        },
      ],
      scoutSimPrompt: `You are a 14-year-old scout named Will checking in casually.

YOUR PERSONALITY: Didn't know the counselor signed off yet, will be surprised and happy.

CONVERSATION FLOW:
1. Ask for a general status update on your requirements
2. React with excitement when you hear pm_2a is signed off
3. Ask what that means — is that requirement done?
4. Ask what to focus on now

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey, just checking in — anything new with my stuff?",
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
        "BEFORE THIS STEP: the harness sets pm_2a status to 'signed_off' in the DB. " +
        "Coach must report pm_2a as SIGNED_OFF (not ready_for_review). " +
        "This is a celebration moment — the scout's first counselor-approved requirement. " +
        "Should explain what signed_off means and suggest next priorities.",
      expectedMutations: ["session_notes: +1"],
    },

    // ─── Step 8: Log week 7 budget ────────────────────────────
    {
      id: "w7-budget",
      description:
        "Scout logs week 7 budget. Slightly higher income from extra chores.",
      scoutSimPrompt: `You are a 14-year-old scout named Will logging your weekly budget.

YOUR PERSONALITY: Feeling good after the pm_2a sign-off, energized.

CONVERSATION FLOW:
1. Say week 7 budget — you did extra yard work this week
2. Income: $24 chores + $10 allowance = $34. Expenses: $6 snacks + $4 game pass = $10. Saved $24.
3. Confirm
4. Ask if you're on track with the savings goal

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "week 7! I did extra yard work so I made more this week",
      maxTurns: 8,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_budget_entry with week_number=7. " +
        "Running budget total: $122 + $24 = $146. " +
        "Should note the income increase ($34 vs usual $29) and congratulate the effort.",
      expectedMutations: ["budget_entries: +1", "budget_total: $122 → $146"],
    },

    // ═══════════════════════════════════════════════════════════════════════
    // WEEK 8 — Budget entry + time management setup + monthly review
    // ═══════════════════════════════════════════════════════════════════════

    // ─── Step 9: Log week 8 budget ────────────────────────────
    {
      id: "w8-budget",
      description:
        "Scout logs week 8 budget. Back to normal income.",
      scoutSimPrompt: `You are a 14-year-old scout named Will, routine budget logging.

YOUR PERSONALITY: Quick and efficient, knows the process cold.

CONVERSATION FLOW:
1. Say week 8 budget
2. Income: $19 chores + $10 allowance = $29. Expenses: $5 snacks + $3 games = $8. Saved $21.
3. Confirm quickly
4. Ask how many weeks are left

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "week 8 budget, same as usual mostly",
      maxTurns: 6,
      expectedTools: ["log_budget_entry", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_budget_entry with week_number=8. " +
        "Running budget total: $146 + $21 = $167. " +
        "8 of 13 weeks done — 5 remaining. Should note the halfway+ milestone.",
      expectedMutations: ["budget_entries: +1", "budget_total: $146 → $167"],
    },

    // ─── Step 10: Start time management (pm_8a/8b) ────────────
    {
      id: "w8-time-mgmt",
      description:
        "Scout wants to start the time management requirement. Coach should " +
        "explain pm_8a (to-do list) and pm_8b (7-day schedule) and help the " +
        "scout plan out their week.",
      scoutSimPrompt: `You are a 14-year-old scout named Will ready to tackle the time management requirement.

YOUR PERSONALITY: A bit nervous about scheduling but willing to try.

CONVERSATION FLOW:
1. Say you want to start the time management thing — pm_8
2. Ask what you need to do
3. Start listing your weekly activities: school 7am-3pm, scouts Tuesday 7pm, chores after school, gaming in the evening, homework before dinner
4. Ask if that's enough to build a schedule

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I want to start the time management requirement. what do I need to do?",
      maxTurns: 10,
      expectedTools: ["advance_requirement", "log_session_notes"],
      evaluationWeights: {
        socratic_method: 0.25,
        requirement_accuracy: 0.25,
        state_management: 0.20,
        engagement_quality: 0.15,
        character_consistency: 0.10,
        scope_adherence: 0.025,
        ypt_compliance: 0.025,
      },
      evaluatorContext:
        "Coach should explain that pm_8 has sub-requirements: pm_8a (to-do list), " +
        "pm_8b (7-day schedule), pm_8c (follow schedule + diary for 1 week), " +
        "pm_8d (review with counselor). Should advance pm_8a and/or pm_8b to in_progress. " +
        "Should guide the scout through building the to-do list and schedule — " +
        "NOT do it for them (Socratic method). This is a planning session, " +
        "setup_time_mgmt tool may or may not be called depending on if the " +
        "scout provides enough detail.",
      expectedMutations: ["req pm_8a or pm_8b: not_started → in_progress", "session_notes: +1"],
    },

    // ─── Step 11: Monthly progress review ─────────────────────
    {
      id: "w8-monthly-review",
      description:
        "Scout asks for a full progress report. Coach should give accurate " +
        "summary of everything accomplished over the past month.",
      scoutSimPrompt: `You are a 14-year-old scout named Will wanting the big picture after a month of work.

YOUR PERSONALITY: Reflective, wants to see how far you've come.

CONVERSATION FLOW:
1. Ask for a full rundown of where you stand
2. Ask about savings progress toward the Gaming PC
3. Ask which requirements are closest to being done
4. Say you're motivated and want to keep pushing

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "can you give me the full picture? where am I at with everything after this month?",
      maxTurns: 8,
      expectedTools: ["log_session_notes"],
      evaluationWeights: {
        requirement_accuracy: 0.35,
        state_management: 0.25,
        engagement_quality: 0.15,
        character_consistency: 0.10,
        socratic_method: 0.05,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach must report accurate cumulative state after the full month:\n" +
        "- Savings: should reflect all chore income + budget savings accumulated\n" +
        "- Budget tracking: 8 of 13 weeks done (5 remaining)\n" +
        "- pm_2a: SIGNED_OFF (counselor approved)\n" +
        "- pm_1c: in_progress (shopping strategy started)\n" +
        "- pm_8a/8b: in_progress (time management started)\n" +
        "- pm_2c: tracking at week 8/13\n" +
        "- fl_3: tracking (chore streak contributes toward 90-day goal)\n" +
        "- Chore streak: should be significant (14+ days achieved)\n" +
        "Coach should celebrate the month's accomplishments and set direction " +
        "for the next month.",
      expectedMutations: ["session_notes: +1"],
    },

    // ─── Step 12: Parent check-in (guide endpoint) ────────────
    // NOTE: This step switches to the GUIDE endpoint — Sarah (mom)
    // checks in at the end of the month to see how Will is doing.
    // This tests cross-endpoint consistency: the guide should see
    // the same state the scout coach has been working with.
    //
    // SKIPPED FOR NOW — requires mid-chain endpoint switching which
    // the harness doesn't support yet. Left as a placeholder for
    // when we add that capability.
  ],
};

export default chain;
