import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { users, scouts, requirements } from "../../db.js";
import {
  scoutbookScouts,
  scoutbookParents,
  scoutbookAdvancement,
} from "../../scoutbook/collections.js";
import { REQUIREMENT_DEFINITIONS } from "../../constants.js";
import type { RequirementStatus, InteractionMode } from "../../types.js";
import type { ScoutbookScoutDoc, ScoutbookAdvancementDoc } from "../../scoutbook/types.js";

// ---------------------------------------------------------------------------
// Advancement → Quest status mapping
// ---------------------------------------------------------------------------

const PM_BADGE_NAMES = ["personal management"];
const FL_BADGE_NAMES = ["family life"];

function isMeritBadgeMatch(adv: ScoutbookAdvancementDoc, names: string[]): boolean {
  return (
    adv.type === "meritBadge" &&
    names.some((n) => adv.name.toLowerCase().includes(n))
  );
}

/**
 * Map a Scoutbook merit badge advancement status to quest requirement statuses.
 * - "Awarded" → completed_prior (the scout already earned this badge)
 * - Anything else → not_started (admin can override individually later)
 *
 * Per design: we use MB-level status, not per-requirement cross-referencing,
 * because Scoutbook requirement IDs don't map directly to quest req_ids.
 */
export function mapAdvancementToQuestStatus(
  advancements: ScoutbookAdvancementDoc[],
  badge: "personal_management" | "family_life",
): RequirementStatus {
  const names = badge === "personal_management" ? PM_BADGE_NAMES : FL_BADGE_NAMES;
  const mbAdv = advancements.find((a) => isMeritBadgeMatch(a, names));
  if (!mbAdv) return "not_started";
  if (mbAdv.status === "Awarded") return "completed_prior";
  return "not_started";
}

// ---------------------------------------------------------------------------
// Init one scout
// ---------------------------------------------------------------------------

interface InitScoutInput {
  sbScout: ScoutbookScoutDoc;
  scoutEmail: string;
  dryRun: boolean;
}

interface InitScoutResult {
  name: string;
  scoutEmail: string;
  userId: string;
  userCreated: boolean;
  parentUserCreated: boolean;
  scoutProfileCreated: boolean;
  scoutProfileUpdated: boolean;
  requirementsCreated: number;
  requirementsSkipped: boolean;
  pmStatus: RequirementStatus;
  flStatus: RequirementStatus;
  parentName: string | null;
  parentEmail: string | null;
}

async function initOneScout({
  sbScout,
  scoutEmail,
  dryRun,
}: InitScoutInput): Promise<InitScoutResult> {
  const scoutName = `${sbScout.firstName} ${sbScout.lastName}`;

  // Look up parent
  const parentsCol = await scoutbookParents();
  const parent = await parentsCol.findOne({
    linkedYouthUserIds: sbScout.userId,
  });
  const parentName = parent ? `${parent.firstName} ${parent.lastName}` : null;
  const parentEmail = parent?.email ?? null;

  // Look up advancement for PM and FL merit badges
  const advCol = await scoutbookAdvancement();
  const advancements = await advCol.find({ userId: sbScout.userId }).toArray();
  const pmStatus = mapAdvancementToQuestStatus(advancements, "personal_management");
  const flStatus = mapAdvancementToQuestStatus(advancements, "family_life");

  const result: InitScoutResult = {
    name: scoutName,
    scoutEmail,
    userId: sbScout.userId,
    userCreated: false,
    parentUserCreated: false,
    scoutProfileCreated: false,
    scoutProfileUpdated: false,
    requirementsCreated: 0,
    requirementsSkipped: false,
    pmStatus,
    flStatus,
    parentName,
    parentEmail,
  };

  if (dryRun) return result;

  const now = new Date();
  const usersCol = await users();
  const scoutsCol = await scouts();
  const reqCol = await requirements();

  // Create/update user doc (scout role)
  const userResult = await usersCol.updateOne(
    { email: scoutEmail },
    {
      $set: { updated_at: now },
      $setOnInsert: {
        email: scoutEmail,
        roles: [{ type: "scout" as const }],
        created_at: now,
      },
    },
    { upsert: true },
  );
  result.userCreated = userResult.upsertedCount > 0;

  // Create/update parent user doc (guide role) if we have parent info
  if (parentEmail) {
    const parentResult = await usersCol.updateOne(
      { email: parentEmail },
      {
        $set: { updated_at: now },
        $addToSet: {
          roles: { type: "guide" as const, scout_emails: [scoutEmail] },
        },
        $setOnInsert: { email: parentEmail, created_at: now },
      },
      { upsert: true },
    );
    result.parentUserCreated = parentResult.upsertedCount > 0;
  }

  // Create or update scout profile
  const existingScout = await scoutsCol.findOne({ email: scoutEmail });
  if (existingScout) {
    // Update with Scoutbook data but preserve quest-specific fields
    await scoutsCol.updateOne(
      { email: scoutEmail },
      {
        $set: {
          name: scoutName,
          age: sbScout.age ?? existingScout.age,
          troop: sbScout.unitNumber,
          patrol: sbScout.patrol?.name ?? existingScout.patrol,
          ...(parentName && parentEmail
            ? { parent_guardian: { name: parentName, email: parentEmail } }
            : {}),
          ...(parentEmail ? { guide_email: parentEmail } : {}),
          updated_at: now,
        },
      },
    );
    result.scoutProfileUpdated = true;
  } else {
    // Create new scout profile with defaults (mirrors createScout pattern)
    await scoutsCol.insertOne({
      email: scoutEmail,
      name: scoutName,
      age: sbScout.age ?? 0,
      troop: sbScout.unitNumber,
      patrol: sbScout.patrol?.name,
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
      parent_guardian: parentName && parentEmail
        ? { name: parentName, email: parentEmail }
        : { name: "", email: "" },
      guide_email: parentEmail ?? "",
      blue_card: {
        personal_management: { requested_date: null, approved_date: null, approved_by: null },
        family_life: { requested_date: null, approved_date: null, approved_by: null },
      },
      chore_list: [],
      created_at: now,
      updated_at: now,
    });
    result.scoutProfileCreated = true;
  }

  // Create requirements (only if none exist yet for this scout)
  const existingReqCount = await reqCol.countDocuments({ scout_email: scoutEmail });
  if (existingReqCount > 0) {
    result.requirementsSkipped = true;
  } else {
    const docs = REQUIREMENT_DEFINITIONS.map((def) => {
      const badgeStatus =
        def.badge === "personal_management" ? pmStatus : flStatus;
      return {
        scout_email: scoutEmail,
        req_id: def.req_id,
        badge: def.badge,
        status: badgeStatus as RequirementStatus,
        quest_driven: true,
        interaction_mode: def.default_interaction_mode as InteractionMode,
        ...(def.tracking_duration && { tracking_duration: def.tracking_duration }),
        tracking_progress: 0,
        notes: "",
        updated_at: now,
      };
    });
    await reqCol.insertMany(docs);
    result.requirementsCreated = docs.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Format results
// ---------------------------------------------------------------------------

function formatResult(results: InitScoutResult[], dryRun: boolean): string {
  const prefix = dryRun ? "[DRY RUN] " : "";
  const lines: string[] = [`${prefix}Quest initialization results:`];

  for (const r of results) {
    lines.push("");
    lines.push(`## ${r.name} (${r.scoutEmail})`);
    lines.push(`- Scoutbook userId: ${r.userId}`);
    if (r.parentName) {
      lines.push(`- Parent: ${r.parentName} (${r.parentEmail ?? "no email"})`);
    } else {
      lines.push(`- Parent: not found in Scoutbook`);
    }
    lines.push(`- PM merit badge status → ${r.pmStatus}`);
    lines.push(`- FL merit badge status → ${r.flStatus}`);

    if (dryRun) {
      lines.push(`- Would create/update user, scout profile, and ${REQUIREMENT_DEFINITIONS.length} requirements`);
    } else {
      lines.push(
        `- User: ${r.userCreated ? "created" : "already existed"}`,
      );
      if (r.parentEmail) {
        lines.push(
          `- Parent user: ${r.parentUserCreated ? "created" : "already existed"}`,
        );
      }
      lines.push(
        `- Scout profile: ${r.scoutProfileCreated ? "created" : r.scoutProfileUpdated ? "updated" : "unchanged"}`,
      );
      if (r.requirementsSkipped) {
        lines.push(`- Requirements: skipped (${r.requirementsCreated} already exist)`);
      } else {
        lines.push(`- Requirements: ${r.requirementsCreated} created`);
      }
    }
  }

  const totalCreated = results.filter((r) => r.scoutProfileCreated).length;
  const totalUpdated = results.filter((r) => r.scoutProfileUpdated).length;
  lines.push("");
  lines.push(
    `---\n${prefix}Summary: ${results.length} scouts processed, ${totalCreated} profiles created, ${totalUpdated} updated.`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

export function registerScoutbookInitQuest(server: McpServer): void {
  server.registerTool(
    "scoutbook_init_quest",
    {
      title: "Scoutbook: Initialize Quest Profiles",
      description:
        "Create quest-ready scout profiles from synced Scoutbook data. " +
        "Reads scoutbook_scouts, scoutbook_parents, and scoutbook_advancement to create " +
        "user accounts, scout profiles, and requirement documents in the quest system. " +
        "Maps Scoutbook merit badge status to quest requirement statuses " +
        '(Awarded → completed_prior, otherwise → not_started). ' +
        "Can target a specific scout by name or scoutId, or process all scouts. " +
        "Use dry_run to preview without making changes.",
      inputSchema: {
        scout_name: z
          .string()
          .optional()
          .describe(
            'Partial name match to target a specific scout (e.g. "Will" matches "Will Bramwell"). Case-insensitive.',
          ),
        scout_id: z
          .string()
          .optional()
          .describe("BSA userId to target a specific scout"),
        scout_email: z
          .string()
          .email()
          .optional()
          .describe(
            "Gmail address for the scout's quest login. Required when targeting a single scout. " +
            "When processing all scouts, scouts without a Scoutbook email will be skipped.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview what would be created without making changes"),
      },
    },
    async ({ scout_name, scout_id, scout_email, dry_run }) => {
      try {
        const sbScoutsCol = await scoutbookScouts();
        let targetScouts: ScoutbookScoutDoc[];

        if (scout_id) {
          // Target by BSA userId
          const doc = await sbScoutsCol.findOne({ userId: scout_id });
          if (!doc) {
            return {
              content: [
                {
                  type: "text",
                  text: `No Scoutbook scout found with userId "${scout_id}". Run scoutbook_sync_roster first.`,
                },
              ],
              isError: true,
            };
          }
          targetScouts = [doc];
        } else if (scout_name) {
          // Target by name (partial, case-insensitive)
          const regex = new RegExp(scout_name, "i");
          targetScouts = await sbScoutsCol
            .find({
              $or: [
                { firstName: { $regex: regex } },
                { lastName: { $regex: regex } },
              ],
            })
            .toArray();
          if (targetScouts.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No Scoutbook scouts found matching name "${scout_name}". Run scoutbook_sync_roster first.`,
                },
              ],
              isError: true,
            };
          }
        } else {
          // All scouts
          targetScouts = await sbScoutsCol.find({}).toArray();
          if (targetScouts.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No scouts found in scoutbook_scouts. Run scoutbook_sync_roster first.",
                },
              ],
              isError: true,
            };
          }
        }

        // Resolve email for each scout
        const results: InitScoutResult[] = [];
        const skipped: string[] = [];

        for (const sbScout of targetScouts) {
          // Determine the email for this scout's quest login
          let email = scout_email;
          if (!email) {
            // Use Scoutbook email if available
            email = sbScout.email || undefined;
          }
          if (!email) {
            skipped.push(
              `${sbScout.firstName} ${sbScout.lastName} (userId ${sbScout.userId}) — no email`,
            );
            continue;
          }

          const initResult = await initOneScout({
            sbScout,
            scoutEmail: email,
            dryRun: dry_run,
          });
          results.push(initResult);
        }

        let text = formatResult(results, dry_run);
        if (skipped.length > 0) {
          text +=
            `\n\nSkipped (no email — provide scout_email parameter):\n` +
            skipped.map((s) => `- ${s}`).join("\n");
        }

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Quest initialization failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
