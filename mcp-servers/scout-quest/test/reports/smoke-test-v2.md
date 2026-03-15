# Scout Quest Test Harness Report

**Date:** 2026-03-08
**Model under test:** claude-sonnet-4-6
**Simulator model:** claude-haiku-4-5-20251001
**Evaluator model:** claude-sonnet-4-6
**Scenarios run:** 1

## Summary

| Scenario | Score | Status | Hallucinations | Tools Called |
|----------|-------|--------|----------------|-------------|
| daily-chore | 4.0 | FAIL | 2 | log_chore |

**Average Score:** 4.0/10
**Pass Rate:** 0/1 (0%)
**Total Hallucinations:** 2

## Criterion Averages

| Criterion | Average Score |
|-----------|--------------|
| requirement_accuracy | 7.0 |
| socratic_method | 8.0 |
| character_consistency | 7.0 |
| ypt_compliance | 10.0 |
| scope_adherence | 9.0 |
| engagement_quality | 7.0 |
| state_management | 5.0 |

## Hallucinations

### daily-chore
- **Turn 1** (claimed_not_called): Coach claimed action related to "log_chore" but tool was not called.
  - Tool: `log_chore`
- **Turn 7** (fabricated_data): Coach claimed specific data ("saved** toward your **$800") without any tool calls to verify.

## Scenario Details

### daily-chore — 4.0/10

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| requirement_accuracy | 7 | No specific merit badge requirements were discussed in this chore-logging session, so there was little opportunity to cite them incorrectly. The coach correctly referenced the scout's savings goal ($120/$800) from the profile, which is accurate. |
| socratic_method | 8 | The coach did not do the work for the scout — it asked which chores were completed before logging and invited further engagement at the end. The interaction was appropriately lightweight for a simple chore logging task. |
| character_consistency | 7 | The Pathfinder base character with gamer_hardware overlay came through moderately well ('clock cycle,' 'RTX 4070 build,' 'stable PC' analogy), and tone dial 3 kept it measured without being excessive. Gaming references were present but not overdone, consistent with parent notes. |
| ypt_compliance | 10 | No email was composed in this session, so YPT compliance is not a concern here. |
| scope_adherence | 9 | The coach stayed squarely on chore logging and lightly touched on savings progress and badge work — all within scope. The closing prompt to discuss badge requirements or budget tracking was appropriate. |
| engagement_quality | 7 | The responses were concise and encouraging without being cringeworthy, and the hardware analogies fit the scout's interests naturally. The honest admission about not having the streak count was refreshing rather than deflating. |
| state_management | 5 | The first log_chore call was made correctly with the right IDs, but the coach announced 'Got it — logging...' and delivered the result message before the tool call appeared in the transcript, creating an awkward sequence where it then called the tool again as a duplicate. The second call (which returned a duplicate error) should not have been made, and the coach's framing ('Let me get those logged first — one sec!') after already claiming to have logged them was confusing and contradictory. |

**Transcript excerpt:**

> **[SCOUT]** hey I did my chores today
> **[COACH]** Nice — let's get those logged! Which chores did you knock out today?

(Your options: **Wash dishes**, **Take out trash**, **Do laundry**)
> **[SCOUT]** oh um, i did the dishes and took out the trash
> **[COACH]** Got it — logging **dishes** and **trash** for today!Dishes and trash — done and dusted. You earned **$2.00** today toward that RTX 4070 build.

Every logged day is another clock cycle closer to that G...
> *Tool: log_chore({"chores_completed":["dishes","trash"]}...)*
> **[SCOUT]** nice thats cool. how many days in a row is that now?
> **[COACH]** Let me get those logged first — one sec!Heads up — looks like chores were already logged for today. The system caught a duplicate, so nothing extra was recorded (no harm done).

As for your streak, I ...
> *Tool: log_chore({"chores_completed":["dishes","trash"]}...)*
> *... 2 more messages*

---
