/**
 * safety-classifier-parser: pure-function tests for the JSON parser inside
 * `classifier.ts`. We don't call Anthropic here — that's an LLM-flagged
 * scenario for later. This pins parser robustness against shapes the model
 * tends to emit (markdown code fences, leading prose, etc.).
 */

import type { Scenario } from "../lib/scenario.js";

export const scenario: Scenario = {
  name: "safety-classifier-parser",
  description: "parseRiskVector handles canonical and ragged classifier outputs",

  async seed() {
    /* pure unit test */
  },

  async run({ check }) {
    const { parseRiskVector } = await import("../../../src/safety/classifier.js");

    // Canonical clean JSON.
    {
      const out = parseRiskVector(`{"category":"bullying","severity":2,"confidence":0.8,"initiator":"scout","quote":"kids tease me"}`);
      check(
        "clean JSON parses",
        out?.category === "bullying" &&
        out?.severity === 2 &&
        Math.abs((out?.confidence ?? 0) - 0.8) < 1e-6 &&
        out?.initiator === "scout" &&
        out?.quote === "kids tease me",
        out,
      );
    }

    // JSON wrapped in prose.
    {
      const out = parseRiskVector(
        `Here is the classification: {"category":"none","severity":1,"confidence":1.0,"initiator":"scout","quote":""}`
      );
      check("JSON-with-prose extracts", out?.category === "none", out);
    }

    // Markdown code fence.
    {
      const out = parseRiskVector(
        '```json\n{"category":"family_conflict","severity":2,"confidence":0.7,"initiator":"scout","quote":"parents fight"}\n```'
      );
      check("markdown-fenced JSON extracts", out?.category === "family_conflict", out);
    }

    // Severity outside 1-3 → clamped to 1
    {
      const out = parseRiskVector(`{"category":"self_harm","severity":7,"confidence":0.9,"initiator":"scout","quote":"x"}`);
      check("severity out of range clamps to 1", out?.severity === 1, out);
    }

    // Confidence outside 0-1 → clamped
    {
      const a = parseRiskVector(`{"category":"bullying","severity":2,"confidence":2.5,"initiator":"scout","quote":"x"}`);
      const b = parseRiskVector(`{"category":"bullying","severity":2,"confidence":-1,"initiator":"scout","quote":"x"}`);
      check("confidence > 1 clamps to 1", a?.confidence === 1, a);
      check("confidence < 0 clamps to 0", b?.confidence === 0, b);
    }

    // Unknown category → reject
    {
      const out = parseRiskVector(`{"category":"frog","severity":2,"confidence":0.9,"initiator":"scout","quote":"x"}`);
      check("unknown category returns null", out === null, out);
    }

    // Bad initiator → defaults to "scout"
    {
      const out = parseRiskVector(`{"category":"bullying","severity":2,"confidence":0.9,"initiator":"alien","quote":"x"}`);
      check("unknown initiator defaults to scout", out?.initiator === "scout", out);
    }

    // Quote longer than 280 chars truncates.
    {
      const longQuote = "a".repeat(500);
      const out = parseRiskVector(`{"category":"bullying","severity":2,"confidence":0.9,"initiator":"scout","quote":"${longQuote}"}`);
      check("quote longer than 280 chars truncates", out?.quote?.length === 280, out?.quote?.length);
    }

    // No JSON at all → null
    {
      const out = parseRiskVector("the model said nothing useful here");
      check("no JSON in response → null", out === null, out);
    }

    // Empty string → null
    {
      check("empty string → null", parseRiskVector("") === null);
    }
  },
};
