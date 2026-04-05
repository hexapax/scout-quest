/** Tool: troop_insights
 * Leader/guide-facing tool for troop-wide advancement analysis.
 * Powers Sunday advancement sessions and troop planning.
 */

import { graphQuery, isFalkorConnected } from "../falkordb.js";
import { getScoutQuestDb } from "../db.js";

export type TroopInsightScope =
  | "advancement_sunday"   // Plan an advancement session: clusters + pairings
  | "who_can_teach"        // Scouts who completed a requirement and can teach it
  | "who_needs"            // Scouts who still need a requirement/rank
  | "troop_progress"       // Dashboard: every scout's rank progress
  | "pairing_suggestions"; // Optimal teach/learn pairs for a given skill area

export interface TroopInsightInput {
  scope: TroopInsightScope;
  skillArea?: string;       // e.g., "first aid", "navigation", "cooking"
  rankName?: string;        // e.g., "First Class", "Tenderfoot"
  requirementRef?: string;  // e.g., "7b", "6e"
  attendees?: string;       // Comma-separated scout names for session planning
}

// Teaching-focused requirements that indicate a scout can teach others
const TEACHING_REQS = [
  { desc: "Life Req 6 (Teaching EDGE)", advId: 6, reqNumbers: ["6"] },
  { desc: "Tenderfoot Req 8 (EDGE + teach knot)", advId: 2, reqNumbers: ["8"] },
  { desc: "Communication MB Req 6 (teach a skill)", advId: 30, reqNumbers: ["6"] },
  { desc: "First Aid MB Req 14 (teach first aid via EDGE)", advId: 51, reqNumbers: ["14", "14."] },
];

// Skill areas and which rank requirements map to them
const SKILL_AREAS: Record<string, { label: string; advIds: number[]; keywords: string[] }> = {
  "first aid": {
    label: "First Aid & Rescue",
    advIds: [2, 3, 4, 51],  // Tenderfoot, Second Class, First Class, First Aid MB
    keywords: ["first aid", "bandage", "rescue", "transport", "cpr", "bleeding", "shock", "hurry"],
  },
  navigation: {
    label: "Navigation & Orienteering",
    advIds: [3, 4],  // Second Class, First Class
    keywords: ["compass", "map", "orienteering", "bearing", "topographic", "direction", "north"],
  },
  cooking: {
    label: "Cooking & Camp Chef",
    advIds: [2, 3, 4, 33],  // Tenderfoot, Second Class, First Class, Cooking MB
    keywords: ["cook", "meal", "menu", "food", "stove", "fire", "recipe", "patrol meal"],
  },
  camping: {
    label: "Camping & Outdoor Skills",
    advIds: [2, 3, 4, 20],  // Tenderfoot, Second Class, First Class, Camping MB
    keywords: ["tent", "camp", "pitch", "sleep", "campsite", "leave no trace", "knot", "lashing"],
  },
  swimming: {
    label: "Swimming & Water Safety",
    advIds: [3, 4],  // Second Class, First Class
    keywords: ["swim", "water", "rescue", "float", "stroke", "buddy"],
  },
  citizenship: {
    label: "Citizenship & Community",
    advIds: [24, 154],  // Cit in Community, Cit in Society
    keywords: ["citizen", "community", "government", "service", "volunteer", "civic"],
  },
};

export async function troopInsights(input: TroopInsightInput): Promise<string> {
  if (!isFalkorConnected()) {
    return "Knowledge graph not available for troop insights.";
  }

  try {
    switch (input.scope) {
      case "advancement_sunday":
        return await advancementSunday(input.attendees, input.skillArea);
      case "who_can_teach":
        return await whoCanTeach(input.skillArea ?? input.requirementRef ?? "");
      case "who_needs":
        return await whoNeeds(input.rankName ?? "", input.requirementRef);
      case "troop_progress":
        return await troopProgress();
      case "pairing_suggestions":
        return await pairingSuggestions(input.skillArea ?? "first aid", input.attendees);
      default:
        return "Unknown troop_insights scope. Use: advancement_sunday, who_can_teach, who_needs, troop_progress, pairing_suggestions.";
    }
  } catch (err) {
    console.error("troop_insights error:", err);
    return `Troop insights query failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Plan an advancement Sunday session. */
async function advancementSunday(attendees?: string, focusArea?: string): Promise<string> {
  // Get all scouts with in-progress work
  const inProgress = await graphQuery<{
    scout: string; rank: string; pct: number; userId: string;
  }>(
    `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) ` +
    `WHERE r.dateCompleted IS NULL AND r.percentCompleted > 0 AND r.percentCompleted < 1 ` +
    `RETURN s.name AS scout, a.name AS rank, toFloat(r.percentCompleted) AS pct, s.userId AS userId ` +
    `ORDER BY a.level, r.percentCompleted DESC`
  );

  // Filter to attendees if provided
  let scouts = inProgress;
  if (attendees) {
    const names = attendees.toLowerCase().split(",").map(n => n.trim());
    scouts = inProgress.filter(s =>
      names.some(n => s.scout.toLowerCase().includes(n))
    );
  }

  // Get scouts with started-but-incomplete requirements (most actionable)
  const startedReqs = await graphQuery<{
    scout: string; reqNumber: string; reqName: string; advName: string; advType: string;
  }>(
    `MATCH (s:Scout)-[:STARTED_REQ]->(req:Requirement) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN s.name AS scout, req.reqNumber AS reqNumber, req.reqName AS reqName, ` +
    `adv.name AS advName, adv.type AS advType ` +
    `ORDER BY s.name, adv.name`
  );

  // Get proven teachers (completed teaching EDGE requirements)
  const teachers = await getProvenTeachers();

  // Cluster by skill area
  const clusters: Record<string, { scouts: Set<string>; reqs: string[] }> = {};
  for (const r of startedReqs) {
    const area = classifyRequirement(r.reqName, r.advName);
    if (!clusters[area]) clusters[area] = { scouts: new Set(), reqs: [] };
    clusters[area].scouts.add(r.scout);
    clusters[area].reqs.push(`${r.scout}: ${r.advName} Req ${r.reqNumber}`);
  }

  // Build session plan
  const lines = ["ADVANCEMENT SUNDAY SESSION PLAN\n"];

  if (attendees) {
    lines.push(`Planned for: ${attendees}`);
  }
  lines.push(`Scouts with active rank work: ${scouts.length}\n`);

  // Rank progress summary
  lines.push("RANK PROGRESS (in-progress scouts):");
  const byRank = new Map<string, typeof scouts>();
  for (const s of scouts) {
    const arr = byRank.get(s.rank) || [];
    arr.push(s);
    byRank.set(s.rank, arr);
  }
  for (const [rank, arr] of byRank) {
    lines.push(`\n  ${rank}:`);
    for (const s of arr) {
      lines.push(`    ${s.scout} — ${Math.round(s.pct * 100)}% complete`);
    }
  }

  // Suggested stations
  lines.push("\n\nSUGGESTED STATIONS:");
  const sortedClusters = Object.entries(clusters)
    .sort((a, b) => b[1].scouts.size - a[1].scouts.size);

  for (const [area, data] of sortedClusters.slice(0, 5)) {
    const label = SKILL_AREAS[area]?.label ?? area;
    lines.push(`\n  Station: ${label} (${data.scouts.size} scouts need work)`);
    lines.push(`    Scouts: ${[...data.scouts].join(", ")}`);

    // Find teachers for this area
    const areaTeachers = teachers.filter(t =>
      data.scouts.has(t) === false
    );
    if (areaTeachers.length > 0) {
      lines.push(`    Potential peer instructors: ${areaTeachers.slice(0, 3).join(", ")}`);
    }

    // Show specific requirements
    const uniqueReqs = [...new Set(data.reqs)].slice(0, 6);
    for (const r of uniqueReqs) {
      lines.push(`      - ${r}`);
    }
  }

  // Multi-person requirements that could be done together
  lines.push("\n\nMULTI-PERSON REQUIREMENTS (need partners):");
  const multiPerson = startedReqs.filter(r =>
    /partner|buddy|another|helper|together|with a|practice victim/i.test(r.reqName)
  );
  if (multiPerson.length > 0) {
    for (const r of multiPerson.slice(0, 8)) {
      lines.push(`  - ${r.scout}: ${r.advName} Req ${r.reqNumber} — ${r.reqName.substring(0, 100)}`);
    }
  } else {
    lines.push("  (check First Class 6e line rescue, 7b transport — these need partners)");
  }

  // Teaching EDGE opportunities
  lines.push("\n\nTEACHING EDGE OPPORTUNITIES:");
  lines.push("  Proven teachers (completed Life Req 6 or Communication Req 6):");
  for (const t of teachers.slice(0, 5)) {
    lines.push(`    - ${t}`);
  }
  lines.push("  These scouts can teach lower-rank skills to earn leadership credit");
  lines.push("  while helping younger scouts complete requirements.");

  return lines.join("\n");
}

/** Find scouts who can teach a given skill area or requirement. */
async function whoCanTeach(query: string): Promise<string> {
  const teachers = await getProvenTeachers();

  // Find scouts who completed requirements matching the query
  const completed = await graphQuery<{
    scout: string; reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `WHERE toLower(req.reqName) CONTAINS toLower($query) OR toLower(adv.name) CONTAINS toLower($query) ` +
    `RETURN DISTINCT s.name AS scout, req.reqNumber AS reqNumber, req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY s.name LIMIT 40`,
    { query }
  );

  if (completed.length === 0) {
    return `No scouts found who completed requirements matching "${query}".`;
  }

  // Group by scout
  const byScout = new Map<string, string[]>();
  for (const r of completed) {
    const arr = byScout.get(r.scout) || [];
    arr.push(`${r.advName} Req ${r.reqNumber}`);
    byScout.set(r.scout, arr);
  }

  const lines = [`SCOUTS WHO CAN TEACH: "${query}"\n`];

  // Highlight proven EDGE teachers first
  const teacherSet = new Set(teachers);
  const proven = [...byScout.entries()].filter(([name]) => teacherSet.has(name));
  const others = [...byScout.entries()].filter(([name]) => !teacherSet.has(name));

  if (proven.length > 0) {
    lines.push("Proven peer instructors (completed Teaching EDGE):");
    for (const [name, reqs] of proven) {
      lines.push(`  ${name} — completed: ${reqs.slice(0, 4).join(", ")}`);
    }
    lines.push("");
  }

  lines.push(`Other scouts who completed these requirements (${others.length}):`);
  for (const [name, reqs] of others.slice(0, 10)) {
    lines.push(`  ${name} — ${reqs.slice(0, 4).join(", ")}`);
  }

  return lines.join("\n");
}

/** Find scouts who still need a specific rank or requirement. */
async function whoNeeds(rankName: string, reqRef?: string): Promise<string> {
  if (reqRef && rankName) {
    // Specific requirement within a rank
    const candidates = [rankName, `${rankName} Scout`];
    let results: { scout: string; reqNumber: string; reqName: string }[] = [];

    for (const candidate of candidates) {
      results = await graphQuery<{ scout: string; reqNumber: string; reqName: string }>(
        `MATCH (adv:Advancement {type: 'rank', name: $rank})-[:HAS_REQUIREMENT]->(req:Requirement) ` +
        `WHERE req.reqNumber STARTS WITH $reqRef ` +
        `MATCH (s:Scout)-[:HAS_ADVANCEMENT]->(adv) ` +
        `WHERE NOT EXISTS { MATCH (s)-[:COMPLETED_REQ]->(req) } ` +
        `RETURN s.name AS scout, req.reqNumber AS reqNumber, req.reqName AS reqName ` +
        `ORDER BY s.name`,
        { rank: candidate, reqRef }
      );
      if (results.length > 0) break;
    }

    if (results.length === 0) {
      return `No scouts found who still need ${rankName} Req ${reqRef}. Either everyone completed it or the requirement wasn't found.`;
    }

    const lines = [`SCOUTS WHO STILL NEED: ${rankName} Req ${reqRef}\n`];
    lines.push(`Requirement: ${results[0].reqName}\n`);
    for (const r of results) {
      lines.push(`  - ${r.scout}`);
    }
    lines.push(`\n${results.length} scouts still need this requirement.`);
    return lines.join("\n");
  }

  // All scouts working toward a rank
  const candidates = [rankName, `${rankName} Scout`];
  let results: { scout: string; pct: number }[] = [];

  for (const candidate of candidates) {
    results = await graphQuery<{ scout: string; pct: number }>(
      `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank', name: $rank}) ` +
      `WHERE r.dateCompleted IS NULL ` +
      `RETURN s.name AS scout, toFloat(r.percentCompleted) AS pct ` +
      `ORDER BY r.percentCompleted DESC`,
      { rank: candidate }
    );
    if (results.length > 0) break;
  }

  if (results.length === 0) {
    return `No scouts found working toward "${rankName}".`;
  }

  const lines = [`SCOUTS WORKING TOWARD: ${rankName}\n`];
  for (const r of results) {
    const pctStr = Math.round((r.pct ?? 0) * 100);
    lines.push(`  ${r.scout} — ${pctStr}% complete`);
  }
  lines.push(`\n${results.length} scouts working on this rank.`);
  return lines.join("\n");
}

/** Troop-wide progress dashboard. */
async function troopProgress(): Promise<string> {
  // Current rank for each scout (highest earned)
  const earned = await graphQuery<{
    scout: string; rank: string; level: number; date: string;
  }>(
    `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) ` +
    `WHERE r.dateCompleted IS NOT NULL ` +
    `RETURN s.name AS scout, a.name AS rank, a.level AS level, r.dateCompleted AS date ` +
    `ORDER BY s.name, a.level DESC`
  );

  // In-progress ranks
  const working = await graphQuery<{
    scout: string; rank: string; pct: number;
  }>(
    `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'rank'}) ` +
    `WHERE r.dateCompleted IS NULL AND r.percentCompleted > 0 AND r.percentCompleted < 1 ` +
    `RETURN s.name AS scout, a.name AS rank, toFloat(r.percentCompleted) AS pct ` +
    `ORDER BY s.name, a.level`
  );

  // Merit badge counts
  const badges = await graphQuery<{
    scout: string; earnedCount: number; inProgressCount: number;
  }>(
    `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) ` +
    `WITH s, ` +
    `sum(CASE WHEN r.dateCompleted IS NOT NULL THEN 1 ELSE 0 END) AS earned, ` +
    `sum(CASE WHEN r.dateCompleted IS NULL THEN 1 ELSE 0 END) AS inProgress ` +
    `RETURN s.name AS scout, earned AS earnedCount, inProgress AS inProgressCount ` +
    `ORDER BY s.name`
  );

  // Build per-scout summary
  const scoutMap = new Map<string, { currentRank: string; nextRank: string; nextPct: number; mbEarned: number; mbInProgress: number }>();

  // Highest earned rank per scout
  const seenScouts = new Set<string>();
  for (const e of earned) {
    if (!seenScouts.has(e.scout)) {
      seenScouts.add(e.scout);
      scoutMap.set(e.scout, { currentRank: e.rank, nextRank: "", nextPct: 0, mbEarned: 0, mbInProgress: 0 });
    }
  }

  // Next rank in progress
  for (const w of working) {
    const entry = scoutMap.get(w.scout);
    if (entry && (!entry.nextRank || w.pct > entry.nextPct)) {
      entry.nextRank = w.rank;
      entry.nextPct = w.pct;
    }
  }

  // Merit badges
  for (const b of badges) {
    const entry = scoutMap.get(b.scout);
    if (entry) {
      entry.mbEarned = b.earnedCount;
      entry.mbInProgress = b.inProgressCount;
    }
  }

  const lines = ["TROOP 2024 ADVANCEMENT DASHBOARD\n"];

  // Sort by rank level descending
  const RANK_LEVEL: Record<string, number> = {
    "Eagle Scout": 7, "Life Scout": 6, "Star Scout": 5, "First Class": 4,
    "Second Class": 3, Tenderfoot: 2, Scout: 1,
  };

  const sorted = [...scoutMap.entries()].sort((a, b) =>
    (RANK_LEVEL[b[1].currentRank] ?? 0) - (RANK_LEVEL[a[1].currentRank] ?? 0)
  );

  // Close to next rank (>70%)
  const closeToRank = sorted.filter(([, v]) => v.nextPct >= 0.7 && v.nextRank);
  if (closeToRank.length > 0) {
    lines.push("CLOSE TO NEXT RANK (70%+):");
    for (const [name, v] of closeToRank) {
      lines.push(`  ${name}: ${v.currentRank} -> ${v.nextRank} (${Math.round(v.nextPct * 100)}%)`);
    }
    lines.push("");
  }

  // Full roster
  lines.push("FULL ROSTER:");
  for (const [name, v] of sorted) {
    const next = v.nextRank ? ` -> ${v.nextRank} (${Math.round(v.nextPct * 100)}%)` : "";
    const mbs = v.mbEarned > 0 ? ` | ${v.mbEarned} MBs earned, ${v.mbInProgress} in progress` : "";
    lines.push(`  ${name}: ${v.currentRank}${next}${mbs}`);
  }

  lines.push(`\nTotal scouts: ${sorted.length}`);
  return lines.join("\n");
}

/** Generate teach/learn pairings for a skill area. */
async function pairingSuggestions(skillArea: string, attendees?: string): Promise<string> {
  const area = SKILL_AREAS[skillArea.toLowerCase()];
  const keywords = area?.keywords ?? [skillArea.toLowerCase()];
  const label = area?.label ?? skillArea;

  // Find incomplete requirements in this area
  const keywordPattern = keywords.join("|");
  const incomplete = await graphQuery<{
    scout: string; userId: string; reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (s:Scout)-[:STARTED_REQ]->(req:Requirement) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `WHERE toLower(req.reqName) =~ $pattern OR toLower(adv.name) =~ $pattern ` +
    `RETURN s.name AS scout, s.userId AS userId, req.reqNumber AS reqNumber, ` +
    `req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY s.name`,
    { pattern: `.*(?:${keywordPattern}).*` }
  );

  // Find scouts who completed these same types of requirements
  const completed = await graphQuery<{
    scout: string; reqNumber: string; advName: string;
  }>(
    `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `WHERE toLower(req.reqName) =~ $pattern OR toLower(adv.name) =~ $pattern ` +
    `RETURN DISTINCT s.name AS scout, req.reqNumber AS reqNumber, adv.name AS advName ` +
    `ORDER BY s.name`,
    { pattern: `.*(?:${keywordPattern}).*` }
  );

  const teachers = await getProvenTeachers();
  const teacherSet = new Set(teachers);

  // Build learner profiles
  const learners = new Map<string, string[]>();
  for (const r of incomplete) {
    if (attendees) {
      const names = attendees.toLowerCase().split(",").map(n => n.trim());
      if (!names.some(n => r.scout.toLowerCase().includes(n))) continue;
    }
    const arr = learners.get(r.scout) || [];
    arr.push(`${r.advName} ${r.reqNumber}`);
    learners.set(r.scout, arr);
  }

  // Build teacher profiles (scouts who completed + not in learner list for same req)
  const mentors = new Map<string, { reqs: string[]; isEdgeTrained: boolean }>();
  for (const r of completed) {
    const entry = mentors.get(r.scout) || { reqs: [], isEdgeTrained: teacherSet.has(r.scout) };
    entry.reqs.push(`${r.advName} ${r.reqNumber}`);
    mentors.set(r.scout, entry);
  }

  const lines = [`TEACH/LEARN PAIRINGS: ${label}\n`];

  if (learners.size === 0) {
    lines.push(`No scouts with in-progress ${label} requirements found.`);
    return lines.join("\n");
  }

  // Generate pairings
  lines.push(`Learners (${learners.size} scouts with incomplete ${label} requirements):`);
  for (const [name, reqs] of learners) {
    lines.push(`  ${name}: needs ${reqs.slice(0, 4).join(", ")}`);
  }

  lines.push(`\nAvailable mentors:`);
  const edgeMentors = [...mentors.entries()].filter(([, v]) => v.isEdgeTrained);
  const otherMentors = [...mentors.entries()].filter(([, v]) => !v.isEdgeTrained && !learners.has(v.reqs[0]));

  if (edgeMentors.length > 0) {
    lines.push("  EDGE-trained (best for teaching):");
    for (const [name, v] of edgeMentors.slice(0, 5)) {
      lines.push(`    ${name} — completed ${v.reqs.length} reqs in this area`);
    }
  }
  if (otherMentors.length > 0) {
    lines.push(`  Others who completed these requirements (${otherMentors.length}):`);
    for (const [name, v] of otherMentors.slice(0, 5)) {
      lines.push(`    ${name} — completed ${v.reqs.length} reqs`);
    }
  }

  // Suggested pairings
  lines.push("\nSUGGESTED PAIRINGS:");
  const availableMentors = [...edgeMentors, ...otherMentors].map(([name]) => name);
  let mentorIdx = 0;
  for (const [learner] of learners) {
    if (mentorIdx < availableMentors.length) {
      lines.push(`  ${availableMentors[mentorIdx]} teaches ${learner}`);
      mentorIdx++;
      if (mentorIdx >= availableMentors.length) mentorIdx = 0;
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get names of scouts who completed teaching-focused requirements. */
async function getProvenTeachers(): Promise<string[]> {
  const results = await graphQuery<{ scout: string }>(
    `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement) ` +
    `WHERE (req.advancementId = 6 AND req.reqNumber = '6') ` +
    `   OR (req.advancementId = 2 AND req.reqNumber = '8') ` +
    `   OR (req.advancementId = 30 AND req.reqNumber = '6') ` +
    `   OR (req.advancementId = 51 AND req.reqNumber IN ['14', '14.']) ` +
    `RETURN DISTINCT s.name AS scout ORDER BY s.name`
  );
  return results.map(r => r.scout);
}

/** Classify a requirement into a skill area by keywords. */
function classifyRequirement(reqName: string, advName: string): string {
  const text = `${reqName} ${advName}`.toLowerCase();
  for (const [area, config] of Object.entries(SKILL_AREAS)) {
    if (config.keywords.some(kw => text.includes(kw))) return area;
  }
  return "general";
}
