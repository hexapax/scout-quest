import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { questPlans, planChangelog } from "../../db.js";

export function registerUpdateQuestPlan(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "update_quest_plan",
    {
      title: "Update Quest Plan",
      description:
        "Update the coaching plan — priorities, strategy, milestones, scout observations, or counselor session prep. Every change is audit-logged.",
      inputSchema: {
        current_priorities: z.array(z.string()).optional().describe("Replace the current priority list"),
        strategy_notes: z.string().optional().describe("Replace strategy notes"),
        add_milestone: z
          .object({
            id: z.string(),
            label: z.string(),
            category: z.enum(["savings", "streak", "requirement", "counselor", "custom"]),
            target_metric: z.string().optional(),
            target_date: z.string().date().optional(),
          })
          .optional()
          .describe("Add a new milestone to track"),
        complete_milestone: z.string().optional().describe("Mark a milestone as completed by its ID"),
        scout_observations: z
          .object({
            engagement_patterns: z.string().optional(),
            attention_notes: z.string().optional(),
            motivation_triggers: z.string().optional(),
            tone_notes: z.string().optional(),
          })
          .optional()
          .describe("Update observations about how the scout engages"),
        next_counselor_session: z
          .object({
            badge: z.enum(["personal_management", "family_life"]),
            requirements_to_present: z.array(z.string()),
            prep_notes: z.string(),
          })
          .optional()
          .describe("Set up prep for the next counselor meeting"),
        reason: z.string().describe("Why this change is being made"),
      },
    },
    async ({
      current_priorities,
      strategy_notes,
      add_milestone,
      complete_milestone,
      scout_observations,
      next_counselor_session,
      reason,
    }) => {
      const col = await questPlans();
      const changeCol = await planChangelog();
      const now = new Date();

      // Get or create the quest plan
      let plan = await col.findOne({ scout_email: scoutEmail });
      if (!plan) {
        const defaults = {
          scout_email: scoutEmail,
          current_priorities: [],
          strategy_notes: "",
          milestones: [],
          scout_observations: {
            engagement_patterns: "",
            attention_notes: "",
            motivation_triggers: "",
            tone_notes: "",
          },
          last_reviewed: now,
          updated_at: now,
        };
        await col.insertOne(defaults);
        plan = await col.findOne({ scout_email: scoutEmail });
        if (!plan) {
          return { content: [{ type: "text", text: "Error: Failed to create quest plan." }] };
        }
      }

      const changes: string[] = [];
      const changelogEntries: Array<{
        field_changed: string;
        old_value?: string;
        new_value: string;
      }> = [];

      // --- current_priorities ---
      if (current_priorities !== undefined) {
        changelogEntries.push({
          field_changed: "current_priorities",
          old_value: JSON.stringify(plan.current_priorities),
          new_value: JSON.stringify(current_priorities),
        });
        changes.push(`priorities updated (${current_priorities.length} items)`);
      }

      // --- strategy_notes ---
      if (strategy_notes !== undefined) {
        changelogEntries.push({
          field_changed: "strategy_notes",
          old_value: plan.strategy_notes,
          new_value: strategy_notes,
        });
        changes.push("strategy notes updated");
      }

      // --- add_milestone ---
      if (add_milestone !== undefined) {
        const existing = plan.milestones.find((m) => m.id === add_milestone.id);
        if (existing) {
          return {
            content: [{ type: "text", text: `Error: Milestone "${add_milestone.id}" already exists.` }],
          };
        }
        changelogEntries.push({
          field_changed: "milestones",
          new_value: `added: ${add_milestone.id} (${add_milestone.label})`,
        });
        changes.push(`milestone added: "${add_milestone.label}"`);
      }

      // --- complete_milestone ---
      if (complete_milestone !== undefined) {
        const milestone = plan.milestones.find((m) => m.id === complete_milestone);
        if (!milestone) {
          return {
            content: [{ type: "text", text: `Error: Milestone "${complete_milestone}" not found.` }],
          };
        }
        if (milestone.completed) {
          return {
            content: [{ type: "text", text: `Milestone "${complete_milestone}" is already completed.` }],
          };
        }
        changelogEntries.push({
          field_changed: "milestones",
          old_value: `${complete_milestone}: incomplete`,
          new_value: `${complete_milestone}: completed`,
        });
        changes.push(`milestone completed: "${milestone.label}"`);
      }

      // --- scout_observations ---
      if (scout_observations !== undefined) {
        const obsFields = Object.entries(scout_observations).filter(
          ([, v]) => v !== undefined,
        ) as [string, string][];
        for (const [field, value] of obsFields) {
          const oldVal =
            plan.scout_observations[field as keyof typeof plan.scout_observations] ?? "";
          changelogEntries.push({
            field_changed: `scout_observations.${field}`,
            old_value: oldVal,
            new_value: value,
          });
        }
        changes.push(`observations updated (${obsFields.length} fields)`);
      }

      // --- next_counselor_session ---
      if (next_counselor_session !== undefined) {
        changelogEntries.push({
          field_changed: "next_counselor_session",
          old_value: plan.next_counselor_session
            ? JSON.stringify(plan.next_counselor_session)
            : undefined,
          new_value: JSON.stringify(next_counselor_session),
        });
        changes.push(`counselor session prep set (${next_counselor_session.badge})`);
      }

      if (changes.length === 0) {
        return { content: [{ type: "text", text: "No changes specified." }] };
      }

      // Write changelog entries
      if (changelogEntries.length > 0) {
        await changeCol.insertMany(
          changelogEntries.map((entry) => ({
            scout_email: scoutEmail,
            change_date: now,
            source: "agent" as const,
            field_changed: entry.field_changed,
            old_value: entry.old_value,
            new_value: entry.new_value,
            reason,
            created_at: now,
          })),
        );
      }

      // Build the $set update
      const update: Record<string, unknown> = {
        updated_at: now,
        last_reviewed: now,
      };

      if (current_priorities !== undefined) {
        update.current_priorities = current_priorities;
      }
      if (strategy_notes !== undefined) {
        update.strategy_notes = strategy_notes;
      }
      if (scout_observations !== undefined) {
        const obsUpdate: Record<string, string> = {};
        for (const [field, value] of Object.entries(scout_observations)) {
          if (value !== undefined) {
            obsUpdate[`scout_observations.${field}`] = value;
          }
        }
        Object.assign(update, obsUpdate);
      }
      if (next_counselor_session !== undefined) {
        update.next_counselor_session = next_counselor_session;
      }

      // Handle milestone mutations via $push / array update
      if (add_milestone !== undefined) {
        const milestoneDoc = {
          id: add_milestone.id,
          label: add_milestone.label,
          category: add_milestone.category,
          target_metric: add_milestone.target_metric,
          target_date: add_milestone.target_date
            ? new Date(add_milestone.target_date)
            : undefined,
          completed: false,
          completed_date: undefined,
          celebrated: false,
        };
        await col.updateOne(
          { scout_email: scoutEmail },
          {
            $set: update,
            $push: { milestones: milestoneDoc },
          },
        );
      } else if (complete_milestone !== undefined) {
        // First apply the $set, then update the specific milestone element
        await col.updateOne({ scout_email: scoutEmail }, { $set: update });
        await col.updateOne(
          { scout_email: scoutEmail, "milestones.id": complete_milestone },
          {
            $set: {
              "milestones.$.completed": true,
              "milestones.$.completed_date": now,
            },
          },
        );
      } else {
        await col.updateOne({ scout_email: scoutEmail }, { $set: update });
      }

      return {
        content: [
          {
            type: "text",
            text: `Quest plan updated: ${changes.join("; ")}. Reason: ${reason}`,
          },
        ],
      };
    },
  );
}
