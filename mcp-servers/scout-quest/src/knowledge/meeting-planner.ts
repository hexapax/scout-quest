// Troop advancement summary and meeting activity suggestions
// Queries scoutbook_* collections for aggregate views

import { scoutbookScouts, scoutbookAdvancement, scoutbookRequirements } from "../scoutbook/collections.js";

const RANK_NAMES: Record<number, string> = {
  1: "Scout", 2: "Tenderfoot", 3: "Second Class", 4: "First Class",
  5: "Star", 6: "Life", 7: "Eagle",
};

export async function getTroopAdvancementSummary(
  filters?: { rank?: string; eagleCandidatesOnly?: boolean },
): Promise<string> {
  const scoutsCol = await scoutbookScouts();
  const advCol = await scoutbookAdvancement();

  const scouts = await scoutsCol
    .find({})
    .sort({ "currentRank.id": -1, lastName: 1 })
    .toArray();

  const lines: string[] = ["# Troop Advancement Summary\n"];
  lines.push("| Scout | Age | Current Rank | Eagle MBs Earned | Total MBs |");
  lines.push("|-------|-----|-------------|-----------------|-----------|");

  for (const s of scouts) {
    if (filters?.rank && s.currentRank?.name?.toLowerCase() !== filters.rank.toLowerCase()) continue;
    if (filters?.eagleCandidatesOnly) {
      const rankId = s.currentRank?.id || 0;
      if (rankId < 6) continue; // Life or Eagle only
    }

    const eagleMBs = await advCol.countDocuments({
      userId: s.userId,
      type: "meritBadge",
      isEagleRequired: true,
      $or: [{ status: "Awarded" }, { status: "Completed" }],
    });
    const totalMBs = await advCol.countDocuments({
      userId: s.userId,
      type: "meritBadge",
      $or: [{ status: "Awarded" }, { status: "Completed" }],
    });

    const rank = s.currentRank?.name || "None";
    const name = `${s.firstName} ${s.lastName}`;
    lines.push(`| ${name} | ${s.age || "?"} | ${rank} | ${eagleMBs}/14 | ${totalMBs} |`);
  }

  // Add activity summary
  const campingScouts = scouts.filter(
    (s) => (s.activitySummary?.campingNights ?? 0) > 0,
  );
  const avgNights =
    campingScouts.length > 0
      ? (
          campingScouts.reduce((sum, s) => sum + (s.activitySummary?.campingNights || 0), 0) /
          campingScouts.length
        ).toFixed(1)
      : "0";

  lines.push(`\n**Troop Stats:** ${scouts.length} scouts, avg ${avgNights} camping nights`);

  return lines.join("\n");
}

export async function suggestMeetingActivities(
  durationMinutes: number,
  focus?: string,
): Promise<string> {
  const reqCol = await scoutbookRequirements();
  const scoutsCol = await scoutbookScouts();

  // Find most-needed incomplete requirements across all scouts
  const pipeline = [
    { $match: { completed: false, advancementType: "rank" } },
    {
      $group: {
        _id: { advancementId: "$advancementId", reqNumber: "$reqNumber", reqName: "$reqName" },
        count: { $sum: 1 },
        scouts: { $push: "$userId" },
      },
    },
    { $sort: { count: -1 as const } },
    { $limit: 20 },
  ];

  const gaps = await reqCol.aggregate(pipeline).toArray();

  const lines: string[] = [
    `# Meeting Activity Suggestions (${durationMinutes} minutes)\n`,
  ];

  if (gaps.length > 0) {
    lines.push("## Requirements Most Scouts Need\n");
    lines.push("| # Scouts | Rank | Requirement |");
    lines.push("|----------|------|-------------|");

    for (const gap of gaps.slice(0, 15)) {
      const rankName = RANK_NAMES[gap._id.advancementId as number] || `Rank ${gap._id.advancementId}`;
      lines.push(`| ${gap.count} | ${rankName} | ${gap._id.reqNumber} ${gap._id.reqName} |`);
    }
  }

  // Categorize requirements by what can be done at a meeting
  lines.push(`\n## Activity Categories\n`);
  lines.push(`**Discussion-based (can sign off at meeting):** Scout spirit, personal safety, bullying awareness, substance abuse, financial literacy, Leave No Trace principles, hiking safety discussions.`);
  lines.push(`\n**Skills practice (can teach and sign off):** First aid, knots, compass/navigation, fire building basics, flag ceremonies.`);
  lines.push(`\n**Needs field/home (cannot do at meeting):** Camping overnight, hiking 5+ miles, swimming, 30-day fitness plans, 90-day chore logs, cooking on campouts.`);

  lines.push(`\n## Suggested ${durationMinutes}-Minute Plan\n`);
  if (durationMinutes <= 30) {
    lines.push("- **Option A:** Discussion circle — sign off Scout spirit, personal safety, and Leave No Trace for multiple scouts (10 min each topic)");
    lines.push("- **Option B:** Scoutmaster conferences — 3 quick SM conferences at 7-8 min each");
    lines.push("- **Option C:** Skills demo — one older scout teaches one skill (knots, first aid) using EDGE method");
  } else if (durationMinutes <= 60) {
    lines.push("- **Option A:** Skills rotation — 2 stations, 20 min each, plus 10 min opening/closing");
    lines.push("- **Option B:** Merit badge work session — focus on one Eagle-required MB that multiple scouts need");
    lines.push("- **Option C:** Mix of SM conferences (20 min) + group skills practice (30 min)");
  } else {
    lines.push("- **Option A:** Full skills stations — 3-4 stations with older scouts teaching younger scouts (EDGE method)");
    lines.push("- **Option B:** Board of Review night — BORs + advancement ceremonies");
    lines.push("- **Option C:** Merit badge clinic — focused session on a high-demand Eagle-required badge");
  }

  return lines.join("\n");
}
