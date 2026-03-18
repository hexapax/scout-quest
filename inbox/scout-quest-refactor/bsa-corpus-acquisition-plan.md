# Scout-Quest Corpus Acquisition Plan

## Repository: `bsa-corpus`

This repo serves as the intermediate form of all BSA source material — raw sources, processed text, distilled knowledge artifacts, and the extraction pipeline that produces them. It is the single source of truth for everything that feeds into scout-quest's three knowledge layers.

**This repo should be PRIVATE.** Even for freely-distributed BSA content, redistributing processed derivatives at scale is a gray area. Keep it private, and if/when BSA national gets involved, they can grant explicit permission for broader distribution.

---

## Repo Structure

```
bsa-corpus/
├── README.md                          # This plan + status tracker
├── LICENSE                            # Private repo notice
│
├── sources/                           # Raw source material (gitignored binaries, tracked metadata)
│   ├── .gitignore                     # Ignore PDFs, images — track only metadata
│   ├── manifest.yaml                  # Master manifest of all sources with provenance
│   ├── official-free/                 # Freely distributed by BSA
│   │   ├── guide-to-advancement-2025.pdf
│   │   ├── guide-to-safe-scouting.pdf
│   │   ├── scouts-bsa-requirements-2024.pdf
│   │   ├── scouts-bsa-requirements-2025.pdf
│   │   └── ...
│   ├── official-purchased/            # Purchased handbooks/pamphlets (NOT committed)
│   │   ├── .gitkeep
│   │   └── README.md                  # Instructions for acquiring these locally
│   ├── scoutbook-export/              # Data exported/scraped from Scoutbook
│   │   └── ...
│   └── web-scraped/                   # Content from scouting.org web pages
│       └── ...
│
├── extracted/                         # Clean text extracted from sources
│   ├── guide-to-advancement/
│   │   ├── metadata.yaml              # Version, date, source URL, extraction method
│   │   ├── full-text.md               # Complete text in markdown
│   │   └── sections/                  # Split by section for processing
│   │       ├── section-01.md
│   │       ├── section-02.md
│   │       └── ...
│   ├── guide-to-safe-scouting/
│   │   └── ...
│   ├── rank-requirements/
│   │   ├── metadata.yaml
│   │   ├── scout.md
│   │   ├── tenderfoot.md
│   │   ├── second-class.md
│   │   ├── first-class.md
│   │   ├── star.md
│   │   ├── life.md
│   │   └── eagle.md
│   ├── merit-badges/
│   │   ├── _index.yaml                # All badges: name, eagle_required, skill_area, current_version
│   │   ├── camping/
│   │   │   ├── requirements.md        # Requirements text only
│   │   │   ├── pamphlet.md            # Full pamphlet content (if available)
│   │   │   └── versions/              # Historical requirement versions
│   │   │       ├── 2024-01.md
│   │   │       └── 2022-01.md
│   │   ├── cooking/
│   │   └── ... (130+ badges)
│   ├── scoutmaster-handbook/
│   ├── youth-protection/
│   └── program-resources/             # Meeting plans, games, activities
│
├── enriched/                          # AI-processed content
│   ├── contextual-chunks/             # Chunks with Contextual Retrieval prefixes
│   │   ├── guide-to-advancement/
│   │   └── ...
│   ├── graph-extractions/             # Structured entity/relationship JSON
│   │   ├── ranks.json
│   │   ├── merit-badges.json
│   │   ├── requirements.json
│   │   ├── cross-references.json
│   │   └── requirement-versions.json
│   ├── embeddings/                    # Generated embeddings (gitignored, regenerable)
│   │   └── .gitignore
│   └── distilled/                     # The Layer 1 cached context document
│       ├── bsa-knowledge-v1.md        # The distilled, AI-optimized knowledge doc
│       ├── distillation-log.md        # What was included/excluded and why
│       └── token-count.txt            # Current token count
│
├── pipelines/                         # Processing scripts
│   ├── README.md                      # Pipeline documentation
│   ├── extract/                       # Source → extracted text
│   │   ├── pdf-to-markdown.py         # PDF extraction using marker/pymupdf
│   │   ├── web-scraper.py             # scouting.org content scraper
│   │   ├── scoutbook-export.py        # Scoutbook data extraction
│   │   └── requirements-parser.py     # Parse structured requirements from PDFs
│   ├── enrich/                        # Extracted → enriched
│   │   ├── contextual-retrieval.py    # Add context prefixes (Haiku Batch)
│   │   ├── graph-extraction.py        # Extract entities/relationships (Sonnet Batch)
│   │   ├── distill-knowledge.py       # Build the Layer 1 cached context doc
│   │   ├── generate-embeddings.py     # Voyage API embedding generation
│   │   └── version-diff.py            # Compare requirement versions, flag changes
│   ├── load/                          # Enriched → FalkorDB
│   │   ├── load-graph.py              # Parse graph-extractions → Cypher MERGE
│   │   ├── load-vectors.py            # Load embeddings into FalkorDB vector indexes
│   │   └── load-fulltext.py           # Build full-text indexes
│   ├── validate/                      # Quality checks
│   │   ├── spot-check.py              # Random sample for human review
│   │   ├── graph-integrity.py         # Check referential integrity
│   │   └── retrieval-eval.py          # Test queries against expected answers
│   └── config/
│       ├── models.yaml                # API model/pricing config
│       ├── schema.yaml                # Graph schema definition
│       └── prompts/                   # Prompt templates for each pipeline stage
│           ├── distill-g2a.md
│           ├── distill-g2ss.md
│           ├── extract-entities.md
│           ├── contextual-prefix.md
│           └── ...
│
├── eval/                              # Evaluation dataset
│   ├── policy-questions.yaml          # 100+ policy Q&A pairs with expected sources
│   ├── advancement-scenarios.yaml     # Complex multi-step advancement scenarios
│   └── version-aware-tests.yaml       # Version-specific requirement queries
│
└── docs/
    ├── architecture.md                # → copy of memory-architecture doc
    ├── provenance.md                  # Legal provenance notes for each source
    └── update-procedure.md            # How to process BSA updates
```

---

## Source Provenance Categories

### Tier A: Freely Distributed by BSA (commit metadata, gitignore binaries)

These are published by BSA for free public use. No purchase required. Safe to process.

| Document | Source URL | Format | Est. Tokens | Status |
|----------|-----------|--------|-------------|--------|
| Guide to Advancement 2025 | filestore.scouting.org/filestore/pdf/33088.pdf | PDF | ~107K | To acquire |
| Guide to Advancement 2025 (web) | scouting.org/resources/guide-to-advancement/ | HTML | ~107K | To scrape |
| Guide to Safe Scouting | scouting.org/health-and-safety/gss/ | HTML | ~80K | To scrape |
| Scouts BSA Requirements 2024 | scouting.org (PDF) | PDF | ~50K | To acquire |
| Scouts BSA Requirements 2025 | scouting.org (PDF) | PDF | ~50K | To acquire |
| Advancement requirement changes (annual) | scouting.org/program-updates/ | HTML/PDF | ~15K/year | To scrape |
| Merit badge requirement lists | scouting.org/merit-badges/ | HTML | ~60K | To scrape |
| Youth Protection training content | scouting.org/training/youth-protection/ | HTML | ~20K | To scrape |
| Age-appropriate guidelines | scouting.org | HTML | ~10K | To scrape |
| Position-specific training outlines | scouting.org | HTML/PDF | ~30K | To scrape |

**Acquisition method:** Combination of direct PDF download and web scraping of scouting.org pages. The web versions of G2A and G2SS are actually cleaner than the PDFs for text extraction.

### Tier B: Scoutbook Data (API/scrape, user's own troop data)

Data you already have access to through your Scoutbook integration.

| Data | Method | Format | Notes |
|------|--------|--------|-------|
| Rank requirements (all ranks, full text) | Scoutbook API/scrape | JSON | Already in MongoDB |
| Merit badge requirements (all 130+) | Scoutbook API/scrape | JSON | Already partially available |
| Scout advancement records | Scoutbook sync | JSON | Troop 2024 specific |
| Historical requirement versions | Scoutbook + scouting.org | JSON/HTML | Critical for version tracking |

**Acquisition method:** Your existing Scoutbook sync tools. The requirement text from Scoutbook is particularly valuable because it's structured (numbered, with sub-requirements parsed) rather than prose.

### Tier C: Purchased Content (DO NOT commit content, commit metadata only)

These require purchase. Process locally, commit only derivatives (embeddings, graph extractions, distilled content — not raw text).

| Document | Approx. Cost | Est. Tokens | Priority |
|----------|-------------|-------------|----------|
| Scoutmaster Handbook | ~$15 (digital) or already own | ~213K | HIGH — essential for Layer 1 |
| Merit badge pamphlets (130+) | ~$5-6 each, ~$650 total | ~5.2M total | MEDIUM — needed for Layer 2, not Layer 1 |
| Scouts BSA Handbook | ~$15 | ~200K | MEDIUM |
| Fieldbook | ~$15 | ~150K | LOW |

**Key insight for pamphlets:** You do NOT need all 130+ pamphlets for the MVP. The requirements are free (Tier A/B). The pamphlet content (explanatory text) is only needed for Layer 2 deep reference. Prioritize the Eagle-required badges (currently 13) plus any badges your troop is actively working on. That's probably 20-30 pamphlets, ~$120-180.

**Alternative for pamphlets:** The BSA Scouts Handbook mobile app includes pamphlet content with a subscription (~$25/year). If the app has accessible text (vs. images), this is far cheaper than buying individual pamphlets.

**Acquisition method for purchased content:**
1. Buy physical or digital copies
2. If physical: scan with OCR (high quality scanner + Tesseract or ABBYY)
3. If digital PDF: extract with pymupdf4llm or marker (both produce clean markdown from PDFs)
4. Process locally, commit only to `sources/official-purchased/` with .gitignore on the raw content
5. Extracted text goes in `extracted/` — this is a gray area for copyright, keep the repo private

### Tier D: Community/Informal Content (various sources, needs curation)

| Content | Source | Notes |
|---------|--------|-------|
| Meeting plans and program ideas | Scouting Magazine, Bryan on Scouting, troop libraries | Curate over time, not needed for MVP |
| Games and activities | Various scouting resources | Same |
| Scoutmaster conference guides | Troop-developed materials | Your own IP, safe to commit |
| Board of review question banks | Various council resources | Widely shared, low copyright risk |

---

## Acquisition Pipeline — Phase by Phase

### Phase 0: Repository Setup (30 minutes)

```bash
# Create repo
gh repo create bsa-corpus --private
cd bsa-corpus

# Initialize structure
mkdir -p sources/{official-free,official-purchased,scoutbook-export,web-scraped}
mkdir -p extracted/{guide-to-advancement/sections,guide-to-safe-scouting,rank-requirements}
mkdir -p extracted/merit-badges
mkdir -p enriched/{contextual-chunks,graph-extractions,embeddings,distilled}
mkdir -p pipelines/{extract,enrich,load,validate,config/prompts}
mkdir -p eval docs

# Gitignore binaries and sensitive content
cat > sources/.gitignore << 'EOF'
*.pdf
*.epub
*.mobi
official-purchased/**
!official-purchased/.gitkeep
!official-purchased/README.md
EOF

cat > enriched/embeddings/.gitignore << 'EOF'
*
!.gitignore
EOF
```

### Phase 1: Free Content Acquisition (1-2 days with Claude Code)

**Step 1.1: Download free PDFs**

Direct downloads from scouting.org:
- Guide to Advancement 2025: `https://filestore.scouting.org/filestore/pdf/33088.pdf`
- Scouts BSA Requirements: available from scouting.org advancement resources page
- Annual requirement change documents: from scouting.org/program-updates/

**Step 1.2: Scrape scouting.org web content**

Build `pipelines/extract/web-scraper.py` to extract:

1. **Guide to Advancement (web version):** The HTML at scouting.org/resources/guide-to-advancement/ is the cleanest source — structured headings, numbered sections, already in logical hierarchy. Scrape section by section, preserve heading structure, output as markdown.

2. **Guide to Safe Scouting:** scouting.org/health-and-safety/gss/ — same approach. Activity-specific pages are individual URLs, making section-level extraction natural.

3. **Merit badge requirements (all 130+):** scouting.org/merit-badges/ lists all badges. Each badge page has the current requirements. Scrape all, output as structured markdown with YAML frontmatter (badge name, eagle_required, skill_area, effective_date).

4. **Youth Protection content:** scouting.org/training/youth-protection/ — policies and training materials.

5. **Annual requirement updates:** The change documents (like the 2024 updates PDF) are critical for building the version history. These document exactly what changed and when.

**Scraping approach:** Use `requests` + `BeautifulSoup` or `playwright` for any JavaScript-rendered pages. Scouting.org is mostly server-rendered HTML, so `requests` should suffice. Rate limit to 1 request/second — be respectful.

**Step 1.3: Extract text from PDFs**

Build `pipelines/extract/pdf-to-markdown.py`:

```bash
pip install pymupdf4llm  # or: pip install marker-pdf
```

`pymupdf4llm` is the recommended PDF-to-markdown extractor for LLM pipelines. It preserves headings, tables, lists, and page structure. For BSA PDFs (which are text-based, not scanned), it produces clean output.

For each PDF:
1. Extract to markdown
2. Split by section (detect heading patterns)
3. Add metadata.yaml with provenance
4. Commit extracted text to `extracted/`

**Step 1.4: Parse structured requirements**

Build `pipelines/extract/requirements-parser.py`:

Rank and merit badge requirements have a very consistent structure:
```
1. Requirement text
   a. Sub-requirement text
   b. Sub-requirement text
2. Next requirement
```

Parse this into structured YAML/JSON:
```yaml
badge: Camping
version: "2024-01"
effective_date: "2024-01-01"
requirements:
  - id: "1"
    text: "Do the following:"
    sub_requirements:
      - id: "1a"
        text: "Explain the BSA Safety Afloat policy..."
      - id: "1b"
        text: "..."
```

This structured form feeds directly into the knowledge graph. The parser can use Claude for ambiguous cases, but most requirements follow the pattern closely enough for regex + heuristics.

### Phase 2: Scoutbook Data Export (1 day)

You already have the Scoutbook sync infrastructure. Extend it to export:

1. **Full requirement text for all ranks** — your `scoutbook_get_rank_requirements` tool already does this
2. **Full requirement text for all merit badges** — extend similarly
3. **Requirement version metadata** — if Scoutbook tracks when requirements changed, export the version boundaries

Output to `sources/scoutbook-export/` as JSON, then normalize into `extracted/` markdown format.

**Key question for you:** Does Scoutbook expose historical requirement versions, or only current? If only current, you'll need the annual update PDFs from scouting.org to reconstruct the version history.

### Phase 3: Purchased Content (ongoing, as needed)

For the Scoutmaster Handbook and priority merit badge pamphlets:

1. Acquire physical or digital copies
2. Extract text using pymupdf4llm (for digital PDFs) or scan+OCR (for physical books)
3. Process locally on your devbox
4. Commit extracted text to `extracted/` (repo is private)
5. Note provenance in `manifest.yaml`

**MVP priority pamphlets (Eagle-required + troop active):**
Camping, Citizenship in the Community, Citizenship in the Nation, Citizenship in the World, Citizenship in Society, Communication, Cooking, Emergency Preparedness OR Lifesaving, Environmental Science OR Sustainability, Family Life, First Aid, Personal Fitness, Personal Management, Swimming OR Hiking OR Cycling

Plus whatever your troop's scouts are actively working on.

### Phase 4: Version History Construction (1-2 days)

This is the foundation for version-aware requirement tracking.

**Build `pipelines/extract/version-diff.py`:**

1. Collect requirement snapshots from multiple years (2022, 2023, 2024, 2025)
2. For each merit badge and rank, diff the requirement text between versions
3. Record: requirement_id, old_text, new_text, effective_date, change_description
4. Output to `extracted/merit-badges/{badge}/versions/`

**Sources for historical requirements:**
- Annual update documents from scouting.org (these explicitly list changes)
- Archived PDFs of previous years' requirements (check if scouting.org keeps these)
- Scoutbook may have historical data
- The Internet Archive (archive.org) may have cached previous versions of scouting.org pages

**Claude-assisted diffing:** For each pair of requirement versions, send both to Claude Haiku and ask: "What specifically changed between these versions? List each change with the requirement ID." This is cheap and produces much better change descriptions than raw text diffs.

---

## Manifest Format

`sources/manifest.yaml` tracks provenance for every source document:

```yaml
sources:
  - id: g2a-2025
    title: "Guide to Advancement 2025"
    source_url: "https://filestore.scouting.org/filestore/pdf/33088.pdf"
    provenance: official-free
    format: pdf
    acquired_date: "2026-03-17"
    extraction_method: pymupdf4llm
    extracted_path: extracted/guide-to-advancement/
    version: "2025"
    authority_level: official_policy
    notes: "Freely distributed by BSA. Web version also scraped."

  - id: camping-pamphlet-2024
    title: "Camping Merit Badge Pamphlet"
    provenance: official-purchased
    format: pdf
    acquired_date: "2026-03-20"
    extraction_method: pymupdf4llm
    extracted_path: extracted/merit-badges/camping/pamphlet.md
    version: "2024"
    authority_level: official_guidance
    purchase_reference: "Amazon order #XYZ"
    notes: "Purchased copy. Raw PDF not committed."

  - id: camping-requirements-2025
    title: "Camping Merit Badge Requirements"
    source_url: "https://www.scouting.org/merit-badges/camping/"
    provenance: official-free
    format: html
    acquired_date: "2026-03-17"
    extraction_method: web-scraper
    extracted_path: extracted/merit-badges/camping/requirements.md
    version: "2025-01"
    effective_date: "2025-01-01"
    authority_level: official_requirements
```

---

## Claude Code Handoff Notes

When moving this to Claude Code, the work sequence is:

1. **Create the repo and directory structure** (Phase 0)
2. **Build the web scraper** for scouting.org — start with merit badge requirements pages since they're the most structured and give you immediate value for the knowledge graph
3. **Build the PDF extractor** and process the G2A and requirements PDFs
4. **Build the requirements parser** to produce structured YAML from the extracted text
5. **Run the Scoutbook export** using existing sync tools
6. **Build the version diff pipeline** using the annual update documents

Each step produces committed artifacts that the enrichment pipelines (Phase 2 of the architecture doc) will consume.

The enrichment pipelines (contextual retrieval, graph extraction, distillation) are a separate body of work that builds on the extracted corpus. Those should be built after the extraction is complete and validated.

---

## What This Plan Deliberately Does NOT Cover

- **Enrichment pipelines** (contextual retrieval, graph extraction, knowledge distillation) — these are the next phase after corpus acquisition is complete
- **FalkorDB setup and schema implementation** — depends on the graph extraction output format
- **Tool refactoring** — depends on the graph schema being finalized
- **Evaluation framework** — needs both the corpus and the enrichment to be in place first

These are all downstream of having clean, structured, version-tracked source material in the repo.
