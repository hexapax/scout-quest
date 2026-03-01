/**
 * Hallucination detection logic.
 *
 * A tool call is classified as "hallucinated" when:
 * 1. The model's response text describes calling a tool but no tool_use block
 *    was emitted (claimed_not_called)
 * 2. A tool_use block was emitted but no tool_result came back — the tool
 *    was never actually executed (called_no_result)
 * 3. The model claims a result (e.g. "Your streak is 15 days") but no
 *    matching DB mutation occurred (fabricated_data)
 */

import type { HallucinationRecord, ToolCallRecord } from "../types.js";

// ---------------------------------------------------------------------------
// Action verbs that indicate a model claims it performed a tool action
// ---------------------------------------------------------------------------

const TOOL_ACTION_PATTERNS: Array<{ pattern: RegExp; toolName: string }> = [
  { pattern: /\b(logged|recorded|saved)\s+(your\s+)?chore/i, toolName: "log_chore" },
  { pattern: /\b(logged|recorded|saved)\s+(your\s+)?budget/i, toolName: "log_budget_entry" },
  { pattern: /\b(advanced|updated|moved)\s+(the\s+)?requirement/i, toolName: "advance_requirement" },
  { pattern: /\b(composed|generated|created)\s+(an?\s+)?email/i, toolName: "compose_email" },
  { pattern: /\b(sent|pushed)\s+(a\s+)?notification/i, toolName: "send_notification" },
  { pattern: /\b(adjusted|changed|updated)\s+(the\s+)?tone/i, toolName: "adjust_tone" },
  { pattern: /\b(set\s+up|created)\s+(your\s+)?schedule/i, toolName: "setup_time_mgmt" },
  { pattern: /\b(logged|recorded)\s+(your\s+)?diary/i, toolName: "log_diary_entry" },
  { pattern: /\b(updated|changed)\s+(your\s+)?goal/i, toolName: "update_quest_goal" },
  { pattern: /\b(updated|changed)\s+(the\s+)?plan/i, toolName: "update_quest_plan" },
  { pattern: /\b(logged|recorded|saved)\s+(the\s+)?session\s+notes/i, toolName: "log_session_notes" },
  { pattern: /\bI'?ve\s+(logged|recorded|saved|updated|advanced|composed|sent|adjusted)/i, toolName: "_generic" },
];

// ---------------------------------------------------------------------------
// Detect hallucinations
// ---------------------------------------------------------------------------

export function detectHallucinations(opts: {
  turnIndex: number;
  responseText: string;
  toolCallsMade: ToolCallRecord[];
  expectedTools: string[];
}): HallucinationRecord[] {
  const records: HallucinationRecord[] = [];
  const actualToolNames = new Set(opts.toolCallsMade.map((tc) => tc.name));

  // Type 1: Model claims action but no tool call was made
  for (const { pattern, toolName } of TOOL_ACTION_PATTERNS) {
    if (toolName === "_generic") continue; // skip generic pattern for specific detection
    if (pattern.test(opts.responseText) && !actualToolNames.has(toolName)) {
      records.push({
        turnIndex: opts.turnIndex,
        type: "claimed_not_called",
        description: `Response claims "${toolName}" action but no tool_use block was emitted`,
        toolName,
      });
    }
  }

  // Type 2: Tool was called but produced no result (empty result string)
  for (const tc of opts.toolCallsMade) {
    if (!tc.result || tc.result.trim() === "") {
      records.push({
        turnIndex: opts.turnIndex,
        type: "called_no_result",
        description: `Tool "${tc.name}" was called but returned empty result`,
        toolName: tc.name,
      });
    }
  }

  // Type 3: Fabricated data — check for specific claim patterns
  // Streak claims
  const streakMatch = opts.responseText.match(
    /streak\s+(?:is|of)\s+(\d+)\s+days?/i,
  );
  if (streakMatch && !actualToolNames.has("log_chore")) {
    // If the model claims a specific streak but didn't call any chore-related tool,
    // flag it as potentially fabricated (evaluator will verify against DB)
    records.push({
      turnIndex: opts.turnIndex,
      type: "fabricated_data",
      description: `Claims streak of ${streakMatch[1]} days without reading chore data from a tool`,
      toolName: "log_chore",
    });
  }

  // Savings claims
  const savingsMatch = opts.responseText.match(
    /savings?\s+(?:is|are|total|balance)[:\s]+\$?([\d,.]+)/i,
  );
  if (
    savingsMatch &&
    !actualToolNames.has("log_budget_entry") &&
    !actualToolNames.has("update_quest_goal")
  ) {
    records.push({
      turnIndex: opts.turnIndex,
      type: "fabricated_data",
      description: `Claims savings of $${savingsMatch[1]} without tool call to verify`,
      toolName: "log_budget_entry",
    });
  }

  return records;
}

/**
 * Check whether any hallucinations are critical (tool_use hallucination
 * is always critical per plan Section 4b).
 */
export function hasCriticalHallucinations(
  records: HallucinationRecord[],
): boolean {
  return records.some((r) => r.type === "claimed_not_called");
}
