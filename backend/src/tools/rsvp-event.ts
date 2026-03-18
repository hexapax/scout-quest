/** Tool: rsvp_event
 * RSVPs a scout (or the leader on behalf of a scout) to a BSA calendar event.
 * Requires a valid BSA token.
 */

import { rsvpEvent, BsaTokenMissingError, BsaApiError, type RsvpCode } from "../bsa-api.js";
import { getBsaToken } from "../bsa-token.js";

export interface RsvpEventInput {
  eventId: string;          // BSA event ID
  scoutUserId: string;      // userId to RSVP for
  rsvpCode: string;         // "Y", "M", or "N"
}

const RSVP_LABELS: Record<string, string> = {
  Y: "YES",
  M: "maybe",
  N: "no",
};

export async function rsvpEventTool(input: RsvpEventInput): Promise<string> {
  const tokenDoc = await getBsaToken();
  if (!tokenDoc) {
    return "Cannot RSVP: no valid BSA token. A leader needs to store a fresh token.";
  }

  const code = input.rsvpCode.toUpperCase() as RsvpCode;
  if (!["Y", "M", "N"].includes(code)) {
    return `Invalid RSVP code "${input.rsvpCode}". Use Y (yes), M (maybe), or N (no).`;
  }

  try {
    const result = await rsvpEvent({
      eventId: Number(input.eventId),
      userId: Number(input.scoutUserId),
      rsvpCode: code,
    });

    const arr = result as Array<{ message?: string }>;
    const msg = arr?.[0]?.message ?? "Updated";
    if (msg.toLowerCase().includes("success") || msg.toLowerCase().includes("updated")) {
      return `RSVP recorded: ${RSVP_LABELS[code]} for event ${input.eventId}.`;
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
    return `Error RSVPing to event: ${err instanceof Error ? err.message : String(err)}`;
  }
}
