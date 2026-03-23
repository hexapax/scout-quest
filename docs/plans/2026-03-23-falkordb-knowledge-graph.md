# FalkorDB Knowledge Graph — Complete BSA Data Model

**Date:** 2026-03-23
**Status:** Design
**Priority:** High — enables tiered knowledge, fixes fabrication, enables graph queries

## Concept: Graph as Source of Truth, Context as Memory Palace

```
FalkorDB (the library)              Context Cache (the memory palace)
━━━━━━━━━━━━━━━━━━━━━━━━           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every badge, requirement,           Compressed map of what's where.
version, policy, activity,          Just enough for the model to know
cross-reference, counselor          WHERE to look, not WHAT it says.
guide. Full text. Searchable.
                                    "First Aid has 10 reqs covering
"First Aid Req 4a: Demonstrate      wound care, CPR, splinting.
on a mannequin the procedure        Practical demos required.
for cardiopulmonary resusci-        → search for details"
tation (CPR). Explain the
steps and demonstrate..."           "Campout activities: Camping 4,
                                    Cooking 5-6, First Class 4a,
Source: 2026 Requirements           Environmental Science 3b"
Book p.142, effective
2026-02-27                          ~70K tokens, cached
```

## Graph Schema

### Node Types

```
(:Badge {
  name: "First Aid",
  category: "eagle_required" | "elective" | "removed",
  eagle_required: true,
  eagle_required_since: "2016",
  eagle_removed_date: null | "2026-02-27",
  summary: "10 requirements covering wound care, CPR, AED...",
  topic_areas: ["medical", "emergency", "safety"],
  typical_settings: ["campout", "troop_meeting", "summer_camp"],
  counselor_count: 3,  // in this troop
})

(:Requirement {
  id: "first_aid_4a",
  badge: "First Aid",
  number: "4a",
  parent_number: "4",         // parent if subrequirement
  text: "Demonstrate on a mannequin the procedure for CPR...",
  short_text: "CPR demonstration on mannequin",
  type: "practical_demo" | "discussion" | "project" | "tracking" | "knowledge",
  duration_estimate: "30min" | "ongoing" | "1 session",
  requires_counselor: true,
  requires_equipment: ["mannequin", "AED_trainer"],
  group_size: "individual" | "pair" | "patrol" | "troop",
})

(:Version {
  badge: "First Aid",
  year: 2026,
  effective_date: "2026-02-27",
  source: "2026 Boy Scout Requirements Book",
  changes: ["Req 4a: added AED component", "Req 7: revised scenario list"],
})

(:Activity {
  name: "campout",
  type: "outdoor" | "meeting" | "service" | "summer_camp" | "home",
  typical_duration: "weekend" | "evening" | "week" | "ongoing",
  typical_frequency: "monthly" | "biweekly" | "annual" | "one_time",
  description: "Overnight camping trip with patrol cooking and outdoor skills",
})

(:Skill {
  name: "CPR",
  category: "medical" | "outdoor" | "leadership" | "communication" | "craft",
  description: "Cardiopulmonary resuscitation technique",
})

(:Policy {
  name: "Two-Deep Leadership",
  source: "Guide to Safe Scouting",
  section: "IV",
  text: "Two registered adult leaders, or one registered leader and...",
  applies_to: ["all_outings", "transportation", "camping"],
  severity: "mandatory",
})

(:Rank {
  name: "First Class",
  order: 4,  // Scout=1, Tenderfoot=2, Second Class=3, ...
  time_requirement: "active for 4 months as Second Class",
})

(:RankRequirement {
  id: "first_class_4a",
  rank: "First Class",
  number: "4a",
  text: "Help plan a patrol menu...",
  short_text: "Plan patrol meal",
})

(:Scout {
  // From Scoutbook data — per-scout progress
  name: "Will",
  email: "will@test.scoutquest.app",
  rank: "Star",
  patrol: "Flaming Tortillas",
})
```

### Edge Types

```
// Structural
(:Badge)-[:HAS_REQUIREMENT]->(:Requirement)
(:Badge)-[:HAS_VERSION]->(:Version)
(:Rank)-[:HAS_REQUIREMENT]->(:RankRequirement)
(:Requirement)-[:PARENT_OF]->(:Requirement)        // 4 → 4a, 4b

// Activity mapping (the reverse index)
(:Requirement)-[:CAN_BE_DONE_AT {
  quality: "ideal" | "possible" | "stretch",
  notes: "Need access to water for this one"
}]->(:Activity)

(:Activity)-[:REQUIRES_CONDITION {
  condition: "water_access" | "campfire" | "overnight" | "counselor_present"
}]->(:Activity)

// Cross-references
(:Requirement)-[:SIMILAR_TO {
  reason: "both cover CPR techniques"
}]->(:Requirement)

(:Requirement)-[:SATISFIES {
  partially: false
}]->(:RankRequirement)                              // MB req satisfies rank req

(:Badge)-[:RELATES_TO {
  relationship: "prerequisite" | "companion" | "advanced_version"
}]->(:Badge)

// Skills
(:Requirement)-[:TEACHES]->(:Skill)
(:Requirement)-[:REQUIRES_SKILL]->(:Skill)

// Policy
(:Activity)-[:GOVERNED_BY]->(:Policy)
(:Policy)-[:APPLIES_TO]->(:Activity)

// Scout progress
(:Scout)-[:COMPLETED {
  date: "2026-01-15",
  counselor: "Nicole Allen",
  signed_off: true
}]->(:Requirement)

(:Scout)-[:WORKING_ON {
  status: "in_progress",
  started: "2026-02-01"
}]->(:Requirement)

(:Scout)-[:HAS_RANK]->(:Rank)
(:Scout)-[:IN_PATROL]->(:Patrol)
```

## Example Graph Queries

### "What can scouts work on at the spring campout?"

```cypher
MATCH (a:Activity {name: 'campout'})<-[:CAN_BE_DONE_AT]-(r:Requirement)-[:HAS_REQUIREMENT]-(b:Badge)
WHERE NOT exists {
  MATCH (s:Scout {name: 'Will'})-[:COMPLETED]->(r)
}
RETURN b.name, r.number, r.short_text, r.type
ORDER BY b.eagle_required DESC, b.name
```

### "Which badges share requirements with First Aid?"

```cypher
MATCH (r1:Requirement)<-[:HAS_REQUIREMENT]-(:Badge {name: 'First Aid'})
MATCH (r1)-[:SIMILAR_TO]-(r2:Requirement)<-[:HAS_REQUIREMENT]-(other:Badge)
WHERE other.name <> 'First Aid'
RETURN DISTINCT other.name, collect(r2.short_text)
```

### "What changed in Eagle requirements since 2024?"

```cypher
MATCH (b:Badge)-[:HAS_VERSION]->(v:Version)
WHERE b.eagle_required = true AND v.year >= 2024
RETURN b.name, v.year, v.changes
ORDER BY v.year DESC
```

### "What requirements can Will complete at the next troop meeting?"

```cypher
MATCH (s:Scout {name: 'Will'})-[:WORKING_ON]->(r:Requirement)
MATCH (r)-[:CAN_BE_DONE_AT]->(a:Activity {name: 'troop_meeting'})
RETURN r.badge, r.number, r.short_text, r.type
```

### "Recommend next steps for Will's Eagle path"

```cypher
MATCH (s:Scout {name: 'Will'})
MATCH (b:Badge {eagle_required: true})-[:HAS_REQUIREMENT]->(r:Requirement)
WHERE NOT exists { MATCH (s)-[:COMPLETED]->(r) }
WITH b, count(r) as remaining, collect(r.short_text) as reqs
RETURN b.name, remaining, reqs[0..3]
ORDER BY remaining ASC
```

## search_knowledge Tool — Graph-Backed

```python
def handle_search_knowledge(db, scout_email, args):
    """Search the FalkorDB knowledge graph.

    Supports:
    - Text search: "First Aid requirement 4a" → full requirement text
    - Activity search: "campout activities" → requirements doable at campouts
    - Cross-reference: "badges related to Swimming" → connected badges
    - Version history: "Eagle changes 2026" → version diffs
    - Scout-specific: "what can Will work on at campout" → personalized
    """
    query = args.get("query", "")
    badge = args.get("badge")
    search_type = args.get("type")

    # Route to appropriate graph query based on intent
    if search_type == "requirements" or badge:
        return _search_requirements(query, badge)
    elif search_type == "version_history":
        return _search_versions(query)
    elif "campout" in query or "meeting" in query or "activity" in query:
        return _search_by_activity(query, scout_email)
    elif "related" in query or "similar" in query or "cross" in query:
        return _search_cross_references(query)
    else:
        # Hybrid: text search + vector similarity
        return _hybrid_search(query)
```

## Data Pipeline

### Phase 1: Extract & Load (~2 hours)

```
scout-corpus/extracted/
  merit-badges/        → Parse each badge's requirements
  rank-requirements/   → Parse rank requirements
  guide-to-advancement/ → Parse policy sections
  requirement-updates/  → Parse version history

For each badge:
  1. Parse requirements into structured format (number, text, subrequirements)
  2. Create Badge node + Requirement nodes + edges
  3. Create Version nodes from requirement-updates/
```

### Phase 2: Tag & Enrich (~1 hour, LLM-assisted)

```
For each Requirement:
  1. LLM classifies: type (practical_demo, discussion, project, tracking, knowledge)
  2. LLM tags: activity_contexts (campout, troop_meeting, home, summer_camp, etc.)
  3. LLM tags: prerequisite_conditions (water, campfire, counselor, equipment)
  4. LLM identifies: cross-references to other requirements
  5. LLM extracts: skills taught/required

Cost: ~$0.10 using GPT-nano for ~2000 requirements
```

### Phase 3: Build Edges (~30 min)

```
From tags:
  - Create Activity nodes
  - Create CAN_BE_DONE_AT edges (requirement → activity)
  - Create SIMILAR_TO edges (cross-references)
  - Create TEACHES/REQUIRES_SKILL edges
  - Create SATISFIES edges (MB req → rank req)
  - Create GOVERNED_BY edges (activity → policy)
```

### Phase 4: Generate Context Cache (~30 min)

```
From graph:
  1. Badge summaries: MATCH (b:Badge)-[:HAS_REQUIREMENT]->(r)
     → count, topic areas, 2-line summary
  2. Activity index: MATCH (a:Activity)<-[:CAN_BE_DONE_AT]-(r)-[:HAS_REQUIREMENT]-(b)
     → grouped by activity type
  3. Cross-reference hints: MATCH paths between popular badges
     → "Swimming connects to Lifesaving, Rowing, and First Class rank"
  4. Policy highlights: top 20 most-referenced policies

Output: ~70K token context document (the memory palace)
```

### Phase 5: Connect Scout Data

```
From Scoutbook sync:
  - Create/update Scout nodes
  - Create COMPLETED/WORKING_ON edges from advancement data
  - Link patrols, ranks

This enables personalized queries:
  "What can THIS scout work on at THIS activity?"
```

## FalkorDB Setup

Already in the architecture (mentioned in development-state.md). Needs:
- FalkorDB container on devbox (or use the existing one on the production VM)
- Python driver: `pip install falkordb`
- Schema creation script
- Data loading script

## Relationship to Eval System

The eval system tests whether the model uses the knowledge correctly:
- **search_knowledge tool** → model calls it, gets graph-backed results
- **Accuracy scoring** → did the model use correct facts from search results?
- **Tool accuracy** → did the model search when it should have?
- **Cross-reference capability** → can the model connect requirements across badges?

New eval questions to add:
- "We're planning a campout near a lake. What requirements could scouts work on?"
  → Tests activity-based cross-referencing
- "I just finished Swimming MB. What else does that help with?"
  → Tests graph traversal through SATISFIES and SIMILAR_TO edges
- "What's the fastest path to complete my remaining Eagle badges?"
  → Tests personalized graph query + strategic coaching

## Memory Palace Metaphor

The context cache IS a memory palace — a spatial organization of knowledge:

```
Room 1: BSA Policy (the rules wing)
  - Advancement procedures (how things work)
  - Safety rules (what's required)
  - YPT (the boundaries)

Room 2: The Activity Map (the connections room)
  - Campout corner: what you can do outdoors
  - Meeting hall: what you can do at troop meetings
  - Service corridor: community service opportunities
  - Summer camp wing: intensive badge work

Room 3: The Badge Gallery (the overview)
  - Eagle wall: 13 required badges with brief profiles
  - Elective shelves: grouped by topic area
  - Each badge card: 2-line summary + "ask me for details"

Room 4: The Scout's Room (personalized)
  - Their progress map
  - Their quest state
  - Their troop details
```

The model walks through this palace to orient itself, then uses search_knowledge
to "pull a book off the shelf" when it needs the actual text.
