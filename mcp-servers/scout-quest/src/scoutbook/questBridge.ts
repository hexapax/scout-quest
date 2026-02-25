import { users, scouts, requirements } from "../db.js";
import {
  scoutbookScouts,
  scoutbookParents,
  scoutbookAdvancement,
  scoutbookSyncLog,
} from "./collections.js";
import { REQUIREMENT_DEFINITIONS } from "../constants.js";
import type { RequirementStatus, InteractionMode } from "../types.js";
import type { ScoutbookScoutDoc, ScoutbookAdvancementDoc, ScoutbookSyncLogDoc } from "./types.js";

// ---------------------------------------------------------------------------
// Advancement -> Quest status mapping
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
 * - "Awarded" -> completed_prior (the scout already earned this badge)
 * - Anything else -> not_started (admin can override individually later)
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
// Types
// ---------------------------------------------------------------------------

export interface InitQuestOptions {
  scoutName?: string;
  scoutId?: string;
  scoutEmail?: string;
  dryRun: boolean;
}

export interface InitScoutResult {
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

export interface InitQuestResult {
  results: InitScoutResult[];
  skipped: string[];
  dryRun: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Init one scout (internal)
// ---------------------------------------------------------------------------

interface InitScoutInput {
  sbScout: ScoutbookScoutDoc;
  scoutEmail: string;
  dryRun: boolean;
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
    // Create new scout profile with defaults
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
// Main entry point
// ---------------------------------------------------------------------------

export async function initQuestFromScoutbook(
  options: InitQuestOptions,
): Promise<InitQuestResult> {
  const start = Date.now();
  const { scoutName, scoutId, scoutEmail, dryRun } = options;
  const log = await scoutbookSyncLog();

  try {
    const sbScoutsCol = await scoutbookScouts();
    let targetScouts: ScoutbookScoutDoc[];

    if (scoutId) {
      const doc = await sbScoutsCol.findOne({ userId: scoutId });
      if (!doc) {
        throw new Error(
          `No Scoutbook scout found with userId "${scoutId}". Run scoutbook_sync_roster first.`,
        );
      }
      targetScouts = [doc];
    } else if (scoutName) {
      const regex = new RegExp(scoutName, "i");
      targetScouts = await sbScoutsCol
        .find({
          $or: [
            { firstName: { $regex: regex } },
            { lastName: { $regex: regex } },
          ],
        })
        .toArray();
      if (targetScouts.length === 0) {
        throw new Error(
          `No Scoutbook scouts found matching name "${scoutName}". Run scoutbook_sync_roster first.`,
        );
      }
    } else {
      targetScouts = await sbScoutsCol.find({}).toArray();
      if (targetScouts.length === 0) {
        throw new Error(
          "No scouts found in scoutbook_scouts. Run scoutbook_sync_roster first.",
        );
      }
    }

    // Process each scout
    const results: InitScoutResult[] = [];
    const skipped: string[] = [];

    for (const sbScout of targetScouts) {
      let email = scoutEmail;
      if (!email) {
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
        dryRun,
      });
      results.push(initResult);
    }

    const durationMs = Date.now() - start;

    // Log to scoutbook_sync_log
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "quest_init" as ScoutbookSyncLogDoc["operation"],
      result: "success",
      counts: {
        scouts: results.length,
      },
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return { results, skipped, dryRun, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "quest_init" as ScoutbookSyncLogDoc["operation"],
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Format results for display
// ---------------------------------------------------------------------------

export function formatInitQuestResult(initResult: InitQuestResult): string {
  const { results, skipped, dryRun } = initResult;
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
        lines.push(`- Requirements: skipped (already exist)`);
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

  if (skipped.length > 0) {
    lines.push(
      `\nSkipped (no email — provide scout_email parameter):\n` +
      skipped.map((s) => `- ${s}`).join("\n"),
    );
  }

  return lines.join("\n");
}
