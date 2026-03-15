/**
 * Chain: Guide Progress Check
 *
 * Tests the parent/scouter (guide) endpoint's ability to report accurate
 * scout progress. Simulator plays Sarah (Will's mom), a casual but
 * engaged parent asking about her son's merit badge work.
 *
 * Baseline state: Will has 10-day chore streak, $120 savings, 4 budget
 * weeks logged, pm_2a in_progress, pm_2c tracking at week 4/13.
 */

import type { SessionChain } from "../types.js";

const chain: SessionChain = {
  id: "guide-progress-check",
  name: "Guide — Parent Progress Check",
  description:
    "Parent asks about scout's progress across 4 topics: overall status, " +
    "chores, budget/savings, and next steps. Tests accurate number reporting, " +
    "parent-appropriate framing, and actionable suggestions.",
  endpoint: "guide",

  steps: [
    // ─── Step 1: Overall progress ──────────────────────────
    {
      id: "ask-overall-progress",
      description:
        "Parent asks how their scout is doing. Guide should read linked scouts " +
        "and scout summary, report savings progress, requirement counts, and " +
        "active work areas.",
      scoutSimPrompt: `You are Sarah, the mother of a 14-year-old scout named Will. You're checking in on his merit badge progress.

YOUR PERSONALITY: Supportive, engaged, busy working mom. You want the overview, not every detail.

CONVERSATION FLOW:
1. Ask how Will is doing with his merit badges
2. React to the progress report — ask if he's on track
3. Say thanks, that's helpful

Generate ONLY Sarah's next message. No commentary.`,
      initialMessage: "Hi! I'm Will's mom — how's he doing with his merit badge work?",
      maxTurns: 6,
      expectedTools: ["read_linked_scouts", "read_scout_summary"],
      evaluationWeights: {
        requirement_accuracy: 0.25,
        state_management: 0.25,
        engagement_quality: 0.20,
        scope_adherence: 0.15,
        socratic_method: 0.05,
        character_consistency: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Guide should call read_linked_scouts and/or read_scout_summary to get real data. " +
        "Key facts: Will has $120 saved toward $800 Gaming PC (15%), 1 requirement signed off (pm_1a), " +
        "3 in progress (pm_1b, pm_2a, fl_1), pm_2c tracking at week 4/13, fl_3 tracking at day 28/90. " +
        "Guide should present this in parent-friendly terms, not internal jargon.",
      expectedMutations: [],
    },

    // ─── Step 2: Chore details ──────────────────────────────
    {
      id: "ask-about-chores",
      description:
        "Parent asks specifically about chores. Guide should read chore data " +
        "and report the streak, recent activity, and earnings.",
      scoutSimPrompt: `You are Sarah, Will's mom, curious about whether he's actually doing his chores consistently.

YOUR PERSONALITY: Slightly skeptical but hopeful — wants to trust but verify.

CONVERSATION FLOW:
1. Ask if he's actually been doing his chores regularly
2. React to the streak info — express pleasant surprise if good
3. Ask how much he's earned from chores

Generate ONLY Sarah's next message. No commentary.`,
      initialMessage: "That's great to hear. But is he actually doing his chores? I feel like I'm always reminding him at home.",
      maxTurns: 6,
      expectedTools: ["read_scout_chores"],
      evaluationWeights: {
        requirement_accuracy: 0.25,
        state_management: 0.25,
        engagement_quality: 0.20,
        scope_adherence: 0.15,
        socratic_method: 0.05,
        character_consistency: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Guide should call read_scout_chores. Key facts: 10-day streak (seeded chore logs " +
        "ending yesterday), dishes and trash daily, $2/day from dishes. Total earned from " +
        "chore logs: $20 (10 days × $2). Guide should frame this positively — 10 days is " +
        "real consistency. Next milestone is 14 days. Should NOT reveal internal coaching " +
        "details (tone_dial, quest overlay, etc.).",
      expectedMutations: [],
    },

    // ─── Step 3: Budget and savings ──────────────────────────
    {
      id: "ask-about-budget",
      description:
        "Parent asks about the budget tracking. Guide should report weeks " +
        "tracked, savings progress, and connect it to learning outcomes.",
      scoutSimPrompt: `You are Sarah, Will's mom, interested in whether the budget tracking is teaching him anything useful.

YOUR PERSONALITY: Practical, cares more about the learning than the numbers.

CONVERSATION FLOW:
1. Ask how the budget tracking is going — is he learning about money management?
2. Ask what he's saving for and how close he is
3. Express satisfaction that he's developing good habits

Generate ONLY Sarah's next message. No commentary.`,
      initialMessage: "What about the budget part? Is he actually learning about money, or is he just going through the motions?",
      maxTurns: 6,
      expectedTools: ["read_scout_budget", "read_scout_summary"],
      evaluationWeights: {
        requirement_accuracy: 0.25,
        state_management: 0.20,
        engagement_quality: 0.25,
        scope_adherence: 0.15,
        socratic_method: 0.05,
        character_consistency: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Guide should call read_scout_budget and/or read_scout_summary. Key facts: " +
        "4 weeks tracked of 13, $120 saved toward $800 Gaming PC (15%), savings on track " +
        "with projected $21/week. Guide should connect the tracking to real financial " +
        "literacy skills (budgeting, discipline, planning). Should NOT just recite numbers — " +
        "should explain what the numbers mean for a parent audience.",
      expectedMutations: [],
    },

    // ─── Step 4: What's next ──────────────────────────────────
    {
      id: "ask-next-steps",
      description:
        "Parent asks what Will should focus on next and how they can help. " +
        "Guide should read requirements, identify actionable items, and " +
        "suggest parent involvement opportunities.",
      scoutSimPrompt: `You are Sarah, Will's mom, wanting to know how you can help.

YOUR PERSONALITY: Wants to be involved without being overbearing.

CONVERSATION FLOW:
1. Ask what he should be working on next
2. Ask if there's anything you can do to help as a parent
3. Thank them and wrap up

Generate ONLY Sarah's next message. No commentary.`,
      initialMessage: "So what should he be focusing on next? And is there anything I can do to help?",
      maxTurns: 6,
      expectedTools: ["read_scout_requirements"],
      evaluationWeights: {
        requirement_accuracy: 0.30,
        state_management: 0.15,
        engagement_quality: 0.20,
        scope_adherence: 0.15,
        socratic_method: 0.10,
        character_consistency: 0.05,
        ypt_compliance: 0.05,
      },
      evaluatorContext:
        "Guide should call read_scout_requirements to see what's available. Key parent " +
        "involvement opportunities: pm_1b (savings plan) involves family purchase decisions, " +
        "fl_4 (individual home project) needs parent_verify, fl_6b (family meetings) needs " +
        "parent involvement. Guide should suggest specific ways Sarah can help without " +
        "doing Will's work for him. Should respect scout agency while giving actionable " +
        "suggestions for the parent.",
      expectedMutations: [],
    },
  ],
};

export default chain;
