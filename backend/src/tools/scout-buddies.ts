/** Tool: scout_buddies
 * Scout-facing tool for finding collaboration opportunities.
 * Helps a scout discover who they can work with or learn from.
 */

import { graphQuery, isFalkorConnected } from "../falkordb.js";

export type ScoutBuddyScope =
  | "working_on_same"  // Who else is working on the same rank/badge?
  | "can_help_me"      // Who completed what I need and could help?
  | "i_can_help"       // What could I help teach to younger scouts?
  | "next_together";   // What requirements could I work on with a specific friend?

export interface ScoutBuddyInput {
  scope: ScoutBuddyScope;
  scoutUserId: string;       // The requesting scout's userId
  friendName?: string;       // For next_together scope
  rankName?: string;         // Optional rank filter
  badgeName?: string;        // Optional badge filter
}

export async function scoutBuddies(input: ScoutBuddyInput): Promise<string> {
  if (!isFalkorConnected()) {
    return "Knowledge graph not available for buddy search.";
  }

  try {
    switch (input.scope) {
      case "working_on_same":
        return await workingOnSame(input.scoutUserId, input.rankName);
      case "can_help_me":
        return await canHelpMe(input.scoutUserId, input.rankName);
      case "i_can_help":
        return await iCanHelp(input.scoutUserId);
      case "next_together":
        return await nextTogether(input.scoutUserId, input.friendName ?? "");
      default:
        return "Unknown scout_buddies scope. Use: working_on_same, can_help_me, i_can_help, next_together.";
    }
  } catch (err) {
    console.error("scout_buddies error:", err);
    return `Buddy search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Find scouts working on the same rank or badge. */
async function workingOnSame(userId: string, rankName?: string): Promise<string> {
  // Get this scout's in-progress advancements
  const myWork = await graphQuery<{ advName: string; advId: number; pct: number; type: string }>(
    `MATCH (s:Scout {userId: $userId})-[r:HAS_ADVANCEMENT]->(a:Advancement) ` +
    `WHERE r.dateCompleted IS NULL AND r.percentCompleted > 0 ` +
    `RETURN a.name AS advName, a.advancementId AS advId, toFloat(r.percentCompleted) AS pct, a.type AS type ` +
    `ORDER BY a.type, a.name`,
    { userId }
  );

  if (myWork.length === 0) {
    return "You don't have any advancements in progress right now.";
  }

  // Filter to specific rank if requested
  const filtered = rankName
    ? myWork.filter(w => w.advName.toLowerCase().includes(rankName.toLowerCase()))
    : myWork.filter(w => w.type === "rank"); // Default to ranks

  const target = filtered.length > 0 ? filtered : myWork.slice(0, 3);

  const lines = ["SCOUTS WORKING ON THE SAME THINGS AS YOU\n"];

  for (const work of target) {
    // Find other scouts working on the same advancement
    const peers = await graphQuery<{ scout: string; pct: number }>(
      `MATCH (s:Scout)-[r:HAS_ADVANCEMENT]->(a:Advancement {advancementId: $advId}) ` +
      `WHERE s.userId <> $userId AND r.dateCompleted IS NULL AND r.percentCompleted > 0 ` +
      `RETURN s.name AS scout, toFloat(r.percentCompleted) AS pct ` +
      `ORDER BY r.percentCompleted DESC`,
      { advId: work.advId, userId }
    );

    if (peers.length > 0) {
      lines.push(`${work.advName} (you: ${Math.round(work.pct * 100)}%):`);
      for (const p of peers.slice(0, 8)) {
        lines.push(`  ${p.scout} — ${Math.round(p.pct * 100)}%`);
      }
      lines.push("");
    }
  }

  if (lines.length === 1) {
    lines.push("No other scouts are working on the same advancements right now.");
  }

  lines.push("Tip: Working with scouts at the same level helps you both stay motivated and practice skills together.");
  return lines.join("\n");
}

/** Find scouts who completed what this scout needs and could help teach. */
async function canHelpMe(userId: string, rankName?: string): Promise<string> {
  // Get this scout's started-but-incomplete requirements
  const myStarted = await graphQuery<{
    reqId: number; reqNumber: string; reqName: string; advName: string; advId: number;
  }>(
    `MATCH (s:Scout {userId: $userId})-[:STARTED_REQ]->(req:Requirement) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN req.reqId AS reqId, req.reqNumber AS reqNumber, req.reqName AS reqName, ` +
    `adv.name AS advName, adv.advancementId AS advId ` +
    `ORDER BY adv.name, req.reqNumber`,
    { userId }
  );

  if (myStarted.length === 0) {
    return "You don't have any started-but-incomplete requirements. Ask your Scoutmaster about what to work on next!";
  }

  // Filter to rank if specified
  const filtered = rankName
    ? myStarted.filter(r => r.advName.toLowerCase().includes(rankName.toLowerCase()))
    : myStarted;

  const target = filtered.length > 0 ? filtered : myStarted;

  // For each of my incomplete reqs, find scouts who completed them
  const lines = ["SCOUTS WHO CAN HELP YOU\n"];
  const helpers = new Map<string, string[]>(); // scout name -> list of reqs they can help with

  for (const req of target.slice(0, 15)) {
    const completers = await graphQuery<{ scout: string }>(
      `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement {reqId: $reqId, advancementId: $advId}) ` +
      `WHERE s.userId <> $userId ` +
      `RETURN s.name AS scout`,
      { reqId: req.reqId, advId: req.advId, userId }
    );

    for (const c of completers) {
      const arr = helpers.get(c.scout) || [];
      arr.push(`${req.advName} ${req.reqNumber}`);
      helpers.set(c.scout, arr);
    }
  }

  if (helpers.size === 0) {
    lines.push("No scouts found who completed your in-progress requirements. You might be the trailblazer!");
    return lines.join("\n");
  }

  // Sort by most helpful (most overlapping completed reqs)
  const sorted = [...helpers.entries()].sort((a, b) => b[1].length - a[1].length);

  lines.push(`You have ${target.length} requirements in progress. Here's who can help:\n`);
  for (const [name, reqs] of sorted.slice(0, 8)) {
    lines.push(`${name} — can help with ${reqs.length} of your requirements:`);
    for (const r of reqs.slice(0, 5)) {
      lines.push(`  - ${r}`);
    }
    lines.push("");
  }

  lines.push("Tip: Ask these scouts if they'd be willing to practice together or show you how they completed the requirement.");
  return lines.join("\n");
}

/** Find what this scout could teach to younger/newer scouts. */
async function iCanHelp(userId: string): Promise<string> {
  // Get this scout's name and completed requirements
  const myInfo = await graphQuery<{ name: string }>(
    `MATCH (s:Scout {userId: $userId}) RETURN s.name AS name`,
    { userId }
  );
  const myName = myInfo[0]?.name ?? "You";

  // Find requirements I completed that other scouts have started but not finished
  const teachOpportunities = await graphQuery<{
    learner: string; reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (me:Scout {userId: $userId})-[:COMPLETED_REQ]->(req:Requirement) ` +
    `MATCH (other:Scout)-[:STARTED_REQ]->(req) ` +
    `WHERE other.userId <> $userId ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN other.name AS learner, req.reqNumber AS reqNumber, req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY adv.name, other.name`,
    { userId }
  );

  // Check if I have EDGE teaching experience
  const edgeCompleted = await graphQuery<{ reqNumber: string }>(
    `MATCH (s:Scout {userId: $userId})-[:COMPLETED_REQ]->(req:Requirement) ` +
    `WHERE (req.advancementId = 6 AND req.reqNumber = '6') ` +
    `   OR (req.advancementId = 2 AND req.reqNumber = '8') ` +
    `RETURN req.reqNumber AS reqNumber`,
    { userId }
  );

  const lines = [`WHAT ${myName.toUpperCase()} CAN TEACH\n`];

  if (edgeCompleted.length > 0) {
    lines.push("You've completed Teaching EDGE requirements — you're a proven peer instructor!\n");
  }

  if (teachOpportunities.length === 0) {
    lines.push("No scouts currently have started-but-incomplete requirements that match what you've completed.");
    lines.push("But you can still help! Ask your Scoutmaster about teaching at the next troop meeting.");
    return lines.join("\n");
  }

  // Group by learner
  const byLearner = new Map<string, string[]>();
  for (const t of teachOpportunities) {
    const arr = byLearner.get(t.learner) || [];
    arr.push(`${t.advName} Req ${t.reqNumber}`);
    byLearner.set(t.learner, arr);
  }

  // Sort by most teachable (most shared reqs)
  const sorted = [...byLearner.entries()].sort((a, b) => b[1].length - a[1].length);

  lines.push(`You can help ${sorted.length} scouts with requirements you've already completed:\n`);
  for (const [name, reqs] of sorted.slice(0, 8)) {
    lines.push(`${name} — you could help with ${reqs.length} requirements:`);
    for (const r of reqs.slice(0, 4)) {
      lines.push(`  - ${r}`);
    }
    lines.push("");
  }

  lines.push("Teaching is one of the best ways to lock in what you've learned.");
  if (edgeCompleted.length === 0) {
    lines.push("Bonus: helping teach younger scouts counts toward your leadership experience for Star, Life, and Eagle!");
  }

  return lines.join("\n");
}

/** Find requirements two scouts could work on together. */
async function nextTogether(userId: string, friendName: string): Promise<string> {
  if (!friendName) {
    return "Tell me which scout you want to work with! Say their name and I'll find what you can do together.";
  }

  // Find the friend's userId
  const friend = await graphQuery<{ userId: string; name: string }>(
    `MATCH (s:Scout) WHERE toLower(s.name) CONTAINS toLower($name) ` +
    `RETURN s.userId AS userId, s.name AS name LIMIT 3`,
    { name: friendName }
  );

  if (friend.length === 0) {
    return `Couldn't find a scout matching "${friendName}" in the troop roster.`;
  }

  const friendId = friend[0].userId;
  const friendFullName = friend[0].name;

  // Find requirements both scouts have started but not completed
  const shared = await graphQuery<{
    reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (me:Scout {userId: $userId})-[:STARTED_REQ]->(req:Requirement) ` +
    `MATCH (friend:Scout {userId: $friendId})-[:STARTED_REQ]->(req) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN req.reqNumber AS reqNumber, req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY adv.name, req.reqNumber`,
    { userId, friendId }
  );

  // Find requirements I completed that friend needs
  const iCanTeach = await graphQuery<{
    reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (me:Scout {userId: $userId})-[:COMPLETED_REQ]->(req:Requirement) ` +
    `MATCH (friend:Scout {userId: $friendId})-[:STARTED_REQ]->(req) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN req.reqNumber AS reqNumber, req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY adv.name LIMIT 10`,
    { userId, friendId }
  );

  // Find requirements friend completed that I need
  const friendCanTeach = await graphQuery<{
    reqNumber: string; reqName: string; advName: string;
  }>(
    `MATCH (friend:Scout {userId: $friendId})-[:COMPLETED_REQ]->(req:Requirement) ` +
    `MATCH (me:Scout {userId: $userId})-[:STARTED_REQ]->(req) ` +
    `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
    `RETURN req.reqNumber AS reqNumber, req.reqName AS reqName, adv.name AS advName ` +
    `ORDER BY adv.name LIMIT 10`,
    { userId, friendId }
  );

  const lines = [`WORKING TOGETHER WITH ${friendFullName.toUpperCase()}\n`];

  if (shared.length > 0) {
    lines.push(`Requirements you're BOTH working on (${shared.length}):`);
    for (const r of shared.slice(0, 10)) {
      lines.push(`  - ${r.advName} Req ${r.reqNumber}: ${r.reqName.substring(0, 80)}`);
    }
    lines.push("\n  These are great to practice together!\n");
  }

  if (iCanTeach.length > 0) {
    lines.push(`Requirements YOU could help ${friendFullName} with (${iCanTeach.length}):`);
    for (const r of iCanTeach.slice(0, 6)) {
      lines.push(`  - ${r.advName} Req ${r.reqNumber}: ${r.reqName.substring(0, 80)}`);
    }
    lines.push("");
  }

  if (friendCanTeach.length > 0) {
    lines.push(`Requirements ${friendFullName} could help YOU with (${friendCanTeach.length}):`);
    for (const r of friendCanTeach.slice(0, 6)) {
      lines.push(`  - ${r.advName} Req ${r.reqNumber}: ${r.reqName.substring(0, 80)}`);
    }
    lines.push("");
  }

  if (shared.length === 0 && iCanTeach.length === 0 && friendCanTeach.length === 0) {
    lines.push(`No shared in-progress requirements found between you and ${friendFullName}.`);
    lines.push("You might be at different stages — but you can still work together on merit badges or service projects!");
  }

  return lines.join("\n");
}
