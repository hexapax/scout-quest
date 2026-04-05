# Scout Quest: AI-Powered Advancement for Troop 2024

## What is Scout Quest?

Scout Quest is an AI assistant built specifically for our troop. It connects to our real Scoutbook data — roster, advancement records, merit badges, events, and RSVPs — and makes that information accessible through a natural conversation with an AI that understands BSA requirements, policies, and procedures.

There are three assistants, each designed for a different audience:

- **Scout Coach** — for scouts. Helps them understand what they're working on, find requirements, get coaching on skills, and discover which troop-mates they can work with.
- **Scout Guide** — for parents and leaders. Provides visibility into a scout's progress, answers questions about BSA procedures, and helps plan advancement activities.
- **Troop Planner** — for leaders running advancement events. Generates session plans with stations, teach/learn pairings, equipment lists, and per-scout checklists.

## What Makes This Different from ChatGPT?

Generic AI doesn't know your troop. Scout Quest does.

When a scout asks "What rank am I working on?", the answer comes from Scoutbook — not from a guess. When a leader asks "Who still needs Tenderfoot?", the system queries a knowledge graph built from real advancement data for all 28 scouts in the troop.

**The knowledge base includes:**

- A curated BSA reference covering rank requirements (Scout through Eagle), 14 Eagle-required merit badges, advancement policies from the Guide to Advancement, and safety procedures from the Guide to Safe Scouting
- Live Scoutbook data: roster, rank progress, merit badge status, requirement completion, upcoming events, and RSVP status for every scout
- A knowledge graph that maps relationships between scouts, requirements, and advancements — enabling queries like "who else is working on the same rank?" or "which older scouts could help teach first aid?"

**The AI model is Claude Sonnet 4.6 from Anthropic**, a reasoning model that can interpret requirements, provide coaching, and make connections between what a scout is working on and what resources are available.

## What Can It Do?

### For Scouts

- **"What do I still need for First Class?"** — Pulls your actual incomplete requirements from Scoutbook.
- **"Who else is working on the same rank?"** — Shows scouts at the same advancement stage so they can work together.
- **"What could I help teach younger scouts?"** — Identifies requirements you've completed that others need, encouraging peer mentoring and the Teaching EDGE method.
- **"What can me and Jack work on together?"** — Finds shared incomplete requirements between any two scouts.
- **"What's the rule about partial completions?"** — Answers BSA policy questions directly and accurately.

### For Parents

- **"How is my scout doing on advancement?"** — Shows earned ranks, in-progress work, and upcoming events.
- **"What events are coming up?"** — Lists the next 30 days of troop events with RSVP status.
- **"What's the Eagle process?"** — Walks through the requirements and timeline without jargon.

### For Leaders

- **"Show me troop advancement status"** — Dashboard of every scout's rank progress, who's close to the next rank, and where bottlenecks are.
- **"Plan a Sunday advancement session"** — Generates a structured plan: skill stations, teach/learn pairings, equipment needs, multi-person requirements, and per-scout checklists.
- **"Who can teach navigation?"** — Identifies scouts who have completed navigation requirements AND have Teaching EDGE experience — your best peer instructors.
- **"Who still needs Second Class 6a?"** — Finds every scout who hasn't completed a specific requirement.

## The Collaborative Advancement Engine

BSA's advancement program is built on the idea that scouts learn by teaching. The Teaching EDGE method (Explain, Demonstrate, Guide, Enable) appears at every rank level, from Tenderfoot through Eagle. Many requirements explicitly require working with another person — line rescues need three people, stretcher transport needs partners, and patrol meals need a team.

Scout Quest makes this visible. It knows which scouts have completed a requirement and which scouts still need it. It identifies natural teach/learn pairings so that an older scout practicing leadership can work with a younger scout completing a skill requirement. Both scouts advance.

For events like a Sunday advancement day, the session planner tool generates a complete plan: which scouts should be at which station, who leads each station, what equipment is needed, and a checklist of requirements each scout can complete during the session.

## How It Works (Briefly)

Scout Quest runs as a private web application. Scouts and parents log in with their Google account. The system matches their email to the Scoutbook roster to identify who they are and pull their advancement data.

All data stays within our infrastructure. The AI doesn't store conversations permanently and doesn't share information with other users. Parents can only see their own scout's data. Leaders can see troop-wide information. Communication tools (like email drafting) always CC parents, following Youth Protection Training guidelines.

The Scoutbook data is refreshed periodically by syncing directly from BSA's systems. The AI's BSA knowledge base is curated from official BSA publications and kept up to date.

## What It Won't Do

- **It won't do the work for a scout.** It coaches, guides, and asks questions — it doesn't write the budget, compose the email, or fill in the requirement. The scout does the work.
- **It won't sign off on requirements.** Only a Scoutmaster or merit badge counselor can mark requirements complete. The AI can help a scout prepare, but advancement authority stays with the humans.
- **It won't replace Scoutbook.** Scoutbook remains the official record. Scout Quest reads from it and can propose updates, but official records are managed through BSA's systems.
- **It won't communicate without transparency.** Any email drafted through the system always includes parent/guardian CCs. There are no private channels between the AI and a scout.

## Getting Started

- **Scouts**: Go to scout-quest.hexapax.com, log in with your Google account, and start chatting with Scout Coach.
- **Parents**: Same URL, same login. The system detects your role from the Scoutbook roster.
- **Leaders**: Access troop-wide tools through the same interface. Ask about troop progress, plan sessions, or look up specific requirements.

Questions? Talk to Scoutmaster Jeremy or try asking Scout Quest itself.
