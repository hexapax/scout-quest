import { graphQuery, isFalkorConnected } from "../falkordb.js";

const RANK_ORDER: Record<string, number> = {
  Scout: 1,
  Tenderfoot: 2,
  "Second Class": 3,
  "First Class": 4,
  Star: 5,
  Life: 6,
  Eagle: 7,
};

export async function getScoutStatus(
  userId: string,
  scope: string,
  rankName?: string
): Promise<string> {
  if (!isFalkorConnected()) {
    return "Knowledge graph not available yet — advancement data is still loading.";
  }

  try {
    switch (scope) {
      case "summary":
        return await getSummary(userId);
      case "rank_progress":
        return await getRankProgress(userId);
      case "rank_requirements":
        if (!rankName) return "rank_name is required for scope=rank_requirements.";
        return await getRankRequirements(userId, rankName);
      case "merit_badges":
        return await getMeritBadges(userId);
      default:
        return "Unknown scope. Use: summary, rank_progress, rank_requirements, or merit_badges.";
    }
  } catch (err) {
    console.error("get_scout_status error:", err);
    return "Unable to query advancement data at this time.";
  }
}

async function getSummary(userId: string): Promise<string> {
  const ranks = await graphQuery<{
    name: string;
    level: number;
    status: string;
    percentCompleted: number;
    dateCompleted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) " +
      "RETURN a.name AS name, a.level AS level, r.status AS status, " +
      "r.percentCompleted AS percentCompleted, r.dateCompleted AS dateCompleted " +
      "ORDER BY a.level",
    { userId }
  );

  const badges = await graphQuery<{ name: string; status: string; dateCompleted: string | null }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) " +
      "RETURN a.name AS name, r.status AS status, r.dateCompleted AS dateCompleted",
    { userId }
  );

  if (ranks.length === 0 && badges.length === 0) {
    return "No advancement data found in the knowledge graph for this scout.";
  }

  const lines: string[] = ["ADVANCEMENT SUMMARY\n"];

  const earnedRanks = ranks.filter((r) => r.dateCompleted);
  const inProgressRanks = ranks.filter((r) => !r.dateCompleted && r.percentCompleted > 0);

  if (earnedRanks.length > 0) {
    lines.push(
      `Earned ranks: ${earnedRanks.map((r) => `${r.name} (${r.dateCompleted?.substring(0, 10)})`).join(", ")}`
    );
  }
  if (inProgressRanks.length > 0) {
    for (const r of inProgressRanks) {
      lines.push(`In progress: ${r.name} — ${r.percentCompleted}% complete`);
    }
  }

  const earnedBadges = badges.filter((b) => b.dateCompleted).length;
  const inProgressBadges = badges.filter((b) => !b.dateCompleted).length;
  lines.push(`\nMerit badges: ${earnedBadges} earned, ${inProgressBadges} in progress`);

  return lines.join("\n");
}

async function getRankProgress(userId: string): Promise<string> {
  const ranks = await graphQuery<{
    name: string;
    level: number;
    status: string;
    percentCompleted: number;
    dateCompleted: string | null;
    dateStarted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) " +
      "RETURN a.name AS name, a.level AS level, r.status AS status, " +
      "r.percentCompleted AS percentCompleted, r.dateCompleted AS dateCompleted, " +
      "r.dateStarted AS dateStarted ORDER BY a.level",
    { userId }
  );

  if (ranks.length === 0) {
    return "No rank data found in the knowledge graph.";
  }

  const lines = ["RANK PROGRESS\n"];
  for (const r of ranks) {
    const date = r.dateCompleted
      ? `earned ${r.dateCompleted.substring(0, 10)}`
      : r.dateStarted
        ? `started ${r.dateStarted.substring(0, 10)}, ${r.percentCompleted}% done`
        : "not started";
    lines.push(`${r.name}: ${date}`);
  }
  return lines.join("\n");
}

async function getRankRequirements(userId: string, rankName: string): Promise<string> {
  // Get the advancementId for this rank
  const rankRows = await graphQuery<{ advancementId: number }>(
    "MATCH (a:Advancement {type: 'rank', name: $rankName}) RETURN a.advancementId AS advancementId",
    { rankName }
  );

  if (rankRows.length === 0) {
    return `Rank "${rankName}" not found in the knowledge graph.`;
  }

  const advancementId = String(rankRows[0].advancementId);

  // All requirements for this rank
  const allReqs = await graphQuery<{
    reqId: number;
    reqNumber: string;
    reqName: string;
    parentReqId: number | null;
  }>(
    "MATCH (req:Requirement {advancementId: $advancementId}) " +
      "RETURN req.reqId AS reqId, req.reqNumber AS reqNumber, " +
      "req.reqName AS reqName, req.parentReqId AS parentReqId " +
      "ORDER BY req.reqNumber",
    { advancementId }
  );

  // Completed requirements for this scout
  const completedRows = await graphQuery<{ reqId: number }>(
    "MATCH (s:Scout {userId: $userId})-[:COMPLETED_REQ]->(req:Requirement {advancementId: $advancementId}) " +
      "RETURN req.reqId AS reqId",
    { userId, advancementId }
  );
  const completedIds = new Set(completedRows.map((r) => String(r.reqId)));

  // Format: top-level reqs only (parentReqId == null or top-level subreqs)
  const topLevel = allReqs.filter((r) => r.parentReqId == null);
  const remaining = topLevel.filter((r) => !completedIds.has(String(r.reqId)));
  const done = topLevel.filter((r) => completedIds.has(String(r.reqId)));

  const lines = [`${rankName.toUpperCase()} REQUIREMENTS\n`];

  if (done.length > 0) {
    lines.push(`Completed (${done.length}):`);
    for (const r of done) {
      lines.push(`  ✓ ${r.reqNumber}. ${r.reqName}`);
    }
    lines.push("");
  }

  if (remaining.length > 0) {
    lines.push(`Still needed (${remaining.length}):`);
    for (const r of remaining) {
      lines.push(`  ○ ${r.reqNumber}. ${r.reqName}`);
    }
  } else {
    lines.push("All requirements complete!");
  }

  lines.push(`\nOverall: ${done.length}/${topLevel.length} requirements done`);
  return lines.join("\n");
}

async function getMeritBadges(userId: string): Promise<string> {
  const badges = await graphQuery<{
    name: string;
    status: string;
    percentCompleted: number;
    dateCompleted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) " +
      "RETURN a.name AS name, r.status AS status, r.percentCompleted AS percentCompleted, " +
      "r.dateCompleted AS dateCompleted ORDER BY a.name",
    { userId }
  );

  if (badges.length === 0) {
    return "No merit badge data found.";
  }

  const earned = badges.filter((b) => b.dateCompleted);
  const inProgress = badges.filter((b) => !b.dateCompleted);

  const lines = ["MERIT BADGES\n"];

  if (earned.length > 0) {
    lines.push(`Earned (${earned.length}):`);
    for (const b of earned) {
      lines.push(`  ✓ ${b.name} (${b.dateCompleted?.substring(0, 10)})`);
    }
    lines.push("");
  }

  if (inProgress.length > 0) {
    lines.push(`In progress (${inProgress.length}):`);
    for (const b of inProgress) {
      lines.push(`  → ${b.name}: ${b.percentCompleted}%`);
    }
  }

  return lines.join("\n");
}
