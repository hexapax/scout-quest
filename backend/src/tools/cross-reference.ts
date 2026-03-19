/** Tool: cross_reference
 * Graph-powered queries for connecting information across badges, ranks, and policies.
 * Uses FalkorDB's graph capabilities to answer relationship questions.
 */

import { graphQuery, isFalkorConnected } from "../falkordb.js";

export type CrossRefScope =
  | "related_badges"       // What badges are in the same category or share skills?
  | "eagle_requirements"   // What Eagle-required badges does this scout need?
  | "rank_overlap"         // What rank requirements overlap with a merit badge?
  | "version_changes"      // What changed for a badge/rank between versions?
  | "badge_for_skill"      // What badges teach a given skill?
  | "category_badges";     // All badges in a category

export interface CrossRefInput {
  scope: CrossRefScope;
  badgeName?: string;
  rankName?: string;
  skillOrTopic?: string;
  scoutUserId?: string;
}

export async function crossReference(input: CrossRefInput): Promise<string> {
  if (!isFalkorConnected()) {
    return "Knowledge graph not available for cross-reference queries.";
  }

  try {
    switch (input.scope) {
      case "related_badges":
        return await relatedBadges(input.badgeName ?? "");
      case "eagle_requirements":
        return await eagleRequirements(input.scoutUserId);
      case "rank_overlap":
        return await rankOverlap(input.badgeName ?? "", input.rankName ?? "");
      case "version_changes":
        return await versionChanges(input.badgeName ?? input.rankName ?? "");
      case "badge_for_skill":
        return await badgeForSkill(input.skillOrTopic ?? "");
      case "category_badges":
        return await categoryBadges(input.badgeName ?? "");
      default:
        return "Unknown cross-reference scope.";
    }
  } catch (err) {
    console.error("cross_reference error:", err);
    return `Cross-reference query failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Find badges in the same category as a given badge. */
async function relatedBadges(badgeName: string): Promise<string> {
  // Find the badge's category, then all badges in that category
  const results = await graphQuery<{ name: string; category: string; eagleRequired: boolean }>(
    `MATCH (b:Badge)-[:BELONGS_TO]->(c:Category)<-[:BELONGS_TO]-(other:Badge) ` +
    `WHERE toLower(b.name) CONTAINS toLower($name) AND b.badgeId <> other.badgeId ` +
    `RETURN other.name AS name, c.name AS category, other.eagleRequired AS eagleRequired ` +
    `ORDER BY other.name LIMIT 15`,
    { name: badgeName }
  );

  if (results.length === 0) {
    return `No related badges found for "${badgeName}". The badge may not be in the knowledge graph yet.`;
  }

  const category = results[0].category;
  const lines = [`RELATED BADGES (same category: ${category})\n`];
  for (const r of results) {
    const eagle = r.eagleRequired ? " [Eagle Required]" : "";
    lines.push(`  - ${r.name}${eagle}`);
  }
  return lines.join("\n");
}

/** List Eagle-required badges, optionally marking which a scout has completed. */
async function eagleRequirements(scoutUserId?: string): Promise<string> {
  const results = await graphQuery<{ name: string; badgeId: string }>(
    `MATCH (b:Badge)-[:EAGLE_REQUIRED_FOR]->(r:RankNode {name: 'Eagle Scout'}) ` +
    `RETURN b.name AS name, b.badgeId AS badgeId ORDER BY b.name`
  );

  // Also check alternatives
  const alts = await graphQuery<{ name: string; altFor: string }>(
    `MATCH (b:Badge)-[:EAGLE_ALTERNATIVE_FOR]->(orig:Badge) ` +
    `RETURN b.name AS name, orig.name AS altFor ORDER BY b.name`
  );

  if (results.length === 0) {
    return "Could not find Eagle-required badges in the graph.";
  }

  const lines = [`EAGLE-REQUIRED MERIT BADGES (${results.length} required + ${alts.length} alternatives)\n`];

  // If we have a scoutUserId, check completion status
  if (scoutUserId) {
    const completed = await graphQuery<{ name: string }>(
      `MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement {type: 'meritBadge'}) ` +
      `WHERE r.dateCompleted IS NOT NULL ` +
      `RETURN a.name AS name`,
      { userId: scoutUserId }
    );
    const completedSet = new Set(completed.map((c) => c.name?.toLowerCase()));

    for (const r of results) {
      const done = completedSet.has(r.name.toLowerCase());
      lines.push(`  ${done ? "✓" : "○"} ${r.name}`);
    }
    const doneCount = results.filter((r) => completedSet.has(r.name.toLowerCase())).length;
    lines.push(`\n${doneCount}/${results.length} completed`);
  } else {
    for (const r of results) {
      lines.push(`  - ${r.name}`);
    }
  }

  if (alts.length > 0) {
    lines.push(`\nAlternatives:`);
    for (const a of alts) {
      lines.push(`  - ${a.name} (alternative for ${a.altFor})`);
    }
  }

  return lines.join("\n");
}

/** Find overlap between rank requirements and merit badge requirements. */
async function rankOverlap(badgeName: string, rankName: string): Promise<string> {
  // Get badge requirements
  const badgeReqs = await graphQuery<{ name: string; text: string }>(
    `MATCH (b:Badge)-[:HAS_REQUIREMENT]->(r) ` +
    `WHERE toLower(b.name) CONTAINS toLower($badge) ` +
    `RETURN r.name AS name, r.text AS text LIMIT 30`,
    { badge: badgeName }
  );

  // Get rank requirements from the Scoutbook-sourced Requirement nodes
  const rankCandidates = [rankName, `${rankName} Scout`];
  let rankReqs: { reqNumber: string; reqName: string }[] = [];
  for (const candidate of rankCandidates) {
    rankReqs = await graphQuery<{ reqNumber: string; reqName: string }>(
      `MATCH (a:Advancement {type: 'rank', name: $rank})-[:HAS_REQUIREMENT]->(r:Requirement) ` +
      `RETURN r.reqNumber AS reqNumber, r.reqName AS reqName LIMIT 30`,
      { rank: candidate }
    );
    if (rankReqs.length > 0) break;
  }

  if (badgeReqs.length === 0 && rankReqs.length === 0) {
    return `Could not find requirements for "${badgeName}" or "${rankName}" in the graph.`;
  }

  const lines = [`REQUIREMENT OVERLAP: ${badgeName} ↔ ${rankName}\n`];

  // Simple keyword matching to find overlapping topics
  const badgeKeywords = new Set<string>();
  for (const r of badgeReqs) {
    const text = (r.name ?? r.text ?? "").toLowerCase();
    for (const kw of ["camp", "cook", "hik", "swim", "first aid", "knot", "fire", "compass", "map", "citizen", "nature", "leadership", "service"]) {
      if (text.includes(kw)) badgeKeywords.add(kw);
    }
  }

  const overlaps: string[] = [];
  for (const r of rankReqs) {
    const text = (r.reqName ?? "").toLowerCase();
    for (const kw of badgeKeywords) {
      if (text.includes(kw)) {
        overlaps.push(`  ${rankName} Req ${r.reqNumber}: ${r.reqName} (overlaps with ${badgeName} on "${kw}")`);
        break;
      }
    }
  }

  if (overlaps.length > 0) {
    lines.push(`Found ${overlaps.length} potential overlaps:`);
    lines.push(...overlaps);
  } else {
    lines.push(`No direct keyword overlap detected between ${badgeName} and ${rankName} requirements.`);
    lines.push(`However, skills practiced in ${badgeName} may still help with ${rankName} requirements.`);
  }

  lines.push(`\n${badgeName}: ${badgeReqs.length} requirements`);
  lines.push(`${rankName}: ${rankReqs.length} requirements`);

  return lines.join("\n");
}

/** Find version changes for a badge or rank. */
async function versionChanges(name: string): Promise<string> {
  const results = await graphQuery<{ changeName: string; description: string; fromVer: string; toVer: string }>(
    `MATCH (b)-[:HAS_VERSION_CHANGES]->(vc:VersionChange) ` +
    `WHERE toLower(b.name) CONTAINS toLower($name) ` +
    `RETURN vc.name AS changeName, vc.description AS description, ` +
    `vc.fromVersion AS fromVer, vc.toVersion AS toVer ` +
    `ORDER BY vc.toVersion DESC LIMIT 10`,
    { name }
  );

  if (results.length === 0) {
    return `No version changes found for "${name}" in the knowledge graph.`;
  }

  const lines = [`VERSION CHANGES for "${name}"\n`];
  for (const r of results) {
    lines.push(`${r.fromVer} → ${r.toVer}: ${r.changeName}`);
    if (r.description) lines.push(`  ${r.description.substring(0, 200)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Find badges that teach a given skill or cover a topic. */
async function badgeForSkill(skillOrTopic: string): Promise<string> {
  // Search badge names and categories for the skill keyword
  const results = await graphQuery<{ name: string; category: string; eagleRequired: boolean }>(
    `MATCH (b:Badge) ` +
    `WHERE toLower(b.name) CONTAINS toLower($query) OR toLower(b.category) CONTAINS toLower($query) ` +
    `RETURN b.name AS name, b.category AS category, b.eagleRequired AS eagleRequired ` +
    `ORDER BY b.name LIMIT 15`,
    { query: skillOrTopic }
  );

  if (results.length === 0) {
    return `No badges found matching "${skillOrTopic}". Try a broader term.`;
  }

  const lines = [`BADGES RELATED TO "${skillOrTopic}"\n`];
  for (const r of results) {
    const eagle = r.eagleRequired ? " [Eagle Required]" : "";
    lines.push(`  - ${r.name} (${r.category})${eagle}`);
  }
  return lines.join("\n");
}

/** List all badges in the same category as a given badge. */
async function categoryBadges(badgeName: string): Promise<string> {
  return relatedBadges(badgeName);
}
