# Scout Quest — Strategy

**Last updated:** 2026-04-26

## Vision

Scout Quest is an AI-assisted coordination and coaching system for Boy Scout troops. It gives scouts, parents, and adult volunteers ("scouters") an AI assistant backed by real troop data from Scoutbook — the official BSA management system.

The project started as a merit badge coaching tool for one troop but is evolving into something broader: an AI layer that makes the entire troop experience more accessible. Scouts get coaching and accountability. Parents get visibility into their child's progress and upcoming events. Scouters get help with the relentless coordination burden that drives volunteer attrition. A Scouting Knowledge Base (design approved 2026-03-16) will give all three audiences access to authoritative BSA policies, rank requirements, and troop-specific knowledge through semantic search — replacing reliance on AI training data recall with curated, versioned, searchable reference material.

The ideas behind it have wider potential. Agentic-led pedagogy — AI that teaches by enabling rather than answering — could reshape how young people interact with AI at a formative age. Scouting has spent over a century formalizing how to build values and character in youth. Combining that institutional knowledge with AI assistants is a powerful opportunity.

## Why This Matters

### For My Troop (Immediate)
- Proof of concept that works with real scouts on real requirements and real troop logistics
- Help the troop survive and keep functioning — volunteers are stretched thin
- Make the bureaucracy of requirements, tracking, communication, RSVPs, and event planning less painful
- Give scouts a reason to engage with AI in a bounded, productive way
- Replace the chaos of the TeamSnap-to-Scoutbook migration with an assistant that makes Scoutbook's data actually useful
- People aren't RSVPing for events because the Scoutbook UI is too cumbersome — an assistant that surfaces "what's coming up" and "who's going" naturally solves this

### For Scouting (Medium-term)
- Scouting America struggles to attract and retain volunteers because there are too many rules to follow and enforce, and people don't have time for it
- The scout-guide assistant and the scouter (adult volunteer) assistant could reduce friction and help the whole organization work better
- Safety controls (YPT compliance, transparent communications, parent CC on all emails) are hard to enforce across a national organization of volunteers — an AI system can make compliance automatic rather than burdensome
- Advancement tracking and event calendars synced from Scoutbook reduce manual data entry and give scouts and parents real-time visibility
- A scouter assistant that knows the calendar, roster, advancement status, and RSVP data can help with planning, communication, and decision-making without the scouter having to navigate Scoutbook's UI

### For Education Broadly (Long-term)
- If this works, it's worth taking to Scouting America, the Atlanta Area Council executive, or the headmaster of Pace Academy
- AI assistants will become a part of these children's lives — we should be intentional about how they're introduced
- Teaching through AI means reimagining pedagogy: the AI is a coach, not a tutor that gives answers
- The bounded scope of the "quest" is a feature — it gives scouts a reason to use the assistant while constraining what the assistant will do

## Core Principles

1. **Enable, don't do.** The AI helps scouts accomplish their goals. It reminds, guides, researches, and celebrates progress. It never writes the budget, composes the email, or fills in the requirement for them.

2. **Bounded scope, expanding over time.** The initial focus is the quest (Personal Management and Family Life merit badges via a savings goal), plus calendar/event awareness for the whole troop. The scope grows as the data foundation solidifies — first advancement, then coordination, then broader troop management.

3. **Transparent and safe.** All communications are visible to parents. Emails always CC the parent/guardian (YPT compliance). The system makes safety automatic, not something volunteers have to remember to enforce.

4. **Powered by real data.** Scout profiles, advancement, calendars, events, RSVPs, and troop rosters come from Scoutbook — the official BSA system. The AI works with accurate, current data rather than manual entry. Scoutbook is the backbone.

5. **Scoutbook integration (read + selective write).** We sync data from Scoutbook and can now write back to it (requirement updates, events, RSVPs, emails — see `docs/bsa-api-reference.md`). Write operations go through the BSA API using the same JWT auth as reads. Official records remain in Scoutbook; our writes update Scoutbook directly rather than maintaining a separate system.

6. **Character and values.** The AI adopts a character persona calibrated per scout. Tone, vocabulary, and intensity are tuned to the individual. The character system is designed to build engagement over the 13-week quest without being cringey or patronizing.

7. **Reduce volunteer burden.** Scouters (adult volunteers) get their own assistant that helps with monitoring, coaching, coordination, and administration. The system handles compliance automatically so volunteers can focus on mentoring.

## Target Audiences

| Audience | Assistant | Value |
|----------|-----------|-------|
| **Scouts** (11-17) | Scout Coach | Quest engagement, advancement tracking, merit badge guidance, "what's coming up" |
| **Parents/Guardians** | Scout Guide | Monitor progress, see advancement, view calendar/events, coordinate with troop |
| **Scouters** (adult volunteers) | Scout Guide (expanded) | Reduce admin burden, event planning, RSVP visibility, roster management, automate compliance |
| **Merit Badge Counselors** | (future) | Track which scouts are working on what, communicate safely |

## Scoutbook as the Backbone

The troop recently switched from TeamSnap and TroopMaster to Scoutbook. The transition has been painful — Scoutbook's RSVP and reminder capabilities are cumbersome, people have trouble seeing what events are coming up, and the people planning events can't easily tell who's attending.

Scout Quest solves this by syncing Scoutbook data into a local MongoDB mirror and giving the AI assistants direct access. The sync covers:

- **Roster** — youth, adults, parents, patrol assignments, positions
- **Advancement** — ranks, merit badges, awards, individual requirement status
- **Calendar/Events** — upcoming events with full RSVP and attendance data
- **Activity summaries** — camping nights, hiking miles, service hours per scout

As of 2026-03-15, this data is loaded into production MongoDB: 20 scouts, 15 adults, 419 advancement records, and 2,535 individual requirements. The BSA automated auth endpoint is currently broken (503), so data is refreshed via a manual Chrome CDP workflow (see `docs/scoutbook-data-refresh.md`). The sync is read-only — Scoutbook remains the source of truth for official records.

### What the AI can do with this data

- **Scout:** "What merit badges am I working on?" → real advancement data. "What's the next troop meeting?" → calendar data. "How many camping nights do I have?" → activity summary.
- **Parent:** "How is my scout doing on First Class requirements?" → advancement. "What events are coming up this month?" → calendar. "Did my scout RSVP for the campout?" → RSVP data.
- **Scouter:** "Who hasn't RSVPed for Saturday's campout?" → RSVP. "Which scouts are close to their next rank?" → advancement dashboard. "Show me the troop calendar for March." → events.

## What We're Proving

The prototype was very effective with individual scouts. The open questions are:

1. **Consistency** — Can the tooling produce results that are consistent over the long term, across different scouts and interaction styles?
2. **Closing the loop** — Can agents verify their own functionality, catch technical issues, and self-correct?
3. **Scale** — Does the system work for a full troop (15-30 scouts), not just one-on-one?
4. **Data integration** — Does Scoutbook sync give us enough data to make the experience seamless for scouts, parents, and scouters?
5. **Volunteer adoption** — Will busy volunteer leaders actually use the guide/scouter assistant?
6. **Coordination value** — Can the assistant reduce the friction of event planning, RSVPs, and troop communication enough that people actually use it?
7. **Knowledge authority** — Can a three-layer knowledge system (cached context + vector search + knowledge graph) give the AI accurate, citable BSA policy answers instead of training-data hallucinations?
8. **Write-back integration** — Can the assistant safely update Scoutbook (mark requirements, RSVP, create events, send emails) through the BSA API, with appropriate guard rails?

## Strategic Next Steps

### Phase 0 — foundation (complete or in flight)

1. ~~Get Scoutbook sync fully working~~ — DONE (2026-03-15, 20 scouts, manual refresh workflow)
2. ~~Map BSA write API~~ — DONE (2026-03-18, 8 write endpoints confirmed via network interception, `docs/bsa-api-reference.md`)
3. ~~Build v2 architecture~~ — DONE (custom backend with prompt caching, FalkorDB graph, multi-provider tools landed across Streams A & D, see `docs/plans/2026-03-18-architecture-v2.md`)
4. ~~Acquire BSA corpus~~ — DONE (interim 165K-token knowledge document, see `docs/plans/2026-03-18-corpus-acquisition-plan.md`)
5. ~~Eval framework v2~~ — DONE (v7 canonical, multi-model coverage, MongoDB-backed results)

### Phase 1 — alpha launch readiness (current focus, target ~6 weeks from 2026-04-26)

The path to a real-youth alpha is governed by `docs/plans/2026-04-26-alpha-evolution-roadmap.md`. Hard prerequisites:

6. **Session memory** — scout-state rolling summary + per-conversation parent recap (`docs/plans/2026-04-26-scout-state-and-summaries.md`)
7. **Safety flagging** — three-tier escalation, two-deep notifications, mandated-reporter workflow (`docs/plans/2026-04-26-safety-flagging.md`)
8. **Observability + budget guards** — cost dashboards, per-user hard limits, loop detection, status page (`docs/plans/2026-04-26-observability-cicd.md`)
9. **Parent visibility finish** — summary-first history viewer with safety banners (`docs/plans/2026-04-16-alpha-launch-plan.md` Stream B' continuation)
10. **Tool hardening** — input validation, scout-userId match checks, error-path eval coverage
11. **Onboarding + runbook + welcome page** — Stream F continuation
12. **Calibration week** — internal dry-run before any external user; <5% Tier-2 false-positive target

### Phase 2 — alpha cohort + early-access

13. Launch with 5-10 alpha users (scouts + parents/leaders), 30-day support commitment
14. **Stable + Dev environments** — opt-in early-access tier with summary-only writeback to stable (`docs/plans/2026-04-26-ab-environments.md`)
15. CI/CD eval gates — block prompt/persona/tool PRs that regress quality (`docs/plans/2026-04-26-observability-cicd.md` week 4)

### Phase 3 — broaden if Phase 1-2 prove out

16. Support Eagle candidates — William McDaid, Connor Goldstrom, Charles Brunt
17. Scouter-facing features — event/RSVP queries, advancement dashboards, planning assistant
18. Multi-troop tenancy
19. Native mobile shell (Capacitor — research already in `docs/future-research.md`)
20. If it works, prepare demo for Atlanta Area Council or Scouting America
21. Document the pedagogy approach for broader audiences
