/** Consolidated onboarding tool: setup_scout
 * Replaces setup_scout_profile + set_scout_interests (2 tools → 1).
 * Creates or updates a scout profile and sets interests in one call.
 * Scout profiles come from Scoutbook sync in production, but this tool
 * handles initial Quest System config for a scout.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { users, scouts, setupStatus } from "../../db.js";
import { SETUP_STEPS, getAgeDefaults } from "./constants.js";

export function registerSetupScout(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "setup_scout",
    {
      title: "Setup Scout",
      description:
        "Initialize a scout in the Quest System and optionally set their interests. " +
        "Creates the scout profile if it doesn't exist; updates interests if they do. " +
        "Call once at the start of onboarding — or when updating a scout's interests. " +
        "Do NOT call if the scout is already fully set up (check get_onboarding_status first).",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email address"),
        name: z.string().describe("Scout's full name"),
        age: z.number().int().min(10).max(18).describe("Scout's age (10-18)"),
        troop: z.string().describe("Troop number, e.g., \"2024\""),
        patrol: z.string().optional().describe("Patrol name"),
        interests: z
          .object({
            likes: z.array(z.string()).describe("Things the scout enjoys"),
            dislikes: z.array(z.string()).describe("Things the scout dislikes"),
            motivations: z.array(z.string()).describe("What motivates the scout"),
          })
          .optional()
          .describe("Optional: seed interests. Can be set later via update."),
      },
    },
    async ({ scout_email, name, age, troop, patrol, interests }) => {
      const now = new Date();
      const scoutsCol = await scouts();
      const usersCol = await users();
      const statusCol = await setupStatus();

      const existing = await scoutsCol.findOne({ email: scout_email });

      if (existing) {
        // Scout already exists — update interests only
        const roles = await getUserRoles(guideEmail);
        const guideRole = roles.find((r) => r.type === "guide");
        if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
          return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
        }

        if (interests) {
          await scoutsCol.updateOne(
            { email: scout_email },
            { $set: { interests, updated_at: now } }
          );
          await statusCol.updateOne(
            { scout_email, "steps.id": "interests" },
            { $set: { "steps.$.status": "complete", "steps.$.completed_at": now, updated_at: now } }
          );
          return {
            content: [{
              type: "text",
              text: `Scout ${name} already set up. Interests updated: ${interests.likes.length} likes, ${interests.dislikes.length} dislikes, ${interests.motivations.length} motivations.`,
            }],
          };
        }
        return { content: [{ type: "text", text: `Scout ${scout_email} already exists. No changes made.` }] };
      }

      // Create scout user record
      await usersCol.updateOne(
        { email: scout_email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email: scout_email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true }
      );

      // Link scout to this guide
      await usersCol.updateOne(
        { email: guideEmail },
        {
          $set: { updated_at: now },
          $addToSet: { roles: { type: "guide" as const, scout_emails: [scout_email] } },
          $setOnInsert: { email: guideEmail, created_at: now },
        },
        { upsert: true }
      );

      // Create scout document
      await scoutsCol.insertOne({
        email: scout_email,
        name,
        age,
        troop,
        patrol,
        guide_email: guideEmail,
        interests: interests ?? { likes: [], dislikes: [], motivations: [] },
        quest_state: {
          goal_item: "", goal_description: "", target_budget: 0,
          savings_capacity: 0, loan_path_active: false,
          quest_start_date: null, current_savings: 0, quest_status: "setup",
        },
        character: {
          base: "guide", quest_overlay: "custom", tone_dial: 3,
          domain_intensity: 3, tone_min: 1, tone_max: 5,
          domain_min: 1, domain_max: 5, sm_notes: "", parent_notes: "",
          avoid: [], calibration_review_enabled: false, calibration_review_weeks: [],
        },
        counselors: {
          personal_management: { name: "", email: "" },
          family_life: { name: "", email: "" },
        },
        unit_leaders: { scoutmaster: { name: "", email: "" } },
        parent_guardian: { name: "", email: guideEmail },
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now,
        updated_at: now,
      });

      // Initialize setup status with age-appropriate defaults
      const defaults = getAgeDefaults(age);
      await statusCol.insertOne({
        scout_email,
        guide_email: guideEmail,
        steps: SETUP_STEPS.map((s) => ({
          ...s,
          status:
            s.id === "profile" || (s.id === "interests" && interests)
              ? ("complete" as const)
              : defaults[s.id] === "delegated"
              ? ("delegated_to_scout" as const)
              : ("pending" as const),
          completed_at: s.id === "profile" || (s.id === "interests" && interests) ? now : undefined,
          delegated_at: defaults[s.id] === "delegated" ? now : undefined,
        })),
        created_at: now,
        updated_at: now,
      });

      const parts = [`Scout "${name}" (${scout_email}) created in troop ${troop}`];
      if (interests) parts.push(`with interests (${interests.likes.length} likes)`);
      parts.push(`Linked to guide ${guideEmail}.`);
      return { content: [{ type: "text", text: parts.join(". ") + " Onboarding started." }] };
    }
  );
}
