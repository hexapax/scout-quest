# Finding: Tool Usage Patterns and Knowledge Base Gaps

**Date:** 2026-03-23
**Confidence:** High
**Based on:** 4 iterations of tool validation tests (C4, C7, E5, E6, B8, F5, S1, F1)

## Summary

Claude Sonnet 4.6 with PKTW layer (all tools + web search) shows three distinct behaviors:

1. **Correct: No tools needed** — BSA policy questions (S1, B8) answered directly from knowledge base
2. **Correct: Read tools for personalization** — Scout-specific questions (F5, F1) use read_quest_state/read_requirements to check this scout's data
3. **Problem: Fabrication despite knowledge base** — Specific requirement text questions (C4, C7, E5) generate plausible-sounding but fabricated details

## Root Cause

The 177K BSA knowledge base contains policy, procedures, and requirement *summaries* but not the complete requirement *text* for every merit badge. When asked "what are the requirements for CIS?" the model:
- Correctly doesn't web search (after prompt fix)
- Correctly doesn't call read tools (they only have status)
- Incorrectly fabricates detailed requirement text from partial knowledge

## Impact on Scoring

- tool_accuracy is penalized even when tool behavior is correct (no tools needed for BSA facts)
- accuracy is correctly penalized for fabrication
- The scorer conflates "used wrong tool" with "fabricated from incomplete knowledge"

## Recommended Fix

Knowledge base quality improvement — not eval system changes:
1. Add complete requirement text for all Eagle-required badges to the knowledge base
2. Or: add a `search_knowledge` vector search tool that retrieves specific requirement text
3. Train the model to say "I have general information about this badge but not the exact requirement text" instead of fabricating

## What Changed During Investigation

- Tool descriptions now clarify knowledge base vs scout data vs web search
- Prompt explicitly says "answer BSA facts directly from your context"
- Model stopped web searching for BSA facts (C4 went from web_search×2 to no tools)
- Model stopped calling random tools (C7 went from web_search to adjust_tone to no tools)
- Fabrication remains — this is a knowledge base completeness issue
