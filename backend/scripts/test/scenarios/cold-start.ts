/**
 * cold-start: empty DB → all read paths return empty, sweeper finds nothing.
 *
 * Establishes the baseline: with no prior data, none of the memory machinery
 * leaks anything. If this fails, something is reading from prod.
 */

import type { Scenario } from "../lib/scenario.js";

const SCOUT_EMAIL = "liam@test.example";

export const scenario: Scenario = {
  name: "cold-start",
  description: "Empty DB — all read paths return empty, sweeper has nothing to do",

  async seed(_ctx) {
    // Intentionally nothing — this is the baseline.
  },

  async run({ check }) {
    const { getRecentEpisodes } = await import("../../../src/episodes.js");
    const { getRecentSummariesForScout, getConversationSummary } = await import(
      "../../../src/conversation-summary.js"
    );
    const { runSummarySweep } = await import("../../../src/cron/summary-sweeper.js");
    const { ObjectId } = await import("mongodb");

    const eps = await getRecentEpisodes(SCOUT_EMAIL);
    check("getRecentEpisodes returns []", eps.length === 0, eps);

    const summaries = await getRecentSummariesForScout(SCOUT_EMAIL);
    check("getRecentSummariesForScout returns []", summaries.length === 0, summaries);

    const single = await getConversationSummary(new ObjectId());
    check("getConversationSummary returns null for unknown id", single === null);

    const sweep = await runSummarySweep();
    check(
      "runSummarySweep finds 0 candidates on empty DB",
      sweep.scanned === 0 && sweep.captured === 0,
      sweep,
    );
  },
};
