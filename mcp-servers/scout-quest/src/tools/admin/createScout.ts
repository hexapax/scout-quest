import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { users, scouts } from "../../db.js";

export function registerCreateScout(server: McpServer): void {
  server.registerTool(
    "create_scout",
    {
      title: "Create Scout",
      description: "Create a new scout profile with parent info and empty quest state. Also creates user doc with scout role.",
      inputSchema: {
        email: z.string().email().describe("Scout's Gmail address"),
        name: z.string().describe("Scout's full name"),
        age: z.number().int().min(10).max(18).describe("Scout's age (10-18)"),
        troop: z.string().describe("Troop number/identifier"),
        patrol: z.string().optional().describe("Patrol name"),
        parent_name: z.string().describe("Parent/guardian name"),
        parent_email: z.string().email().describe("Parent/guardian email"),
      },
    },
    async ({ email, name, age, troop, patrol, parent_name, parent_email }) => {
      const scoutsCol = await scouts();
      const usersCol = await users();

      const existing = await scoutsCol.findOne({ email });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Scout with email ${email} already exists.` }] };
      }

      const now = new Date();

      await usersCol.updateOne(
        { email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true },
      );

      // Also create parent user if not exists
      await usersCol.updateOne(
        { email: parent_email },
        {
          $set: { updated_at: now },
          $addToSet: { roles: { type: "parent" as const, scout_emails: [email] } },
          $setOnInsert: { email: parent_email, created_at: now },
        },
        { upsert: true },
      );

      await scoutsCol.insertOne({
        email,
        name,
        age,
        troop,
        patrol,
        quest_state: {
          goal_item: "",
          goal_description: "",
          target_budget: 0,
          savings_capacity: 0,
          loan_path_active: false,
          quest_start_date: null,
          current_savings: 0,
          quest_status: "setup",
        },
        character: {
          base: "guide",
          quest_overlay: "custom",
          tone_dial: 3,
          domain_intensity: 3,
          tone_min: 1,
          tone_max: 5,
          domain_min: 1,
          domain_max: 5,
          sm_notes: "",
          parent_notes: "",
          avoid: [],
          calibration_review_enabled: false,
          calibration_review_weeks: [],
        },
        counselors: {
          personal_management: { name: "", email: "" },
          family_life: { name: "", email: "" },
        },
        unit_leaders: {
          scoutmaster: { name: "", email: "" },
        },
        parent_guardian: { name: parent_name, email: parent_email },
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now,
        updated_at: now,
      });

      return {
        content: [{
          type: "text",
          text: `Scout "${name}" (${email}) created in troop ${troop}. Parent: ${parent_name} (${parent_email}). Quest status: setup. Next: configure quest goal and character.`,
        }],
      };
    },
  );
}
