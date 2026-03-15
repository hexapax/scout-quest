/**
 * Chain: Chore Streak + Savings Growth
 *
 * Tests daily chore logging across sessions with accumulating savings.
 * Verifies the coach reports correct streak count and savings total
 * each session.
 *
 * Baseline state: 10-day streak, $120 savings.
 */

import type { SessionChain } from "../types.js";

const chain: SessionChain = {
  id: "chore-streak",
  name: "Chore Streak + Savings Growth",
  description:
    "Multi-session chore logging test. Scout logs chores across 3 sessions, " +
    "then asks for a progress summary. Tests savings accumulation accuracy, " +
    "streak counting, and consistent reporting.",

  steps: [
    // ─── Step 1: Log today's chores ──────────────────────────
    {
      id: "log-chores-day-1",
      description:
        "Scout logs dishes and trash. Coach should call log_chore and report " +
        "updated savings ($120 + $2 = $122) and streak (11 days).",
      scoutSimPrompt: `You are a 14-year-old scout named Will checking in after doing chores.

YOUR PERSONALITY: Quick and casual, just wants to log and go.

CONVERSATION FLOW:
1. Say you did your chores
2. When asked which ones, say dishes and trash
3. React to the savings update
4. Say bye

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "hey I did my chores today",
      maxTurns: 8,
      expectedTools: ["log_chore", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_chore with chores_completed=['dishes','trash']. " +
        "Should report earnings ($2 from dishes) and updated savings. " +
        "Streak should be reported as 11 days (10 seeded + today).",
      expectedMutations: ["chore_logs: +1", "savings: $120 → $122"],
    },

    // ─── Step 2: Check savings progress ──────────────────────
    {
      id: "check-savings",
      description:
        "Scout asks how savings are going. Coach should accurately report " +
        "current savings ($122) and progress toward $800 goal.",
      scoutSimPrompt: `You are a 14-year-old scout named Will curious about your savings.

YOUR PERSONALITY: Interested in the numbers, wants to know the math.

CONVERSATION FLOW:
1. Ask how much you've saved so far
2. Ask how long until you reach your goal
3. Say cool and wrap up

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "how much money have I saved up so far?",
      maxTurns: 6,
      expectedTools: ["log_session_notes"],
      evaluationWeights: {
        requirement_accuracy: 0.25,
        state_management: 0.25,
        engagement_quality: 0.15,
        socratic_method: 0.15,
        character_consistency: 0.10,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach must report savings as $122 (NOT $120 — that was before yesterday's chore log). " +
        "Goal is $800. Should discuss progress as a fraction/percentage. " +
        "Should NOT call log_chore or any mutation tool.",
      expectedMutations: ["session_notes: +1"],
    },

    // ─── Step 3: Log chores + laundry ────────────────────────
    {
      id: "log-chores-with-laundry",
      description:
        "Scout did all chores including laundry (weekly, $5). Tests that " +
        "the higher-value chore is calculated correctly. Pre-step mutation " +
        "backdates yesterday's log so today is a fresh day.",
      // Backdate the chore log from step 1 to yesterday so log_chore won't reject today's log
      preStepMutations: [
        {
          collection: "chore_logs",
          filter: { scout_email: "will@test.scoutquest.app", date: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
          update: {
            $set: {
              date: new Date(new Date(new Date().setHours(0, 0, 0, 0)).getTime() - 86400000),
            },
          },
        },
      ],
      scoutSimPrompt: `You are a 14-year-old scout named Will who did extra chores today.

YOUR PERSONALITY: Feeling productive, proud of doing laundry too.

CONVERSATION FLOW:
1. Say you did dishes, trash, AND laundry today
2. Confirm when asked
3. React excitedly to the bigger earnings
4. Ask about the streak

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "I did all three chores today! dishes, trash, and laundry!",
      maxTurns: 8,
      expectedTools: ["log_chore", "log_session_notes"],
      evaluatorContext:
        "Coach should call log_chore with chores_completed=['dishes','trash','laundry']. " +
        "Total earnings: $2 (dishes) + $5 (laundry) = $7. Trash earns nothing. " +
        "Updated savings: $122 + $7 = $129.",
      expectedMutations: ["chore_logs: +1", "savings: $122 → $129"],
    },

    // ─── Step 4: Final progress summary ──────────────────────
    {
      id: "final-summary",
      description:
        "Scout asks for a full picture. Coach should report accurate " +
        "savings ($129), chore streak, and overall quest progress.",
      scoutSimPrompt: `You are a 14-year-old scout named Will wanting the big picture.

YOUR PERSONALITY: Reflective, wants to understand overall progress.

CONVERSATION FLOW:
1. Ask for a full update on your quest progress
2. Ask specifically about the PC build savings goal
3. Say you're motivated to keep going
4. Wrap up

Generate ONLY the scout's next message. No commentary.`,
      initialMessage: "can you give me a full rundown of where I'm at with everything?",
      maxTurns: 10,
      expectedTools: ["log_session_notes"],
      evaluationWeights: {
        requirement_accuracy: 0.30,
        state_management: 0.20,
        engagement_quality: 0.15,
        socratic_method: 0.10,
        character_consistency: 0.15,
        scope_adherence: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Coach should call read tools to get current state and report it accurately. " +
        "Expected savings is $129 if all prior steps succeeded, but if the coach reads " +
        "a different amount from the DB, it should report what the tools return — do NOT " +
        "penalize for reporting a slightly different savings figure if the tools confirm it. " +
        "Goal is $800 Gaming PC. Should mention requirement statuses accurately. " +
        "Should not confuse the savings amount with the budget tracking total.",
      expectedMutations: ["session_notes: +1"],
    },
  ],
};

export default chain;
