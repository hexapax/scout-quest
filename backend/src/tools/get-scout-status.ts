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
  rankName?: string,
  badgeName?: string
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
        return await getRequirements(userId, rankName, "rank");
      case "merit_badges":
        return await getMeritBadges(userId);
      case "badge_requirements":
        if (!badgeName) return "badge_name is required for scope=badge_requirements.";
        return await getRequirements(userId, badgeName, "meritBadge");
      case "awards":
        return await getAwards(userId);
      case "eagle_progress":
        return await getEagleProgress(userId);
      default:
        return "Unknown scope. Use: summary, rank_progress, rank_requirements, merit_badges, badge_requirements, awards, or eagle_progress.";
    }
  } catch (err) {
    console.error("get_scout_status error:", err);
    return "Unable to query advancement data at this time.";
  }
}

/** Format percentCompleted (stored as 0.0-1.0 fraction) for display. */
function fmtPct(raw: number | string): number {
  const n = Number(raw);
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

// ── Summary ──────────────────────────────────────────────────────────────────

async function getSummary(userId: string): Promise<string> {
  const ranks = await graphQuery<{
    name: string; level: number; status: string;
    percentCompleted: number; dateCompleted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) " +
      "RETURN a.name AS name, a.level AS level, r.status AS status, " +
      "r.percentCompleted AS percentCompleted, r.dateCompleted AS dateCompleted " +
      "ORDER BY a.level",
    { userId }
  );

  const badges = await graphQuery<{
    name: string; status: string; percentCompleted: number; dateCompleted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) " +
      "RETURN a.name AS name, r.status AS status, r.percentCompleted AS percentCompleted, " +
      "r.dateCompleted AS dateCompleted",
    { userId }
  );

  const awards = await graphQuery<{ name: string; dateCompleted: string | null }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'award'}) " +
      "RETURN a.name AS name, r.dateCompleted AS dateCompleted",
    { userId }
  );

  if (ranks.length === 0 && badges.length === 0) {
    return "No advancement data found in the knowledge graph for this scout.";
  }

  const lines: string[] = ["ADVANCEMENT SUMMARY\n"];

  // Ranks
  const earnedRanks = ranks.filter((r) => r.dateCompleted);
  const inProgressRanks = ranks.filter((r) => !r.dateCompleted && Number(r.percentCompleted) > 0);
  const highestRank = earnedRanks.length > 0
    ? earnedRanks.reduce((a, b) => ((RANK_ORDER[a.name] || 0) > (RANK_ORDER[b.name] || 0) ? a : b))
    : null;

  if (earnedRanks.length > 0) {
    lines.push(`Earned ranks: ${earnedRanks.map((r) => `${r.name} (${r.dateCompleted?.substring(0, 10)})`).join(", ")}`);
  }
  if (highestRank) {
    lines.push(`Current rank: ${highestRank.name}`);
  }
  if (inProgressRanks.length > 0) {
    for (const r of inProgressRanks) {
      lines.push(`In progress: ${r.name} — ${fmtPct(r.percentCompleted)}% complete`);
    }
  }

  // Merit badges
  const earnedBadges = badges.filter((b) => b.dateCompleted);
  const inProgressBadges = badges.filter((b) => !b.dateCompleted && Number(b.percentCompleted) > 0);
  lines.push(`\nMerit badges: ${earnedBadges.length} earned, ${inProgressBadges.length} in progress`);
  if (earnedBadges.length > 0) {
    lines.push(`Earned: ${earnedBadges.map(b => b.name).join(", ")}`);
  }
  if (inProgressBadges.length > 0) {
    lines.push(`In progress: ${inProgressBadges.map(b => `${b.name} (${fmtPct(b.percentCompleted)}%)`).join(", ")}`);
  }

  // Eagle-required badge count
  const eagleReqBadges = await graphQuery<{ name: string }>(
    "MATCH (b:Badge)-[:EAGLE_REQUIRED_FOR]->(:RankNode) RETURN b.name AS name"
  );
  const eagleReqNames = new Set(eagleReqBadges.map(b => b.name));
  const earnedEagleReq = earnedBadges.filter(b => eagleReqNames.has(b.name)).length;
  lines.push(`\nEagle-required badges: ${earnedEagleReq}/${eagleReqNames.size} earned`);

  // Awards
  if (awards.length > 0) {
    const earnedAwards = awards.filter(a => a.dateCompleted);
    const pendingAwards = awards.filter(a => !a.dateCompleted);
    if (earnedAwards.length > 0) {
      lines.push(`\nAwards: ${earnedAwards.map(a => a.name).join(", ")}`);
    }
    if (pendingAwards.length > 0) {
      lines.push(`Awards in progress: ${pendingAwards.map(a => a.name).join(", ")}`);
    }
  }

  // Activity totals
  const scoutNode = await graphQuery<{ campingNights: number; hikingMiles: number; serviceHours: number }>(
    "MATCH (s:Scout {userId: $userId}) RETURN s.campingNights AS campingNights, s.hikingMiles AS hikingMiles, s.serviceHours AS serviceHours",
    { userId }
  );
  if (scoutNode.length > 0) {
    const a = scoutNode[0];
    lines.push(`\nActivities: ${a.campingNights} camping nights, ${a.hikingMiles} hiking miles, ${a.serviceHours} service hours`);
  }

  // OA eligibility check (First Class + 15 camping nights)
  const campingNights = scoutNode[0]?.campingNights ?? 0;
  const hasFirstClass = highestRank && (RANK_ORDER[highestRank.name] || 0) >= RANK_ORDER["First Class"];
  const hasCampingForOA = campingNights >= 15;
  if (hasFirstClass && hasCampingForOA) {
    lines.push(`\nOrder of the Arrow: Eligible (First Class + ${campingNights} camping nights)`);
  } else if (hasFirstClass) {
    lines.push(`\nOrder of the Arrow: Needs more camping (${campingNights}/15 nights). Rank requirement met.`);
  } else {
    const nextForOA = highestRank ? "First Class" : "Scout → Tenderfoot → Second Class → First Class";
    lines.push(`\nOrder of the Arrow: Not yet eligible (needs First Class + 15 camping nights). Current: ${nextForOA}, ${campingNights} nights`);
  }

  return lines.join("\n");
}

// ── Rank Progress ────────────────────────────────────────────────────────────

async function getRankProgress(userId: string): Promise<string> {
  const ranks = await graphQuery<{
    name: string; level: number; status: string;
    percentCompleted: number; dateCompleted: string | null; dateStarted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) " +
      "RETURN a.name AS name, a.level AS level, r.status AS status, " +
      "r.percentCompleted AS percentCompleted, r.dateCompleted AS dateCompleted, " +
      "r.dateStarted AS dateStarted ORDER BY a.level",
    { userId }
  );

  if (ranks.length === 0) return "No rank data found in the knowledge graph.";

  const lines = ["RANK PROGRESS\n"];
  for (const r of ranks) {
    const date = r.dateCompleted
      ? `earned ${r.dateCompleted.substring(0, 10)}`
      : r.dateStarted
        ? `started ${r.dateStarted.substring(0, 10)}, ${fmtPct(r.percentCompleted)}% done`
        : "not started";
    lines.push(`${r.name}: ${date}`);
  }
  return lines.join("\n");
}

// ── Requirements (shared for ranks and merit badges) ─────────────────────────

/** Normalize names for fuzzy matching: "Star" → ["Star", "Star Scout"], etc. */
function nameCandidates(name: string): string[] {
  const n = name.trim();
  const candidates = [n];
  if (!n.toLowerCase().includes("scout") && !["tenderfoot", "second class", "first class"].includes(n.toLowerCase())) {
    candidates.push(`${n} Scout`);
  }
  if (n.toLowerCase().endsWith(" scout")) {
    candidates.push(n.replace(/ [Ss]cout$/, ""));
  }
  return candidates;
}

async function getRequirements(userId: string, name: string, advType: "rank" | "meritBadge"): Promise<string> {
  const candidates = nameCandidates(name);
  let advRows: { advancementId: number; name: string }[] = [];

  for (const candidate of candidates) {
    advRows = await graphQuery<{ advancementId: number; name: string }>(
      `MATCH (a:Advancement {type: $advType, name: $name}) RETURN a.advancementId AS advancementId, a.name AS name`,
      { advType, name: candidate }
    );
    if (advRows.length > 0) break;
  }

  if (advRows.length === 0) {
    return `${advType === "rank" ? "Rank" : "Merit badge"} "${name}" not found in the knowledge graph.`;
  }

  const advancementId = Number(advRows[0].advancementId);
  const displayName = advRows[0].name;

  // Guard against the "Finn already has First Class but we list all 83 reqs as
  // Not started" bug that scored SM-PLAN3 at 2-4 across all three models in
  // the 2026-04-18 scoutmaster eval. Legacy scouts earned ranks before the
  // scoutbook sync tracked individual requirement edges, so per-req edges
  // don't exist — but the HAS_ADVANCEMENT edge carries the earned date.
  // Listing the req text as "Not started" misleads the model into suggesting
  // the scout can still "work on" a rank they've already completed.
  const earnedRows = await graphQuery<{ dateCompleted: string; status: string }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {advancementId: $advancementId}) " +
      "WHERE r.dateCompleted IS NOT NULL " +
      "RETURN r.dateCompleted AS dateCompleted, r.status AS status",
    { userId, advancementId }
  );
  if (earnedRows.length > 0) {
    const when = earnedRows[0].dateCompleted?.substring(0, 10) ?? "unknown date";
    const label = advType === "rank" ? displayName.toUpperCase() : displayName;
    // Deliberately emphatic — the model needs to treat this as a terminal
    // signal, not a hint. "Not started" text would undo the cue.
    return [
      `${label} — ALREADY EARNED`,
      ``,
      `This scout earned ${displayName} on ${when}.`,
      `All requirements for this ${advType === "rank" ? "rank" : "merit badge"} are satisfied.`,
      `If planning pair-work, this scout CANNOT re-earn these requirements and should be`,
      `positioned as a mentor/teacher for scouts who still need them. Query a different`,
      `rank or a specific incomplete merit badge to see what they can still advance on.`,
    ].join("\n");
  }

  // All requirements
  const allReqs = await graphQuery<{
    reqId: number; reqNumber: string; reqName: string; parentReqId: number | null;
  }>(
    "MATCH (req:Requirement {advancementId: $advancementId}) " +
      "RETURN req.reqId AS reqId, req.reqNumber AS reqNumber, " +
      "req.reqName AS reqName, req.parentReqId AS parentReqId " +
      "ORDER BY req.reqNumber",
    { advancementId }
  );

  // Scout's completed requirements
  const completedRows = await graphQuery<{ reqId: number }>(
    "MATCH (s:Scout {userId: $userId})-[:COMPLETED_REQ]->(req:Requirement {advancementId: $advancementId}) " +
      "RETURN req.reqId AS reqId",
    { userId, advancementId }
  );
  const completedIds = new Set(completedRows.map((r) => Number(r.reqId)));

  // Scout's started requirements
  const startedRows = await graphQuery<{ reqId: number }>(
    "MATCH (s:Scout {userId: $userId})-[:STARTED_REQ]->(req:Requirement {advancementId: $advancementId}) " +
      "RETURN req.reqId AS reqId",
    { userId, advancementId }
  );
  const startedIds = new Set(startedRows.map((r) => Number(r.reqId)));

  // Top-level requirements (no parent)
  const topLevel = allReqs.filter((r) => r.parentReqId == null);
  const done = topLevel.filter((r) => completedIds.has(Number(r.reqId)));
  const started = topLevel.filter((r) => !completedIds.has(Number(r.reqId)) && startedIds.has(Number(r.reqId)));
  const remaining = topLevel.filter((r) => !completedIds.has(Number(r.reqId)) && !startedIds.has(Number(r.reqId)));

  const label = advType === "rank" ? displayName.toUpperCase() : displayName;
  const lines = [`${label} REQUIREMENTS\n`];

  if (done.length > 0) {
    lines.push(`Completed (${done.length}):`);
    for (const r of done) lines.push(`  ✓ ${r.reqNumber}. ${r.reqName}`);
    lines.push("");
  }

  if (started.length > 0) {
    lines.push(`In progress (${started.length}):`);
    for (const r of started) lines.push(`  → ${r.reqNumber}. ${r.reqName}`);
    lines.push("");
  }

  if (remaining.length > 0) {
    lines.push(`Not started (${remaining.length}):`);
    for (const r of remaining) lines.push(`  ○ ${r.reqNumber}. ${r.reqName}`);
  }

  if (done.length === topLevel.length && topLevel.length > 0) {
    lines.push("All requirements complete!");
  }

  lines.push(`\nOverall: ${done.length}/${topLevel.length} complete, ${started.length} in progress`);
  return lines.join("\n");
}

// ── Merit Badges ─────────────────────────────────────────────────────────────

async function getMeritBadges(userId: string): Promise<string> {
  const badges = await graphQuery<{
    name: string; status: string; percentCompleted: number;
    dateCompleted: string | null; dateStarted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) " +
      "RETURN a.name AS name, r.status AS status, r.percentCompleted AS percentCompleted, " +
      "r.dateCompleted AS dateCompleted, r.dateStarted AS dateStarted ORDER BY a.name",
    { userId }
  );

  if (badges.length === 0) return "No merit badge data found.";

  // Check which are Eagle-required
  const eagleReqBadges = await graphQuery<{ name: string }>(
    "MATCH (b:Badge)-[:EAGLE_REQUIRED_FOR]->(:RankNode) RETURN b.name AS name"
  );
  const eagleReqNames = new Set(eagleReqBadges.map(b => b.name));

  const earned = badges.filter((b) => b.dateCompleted);
  const inProgress = badges.filter((b) => !b.dateCompleted);

  const lines = ["MERIT BADGES\n"];

  if (earned.length > 0) {
    lines.push(`Earned (${earned.length}):`);
    for (const b of earned) {
      const eagle = eagleReqNames.has(b.name) ? " ★Eagle" : "";
      lines.push(`  ✓ ${b.name} (${b.dateCompleted?.substring(0, 10)})${eagle}`);
    }
    lines.push("");
  }

  if (inProgress.length > 0) {
    lines.push(`In progress (${inProgress.length}):`);
    for (const b of inProgress) {
      const pct = fmtPct(b.percentCompleted);
      const eagle = eagleReqNames.has(b.name) ? " ★Eagle" : "";
      const started = b.dateStarted ? `, started ${b.dateStarted.substring(0, 10)}` : "";
      lines.push(`  → ${b.name}: ${pct}%${started}${eagle}`);
    }
  }

  return lines.join("\n");
}

// ── Awards ───────────────────────────────────────────────────────────────────

async function getAwards(userId: string): Promise<string> {
  const awards = await graphQuery<{
    name: string; status: string; percentCompleted: number;
    dateCompleted: string | null; dateStarted: string | null;
  }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'award'}) " +
      "RETURN a.name AS name, r.status AS status, r.percentCompleted AS percentCompleted, " +
      "r.dateCompleted AS dateCompleted, r.dateStarted AS dateStarted ORDER BY a.name",
    { userId }
  );

  if (awards.length === 0) return "No awards data found.";

  const lines = ["AWARDS\n"];
  for (const a of awards) {
    if (a.dateCompleted) {
      lines.push(`  ✓ ${a.name} (${a.dateCompleted.substring(0, 10)})`);
    } else {
      lines.push(`  → ${a.name}: ${fmtPct(a.percentCompleted)}% complete`);
    }
  }
  return lines.join("\n");
}

// ── Eagle Progress ───────────────────────────────────────────────────────────

async function getEagleProgress(userId: string): Promise<string> {
  const lines = ["EAGLE SCOUT PROGRESS\n"];

  // Rank check
  const ranks = await graphQuery<{ name: string; dateCompleted: string | null }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) " +
      "WHERE r.dateCompleted IS NOT NULL " +
      "RETURN a.name AS name, r.dateCompleted AS dateCompleted ORDER BY a.level",
    { userId }
  );
  const earnedRankNames = new Set(ranks.map(r => r.name));
  const hasLife = earnedRankNames.has("Life") || earnedRankNames.has("Life Scout");
  lines.push(`Life rank: ${hasLife ? "✓ Earned" : "○ Not yet earned (required for Eagle)"}`);

  // Eagle-required merit badges
  const eagleReqBadges = await graphQuery<{ name: string }>(
    "MATCH (b:Badge)-[:EAGLE_REQUIRED_FOR]->(:RankNode) RETURN b.name AS name ORDER BY b.name"
  );

  const scoutBadges = await graphQuery<{ name: string; dateCompleted: string | null; percentCompleted: number }>(
    "MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) " +
      "RETURN a.name AS name, r.dateCompleted AS dateCompleted, r.percentCompleted AS percentCompleted",
    { userId }
  );
  const badgeMap = new Map(scoutBadges.map(b => [b.name, b]));

  let earnedCount = 0;
  const missingEagle: string[] = [];
  const inProgressEagle: string[] = [];

  for (const eb of eagleReqBadges) {
    const scout = badgeMap.get(eb.name);
    if (scout?.dateCompleted) {
      earnedCount++;
    } else if (scout) {
      inProgressEagle.push(`${eb.name} (${fmtPct(scout.percentCompleted)}%)`);
    } else {
      missingEagle.push(eb.name);
    }
  }

  lines.push(`\nEagle-required merit badges: ${earnedCount}/${eagleReqBadges.length}`);
  if (inProgressEagle.length > 0) lines.push(`In progress: ${inProgressEagle.join(", ")}`);
  if (missingEagle.length > 0) lines.push(`Not started: ${missingEagle.join(", ")}`);

  // Total merit badges (need 21 for Eagle)
  const totalEarned = scoutBadges.filter(b => b.dateCompleted).length;
  lines.push(`\nTotal merit badges earned: ${totalEarned}/21 required`);

  // Activity data
  const scoutNode = await graphQuery<{ campingNights: number; hikingMiles: number; serviceHours: number }>(
    "MATCH (s:Scout {userId: $userId}) RETURN s.campingNights AS campingNights, s.hikingMiles AS hikingMiles, s.serviceHours AS serviceHours",
    { userId }
  );
  if (scoutNode.length > 0) {
    const a = scoutNode[0];
    lines.push(`\nActivities:`);
    lines.push(`  Camping nights: ${a.campingNights}`);
    lines.push(`  Hiking miles: ${a.hikingMiles}`);
    lines.push(`  Service hours: ${a.serviceHours}`);
  }

  // Eagle project
  lines.push(`\nEagle project: Check with Scoutmaster (not tracked in system)`);

  return lines.join("\n");
}
