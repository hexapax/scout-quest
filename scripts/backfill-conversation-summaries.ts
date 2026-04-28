/**
 * Backfill ConversationSummary docs for existing conversations (Stream G step 10).
 *
 * Reads `conversations`, generates a summary via Haiku, upserts into
 * `conversation_summaries`. Idempotent — re-running on a conversation that
 * already has a summary skips it unless --force.
 *
 * Run with:
 *   MONGO_URI=mongodb://localhost:27017/scoutquest \
 *     ANTHROPIC_API_KEY=sk-... \
 *     npx --prefix backend tsx scripts/backfill-conversation-summaries.ts \
 *       [--since 30d] [--limit 50] [--force] [--dry-run] [--scout EMAIL]
 *
 * Default scope: last 30 days, max 50 conversations, skip already-summarized.
 *
 * Cost: ~$0.001 per conversation (Haiku, ~700 max_tokens out, full transcript in).
 * 50 conversations ≈ $0.05.
 */

// Avoid static `import type { ObjectId } from "mongodb"` so this file can be
// type-checked from outside backend/ without resolution gymnastics. We work
// with conversations._id structurally — its concrete type is bound by the
// dynamically-imported backend modules at runtime.
type ObjectIdShape = { toString(): string; toHexString?: () => string };

interface Args {
  sinceDays: number;
  limit: number;
  force: boolean;
  dryRun: boolean;
  scoutFilter: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { sinceDays: 30, limit: 50, force: false, dryRun: false, scoutFilter: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") {
      const v = argv[++i] || "30d";
      const m = v.match(/^(\d+)d$/);
      if (!m) throw new Error(`--since expects Nd format, got ${v}`);
      out.sinceDays = parseInt(m[1], 10);
    } else if (a === "--limit") {
      out.limit = parseInt(argv[++i] || "50", 10);
    } else if (a === "--force") {
      out.force = true;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--scout") {
      out.scoutFilter = argv[++i] || null;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("[backfill] args:", args);

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not set");
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(2);
  }

  const { connectDb, getScoutQuestDb } = await import("../backend/src/db.js");
  await connectDb();

  const {
    generateConversationSummary,
    writeConversationSummary,
  } = await import("../backend/src/conversation-summary.js");

  const db = getScoutQuestDb();
  const conversations = db.collection<{
    _id: ObjectIdShape;
    userEmail: string;
    scoutEmail?: string | null;
    troopId?: string | null;
    channel?: "chat" | "voice" | "mixed";
    messages: Array<{ role: string; content: string; ts?: Date }>;
    createdAt: Date;
    updatedAt: Date;
  }>("conversations");
  const summaries = db.collection<{ _id: ObjectIdShape; generated_at: Date }>("conversation_summaries");

  const since = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = { updatedAt: { $gte: since } };
  if (args.scoutFilter) filter.scoutEmail = args.scoutFilter;

  const candidates = await conversations.find(filter).sort({ updatedAt: -1 }).limit(args.limit).toArray();
  console.log(`[backfill] candidates: ${candidates.length}`);

  let processed = 0;
  let skipped = 0;
  let written = 0;
  let failed = 0;

  for (const conv of candidates) {
    processed++;
    const userMsgs = (conv.messages || []).filter((m) => m.role === "user");
    if (userMsgs.length < 2) {
      console.log(`  [skip<2turn] ${conv._id} (${userMsgs.length} user msgs)`);
      skipped++;
      continue;
    }

    if (!args.force) {
      const existing = await summaries.findOne({ _id: conv._id }, { projection: { generated_at: 1 } });
      if (existing && existing.generated_at >= conv.updatedAt) {
        console.log(`  [skip-fresh] ${conv._id} (summary newer than conv)`);
        skipped++;
        continue;
      }
    }

    if (args.dryRun) {
      console.log(`  [dry-run] would summarize ${conv._id} — ${userMsgs.length} turns, scout=${conv.scoutEmail || "—"}`);
      continue;
    }

    try {
      const summary = await generateConversationSummary({
        conversationId: conv._id,
        scoutEmail: conv.scoutEmail ?? null,
        userEmail: conv.userEmail,
        troopId: conv.troopId ?? null,
        channel: conv.channel ?? "chat",
        messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
        startedAt: conv.createdAt,
        endedAt: conv.updatedAt,
      });

      if (!summary) {
        console.log(`  [fail-gen] ${conv._id} — generator returned null`);
        failed++;
        continue;
      }

      await writeConversationSummary(summary);
      written++;
      console.log(`  [ok] ${conv._id} — "${summary.one_liner.slice(0, 60)}"`);
    } catch (err) {
      failed++;
      console.error(`  [error] ${conv._id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n=== Backfill complete ===");
  console.log(`  processed: ${processed}`);
  console.log(`  written:   ${written}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  failed:    ${failed}`);
  console.log(`  est. cost: ~$${(written * 0.001).toFixed(3)} (Haiku)`);

  process.exit(failed > 0 && written === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
