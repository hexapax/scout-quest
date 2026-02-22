import { questPlans, planChangelog, cronLog, requirements, choreLogs, budgetEntries } from "../db.js";

export async function reviewPlan(
  scoutEmail: string,
  driftDetails: string[],
  reviewModel: string,
): Promise<void> {
  const planCol = await questPlans();
  const plan = await planCol.findOne({ scout_email: scoutEmail });
  if (!plan) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[cron] ANTHROPIC_API_KEY not set — skipping plan review");
    return;
  }

  // Gather context
  const reqCol = await requirements();
  const reqs = await reqCol.find({ scout_email: scoutEmail }).toArray();
  const choreCol = await choreLogs();
  const recentChores = await choreCol.find({ scout_email: scoutEmail })
    .sort({ date: -1 }).limit(14).toArray();
  const budgetCol = await budgetEntries();
  const latestBudget = await budgetCol.findOne(
    { scout_email: scoutEmail },
    { sort: { week_number: -1 } },
  );

  const context = JSON.stringify({
    current_plan: {
      priorities: plan.current_priorities,
      strategy: plan.strategy_notes,
      milestones: plan.milestones,
    },
    drift: driftDetails,
    requirements_summary: {
      total: reqs.length,
      signed_off: reqs.filter(r => r.status === "signed_off").length,
      in_progress: reqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
      blocked: reqs.filter(r => r.status === "blocked").length,
    },
    chore_streak: recentChores.length,
    budget_week: latestBudget?.week_number ?? 0,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: reviewModel,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Review this scout's quest plan and suggest updates. Drift detected: ${driftDetails.join("; ")}. Return JSON with: updated_priorities (string[]), updated_strategy (string), reasoning (string). Only suggest changes if drift warrants them.\n\n${context}`,
      }],
    }),
  });

  if (!response.ok) {
    console.error(`[cron] Plan review API error: ${response.status}`);
    return;
  }

  const result = await response.json() as { content: { text: string }[] };
  const text = result.content?.[0]?.text || "";

  const logCol = await cronLog();
  const changelogCol = await planChangelog();
  const now = new Date();

  try {
    const parsed = JSON.parse(text);

    if (parsed.updated_priorities) {
      await changelogCol.insertOne({
        scout_email: scoutEmail,
        change_date: now,
        source: "cron",
        field_changed: "current_priorities",
        old_value: JSON.stringify(plan.current_priorities),
        new_value: JSON.stringify(parsed.updated_priorities),
        reason: parsed.reasoning || "Cron drift review",
        created_at: now,
      });
      await planCol.updateOne(
        { scout_email: scoutEmail },
        { $set: { current_priorities: parsed.updated_priorities, last_reviewed: now, updated_at: now } },
      );
    }

    if (parsed.updated_strategy) {
      await changelogCol.insertOne({
        scout_email: scoutEmail,
        change_date: now,
        source: "cron",
        field_changed: "strategy_notes",
        old_value: plan.strategy_notes,
        new_value: parsed.updated_strategy,
        reason: parsed.reasoning || "Cron drift review",
        created_at: now,
      });
      await planCol.updateOne(
        { scout_email: scoutEmail },
        { $set: { strategy_notes: parsed.updated_strategy, last_reviewed: now, updated_at: now } },
      );
    }

    await logCol.insertOne({
      run_date: now,
      scout_email: scoutEmail,
      action: "plan_review",
      details: parsed.reasoning || "Plan reviewed",
      model_used: reviewModel,
      changes_made: JSON.stringify({ priorities: !!parsed.updated_priorities, strategy: !!parsed.updated_strategy }),
      created_at: now,
    });
  } catch {
    console.error(`[cron] Failed to parse plan review response for ${scoutEmail}`);
  }
}
