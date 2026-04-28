# Scout State + Conversation Summaries — Design

**Created:** 2026-04-26
**Status:** Design (approved 2026-04-26)
**Related:** `docs/plans/2026-04-16-alpha-launch-plan.md` (Stream B parent visibility), `docs/plans/2026-04-26-alpha-evolution-roadmap.md`

## Problem

Three connected gaps:

1. **The agent forgets every conversation.** `backend/src/episodes.ts` already runs Haiku to extract a structured summary after each chat (`scout_episodes` collection), but `getRecentEpisodes()` is exported and never called. The "Phase 2 — pre-load context" was never wired up. Each new session starts cold.

2. **Parents and leaders can read transcripts but get no synthesis.** Stream B of the alpha-launch plan ships `history.html` for raw transcript viewing. A scoutmaster who needs to know "what did Liam work on this week" has to read N conversations end-to-end.

3. **No "scout-observed state" layer.** `scout-context.ts` injects live Scoutbook data per turn (earned ranks, in-progress rank %, upcoming events). That's authoritative for current totals — but the agent has no place to record *deltas it observed* during a session: "scout said req 5b is done", "scout asked to start Camping MB", "scout is blocked on SM conference for First Class". These observations are valuable forward-looking signal that today vanish when the conversation ends.

## Design principles

- **Scoutbook is the source of truth for current totals** (rank %, badge completion, events). We never duplicate or stale-mirror that.
- **Our store records observations and deltas only.** "Scout reported X happened" — not "rank is now 47% complete." Anything that can change through Scoutbook write-backs or counselor sign-offs lives there.
- **Summaries are forward-looking.** Existing episodes prompt is right: "what should the next session pick up on?" Keep that orientation.
- **Two surfaces, one source.** The same summary content powers (a) next-session context preload, (b) parent/leader history view, (c) the scout's own "what we covered" recap.

## Data model

Three collections. Two already exist — one new.

### `scout_episodes` (existing — keep as-is)

Per-conversation summary. Already populated by `episodes.ts`. Schema unchanged. Fix: actually read it.

### `scout_state` (NEW)

Per-scout rolling state document. One doc per scout email.

```ts
interface ScoutState {
  _id: ObjectId;
  scoutEmail: string;             // canonical, normalized
  troopId?: string | null;

  // Append-only event log of observations (newest first capped to N=200)
  events: ScoutStateEvent[];

  // Rolling LLM-generated narrative, 300-600 tokens.
  // Re-generated whenever events list changes meaningfully.
  rolling_summary: string;
  rolling_summary_updated_at: Date;
  rolling_summary_model: string;     // e.g. "claude-haiku-4-5-20251001"
  rolling_summary_input_event_count: number;

  // Lightweight stats — cheap to query, no LLM call.
  stats: {
    total_sessions: number;
    last_session_at: Date | null;
    distinct_topics_30d: string[]; // ["Camping MB", "First Class req 5b", ...]
  };

  createdAt: Date;
  updatedAt: Date;
}

interface ScoutStateEvent {
  ts: Date;
  // Source — which conversation/session produced this observation.
  conversationId: ObjectId;
  episodeId?: ObjectId;
  // What kind of thing happened.
  type:
    | "requirement_reported_complete"  // scout: "I finished req 5b"
    | "requirement_started"            // scout: "starting on Personal Mgmt"
    | "interest_expressed"             // scout: "I want to do Camping MB"
    | "blocker"                        // "needs SM conference for First Class"
    | "goal_set"                       // "Eagle by 16"
    | "commitment_made"                // "I'll do 3 chores this week"
    | "concern_voiced"                 // "I don't think I'll make Star this year"
    | "achievement_celebrated"         // "earned my Tenderfoot today"
    | "topic_unresolved"               // ended session without answering
    | "external_event_mentioned";      // "campout this weekend"
  // Free-text observation (what the agent observed, in past tense).
  note: string;
  // Optional structured payload — depends on type.
  payload?: {
    rankName?: string;                 // "Star", "First Class"
    requirementCode?: string;          // "5b", "FirstClass.7a"
    badgeName?: string;                // "Camping", "Personal Management"
    counselor?: string;
    targetDate?: string;               // ISO date — scout-stated, not authoritative
    [k: string]: unknown;
  };
  // Confidence the agent expressed (0-1). Below 0.5 → don't surface to leaders.
  confidence: number;
  // Raw scout quote that triggered this event, for human review.
  source_quote?: string;
}
```

**Why a rolling summary AND an event log?** The event log is auditable, durable, and cheap to append. The rolling summary is what the next session's system prompt actually injects (~500 tokens beats replaying 50 events). When events change, regenerate summary; otherwise serve cached.

### `conversation_summaries` (NEW — derived from `scout_episodes`)

Per-conversation, human-facing summary card. Lighter than the structured episode (which is for machine context); written for parent/leader review and for the scout's own recap.

```ts
interface ConversationSummary {
  _id: ObjectId;                     // === conversations._id (1:1)
  scoutEmail: string;
  userEmail: string;                 // who chatted (may equal scoutEmail or be parent)
  troopId?: string | null;
  channel: "chat" | "voice" | "mixed";
  durationMs: number;
  turnCount: number;

  // Three layers of summary, all generated together by Haiku.
  one_liner: string;                 // 80-char title-ish
  parent_recap: string;              // 2-3 sentences for parent dashboard
  scout_recap: string;               // 2-3 sentences in coach voice for scout

  // Structured pulls — same as episode but normalized for UI:
  topics: string[];
  achievements: string[];            // things the scout reported finishing
  next_steps: string[];              // open loops the scout should follow up on
  blockers: string[];                // things that need adult help

  // Pointer to events derived from this conversation (for traceability).
  derived_event_ids: ObjectId[];

  // Safety flag — see safety-flagging design doc.
  safety_tier?: 1 | 2 | 3;

  generated_at: Date;
  generated_by_model: string;
}
```

## Generation flow

End-of-conversation pipeline (replaces fire-and-forget capture):

```
session ends (or N turns idle, or explicit "finish")
    │
    ├─ 1. existing captureEpisode() → scout_episodes (KEEP)
    │
    ├─ 2. NEW: generateConversationSummary(conv) → conversation_summaries
    │       Single Haiku call, structured-output, ~$0.001
    │
    ├─ 3. NEW: extractStateEvents(episode, summary) → append to scout_state.events
    │       Mostly mechanical: pull achievements/next_steps/blockers fields
    │       and map to event types. Some fields need a second light LLM pass
    │       to fill structured payload (rank name, req code) — Haiku $0.0005.
    │
    ├─ 4. NEW: maybeRegenerateRollingSummary(scoutEmail)
    │       If events list grew by ≥3 since last regen, or 24h passed:
    │       Haiku reads last 50 events + previous rolling_summary →
    │       new rolling_summary. ~$0.002.
    │
    └─ 5. NEW: safetyEvaluate(conv, summary) → maybe set safety_tier
          See safety-flagging design.
```

Cost target: **<$0.01 per conversation** end-of-session processing. At 5 conv/scout/week × 15 alpha scouts = 75 conv/week → **<$0.75/week** in summarization overhead.

All steps are fire-and-forget post-response; never block the chat reply.

### Triggering "session end"

- Explicit: scout taps "end session" or starts a new conversation.
- Implicit: 30 min idle on an active conversation.
- Voice: ElevenLabs hangup webhook (already wired).
- Crash recovery: a cron sweeper (every 6h) finds conversations updated >2h ago without a summary and processes them.

## Read paths

### Next-session context injection (closes the original Phase 2 gap)

In `chat.ts`, when building the system prompt, after `scout-context.ts`:

```ts
const state = await getScoutState(scoutEmail);
if (state?.rolling_summary) {
  systemBlocks.push({
    type: "text",
    text: `RECENT COACHING CONTEXT — ${state.scoutEmail}\n\n${state.rolling_summary}\n\n` +
          `(Source: scout-reported observations from ${state.stats.total_sessions} prior sessions. ` +
          `For authoritative current rank/badge totals, use get_scout_status.)`,
    cache_control: { type: "ephemeral" },
  });
}
```

The disclaimer matters: it tells the model the rolling summary is *narrative memory*, not source-of-truth data.

### Parent/leader summary view (Stream B extension)

`history.html` gets a new tab "Summaries" that lists `conversation_summaries` for accessible scouts. Each card:

```
[2026-04-26 14:22 · 18 min · voice]
"Working on Camping MB requirements 4 and 5"

Parent recap: Liam talked through camping menu planning for the
Woodruff trip. He said he'd already finished requirement 4 (camping
gear list) and is planning to start req 5 (cooking) at the campout.
Mentioned he wants to ask Mr. Brunt to be his counselor.

Achievements:
  • Reported finishing Camping MB req 4
Next steps:
  • Start Camping MB req 5 at Woodruff
  • Ask Mr. Brunt about MB counseling
Blockers: (none)

[Open transcript →]
```

Tier 2/3 safety flags surface a banner above the card with appropriate framing (see safety-flagging design).

### Scout's own recap

When a conversation ends, the chat UI shows the `scout_recap` inline:

```
─── Coach recap ───
Nice work today, Liam — you mapped out exactly what you need for
Camping MB and got a plan for Woodruff. Reach out to Mr. Brunt this
week to get him on as your counselor. Talk soon!
─────────────────
```

Establishes the "the assistant remembers" affordance without leaking long-term memory machinery to the user.

## Implementation plan

| Step | Deliverable | File touchpoints | Est |
|------|-------------|------------------|-----|
| 1 | New `backend/src/state/scout-state.ts` — read/write helpers, rolling-summary regen logic | new file | 0.5d |
| 2 | New `backend/src/state/conversation-summary.ts` — end-of-session summary generator | new file | 0.5d |
| 3 | New `backend/src/state/event-extractor.ts` — episode/summary → events mapping | new file | 0.5d |
| 4 | Wire end-of-session pipeline into `chat.ts` and `voice-persistence.ts` | edit chat.ts:439, voice-persistence.ts | 0.5d |
| 5 | Idle-end-detection sweeper in `cron.js` (already runs) | edit mcp-servers/scout-quest/src/cron | 0.5d |
| 6 | Inject rolling summary in system prompt after scout-context | edit chat.ts | 0.25d |
| 7 | New `GET /api/state/scout/:email` and `GET /api/summaries/scout/:email` endpoints (role-checked) | new routes/state.ts, routes/summaries.ts | 0.5d |
| 8 | "Summaries" tab in `history.html` | edit backend/public/history.html, app.js | 0.75d |
| 9 | Inline "Coach recap" in chat UI on session end | edit app.html, app.js | 0.5d |
| 10 | Backfill: process the last 30 days of existing conversations into summaries+events | one-shot script in scripts/ | 0.5d |
| 11 | Tests: unit test the extractor with fixture transcripts; integration test the full pipeline | test/* | 1d |

**Total: ~6 agent-days.** Can be split: one agent on backend pipeline (1-7), one on UI (8-9), backfill (10) and tests (11) sequenced after.

## Cost discipline

- **All summarization on Haiku** (`claude-haiku-4-5-20251001` per `episodes.ts:14`). Never Sonnet/Opus.
- **Rolling summary cap**: regenerate at most once per session per scout, even if many events appended.
- **Episode + summary share their LLM call** when possible — if `episodes.ts` is being run, pass-through more output to also fill `conversation_summaries` instead of two calls.
- **Budget check**: end-of-session pipeline writes its cost to the same `message_usage` collection (Stream C) with `source: "summary"` so we can see total summarization spend in the cost dashboard.

## Privacy / safety

- `scout_state.events[].source_quote` may contain anything the scout said. Treat it as conversation content (same retention rules as `conversations`).
- Rolling summary is regenerated in full each time, so old phrasings get rewritten — but events are append-only. Add a 90-day TTL on events older than that, with the rolling summary as the long-term remnant.
- Summaries that include Tier 2/3 safety flags follow the trauma-informed framing pattern from the safety-flagging design — parent recap is information-forward ("Liam mentioned feeling overwhelmed about school"), not alarm-forward.
- Leaders see *aggregate* troop summaries (e.g., "5 scouts mentioned Woodruff prep this week") not individual scout recaps unless they have explicit role on that scout. The scoutmaster role gets per-scout access.

## Testing

- Fixture transcripts in `test/fixtures/conversations/` covering: pure chitchat (should produce minimal events), heavy advancement work (many achievements), blocked scout (blockers populated), safety flag cases.
- Cross-check: events extracted from a transcript should round-trip — re-running the extractor on the same input must be idempotent (no duplicate events).
- Eval addition to v7: a 5-question subset that asks the agent about something the rolling-summary should know ("what were we working on last time"). Score whether the agent uses the injected summary vs. asks the scout to repeat.

## Migration

- Both new collections start empty.
- Backfill script (step 10) is opt-in by scout email — for alpha cohort only initially.
- No schema changes to existing `conversations` or `scout_episodes`.

## Open questions

1. **Event retention beyond 90 days.** Keep all forever (small data, useful for longitudinal coaching) or aggressively prune? Default: keep events with confidence ≥0.7 forever; prune low-confidence/chitchat events at 90d.
2. **Cross-scout patterns.** Should leader-aggregate summaries detect troop-wide patterns ("4 scouts mentioned wanting to skip Woodruff")? Defer to post-alpha.
3. **Editable rolling summary.** Should the scout or parent be able to correct the rolling summary if the agent misremembered something? Defer — instead, scoutbook write-backs should override observed state when they conflict.

## Decisions (answered 2026-04-26)

1. **Build all of it before alpha.** Session memory is on the must-have list; parent visibility (Stream B) without summaries is half a feature.
2. **Haiku-only for all summary work.** No fallback. If Haiku is unavailable, summarization is delayed, not retried on a more expensive model.
3. **Event extraction is mechanical-then-LLM.** First pass mechanical (episode JSON → events). Second pass single Haiku call to enrich payload (rank/req codes). Don't loop a model just to extract structured fields.
