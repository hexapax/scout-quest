// Structured queries for rank requirements and merit badge info
// Merges reference text (scoutbook_reference) with per-scout completion (scoutbook_requirements)

import { getDb } from "../db.js";
import { scoutbookScouts, scoutbookRequirements, scoutbookAdvancement } from "../scoutbook/collections.js";

const RANK_IDS: Record<string, number> = {
  scout: 1,
  tenderfoot: 2,
  "second-class": 3,
  "second class": 3,
  "first-class": 4,
  "first class": 4,
  star: 5,
  life: 6,
  eagle: 7,
  "eagle scout": 7,
};

export async function getRankRequirements(rank: string, scoutId?: string): Promise<string> {
  const rankId = RANK_IDS[rank.toLowerCase()];
  if (!rankId)
    return `Unknown rank: "${rank}". Valid ranks: ${Object.keys(RANK_IDS).join(", ")}`;

  const db = await getDb();
  const refCol = db.collection("scoutbook_reference");

  // Get reference requirement text
  const refs = await refCol
    .find({ type: "rank_requirement", rankId })
    .sort({ sortOrder: 1 })
    .toArray();

  if (refs.length === 0) {
    return `No reference data found for rank "${rank}". The scoutbook_reference collection may need to be populated.`;
  }

  const rankName = refs[0].rankName || rank;
  const lines: string[] = [`# ${rankName} Rank Requirements\n`];

  // If scout specified, get their completion status
  const scoutReqs = new Map<string, { completed: boolean; started: boolean; dateCompleted?: string }>();
  let scoutName = "";

  if (scoutId) {
    const scoutsCol = await scoutbookScouts();
    const scout = await scoutsCol.findOne({ userId: scoutId });
    scoutName = scout ? `${scout.firstName} ${scout.lastName}` : `userId ${scoutId}`;

    const reqCol = await scoutbookRequirements();
    const reqs = await reqCol
      .find({ userId: scoutId, advancementType: "rank", advancementId: rankId })
      .toArray();
    for (const r of reqs) {
      scoutReqs.set(r.reqNumber, {
        completed: r.completed,
        started: r.started,
        dateCompleted: r.dateCompleted,
      });
    }

    lines.push(`**Scout:** ${scoutName}`);
    const done = [...scoutReqs.values()].filter((r) => r.completed).length;
    lines.push(`**Progress:** ${done}/${refs.length} requirements completed\n`);
  }

  for (const ref of refs) {
    const reqNum = ref.reqNumber || "";
    if (!reqNum) continue; // skip header/parent entries without a number

    const status = scoutReqs.get(reqNum);
    const icon = status?.completed ? "✅" : status?.started ? "🔄" : "⬜";
    const dateStr = status?.dateCompleted ? ` (completed ${status.dateCompleted})` : "";

    lines.push(`${icon} **${reqNum}.** ${ref.fullText}${dateStr}\n`);
  }

  return lines.join("\n");
}

export async function getMeritBadgeInfo(meritBadge: string, scoutId?: string): Promise<string> {
  const db = await getDb();
  const refCol = db.collection("scoutbook_reference");

  const mbRef = await refCol.findOne({
    type: "merit_badge",
    name: { $regex: new RegExp(`^${meritBadge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });

  if (!mbRef) return `Merit badge "${meritBadge}" not found in reference data.`;

  const lines: string[] = [
    `# ${mbRef.name} Merit Badge\n`,
    mbRef.isEagleRequired ? "**Eagle-Required: Yes**" : "**Eagle-Required: No**",
    `**Category:** ${mbRef.categoryName || "Unknown"}`,
  ];

  if (mbRef.description) lines.push(`\n${mbRef.description}`);
  if (mbRef.worksheetPDF) lines.push(`\n**Worksheet:** ${mbRef.worksheetPDF}`);

  if (scoutId) {
    const scoutsCol = await scoutbookScouts();
    const scout = await scoutsCol.findOne({ userId: scoutId });
    const name = scout ? `${scout.firstName} ${scout.lastName}` : scoutId;

    const advCol = await scoutbookAdvancement();
    const progress = await advCol.findOne({
      userId: scoutId,
      type: "meritBadge",
      name: { $regex: new RegExp(`^${meritBadge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    });

    if (progress) {
      const pct = progress.percentCompleted ?? 0;
      lines.push(`\n**${name}'s Progress:** ${(pct * 100).toFixed(0)}% | Status: ${progress.status}`);
      if (progress.dateStarted) lines.push(`Started: ${progress.dateStarted}`);
      if (progress.dateAwarded) lines.push(`Awarded: ${progress.dateAwarded}`);
    } else {
      lines.push(`\n**${name}:** Not started`);
    }
  }

  return lines.join("\n");
}
