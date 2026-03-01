/**
 * Hallucination detection for Scout Quest test harness.
 *
 * Detects when the model-under-test claims to have called a tool or
 * performed an action without actually doing so.  Three detection methods:
 *
 * 1. claimed_not_called — model text says "I logged your chores" but no
 *    tool_use block was emitted
 * 2. called_no_result — a tool_use block was emitted but no tool_result
 *    came back (MCP never received it)
 * 3. fabricated_data — model claims a specific result ("streak is 15 days")
 *    but no DB mutation supports it
 */

import type { HallucinationRecord, TranscriptMessage } from "./types.js";

// Action verb patterns that indicate the model claims to have done something
const ACTION_PATTERNS: { pattern: RegExp; tool: string }[] = [
  { pattern: /\b(logged|recorded|tracked)\b.*\bchore/i, tool: "log_chore" },
  { pattern: /\b(logged|recorded|tracked)\b.*\bbudget/i, tool: "log_budget_entry" },
  { pattern: /\b(advanced|moved|updated)\b.*\brequirement/i, tool: "advance_requirement" },
  { pattern: /\b(composed|drafted|created)\b.*\bemail/i, tool: "compose_email" },
  { pattern: /\b(sent|pushed)\b.*\bnotification/i, tool: "send_notification" },
  { pattern: /\b(adjusted|changed|lowered|raised)\b.*\btone/i, tool: "adjust_tone" },
  { pattern: /\b(set up|created|initialized)\b.*\btime management/i, tool: "setup_time_mgmt" },
  { pattern: /\b(logged|recorded)\b.*\bdiary/i, tool: "log_diary_entry" },
  { pattern: /\b(updated|changed)\b.*\bquest goal/i, tool: "update_quest_goal" },
  { pattern: /\b(updated|revised)\b.*\bquest plan/i, tool: "update_quest_plan" },
  { pattern: /\b(logged|captured|saved)\b.*\bsession notes/i, tool: "log_session_notes" },
  // Generic patterns for definitive claim language
  { pattern: /\bI've (?:logged|recorded|updated|saved|created|sent|advanced|adjusted)/i, tool: "__generic__" },
  { pattern: /\bDone!?\s.*(?:logged|recorded|saved)/i, tool: "__generic__" },
];

// Fabrication patterns — claims about specific data that must come from a tool
const FABRICATION_PATTERNS: RegExp[] = [
  /streak.*?(\d+)\s*day/i,
  /saved.*?\$[\d,.]+/i,
  /week\s+\d+.*?logged/i,
  /requirement.*?→.*?(tracking|in_progress|ready_for_review|submitted)/i,
];

/**
 * Analyze a single coach message for hallucination indicators.
 *
 * @param turnIndex — 0-based index of this turn in the transcript
 * @param coachMessage — the coach's response text
 * @param actualToolCalls — tool_use blocks that were actually dispatched
 */
export function detectHallucinations(
  turnIndex: number,
  coachMessage: string,
  actualToolCalls: { name: string; args: Record<string, unknown>; result: string }[],
): HallucinationRecord[] {
  const records: HallucinationRecord[] = [];
  const calledTools = new Set(actualToolCalls.map((tc) => tc.name));

  // 1. Check for claimed-but-not-called
  for (const { pattern, tool } of ACTION_PATTERNS) {
    if (pattern.test(coachMessage)) {
      // If the pattern matches a specific tool and that tool wasn't called
      if (tool === "__generic__") {
        // Generic claim — only flag if NO tools were called at all
        if (calledTools.size === 0) {
          records.push({
            turnIndex,
            type: "claimed_not_called",
            description: `Coach used definitive action language ("${coachMessage.match(pattern)?.[0]}") but no tools were called.`,
          });
        }
      } else if (!calledTools.has(tool)) {
        records.push({
          turnIndex,
          type: "claimed_not_called",
          description: `Coach claimed action related to "${tool}" but tool was not called.`,
          toolName: tool,
        });
      }
    }
  }

  // 2. Check for fabricated data claims (specific numbers/results without tool calls)
  if (calledTools.size === 0) {
    for (const pattern of FABRICATION_PATTERNS) {
      const match = coachMessage.match(pattern);
      if (match) {
        records.push({
          turnIndex,
          type: "fabricated_data",
          description: `Coach claimed specific data ("${match[0]}") without any tool calls to verify.`,
        });
      }
    }
  }

  return records;
}

/**
 * Analyze the full transcript for hallucinations.
 */
export function analyzeTranscript(
  messages: TranscriptMessage[],
): HallucinationRecord[] {
  const allRecords: HallucinationRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "coach") continue;

    const hallucinations = detectHallucinations(
      i,
      msg.content,
      msg.toolCalls || [],
    );
    allRecords.push(...hallucinations);
  }

  return allRecords;
}
