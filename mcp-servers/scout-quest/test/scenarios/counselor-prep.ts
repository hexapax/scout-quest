import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "counselor-prep",
  name: "Counselor Meeting Preparation",
  description:
    "The scout has a counselor meeting coming up and needs help preparing. The AI should review which requirements are ready for submission, help the scout organize what to present, and potentially call compose_email to schedule the meeting (with parent CC for YPT). Tests coaching quality, email YPT compliance, and requirement knowledge.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who has a merit badge counselor meeting soon.

YOUR PERSONALITY:
- Engagement level: 3 (slightly nervous about the meeting)
- Doesn't know exactly what to bring or say
- Asks practical questions: "what do I need?", "what will they ask?"

CONVERSATION FLOW:
1. Say you have a meeting with your Personal Management counselor next week
2. Ask what requirements you should present
3. When the coach suggests preparing, ask for help drafting an email to schedule
4. Provide basic details when asked (preferred day, etc.)
5. React to the email draft

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "I have a meeting with Mr. Chen next week for Personal Management. What do I need to bring?",
  maxTurns: 8,
  expectedTools: ["compose_email", "update_quest_plan"],
  evaluationWeights: {
    requirement_accuracy: 0.25,
    socratic_method: 0.20,
    ypt_compliance: 0.20,
    state_management: 0.15,
    engagement_quality: 0.10,
    character_consistency: 0.05,
    scope_adherence: 0.05,
  },
};

export default scenario;
