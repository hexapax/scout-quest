/** BSA Scoutbook API HTTP client.
 * All calls require a valid JWT stored via bsa-token.ts.
 * Base URL: https://api.scouting.org
 *
 * Troop 2024 constants are sourced from the BSA API reference doc.
 */

import { getBsaToken } from "./bsa-token.js";

const BSA_BASE = "https://api.scouting.org";

// Troop 2024 constants
export const ORG_GUID = "E1D07881-103D-43D8-92C4-63DEFDC05D48";
export const UNIT_ID = 121894;

/** Thrown when no valid BSA token is available. */
export class BsaTokenMissingError extends Error {
  constructor() {
    super("No valid BSA token. A leader must log in to my.scouting.org and store the token via POST /bsa-token.");
    this.name = "BsaTokenMissingError";
  }
}

/** Thrown when the BSA API returns a non-2xx response. */
export class BsaApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`BSA API error ${status}: ${body}`);
    this.name = "BsaApiError";
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const tokenDoc = await getBsaToken();
  if (!tokenDoc) throw new BsaTokenMissingError();
  return {
    Authorization: `bearer ${tokenDoc.token}`,
    "Content-Type": "application/json",
    Origin: "https://advancements.scouting.org",
    Referer: "https://advancements.scouting.org/",
  };
}

async function bsaFetch(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BSA_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new BsaApiError(res.status, text);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Write: Mark requirement complete
// ---------------------------------------------------------------------------

export interface RequirementUpdate {
  requirementId: number;    // BSA requirement ID (from graph)
  completed: boolean;
  started: boolean;
  approved: boolean;
  dateCompleted: string;    // YYYY-MM-DD when scout did the work
  leaderApprovedUserId: number;
}

export interface AdvanceRequirementParams {
  rankId: number;
  scoutUserId: number;
  leaderUserId: number;
  requirements: RequirementUpdate[];
}

export async function advanceRequirement(
  params: AdvanceRequirementParams
): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const payload = [
    {
      userId: params.scoutUserId,
      organizationGuid: ORG_GUID,
      requirements: params.requirements.map((r) => ({
        id: r.requirementId,
        completed: r.completed,
        started: r.started,
        approved: r.approved,
        dateCompleted: r.dateCompleted,
        dateStarted: r.dateCompleted,
        markedCompletedDate: today,
        leaderApprovedDate: today,
        leaderApprovedUserId: params.leaderUserId,
      })),
    },
  ];
  return bsaFetch("POST", `/advancements/v2/youth/ranks/${params.rankId}/requirements`, payload);
}

// ---------------------------------------------------------------------------
// Write: Add comment to advancement
// ---------------------------------------------------------------------------

export interface AddCommentParams {
  scoutUserId: number;
  leaderUserId: number;
  advancementId: number;
  advancementType: "ranks" | "meritBadges" | "awards";
  versionId: number;
  requirementId: number;
  body: string;
}

export async function addComment(params: AddCommentParams): Promise<unknown> {
  const payload = {
    advancementId: params.advancementId,
    advancementType: params.advancementType,
    body: params.body,
    scoutUserId: params.scoutUserId,
    subject: "subject-post",
    userId: params.leaderUserId,
    versionId: params.versionId,
    requirementId: params.requirementId,
  };
  return bsaFetch("POST", `/advancements/v2/users/${params.leaderUserId}/comments/add`, payload);
}

// ---------------------------------------------------------------------------
// Write: RSVP to event
// ---------------------------------------------------------------------------

export type RsvpCode = "Y" | "M" | "N";

export interface RsvpEventParams {
  eventId: number;
  userId: number;
  rsvpCode: RsvpCode;
}

export async function rsvpEvent(params: RsvpEventParams): Promise<unknown> {
  return bsaFetch("PUT", `/advancements/v2/events/${params.eventId}/invitees`, {
    users: [{ userId: params.userId, rsvpCode: params.rsvpCode }],
  });
}

// ---------------------------------------------------------------------------
// Write: Log activity (service project)
// ---------------------------------------------------------------------------

export interface ActivityParticipant {
  userId: number;
  personGuid: string;
  memberId: number;
  serviceHours: number;
  isLeader: boolean;
}

export interface LogActivityParams {
  name: string;
  startDateTime: string;   // ISO string
  endDateTime: string;     // ISO string
  location: string;
  city: string;
  description: string;
  activityTypeId: number;  // 1 = Service Project
  categoryId: number;      // 47 = confirmed for service
  leaderUserId: number;
  leaderPersonGuid: string;
  leaderMemberId: number;
  participants: ActivityParticipant[];
}

export async function logActivity(params: LogActivityParams): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    activityTypeId: params.activityTypeId,
    categoryId: params.categoryId,
    name: params.name,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    location: params.location,
    city: params.city,
    description: params.description,
    isPersonalActivity: false,
    hostOrganizationGuid: ORG_GUID,
    organizationGuid: ORG_GUID,
    isEveryChildOrg: false,
    registeredAdults: params.participants
      .filter((p) => p.isLeader)
      .map((p) => ({
        userId: p.userId,
        note: "N/A",
        organizationGuid: ORG_GUID,
        isApproved: true,
        leaderApprovedDate: today,
        leaderApprovedId: params.leaderUserId,
        personGuid: p.personGuid,
        memberId: p.memberId,
        activityValues: [{ activityValueTypeId: 1, activityValue: p.serviceHours }],
      })),
    registeredYouths: params.participants
      .filter((p) => !p.isLeader)
      .map((p) => ({
        userId: p.userId,
        note: "N/A",
        organizationGuid: ORG_GUID,
        isApproved: true,
        leaderApprovedDate: today,
        leaderApprovedId: params.leaderUserId,
        personGuid: p.personGuid,
        memberId: p.memberId,
        activityValues: [{ activityValueTypeId: 1, activityValue: p.serviceHours }],
      })),
    benefitGroup: JSON.stringify({
      SFF: false, SFF_foodLb: 0, SFCW: false,
      SFCW_wasteLb: 0, SFCW_plasticLb: 0,
      MOP: false, BUCO: false,
    }),
  };
  return bsaFetch("POST", "/advancements/v2/activities/add", payload);
}
