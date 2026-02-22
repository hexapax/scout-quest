import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { users, scouts, setupStatus } from "../../db.js";
import { SETUP_STEPS, getAgeDefaults } from "./constants.js";

export function registerSetupScoutProfile(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "setup_scout_profile",
    {
      title: "Setup Scout Profile",
      description: "Create a scout profile and link them to this guide. Sets up onboarding checklist with age-appropriate defaults.",
      inputSchema: {
        email: z.string().email().describe("Scout's email address"),
        name: z.string().describe("Scout's full name"),
        age: z.number().int().min(10).max(18).describe("Scout's age (10-18)"),
        troop: z.string().describe("Troop number"),
        patrol: z.string().optional().describe("Patrol name"),
      },
    },
    async ({ email, name, age, troop, patrol }) => {
      const scoutsCol = await scouts();
      const usersCol = await users();

      const existing = await scoutsCol.findOne({ email });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Scout ${email} already exists.` }] };
      }

      const now = new Date();

      // Create scout user
      await usersCol.updateOne(
        { email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true },
      );

      // Create/update guide user with guide role
      await usersCol.updateOne(
        { email: guideEmail },
        {
          $set: { updated_at: now },
          $addToSet: { roles: { type: "guide" as const, scout_emails: [email] } },
          $setOnInsert: { email: guideEmail, created_at: now },
        },
        { upsert: true },
      );

      // Create scout document
      await scoutsCol.insertOne({
        email,
        name,
        age,
        troop,
        patrol,
        guide_email: guideEmail,
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

      // Create setup status with age defaults
      const _defaults = getAgeDefaults(age);
      const statusCol = await setupStatus();
      await statusCol.insertOne({
        scout_email: email,
        guide_email: guideEmail,
        steps: SETUP_STEPS.map(s => ({
          ...s,
          status: s.id === "profile" ? "complete" as const : "pending" as const,
          completed_at: s.id === "profile" ? now : undefined,
        })),
        created_at: now,
        updated_at: now,
      });

      return {
        content: [{
          type: "text",
          text: `Scout "${name}" (${email}) created in troop ${troop}. Linked to guide ${guideEmail}. Onboarding started — profile step complete. Age ${age} defaults applied.`,
        }],
      };
    },
  );
}
