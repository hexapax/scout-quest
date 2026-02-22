import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUserRoles } from "../auth.js";
import {
  scouts, requirements, choreLogs, budgetEntries,
  reminders, setupStatus, questPlans, sessionNotes,
} from "../db.js";
import { STREAK_MILESTONES } from "../constants.js";

async function getLinkedScoutEmails(guideEmail: string): Promise<string[]> {
  const roles = await getUserRoles(guideEmail);
  const guideRole = roles.find(r => r.type === "guide");
  if (!guideRole || guideRole.type !== "guide") return [];
  return guideRole.scout_emails;
}

export function registerGuideScouts(server: McpServer, guideEmail: string): void {
  // 1. List all scouts linked to this guide
  server.registerResource(
    "guide_scouts_list",
    "guide://scouts",
    {
      title: "My Scouts",
      description: "All scouts linked to this guide with summary info.",
      mimeType: "application/json",
    },
    async (uri) => {
      const linkedEmails = await getLinkedScoutEmails(guideEmail);
      if (linkedEmails.length === 0) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ scouts: [], message: "No scouts linked. Use setup_scout_profile to create one." }),
          }],
        };
      }

      const col = await scouts();
      const scoutDocs = await col.find({ email: { $in: linkedEmails } }).toArray();
      const summaries = scoutDocs.map(s => ({
        email: s.email,
        name: s.name,
        age: s.age,
        troop: s.troop,
        quest_status: s.quest_state.quest_status,
        goal_item: s.quest_state.goal_item,
        current_savings: s.quest_state.current_savings,
        target_budget: s.quest_state.target_budget,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify({ scouts: summaries }) }] };
    },
  );

  // 2. Scout summary (gamified progress)
  server.registerResource(
    "guide_scout_summary",
    new ResourceTemplate("guide://scout/{email}/summary", { list: undefined }),
    {
      title: "Scout Summary",
      description: "Gamified quest progress overview for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized for this scout" }) }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: email }).toArray();
      const planCol = await questPlans();
      const plan = await planCol.findOne({ scout_email: email });

      const summary = {
        name: scout.name,
        quest_status: scout.quest_state.quest_status,
        goal_item: scout.quest_state.goal_item,
        savings_progress: {
          current: scout.quest_state.current_savings,
          target: scout.quest_state.target_budget,
          percent: scout.quest_state.target_budget > 0
            ? Math.round((scout.quest_state.current_savings / scout.quest_state.target_budget) * 100)
            : 0,
        },
        requirements: {
          total: reqs.length,
          signed_off: reqs.filter(r => r.status === "signed_off").length,
          in_progress: reqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
          not_started: reqs.filter(r => r.status === "not_started").length,
        },
        milestones: plan?.milestones?.map(m => ({
          label: m.label,
          completed: m.completed,
          category: m.category,
        })) ?? [],
      };

      return { contents: [{ uri: uri.href, text: JSON.stringify(summary) }] };
    },
  );

  // 3. Chore streak and income
  server.registerResource(
    "guide_scout_chores",
    new ResourceTemplate("guide://scout/{email}/chores", { list: undefined }),
    {
      title: "Scout Chores",
      description: "Chore streak and income summary for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const choreCol = await choreLogs();
      const recentLogs = await choreCol.find({ scout_email: email })
        .sort({ date: -1 }).limit(100).toArray();

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);
      for (const log of recentLogs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      const totalIncome = recentLogs.reduce((sum, l) => sum + l.income_earned, 0);

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            current_streak: streak,
            next_milestone: STREAK_MILESTONES.find(m => m > streak) ?? null,
            total_income_earned: totalIncome,
            recent_entries: recentLogs.slice(0, 7).map(l => ({
              date: l.date,
              chores: l.chores_completed,
              income: l.income_earned,
            })),
          }),
        }],
      };
    },
  );

  // 4. Budget tracking
  server.registerResource(
    "guide_scout_budget",
    new ResourceTemplate("guide://scout/{email}/budget", { list: undefined }),
    {
      title: "Scout Budget",
      description: "Budget tracking snapshot for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const budgetCol = await budgetEntries();
      const entries = await budgetCol.find({ scout_email: email })
        .sort({ week_number: -1 }).limit(13).toArray();

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            weeks_tracked: entries.length,
            latest: entries[0] ? {
              week: entries[0].week_number,
              savings: entries[0].running_savings_total,
            } : null,
          }),
        }],
      };
    },
  );

  // 5. Requirements
  server.registerResource(
    "guide_scout_requirements",
    new ResourceTemplate("guide://scout/{email}/requirements", { list: undefined }),
    {
      title: "Scout Requirements",
      description: "All requirement states with progress for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: email }).toArray();
      const clean = reqs.map(({ _id, ...r }) => r);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );

  // 6. Reminders
  server.registerResource(
    "guide_scout_reminders",
    new ResourceTemplate("guide://scout/{email}/reminders", { list: undefined }),
    {
      title: "Scout Reminders",
      description: "Pending/overdue items for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const remCol = await reminders();
      const active = await remCol.find({ scout_email: email, active: true }).toArray();
      const clean = active.map(({ _id, ...r }) => r);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );

  // 7. Setup status
  server.registerResource(
    "guide_scout_setup_status",
    new ResourceTemplate("guide://scout/{email}/setup-status", { list: undefined }),
    {
      title: "Setup Status",
      description: "Onboarding checklist progress for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const col = await setupStatus();
      const status = await col.findOne({ scout_email: email });
      if (!status) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ status: "not_started", message: "Onboarding not started" }) }] };
      }

      const { _id, ...data } = status;
      return { contents: [{ uri: uri.href, text: JSON.stringify(data) }] };
    },
  );

  // 8. Conversations (from session_notes)
  server.registerResource(
    "guide_scout_conversations",
    new ResourceTemplate("guide://scout/{email}/conversations", { list: undefined }),
    {
      title: "Scout Conversations",
      description: "Recent conversation summaries for a linked scout (from session notes).",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const col = await sessionNotes();
      const notes = await col.find({ scout_email: email })
        .sort({ session_date: -1 })
        .limit(10)
        .toArray();

      const clean = notes.map(({ _id, ...n }) => ({
        date: n.session_date,
        source: n.source,
        topics: n.topics_discussed,
        progress: n.progress_made,
        pending: n.pending_items,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );
}
