/** Tool: create_pending_action
 * Creates a pending action that the user can review and approve via a micro-app.
 * Returns a link the AI can share in chat.
 */

import { createPendingAction, type ActionType } from "../pending-action.js";

export interface CreatePendingActionInput {
  type: ActionType;
  payload: Record<string, unknown>;
  createdBy: string;
  scoutUserId?: string;
}

/** Base URL for action micro-apps. Configured via FRONTEND_URL env var. */
function getActionUrl(actionId: string, type: ActionType): string {
  const base = process.env.FRONTEND_URL ?? "";
  switch (type) {
    case "send_email":
      return `${base}/email?action=${actionId}`;
    case "advance_requirement":
      return `${base}/actions?id=${actionId}`;
    case "rsvp_event":
      return `${base}/actions?id=${actionId}`;
    default:
      return `${base}/actions?id=${actionId}`;
  }
}

export async function createPendingActionTool(
  input: CreatePendingActionInput
): Promise<string> {
  try {
    const actionId = await createPendingAction(
      input.type,
      input.payload,
      input.createdBy,
      input.scoutUserId
    );
    const url = getActionUrl(actionId, input.type);

    switch (input.type) {
      case "send_email":
        return (
          `Email draft created. The scout can review and send it here:\n${url}\n\n` +
          `Subject: ${input.payload.subject ?? "(no subject)"}\n` +
          `To: ${JSON.stringify(input.payload.toMemberIds ?? [])}\n` +
          `This link expires in 1 hour.`
        );
      case "advance_requirement":
        return (
          `Requirement advancement queued for review:\n${url}\n\n` +
          `This link expires in 1 hour.`
        );
      case "rsvp_event":
        return (
          `RSVP queued for review:\n${url}\n\n` +
          `This link expires in 1 hour.`
        );
      default:
        return `Action created: ${url}\nThis link expires in 1 hour.`;
    }
  } catch (err) {
    return `Failed to create action: ${err instanceof Error ? err.message : String(err)}`;
  }
}
