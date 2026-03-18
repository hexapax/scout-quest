/** Tool: log_activity
 * Records a service project or other activity in BSA Scoutbook.
 * Requires a valid BSA token (leader-approved activities).
 */

import { getScoutQuestDb } from "../db.js";
import {
  logActivity,
  BsaTokenMissingError,
  BsaApiError,
} from "../bsa-api.js";
import { getBsaToken } from "../bsa-token.js";

interface RosterEntry {
  userId: number;
  personGuid: string;
  memberId: number;
}

/** Look up personGuid and memberId for a userId from local roster data. */
async function lookupRosterEntry(userId: number): Promise<RosterEntry | null> {
  try {
    const db = getScoutQuestDb();
    // Try youth roster first, then adults
    for (const coll of ["scoutbook_scouts", "scoutbook_adults"]) {
      const doc = await db.collection(coll).findOne(
        { userId },
        { projection: { userId: 1, personGuid: 1, memberId: 1 } }
      );
      if (doc) {
        return {
          userId: Number(doc.userId),
          personGuid: String(doc.personGuid ?? ""),
          memberId: Number(doc.memberId ?? 0),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface ActivityParticipantInput {
  userId: string;
  serviceHours: number;
}

export interface LogActivityInput {
  name: string;
  startDateTime: string;    // ISO datetime
  endDateTime: string;      // ISO datetime
  location: string;
  city: string;
  description: string;
  activityTypeId: number;   // 1 = Service Project
  categoryId: number;       // 47 = Service confirmed
  participants: ActivityParticipantInput[];
}

export async function logActivityTool(input: LogActivityInput): Promise<string> {
  const tokenDoc = await getBsaToken();
  if (!tokenDoc) {
    return "Cannot log activity: no valid BSA token. A leader needs to store a fresh token.";
  }

  const leaderUserId = Number(tokenDoc.leaderUserId);
  const leaderRoster = await lookupRosterEntry(leaderUserId);
  if (!leaderRoster) {
    return `Cannot log activity: could not find leader userId ${leaderUserId} in roster. Check that the BSA token's leaderUserId matches a known adult.`;
  }

  // Resolve all participant roster entries
  const resolvedParticipants = [];
  const missing: string[] = [];
  for (const p of input.participants) {
    const entry = await lookupRosterEntry(Number(p.userId));
    if (!entry) {
      missing.push(p.userId);
      continue;
    }
    resolvedParticipants.push({
      ...entry,
      serviceHours: p.serviceHours,
      isLeader: entry.userId === leaderUserId,
    });
  }

  // Always include the leader
  if (!resolvedParticipants.some((p) => p.userId === leaderUserId)) {
    resolvedParticipants.push({
      ...leaderRoster,
      serviceHours: 0,
      isLeader: true,
    });
  }

  if (missing.length > 0) {
    return `Cannot log activity: roster lookup failed for userIds: ${missing.join(", ")}. Verify the participant IDs.`;
  }

  try {
    const result = await logActivity({
      name: input.name,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      location: input.location,
      city: input.city,
      description: input.description,
      activityTypeId: input.activityTypeId,
      categoryId: input.categoryId,
      leaderUserId,
      leaderPersonGuid: leaderRoster.personGuid,
      leaderMemberId: leaderRoster.memberId,
      participants: resolvedParticipants,
    });

    const res = result as { message?: string; activityId?: number };
    if (res?.activityId) {
      const youth = resolvedParticipants.filter((p) => !p.isLeader).length;
      return `Activity "${input.name}" logged successfully (activityId: ${res.activityId}, ${youth} youth participant${youth !== 1 ? "s" : ""}).`;
    }
    return `BSA API response: ${JSON.stringify(result)}`;
  } catch (err) {
    if (err instanceof BsaTokenMissingError) {
      return "BSA token expired or missing. Please store a fresh token.";
    }
    if (err instanceof BsaApiError) {
      if (err.status === 401) {
        return "BSA token is expired (401). A leader needs to log in again and store a fresh token.";
      }
      return `BSA API error (${err.status}): ${err.body}`;
    }
    return `Error logging activity: ${err instanceof Error ? err.message : String(err)}`;
  }
}
