/** Tool: advance_requirement
 * Marks a rank requirement as complete in BSA Scoutbook.
 * Requires a valid BSA token stored via POST /bsa-token.
 */

import { getScoutQuestDb } from "../db.js";
import {
  advanceRequirement,
  addComment,
  BsaTokenMissingError,
  BsaApiError,
  ORG_GUID,
} from "../bsa-api.js";
import { getBsaToken } from "../bsa-token.js";
import { graphQuery } from "../falkordb.js";

interface ReqNode {
  reqId: string;
  advancementId: string;
  versionId?: string;
}

/** Resolve rank name → BSA rankId via MongoDB scoutbook_requirements. */
async function resolveRankId(rankName: string): Promise<number | null> {
  try {
    const db = getScoutQuestDb();
    const doc = await db.collection("scoutbook_advancement").findOne(
      { type: "rank", name: { $regex: new RegExp(rankName, "i") } },
      { projection: { advancementId: 1 } }
    );
    return doc ? Number(doc.advancementId) : null;
  } catch {
    return null;
  }
}

/** Look up requirementId from graph by rank name + requirement number. */
async function resolveRequirementId(
  rankName: string,
  requirementNumber: string
): Promise<{ requirementId: number; advancementId: number; versionId: number } | null> {
  try {
    const rows = await graphQuery<ReqNode>(
      `MATCH (a:Advancement {name: $rankName})-[:HAS_REQUIREMENT]->(r:Requirement {reqNumber: $reqNum})
       RETURN r.reqId AS reqId, a.advancementId AS advancementId, r.versionId AS versionId
       LIMIT 1`,
      { rankName, reqNum: requirementNumber }
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      requirementId: Number(row.reqId),
      advancementId: Number(row.advancementId),
      versionId: Number(row.versionId ?? 0),
    };
  } catch {
    return null;
  }
}

export interface AdvanceRequirementInput {
  scoutUserId: string;
  rankName: string;
  requirementNumber: string;
  dateCompleted: string;        // YYYY-MM-DD
  notes?: string;
}

export async function advanceRequirementTool(
  input: AdvanceRequirementInput
): Promise<string> {
  const tokenDoc = await getBsaToken();
  if (!tokenDoc) {
    return "Cannot mark requirement: no valid BSA token. A leader needs to log in to my.scouting.org and store the token.";
  }

  // Resolve requirement IDs
  const reqInfo = await resolveRequirementId(input.rankName, input.requirementNumber);
  if (!reqInfo) {
    return `Could not find requirement ${input.requirementNumber} for ${input.rankName} in the knowledge graph. Verify the rank name and requirement number are correct.`;
  }

  try {
    const result = await advanceRequirement({
      rankId: reqInfo.advancementId,
      scoutUserId: Number(input.scoutUserId),
      leaderUserId: Number(tokenDoc.leaderUserId),
      requirements: [
        {
          requirementId: reqInfo.requirementId,
          completed: true,
          started: true,
          approved: true,
          dateCompleted: input.dateCompleted,
          leaderApprovedUserId: Number(tokenDoc.leaderUserId),
        },
      ],
    });

    // Add a comment if notes provided
    if (input.notes && reqInfo.versionId) {
      try {
        await addComment({
          scoutUserId: Number(input.scoutUserId),
          leaderUserId: Number(tokenDoc.leaderUserId),
          advancementId: reqInfo.advancementId,
          advancementType: "ranks",
          versionId: reqInfo.versionId,
          requirementId: reqInfo.requirementId,
          body: input.notes,
        });
      } catch {
        // Comment failure is non-fatal
      }
    }

    const resultArr = result as Array<{ requirements?: Array<{ status?: string; message?: string }> }>;
    const reqResult = resultArr?.[0]?.requirements?.[0];
    if (reqResult?.status === "Success") {
      return (
        `✓ Requirement ${input.requirementNumber} of ${input.rankName} marked complete in Scoutbook` +
        (input.notes ? " (with notes)" : "") +
        "."
      );
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
    return `Error marking requirement: ${err instanceof Error ? err.message : String(err)}`;
  }
}
