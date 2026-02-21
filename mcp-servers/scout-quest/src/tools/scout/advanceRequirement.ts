import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requirements } from "../../db.js";
import { isValidTransition } from "../../validation.js";
import type { RequirementStatus } from "../../types.js";

export function registerAdvanceRequirement(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "advance_requirement",
    {
      title: "Advance Requirement",
      description: "Move a requirement to the next status in the state machine. Scouts cannot set 'signed_off' (admin only).",
      inputSchema: {
        req_id: z.string().describe("Requirement ID (e.g. pm_1a, fl_3)"),
        new_status: z.string().describe("Target status"),
        notes: z.string().optional().describe("Notes about this transition"),
        document: z.object({
          name: z.string(),
          content: z.string(),
        }).optional().describe("Deliverable document to attach"),
      },
    },
    async ({ req_id, new_status, notes, document }) => {
      // Block scouts from setting signed_off
      if (new_status === "signed_off") {
        return { content: [{ type: "text", text: "Error: Only an admin can sign off requirements. Submit it for review instead." }] };
      }

      const col = await requirements();
      const req = await col.findOne({ scout_email: scoutEmail, req_id });
      if (!req) {
        return { content: [{ type: "text", text: `Error: Requirement ${req_id} not found.` }] };
      }

      if (!isValidTransition(req.status, new_status as RequirementStatus)) {
        return {
          content: [{
            type: "text",
            text: `Error: Cannot transition ${req_id} from "${req.status}" to "${new_status}". Check the requirement state machine.`,
          }],
        };
      }

      const update: Record<string, unknown> = {
        status: new_status as RequirementStatus,
        updated_at: new Date(),
      };

      if (notes) {
        update.notes = req.notes ? `${req.notes}\n${notes}` : notes;
      }

      if (new_status === "tracking") {
        update.tracking_start_date = new Date();
      }

      if (new_status === "submitted") {
        update.submitted_to_counselor_date = new Date();
      }

      // Handle document attachment
      if (document) {
        await col.updateOne(
          { scout_email: scoutEmail, req_id },
          {
            $set: update,
            $push: {
              documents: {
                name: document.name,
                content: document.content,
                submitted_date: new Date(),
              },
            } as Record<string, unknown>,
          },
        );
      } else {
        await col.updateOne(
          { scout_email: scoutEmail, req_id },
          { $set: update },
        );
      }

      return {
        content: [{
          type: "text",
          text: `Requirement ${req_id}: ${req.status} → ${new_status}.${document ? ` Document "${document.name}" attached.` : ""}`,
        }],
      };
    },
  );
}
