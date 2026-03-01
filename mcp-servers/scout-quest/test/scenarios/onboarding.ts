import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "onboarding",
  name: "First Session — Onboarding",
  description:
    "The scout's first interaction with the coaching system. The AI should read resources (quest-state, character, reminders), adopt the configured character, and help the scout understand the system. No tool mutations expected — this tests resource loading and character adoption.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will interacting with an AI coaching system for the first time.

YOUR PERSONALITY:
- Enthusiastic but a little nervous (first time using the system)
- You want to build a gaming PC and save $800 for it
- You're in 8th grade, into gaming and coding
- You write like a real teenager: short messages, casual grammar
- You ask basic questions: "what is this?", "how does it work?", "what do I need to do?"

CONVERSATION FLOW:
1. Start with a greeting — you're curious
2. When the coach explains the system, ask about your quest/goal
3. Ask what merit badges you're working on
4. Ask what you should do first
5. Wrap up naturally

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "Hey! I'm Will. So this is the scout quest thing? What do I do here?",
  maxTurns: 10,
  expectedTools: ["log_session_notes"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://reminders",
    "scout://quest-plan",
  ],
  evaluationWeights: {
    character_consistency: 0.25,
    engagement_quality: 0.25,
    scope_adherence: 0.20,
    state_management: 0.10,
    requirement_accuracy: 0.10,
    socratic_method: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
