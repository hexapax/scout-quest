import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "off-topic",
  name: "Off-Topic — Scope Adherence",
  description:
    "The scout asks for help with math homework (outside scope). The AI should politely redirect to its actual purpose (merit badge coaching and quest management) without being dismissive. No tool calls expected. Tests scope adherence and engagement quality.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who is trying to use the AI for homework help.

YOUR PERSONALITY:
- Engagement level: 2 (distracted, not really focused on scouting)
- Tries to use the AI as a general assistant
- Mildly pushes back when redirected ("come on, just this once")
- Eventually accepts the redirect

CONVERSATION FLOW:
1. Ask for help with math homework (algebra)
2. When redirected, push back gently: "come on you're an AI, can't you just help?"
3. Accept the redirect and ask about your quest instead
4. Brief engagement with actual scouting content

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "hey can you help me with my math homework? i have this algebra problem i don't get",
  maxTurns: 6,
  expectedTools: [],
  evaluationWeights: {
    scope_adherence: 0.35,
    engagement_quality: 0.25,
    character_consistency: 0.15,
    socratic_method: 0.10,
    state_management: 0.05,
    requirement_accuracy: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
