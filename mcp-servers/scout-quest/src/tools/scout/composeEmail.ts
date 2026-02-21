import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, emailsSent } from "../../db.js";
import { enforceYptCc } from "../../validation.js";

export function registerComposeEmail(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "compose_email",
    {
      title: "Compose Email",
      description: "Generate a mailto: link for the scout. ALWAYS includes parent/guardian in CC (YPT requirement — non-negotiable).",
      inputSchema: {
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Email body text"),
        context: z.string().describe("Why is this email being sent (for audit log)"),
      },
    },
    async ({ to, subject, body, context }) => {
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { content: [{ type: "text", text: "Error: Scout profile not found." }] };
      }

      const parentEmail = scout.parent_guardian.email;
      if (!parentEmail) {
        return { content: [{ type: "text", text: "Error: No parent/guardian email configured. Cannot send email without YPT compliance." }] };
      }

      // YPT enforcement: parent is ALWAYS in CC
      const cc = enforceYptCc([], parentEmail);

      // Build mailto link
      const ccParam = cc.map(e => encodeURIComponent(e)).join(",");
      const mailtoLink = `mailto:${encodeURIComponent(to)}?cc=${ccParam}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      // Log the email for audit
      const emailCol = await emailsSent();
      await emailCol.insertOne({
        scout_email: scoutEmail,
        date: new Date(),
        to,
        cc,
        subject,
        context,
      });

      return {
        content: [{
          type: "text",
          text: [
            `**Email Ready**`,
            `To: ${to}`,
            `CC: ${cc.join(", ")} (YPT — parent/guardian always copied)`,
            `Subject: ${subject}`,
            "",
            `Click to send: ${mailtoLink}`,
            "",
            `_Youth Protection Training requires that a parent/guardian is always copied on scout communications._`,
          ].join("\n"),
        }],
      };
    },
  );
}
