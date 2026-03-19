# Layered Knowledge Evaluation Plan

**Date:** 2026-03-19
**Goal:** Measure how each knowledge layer improves response quality, using the existing test harness with progressive context injection.

---

## Evaluation Layers

| Layer | Description | Token Budget | What Changes |
|---|---|---|---|
| **L0: Null** | No BSA knowledge. Model's training data only. Persona prompt + scout context. | ~1K | Baseline — how good is Claude "out of the box" for scouting? |
| **L1-thin: Interim** | Current 52K interim knowledge doc (assembled from scouting-knowledge/ markdown) | ~53K | Troop 2024 info + partial requirements + policies from Perplexity research |
| **L1-full: Production** | Full distilled knowledge doc (176K tokens, 10 parts from corpus) | ~177K | Complete G2A policy, G2SS safety, all 141 MB requirements, TLG volumes, version history |
| **L2: + Retrieval** | L1-full + voyage-context-3 embeddings in FalkorDB for search_bsa_reference tool | ~177K + retrieval | Deep retrieval for specific requirement text, policy sections, cross-references |
| **L3: + Graph** | L2 + enriched graph nodes (skills, topics, version changes, cross-badge relationships) | ~177K + retrieval + graph | "What overlaps between Camping and Hiking?", version-aware answers, skill-based recommendations |

---

## Test Question Categories

### Category A: Policy Nuance (where G2A depth matters)

These questions have answers that models often get confidently wrong from training data. The G2A has specific, sometimes counter-intuitive policy positions.

| # | Question | What L0 likely says | What L1-full should say | Differentiator |
|---|---|---|---|---|
| A1 | "Can a board of review reject me for not being active enough?" | Probably yes, vague answer | G2A 4.2.3.0: "reasonable" standard, cannot hold to unwritten expectations, must communicate early | G2A policy depth |
| A2 | "My scoutmaster says I have to redo a requirement because a different counselor started it. Is that true?" | Might agree it's valid | G2A: "Scouts need not pass all requirements of one merit badge with same counselor." Partials have no expiration except 18th birthday. | Partial completion policy |
| A3 | "Do partial merit badge completions expire?" | Training data might say "yes, some councils set limits" | G2A: "Units, districts, or councils must not establish other expiration dates" beyond 18th birthday | Explicit G2A prohibition |
| A4 | "My board of review wants to retest me on requirements. Can they do that?" | Might say yes, it's their job | G2A: BOR is NOT a retest. "The board of review is not an examination" — they verify the process was followed, not re-examine knowledge. | Common misconception |
| A5 | "I was told I can't work on Star and Life requirements at the same time. Is that right?" | Might confirm this | G2A: You CAN work on requirements for future ranks, but must earn them in sequence. Working ahead is explicitly allowed. | Working-ahead policy |

### Category B: Troop-Specific Values (where scoutmaster voice matters)

These test whether the cached context shapes the coaching philosophy. The model's default training produces generic "encouraging tutor" behavior. The troop context should produce specific Troop 2024 values.

| # | Question | What L0 likely says | What L1-thin/full should say | Differentiator |
|---|---|---|---|---|
| B1 | "I don't want to go on the campout this weekend" | Generic encouragement to attend | Should reference troop's specific camping expectations, outdoor focus, patrol method values from TLG | Troop culture |
| B2 | "Can my mom do my Eagle project for me?" | "No, you need to lead it yourself" | Should reference specific G2A Eagle project requirements: scout must plan, develop, give leadership. Distinguish between family helping vs family leading. | Eagle project policy depth |
| B3 | "What should I wear to the meeting?" | "Your scout uniform" | Should know Troop 2024 specifics: Class A for courts of honor, Class B (troop t-shirt) for regular biweekly meetings | Troop-specific uniform policy |
| B4 | "How do I get a blue card?" | Generic "ask your scoutmaster" | Should know Troop 2024's advancement practices, blue card process, who to contact (advancement chair) | Troop advancement process |
| B5 | "Is it OK to use AI to help with my merit badge requirements?" | Model might hedge or say "ask your leader" | Should reflect scoutmaster's values: AI as a coaching tool, not a shortcut. Scout does the work. Socratic method. | Coaching philosophy |

### Category C: Requirement Accuracy (where complete requirement text matters)

These test factual accuracy on specific requirements that the model might hallucinate or confuse with outdated versions.

| # | Question | What L0 likely says | What L1-full should say | Differentiator |
|---|---|---|---|---|
| C1 | "How many camping nights do I need for Camping merit badge?" | Might say "20" (common answer) | Requirement 9a/9b: 20 days AND nights total, with specific subrequirements about long-term camp, family campout exclusions | Exact requirement text |
| C2 | "What changed in the 2025 Eagle requirements?" | Training data likely outdated | Version history shows v2026 Eagle requirements effective 2026-02-27 with specific changes | Version awareness |
| C3 | "For Personal Fitness, do I need to do the 12-week exercise plan or just track it?" | Might confuse this | PF Req 8: Must develop AND follow a training plan for 12 weeks, keep a log, report improvements | Precise requirement text |
| C4 | "What are the Citizenship in Society requirements?" | Training data might have older version | Current version from official 2025 requirements book | Currency of requirements |
| C5 | "Can I count my Eagle project service hours toward the Star service requirement?" | Might say yes | Depends on timing and specific policy — G2A has rules about double-counting | Policy cross-reference |

### Category D: Safety & YPT (where G2SS depth matters)

These test whether the model gives correct safety guidance vs generic advice.

| # | Question | What L0 likely says | What L1-full should say | Differentiator |
|---|---|---|---|---|
| D1 | "Can our scoutmaster drive me to the campout alone?" | "That should be fine" or "ask your parents" | G2SS: Two-deep leadership applies to transportation. No one-on-one during transport. Must have 2 adults or adult + 2 youth. | G2SS specifics |
| D2 | "We want to go kayaking at the lake. What do we need?" | Generic "wear life jackets" | G2SS: Safe Swim Defense AND Safety Afloat both apply. Specific requirements for qualified supervision, buddy system, ability groups, lookout. | Activity-specific safety |
| D3 | "My scout leader wants to be friends with me on Instagram. Is that OK?" | Might say "that's nice" | YPT: No private one-on-one digital contact between adults and youth. All electronic communication must include another adult. | YPT digital communication |
| D4 | "How long can we drive to get to summer camp?" | "However long it takes" | G2SS: Driving time limited to max 10 hours in one 24-hour period, regardless of drivers available. Frequent breaks required. | Specific G2SS rule |

### Category E: Cross-Reference & Indirect (where retrieval + graph matter most)

These questions require connecting information across multiple sources. L0-L1 will struggle. L2 retrieval helps. L3 graph connections should excel.

| # | Question | Differentiator |
|---|---|---|
| E1 | "What merit badges would help me prepare for my Eagle project?" | Needs to cross-reference project management skills with MB requirements |
| E2 | "I like cooking. What other badges are related?" | Graph: skill-based connections between Cooking, Camping, Backpacking |
| E3 | "Which First Class requirements can I complete at the same campout as Camping MB requirements?" | Cross-reference rank + MB requirements for overlap |
| E4 | "I completed Swimming MB. Does that count toward any rank requirements?" | Graph: Swimming MB → rank requirement relationships |
| E5 | "What requirements changed between 2023 and 2025 for the badges I'm working on?" | Version-aware graph: VersionChange nodes with per-scout context |

---

## Execution Plan

### Phase 1: Establish baselines (L0 + L1-thin)

1. Adapt the harness runner to accept a `knowledgeLayer` parameter
2. For L0: pass empty system[0] (no knowledge block, just persona + scout context)
3. For L1-thin: use current interim knowledge doc (already deployed, 52K tokens)
4. Run all 25 questions above (A1-A5, B1-B5, C1-C5, D1-D4, E1-E5) through the harness
5. Score each on the 7 evaluation dimensions
6. Store as regression baseline

### Phase 2: Production knowledge (L1-full)

1. Swap interim doc for production `bsa-knowledge-v1.md` (176K tokens)
2. Rebuild + deploy backend
3. Re-run same 25 questions
4. Compare scores to L0 and L1-thin
5. Expected biggest improvements: A1-A5 (policy), C1-C5 (requirements), D1-D4 (safety)

### Phase 3: Retrieval augmentation (L2)

1. Generate voyage-context-3 embeddings for 3,990 chunks
2. Load vectors into FalkorDB
3. Update `search_bsa_reference` tool to use vector search (hybrid: BM25 + semantic)
4. Re-run same 25 questions
5. Expected biggest improvements: E1-E5 (cross-reference), C1-C5 (exact text retrieval)

### Phase 4: Graph enrichment (L3)

1. Load Layer 3 nodes (skills, topics, version changes) into FalkorDB
2. Add graph-aware tools or enrich search results with graph context
3. Re-run same 25 questions
4. Expected biggest improvements: E1-E5 (graph traversal), version-aware answers

### Scoring & Comparison

For each layer, produce a matrix:

```
                    L0    L1-thin   L1-full   L2      L3
A1 (BOR policy)     ?/10  ?/10      ?/10      ?/10    ?/10
A2 (Partial MB)     ?/10  ?/10      ?/10      ?/10    ?/10
...
Overall avg         ?     ?         ?         ?       ?
```

**Success criteria:**
- L1-thin > L0 on categories A, B, C (validates interim knowledge adds value)
- L1-full > L1-thin on categories A, C, D (validates production doc is better)
- L2 > L1-full on category E (validates retrieval adds value for cross-reference)
- L3 > L2 on category E (validates graph adds value for relationship queries)
- No layer should regress on any category vs the previous layer

---

## Test Harness Adaptation

The existing harness at `mcp-servers/scout-quest/test/` needs these changes:

1. **New `--knowledge-layer` CLI flag** — selects which system[0] content to inject
2. **Backend HTTP mode** — option to call the deployed backend's `/v1/chat/completions` instead of direct Anthropic SDK (tests the full stack including caching)
3. **New scenario file** — `knowledge-layer-eval.ts` with the 25 questions above as individual scenarios with custom evaluation prompts
4. **Comparison report** — side-by-side scores across layers

The existing evaluator dimensions map directly:
- `requirement_accuracy` → Categories C, E
- `scope_adherence` → Categories A, D (policy correctness)
- `character_consistency` → Category B (troop values)
- `socratic_method` → Category B (coaching philosophy)
- `ypt_compliance` → Category D
- `engagement_quality` → All (does the answer actually help?)
- `state_management` → Category E (uses tools correctly for cross-reference)
