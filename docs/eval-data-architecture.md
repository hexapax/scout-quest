# Evaluation Data Architecture

## Problem

Test results are currently JSON files on disk tracked in git. This won't scale for:
- Embedding-based similarity analysis and response clustering
- Long-term pairwise ranking (Bradley-Terry needs all historical comparisons)
- Question quality meta-analysis (aggregate across many runs)
- Audio/TTS asset caching
- Data growing larger than practical for git

## Architecture

### Storage Layers

```
┌─────────────────────────────────────────────────────┐
│ Git (scout-quest repo)                              │
│  Code, test definitions, eval_notes, documentation  │
│  NOT results data — just the test suite itself       │
└─────────────────────────────────────────────────────┘
         │ reads test definitions
         ▼
┌─────────────────────────────────────────────────────┐
│ MongoDB (devbox, scoutquest database)               │
│  eval_results    — responses, scores, assessments   │
│  eval_usage      — per-call cost tracking (exists)  │
│  eval_rankings   — pairwise comparison results      │
│  eval_embeddings — cached response embeddings       │
│  eval_questions  — question quality metadata        │
└─────────────────────────────────────────────────────┘
         │ large assets
         ▼
┌─────────────────────────────────────────────────────┐
│ GCS (hexapax-devbox project)                        │
│  gs://eval-assets/audio/     — TTS audio cache      │
│  gs://eval-assets/archives/  — compressed old runs  │
│  gs://eval-assets/exports/   — periodic DB exports  │
└─────────────────────────────────────────────────────┘
```

### MongoDB Collections

#### eval_results
One document per model+question+run. The primary analysis collection.

```javascript
{
  _id: ObjectId,
  run_id: "2026-03-21_19-50-45",
  eval_version: "4",
  system_version: "5",
  model: "claude",
  label: "Claude Sonnet 4.6",
  price: "$3/$15",
  layer: null,                    // or "persona-only", "knowledge-only", etc.
  question_id: "C4",
  category: "C",
  question: "What are the requirements for Citizenship in Society?",
  expected: "Current version from official requirements",
  eval_notes: "CIS was removed from Eagle-required...",
  response: "...",                // full response text
  response_hash: "sha256:...",   // for dedup and embedding lookup
  scores: {
    accuracy: 5, specificity: 6, safety: 10, coaching: 8, troop_voice: 5,
    notes: "...",
    _assessments: { claims: "...", coaching: "...", troop: "..." }
  },
  tool_calls: [
    { tool: "web_search", query: "...", result: "...", round: 1 }
  ],
  evaluator: "panel",            // which evaluator was used
  timestamp: ISODate,

  // Added post-hoc:
  embedding: [0.123, ...],       // response embedding (cached)
  cluster_id: 3,                 // from similarity clustering
  bt_score: null,                // Bradley-Terry strength (from ranking)
}
```

Indexes: `{run_id: 1, model: 1}`, `{question_id: 1}`, `{response_hash: 1}`

#### eval_rankings
Pairwise comparison results for Bradley-Terry ranking.

```javascript
{
  _id: ObjectId,
  question_id: "C4",
  response_a_hash: "sha256:...",  // links to eval_results
  response_b_hash: "sha256:...",
  winner: "a",                    // "a", "b", or "tie"
  judge_model: "gpt-4.1-nano",
  judge_confidence: 0.85,
  position_order: "ab",           // for position bias detection
  timestamp: ISODate,
}
```

#### eval_questions
Meta-analysis of question quality — aggregated from eval_results.

```javascript
{
  _id: "C4",
  question: "What are the requirements for Citizenship in Society?",
  category: "C",
  eval_notes: "...",

  // Computed from historical results:
  response_count: 45,            // total responses across all runs
  score_variance: {              // high variance = unreliable question
    accuracy: 4.2,
    coaching: 1.1,
  },
  evaluator_disagreement: 0.73,  // avg spread across evaluators
  cluster_count: 3,              // distinct response patterns
  difficulty: "hard",            // derived from avg accuracy

  // Quality assessment (from reasoning model):
  quality_score: 7,
  quality_notes: "Good at testing policy knowledge but eval_notes need expansion...",
  suggested_improvements: ["Add specific requirement numbers to eval_notes", ...],

  last_analyzed: ISODate,
}
```

#### eval_embeddings
Cached embeddings for response deduplication and clustering.

```javascript
{
  _id: "sha256:...",             // response_hash
  text_preview: "first 200 chars...",
  embedding: [0.123, ...],       // 1024-dim Voyage or 768-dim Gemini
  model: "voyage-3",             // embedding model used
  created_at: ISODate,
}
```

### GCS Asset Caching

#### TTS Audio Cache
Key format: `gs://eval-assets/audio/{voice_id}/{sha256(text)}.mp3`

The eval viewer requests audio via `/api/tts`, which:
1. Computes hash of text + voice config
2. Checks GCS for cached audio
3. If not cached: generates via ElevenLabs/Google TTS, uploads to GCS, returns audio
4. If cached: returns GCS URL (or streams from GCS)

TTL: indefinite (text doesn't change for a given response)

#### Periodic Exports
Daily/weekly export of MongoDB eval data to GCS as compressed JSON:
`gs://eval-assets/exports/eval_results_2026-03-21.jsonl.gz`

This serves as backup and enables BigQuery analysis if needed.

### Migration Path

#### Phase 1: Dual-write (now)
- Eval runner writes to both JSON files AND MongoDB
- Viewer reads from MongoDB when available, falls back to JSON
- Git still tracks JSON files as a safety net

#### Phase 2: MongoDB primary (when stable)
- Remove JSON file writes from eval runner
- Viewer reads exclusively from MongoDB
- Remove results JSON from git tracking
- Add GCS export for backup

#### Phase 3: Full analytics (future)
- Embedding generation pipeline
- Bradley-Terry ranking system
- Question quality analyzer
- TTS audio caching in GCS

### Backup Strategy

| Data | Primary | Backup | Recovery |
|------|---------|--------|----------|
| Test definitions | Git | GitHub | git clone |
| Eval results | MongoDB | GCS daily export | mongoimport from JSONL |
| Cost tracking | MongoDB | GCS daily export | mongoimport |
| TTS audio | GCS | None (regenerable) | Re-generate from text |
| Embeddings | MongoDB | None (regenerable) | Re-embed from responses |
| Code/configs | Git | GitHub | git clone |

### Cost Estimates

| Component | Current | Proposed | Monthly Cost |
|-----------|---------|----------|-------------|
| MongoDB | Running (LibreChat) | Same instance, new collections | $0 |
| GCS | Secrets only | + audio cache + exports | ~$1-2 |
| CloudSQL | None | Not needed yet | $0 |
| Git | Results in repo | Code only | $0 |
