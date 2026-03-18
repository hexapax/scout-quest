# BSA Corpus Acquisition Plan

**Status:** Approved — see scout-corpus repo for authoritative plan
**Date:** 2026-03-18
**Architecture:** docs/plans/2026-03-18-architecture-v2.md
**Corpus repo:** https://github.com/hexapax/scout-corpus

> **This document is a summary and cross-reference pointer.**
> The full acquisition plan, directory structure, and pipeline documentation lives in the
> [scout-corpus repo README](https://github.com/hexapax/scout-corpus/blob/main/README.md).
> Local clone: `/opt/repos/scout-corpus/`

---

## Overview

Build a private `bsa-corpus` repo containing all BSA source material, extracted text, enrichment pipelines, and the processing infrastructure that produces scout-quest's three knowledge layers. This is the prerequisite for the 200K-token cached knowledge document and the FalkorDB knowledge graph.

## Repository Structure

```
bsa-corpus/                           (private GitHub repo)
├── sources/                          Raw source material (gitignored binaries)
│   ├── manifest.yaml                 Master manifest with provenance
│   ├── official-free/                Freely distributed by BSA (PDFs)
│   ├── official-purchased/           Purchased handbooks/pamphlets (NOT committed)
│   ├── scoutbook-export/             Data from Scoutbook API
│   └── web-scraped/                  Content from scouting.org
│
├── extracted/                        Clean text extracted from sources
│   ├── guide-to-advancement/         G2A full text + sections
│   ├── guide-to-safe-scouting/       G2SS full text + sections
│   ├── rank-requirements/            Per-rank markdown (scout through eagle)
│   ├── merit-badges/                 Per-badge: requirements.md, pamphlet.md, versions/
│   ├── scoutmaster-handbook/
│   ├── youth-protection/
│   └── program-resources/            Meeting plans, games, activities
│
├── enriched/                         AI-processed content
│   ├── contextual-chunks/            Chunks with Contextual Retrieval prefixes
│   ├── graph-extractions/            Structured entity/relationship JSON
│   ├── embeddings/                   Generated embeddings (gitignored)
│   └── distilled/                    The Layer 1 cached context document
│       ├── bsa-knowledge-v1.md       Distilled knowledge (target: 200K tokens)
│       └── token-count.txt
│
├── pipelines/                        Processing scripts
│   ├── extract/                      Source → extracted text
│   │   ├── web-scraper.mjs           scouting.org content scraper
│   │   ├── pdf-to-markdown.mjs       PDF extraction (pymupdf4llm or marker)
│   │   ├── requirements-parser.mjs   Parse structured requirements → YAML
│   │   └── version-diff.mjs          Compare requirement versions
│   ├── enrich/                       Extracted → enriched
│   │   ├── contextual-retrieval.mjs  Add context prefixes (Haiku Batch)
│   │   ├── graph-extraction.mjs      Extract entities/relationships (Sonnet Batch)
│   │   ├── distill-knowledge.mjs     Build Layer 1 cached context doc
│   │   └── generate-embeddings.mjs   Voyage/Gemini embedding generation
│   ├── load/                         Enriched → FalkorDB
│   │   ├── load-graph.mjs            Parse graph-extractions → Cypher MERGE
│   │   └── load-vectors.mjs          Load embeddings into FalkorDB
│   └── validate/                     Quality checks
│       ├── spot-check.mjs            Random sample for human review
│       └── retrieval-eval.mjs        Test queries against expected answers
│
└── eval/                             Evaluation dataset
    ├── policy-questions.yaml         100+ policy Q&A pairs
    ├── advancement-scenarios.yaml    Complex advancement scenarios
    └── version-aware-tests.yaml      Version-specific requirement queries
```

## Source Provenance Tiers

### Tier A: Freely Distributed by BSA

Published by BSA for free public use. Safe to process and store.

| Document | Source | Format | Est. Tokens | Priority |
|----------|--------|--------|-------------|----------|
| Guide to Advancement 2025 | filestore.scouting.org/filestore/pdf/33088.pdf | PDF | ~107K | HIGH |
| Guide to Advancement (web) | scouting.org/resources/guide-to-advancement/ | HTML | ~107K | HIGH |
| Guide to Safe Scouting | scouting.org/health-and-safety/gss/ | HTML | ~80K | HIGH |
| Scouts BSA Requirements 2024/2025 | scouting.org | PDF | ~50K each | HIGH |
| Annual requirement changes | scouting.org/program-updates/ | HTML/PDF | ~15K/year | HIGH |
| Merit badge requirement lists (all 130+) | scouting.org/merit-badges/ | HTML | ~60K | HIGH |
| Youth Protection training | scouting.org/training/youth-protection/ | HTML | ~20K | HIGH |
| Position-specific training outlines | scouting.org | HTML/PDF | ~30K | MEDIUM |

### Tier B: Scoutbook Data

Already accessible through existing sync tools.

| Data | Method | Notes |
|------|--------|-------|
| Rank requirements (full text, all ranks) | Scoutbook API | Already in `data/fresh/` |
| Merit badge requirements (all 130+) | Scoutbook API | Partially available |
| Scout advancement records | Scoutbook sync | Troop 2024 specific |
| Historical requirement versions | Scoutbook + scouting.org | Critical for version tracking |

### Tier C: Purchased Content (metadata only in repo)

Require purchase. Process locally, commit only derivatives.

| Document | Est. Cost | Est. Tokens | Priority |
|----------|-----------|-------------|----------|
| Scoutmaster Handbook | ~$15 | ~213K | HIGH — essential for Layer 1 |
| Eagle-required MB pamphlets (13) | ~$65-78 | ~650K | MEDIUM — needed for Layer 2 |
| Active troop MB pamphlets (~15 more) | ~$75-90 | ~750K | LOW — Layer 2 expansion |
| Scouts BSA Handbook | ~$15 | ~200K | MEDIUM |

**Key insight:** Requirements are free (Tier A/B). Pamphlet explanatory content is Tier C. The 200K cached knowledge document (Layer 1) can be built almost entirely from Tier A+B sources. Pamphlet content is only needed for Layer 2 deep reference.

### Tier D: Community/Informal Content

| Content | Source | Notes |
|---------|--------|-------|
| Meeting plans and program ideas | Scouting Magazine, troop libraries | Not needed for MVP |
| Board of review question banks | Various council resources | Widely shared |
| Troop-developed materials | Your own IP | Already in Google Drive data |

## Acquisition Pipeline — Phase by Phase

### Phase A0: Repository Setup (30 min)

```bash
gh repo create bsa-corpus --private
```

Initialize directory structure, .gitignore (PDFs, purchased content, embeddings), README.

### Phase A1: Free Content Acquisition (1-2 days)

**Step 1: Download free PDFs**
- Guide to Advancement 2025 PDF
- Scouts BSA Requirements 2024/2025 PDFs
- Annual requirement change documents

**Step 2: Web scrape scouting.org**
Build `pipelines/extract/web-scraper.mjs`:
- G2A web version (scouting.org/resources/guide-to-advancement/) — cleanest source
- G2SS (scouting.org/health-and-safety/gss/) — activity-specific pages
- All 130+ merit badge requirement pages (scouting.org/merit-badges/)
- YPT content (scouting.org/training/youth-protection/)

Approach: Node.js fetch + cheerio (scouting.org is server-rendered). Rate limit 1 req/sec.

**Step 3: Extract text from PDFs**
Build `pipelines/extract/pdf-to-markdown.mjs` using pymupdf4llm or marker.

**Step 4: Parse structured requirements**
Build `pipelines/extract/requirements-parser.mjs`:
- Parse numbered requirement structure into YAML
- Handle sub-requirements (1a, 1b, etc.)
- Output feeds directly into knowledge graph

### Phase A2: Scoutbook Data Export (1 day)

Extend existing `scripts/scoutbook/fetch-all-data.mjs` to also capture:
- Full requirement text for all merit badges (not just ranks)
- Requirement version metadata (if Scoutbook exposes it)
- Reference data already in `data/fresh/ref_*.json`

Copy/link relevant data into `bsa-corpus/sources/scoutbook-export/`.

### Phase A3: Purchased Content (as needed)

For Scoutmaster Handbook and priority pamphlets:
1. Acquire digital copies
2. Extract with pymupdf4llm
3. Process locally
4. Commit extracted text to `extracted/` (repo is private)

### Phase A4: Version History Construction (1-2 days)

Build `pipelines/extract/version-diff.mjs`:
1. Collect requirement snapshots from multiple years
2. Diff requirement text between versions
3. Record: requirement_id, old_text, new_text, effective_date, change_description
4. Claude-assisted diffing for better change descriptions

Sources for historical requirements:
- Annual update PDFs from scouting.org
- Scoutbook historical data (if available)
- Internet Archive cached pages

## Existing Assets to Leverage

These already exist in the scout-quest repo and should be linked/copied:

| Asset | Location | Use |
|-------|----------|-----|
| Scoutbook API data (336 JSON files) | `scouting-org-research/data/fresh/` | Tier B requirements + advancement |
| Google Drive troop docs (46 files) | `scouting-org-research/data/drive/` | Tier D troop materials |
| BSA research docs (30 markdown files) | `docs/scouting-knowledge/` | Tier A policy content (via Perplexity) |
| Embedded knowledge (127 pgvector chunks) | PostgreSQL `scouting_knowledge` | Migrate to FalkorDB |
| Reference data in MongoDB | `scoutbook_reference` collection | Structured rank/MB requirements |
| BSA API reference | `docs/bsa-api-reference.md` | Write API documentation |

## Enrichment Pipelines (built after extraction)

These run after all Tier A+B content is extracted:

| Pipeline | Input | Output | Model | Est. Cost |
|----------|-------|--------|-------|-----------|
| Distill knowledge doc | All extracted text | `distilled/bsa-knowledge-v1.md` | Sonnet/Opus | $30-60 |
| Contextual Retrieval | All chunks | `contextual-chunks/` | Haiku Batch | $3-6 |
| Graph extraction | All extracted text | `graph-extractions/*.json` | Sonnet Batch | $25-50 |
| Generate embeddings | All chunks | `embeddings/` | Voyage-3.5 | $0.50 |
| Version diffing | Requirement snapshots | Version change records | Haiku | $2-5 |
| **Total** | | | | **$60-120** |

## Quality Validation

Build `eval/` test datasets:
- 100+ policy Q&A pairs with expected sources
- Complex advancement scenarios (multi-badge, version-aware)
- Edge cases (extensions, partial completion, transfers, appeals)

Run against both the cached knowledge (Layer 1) and retrieval (Layer 2) to measure accuracy.

## Open Questions

1. **Does Scoutbook expose historical requirement versions?** If only current, version history must be reconstructed from annual update PDFs.
2. **BSA Scouts Handbook mobile app** — does it have extractable text for pamphlet content? If so, $25/year subscription is far cheaper than buying individual pamphlets.
3. **scouting.org scraping** — any rate limiting or WAF issues? Test with small batch first.
