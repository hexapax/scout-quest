/**
 * Scout Simulator — uses an LLM to generate realistic scout messages.
 *
 * The simulator plays the role of a teenager interacting with the AI coaching
 * system.  It does NOT interact with the MCP server directly; it produces
 * text that the test runner sends to the model-under-test.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ScenarioDefinition, TranscriptMessage } from "./types.js";

export class ScoutSimulator {
  private client: Anthropic;
  private model: string;

  constructor(config: { model: string; apiKey: string }) {
    this.model = config.model;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  /**
   * Generate the next scout message given the scenario and conversation
   * history.  Returns the raw text the scout would say.
   */
  async generateResponse(
    scenario: ScenarioDefinition,
    history: TranscriptMessage[],
  ): Promise<string> {
    // On the first turn, use the scenario's initial message
    if (history.length === 0) {
      return scenario.initialMessage;
    }

    // Build conversation for the simulator
    const messages: Anthropic.MessageParam[] = [];
    for (const msg of history) {
      messages.push({
        role: msg.role === "scout" ? "assistant" : "user",
        content: msg.content,
      });
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system: scenario.scoutSimPrompt,
      messages,
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text?.trim() || "ok";
  }
}
