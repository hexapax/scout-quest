# Tiered Knowledge Architecture — Context Index + Search Tool

**Date:** 2026-03-23
**Status:** Design
**Priority:** High — addresses root cause of fabrication in eval results

## Problem

The 177K-token BSA knowledge base in context is both too much and not enough:
- **Too much**: 89K tokens of requirement text inflates every API call. Most questions only need 1-2 badges.
- **Not enough**: Requirements are summaries missing subrequirements (a, b, c). Model fabricates details.
- **Wrong shape**: Cross-referencing works (model sees everything) but lookup fails (fabricates specifics).

## Design: Three Knowledge Tiers

```
Tier 1: CONTEXT (always in system prompt, cached)
  ├── BSA Policy & Procedures (~30K tokens)
  │   G2A, G2SS, YPT, advancement procedures, BOR rules
  │   Kept in full — referenced across many question types
  │
  ├── Activity-to-Requirement Index (~15K tokens)
  │   Reverse index: "what can you work on during X activity?"
  │   Enables cross-referencing without full requirement text
  │
  ├── Badge & Requirement Summary (~10K tokens)
  │   One-line per requirement — enough to suggest, not enough to fabricate
  │   "First Aid 4a: Demonstrate first aid for stopped breathing"
  │
  ├── Coaching Tips & Strategies (~5K tokens)
  │   "Older scouts can mentor younger on completed requirements"
  │   "Summer camp is prime for aquatics badges"
  │   "Campouts: combine Camping, Cooking, Hiking requirements"
  │
  └── Troop Context (~11K tokens)
      Roster, schedule, leaders, patrols — unchanged

  Total: ~70K tokens (down from 177K — 60% reduction)

Tier 2: SEARCH TOOL (on demand via search_knowledge)
  ├── Full requirement text — exact wording, all subrequirements
  ├── Version history — what changed between years
  ├── Counselor guidelines — how requirements should be evaluated
  └── Detailed policy sections — full G2A chapters, etc.

  Storage: MongoDB collection with text search + optional vector embeddings

Tier 3: FULL DOCUMENTS (reference archive)
  ├── Original BSA publications (scout-corpus repo)
  ├── OCR'd guidebooks
  └── Scoutbook API data exports

  Storage: Files in scout-corpus repo, referenced by Tier 2 entries
```

## Activity-to-Requirement Reverse Index

The key innovation. Instead of listing requirements by badge, list them by activity:

```yaml
campout_activities:
  camping:
    - "Camping 4a-d: Plan and cook meals for patrol (min 2 breakfasts, 3 dinners)"
    - "Camping 7a: Demonstrate proper tent setup and campsite organization"
    - "Cooking 5-6: Prepare meals outdoors using different methods"
    - "First Class 4a: Help plan and cook a patrol meal"
    - "Environmental Science 3b: Conduct outdoor observations"

  hiking:
    - "Hiking MB: Complete hikes of various lengths (5, 10, 15, 20 miles)"
    - "First Class 2a-b: Orienteering on a 5-mile hike"
    - "Camping 9b: Participate in a 10-mile hike"

  water_activities:
    - "Swimming MB: All requirements need water access"
    - "Lifesaving MB: Requires supervised water"
    - "Canoeing/Kayaking MB: Requires watercraft access"
    - "Safety: Safe Swim Defense AND Safety Afloat required"

troop_meetings:
  presentations:
    - "Communication MB 5: Give a 5-minute presentation"
    - "Public Speaking MB: Prepare and deliver speeches"
    - "Citizenship in Community 7: Attend a meeting and report"

  skills_instruction:
    - "Any merit badge: Older scouts can teach younger scouts"
    - "First Aid 4-5: Practice first aid scenarios with patrol"
    - "Pioneering: Knot-tying stations at meetings"

  planning:
    - "Personal Management 1-2: Budget planning and tracking"
    - "Family Life 4: Family meeting planning"
    - "Eagle project planning: Can start during regular meetings"

service_projects:
  community:
    - "Eagle project: Plan, develop, give leadership to a service project"
    - "Community service hours: Count toward rank advancement"
    - "Citizenship in Community: Service requirement"

  troop:
    - "Helping younger scouts learn skills satisfies multiple badges"
    - "Teaching a skill = learning it deeper"

seasonal:
  summer_camp:
    - "Prime time for: Swimming, Lifesaving, Water Sports, Archery, Rifle/Shotgun"
    - "Most camps offer 4-6 merit badges per week"
    - "Camping nights count toward Camping MB"

  winter:
    - "Winter camping counts toward Camping MB (20 nights)"
    - "Cold weather first aid scenarios"
    - "Winter sports: Skiing, Snowboarding MB opportunities"
```

## Badge Summary Format (Tier 1)

Brief enough to prevent fabrication, detailed enough for cross-referencing:

```
## First Aid (Eagle-required)
10 requirements covering: wound care, shock, CPR, AED, splinting,
water rescue, patient assessment. Req 4 splits into 4a (stopped breathing/CPR)
and 4b (severe bleeding). Practical demonstrations required.
→ search_knowledge("First Aid merit badge requirements") for full text.

## Citizenship in Society (removed from Eagle-required 2026-02-27)
11 requirements covering: diversity/equity/inclusion terms, ethical leadership,
connecting with different perspectives, studying positive social change events.
Strong discussion component — most reqs involve counselor conversations.
→ search_knowledge("Citizenship in Society requirements") for full text.

## Personal Management (Eagle-required)
10 requirements covering: budget planning (13-week tracking), goal setting,
income/expense tracking, savings plans, time management, insurance basics.
Req 2c is the 13-week budget — needs consistent weekly entries.
→ search_knowledge("Personal Management requirements") for full text.
```

## search_knowledge Tool

```python
{
    "name": "search_knowledge",
    "description": (
        "Search the BSA knowledge database for specific requirement text, "
        "version history, policy details, or counselor guidelines. Returns "
        "the exact text with source citations. Use this when you need "
        "SPECIFIC details beyond what's in your summary context — e.g., "
        "exact requirement wording, subrequirement details, or version changes."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to search for (e.g., 'First Aid requirement 4a 4b', 'Eagle requirements 2026 changes')",
            },
            "badge": {
                "type": "string",
                "description": "Optional: specific badge name to filter results",
            },
            "type": {
                "type": "string",
                "enum": ["requirements", "policy", "version_history", "counselor_guide"],
                "description": "Optional: type of content to search for",
            },
        },
        "required": ["query"],
    },
}
```

## MongoDB Knowledge Collection

```javascript
// knowledge_chunks collection
{
  _id: ObjectId,
  badge: "First Aid",                    // badge name (null for policy docs)
  section: "requirements",               // requirements, policy, version_history, counselor_guide
  requirement_id: "4a",                  // specific requirement (null for non-requirement chunks)
  title: "First Aid Requirement 4a — CPR and Rescue Breathing",
  text: "Demonstrate on a mannequin...",  // full text
  text_embedding: [float],               // vector embedding for semantic search
  source: "2026 Boy Scout Requirements Book, p. 142",
  version: "2026",                       // which version of requirements
  version_effective_date: "2026-02-27",
  tags: ["campout", "first_aid", "practical", "demonstration", "cpr"],
  activity_contexts: ["campout", "troop_meeting", "skills_instruction"],
  created_at: ISODate,
}
```

**Indexes:**
- Text index on `text` + `title` for keyword search
- Vector index on `text_embedding` for semantic search
- Compound index on `badge` + `section` + `requirement_id` for direct lookup
- Tag index for activity-based queries

## Pipeline: Building the Index

### Step 1: Extract from scout-corpus

The scout-corpus repo has the raw data:
```
scout-corpus/
  extracted/
    merit-badges/         ← badge requirement text
    rank-requirements/    ← rank requirement text
    guide-to-advancement/ ← G2A policy
    guide-to-safe-scouting/ ← safety policies
    requirement-updates/  ← version history
```

### Step 2: Tag requirements with activity contexts

Use an LLM to read each requirement and tag it:

```python
prompt = """Read this merit badge requirement and tag it with:
1. activity_contexts: what activities/settings this could be done in
   (campout, troop_meeting, service_project, home, school, summer_camp, etc.)
2. prerequisite_conditions: what you need to have available
   (water, campfire, first_aid_kit, patrol, counselor, etc.)
3. cross_references: other badges/ranks with similar requirements

Requirement: {requirement_text}
Badge: {badge_name}

Return JSON: {activity_contexts: [...], prerequisites: [...], cross_refs: [...]}"""
```

Cost: ~$0.10 for GPT-nano to tag all ~2000 requirements.

### Step 3: Build reverse index from tags

Group requirements by activity_context to build the Tier 1 index:
```python
# Aggregate: for each activity_context, collect all tagged requirements
for context in ["campout", "troop_meeting", "service_project", ...]:
    reqs = db.knowledge_chunks.find({"activity_contexts": context})
    # Format as the activity-to-requirement index
```

### Step 4: Generate badge summaries

Use an LLM to read full requirements and produce 2-3 line summaries:
```python
prompt = """Summarize this merit badge in 2-3 lines. Include:
- Number of requirements
- Key topics covered
- Any notable features (long-term tracking, practical demos, discussions)
- Note: "→ search_knowledge('{badge_name} requirements') for full text."

Full requirements: {full_text}"""
```

### Step 5: Assemble Tier 1 context document

Combine: policy (trimmed) + activity index + badge summaries + coaching tips.
Target: ~70K tokens.

### Step 6: Load Tier 2 into MongoDB

Insert all requirement chunks with embeddings into knowledge_chunks collection.

## Cost Impact

| Metric | Current (177K) | Proposed (70K + search) |
|--------|---------------|------------------------|
| Context tokens/call | 177K | 70K |
| Anthropic cost/call (cached) | $0.053 | $0.021 |
| Anthropic cost/call (uncached) | $0.53 | $0.21 |
| First call (cache creation) | $0.53 | $0.21 |
| search_knowledge call | N/A | ~$0.001 (MongoDB) |
| 54-question eval run | ~$4 | ~$2 |
| Accuracy on specific reqs | Low (fabricates) | High (exact text) |

## Migration Path

1. **Build the pipeline** — extract, tag, index (scout-corpus → MongoDB)
2. **Build search_knowledge tool** — add to eval_tools.py
3. **Generate Tier 1 context** — summaries + activity index
4. **Create new knowledge layer** — "PKT-tiered" that uses the smaller context
5. **A/B test** — run same questions with 177K context vs 70K + search
6. **If better** — make tiered the default, retire the 177K monolith
