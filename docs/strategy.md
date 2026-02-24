# Scout Quest — Strategy

**Last updated:** 2026-02-22

## Vision

Scout Quest is an AI-assisted coordination and coaching system for Boy Scout troops. It gives scouts, parents, and adult volunteers ("scouters") an AI assistant backed by real troop data from Scoutbook — the official BSA management system.

The project started as a merit badge coaching tool for one troop but is evolving into something broader: an AI layer that makes the entire troop experience more accessible. Scouts get coaching and accountability. Parents get visibility into their child's progress and upcoming events. Scouters get help with the relentless coordination burden that drives volunteer attrition.

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

5. **Read-only from Scoutbook.** We sync data from Scoutbook but never write back to it. People update Scoutbook directly for official records. This keeps the system safe and simple — we can't break anything.

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

This data is synced periodically via cron (with smart rate limiting) and available on-demand via admin tools. The sync is read-only — Scoutbook remains the source of truth for official records.

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

## Strategic Next Steps

1. Get Scoutbook sync fully working — roster, advancement, calendar/events, activity data
2. Close the testing loop — agents need to be able to verify the system works end-to-end
3. Run with 2-3 scouts from the troop as a pilot (quest + calendar awareness)
4. Add scouter-facing features — event/RSVP queries, roster views, advancement dashboards
5. If it works, prepare a demo for the Atlanta Area Council or Scouting America
6. Document the pedagogy approach for broader audiences (Pace Academy, education conferences)
