# Vector Search Experiments

Compare embedding models and chunking strategies for BSA knowledge retrieval.

Runs locally on devbox with a separate FalkorDB instance — does not affect production.

## Current Production Config
- **Embedding model:** voyage-3 (1024 dim)
- **Chunking:** ~500 token target, heading-aware splits, 50 token overlap
- **Context enrichment:** Haiku contextual prefixes (already applied to chunks)
- **Vector DB:** FalkorDB on scout-coach-vm

## Experiments

### Embedding Models
1. **voyage-3** (current) — 1024 dim, $0.06/MTok
2. **gemini-embedding-001** — 1024 dim (truncated from 3072 via MRL), $0.15/MTok, #1 MTEB

### Chunking Strategies
1. **heading-aware-500** (current) — split on headings, ~500 token target, 50 token overlap
2. **naive-500** — fixed 500 token windows, no heading awareness, 50 token overlap
3. **line-break** — split on double newlines (paragraph boundaries), no size target
4. **no-chunk** — entire documents as single vectors (tests if Voyage's 32K context handles it)
5. **heading-aware-1000** — larger chunks (~1000 tokens) with heading awareness
6. **contextual-prefix** (current enriched) — current chunks with Haiku context prefix prepended

### Evaluation Method
For each combination, run a set of retrieval queries and measure:
- **Recall@5:** Does the correct chunk appear in the top 5 results?
- **Recall@10:** Top 10?
- **MRR (Mean Reciprocal Rank):** How high does the correct chunk rank?
- **Relevance score:** Average cosine similarity of correct matches

## Running Experiments

```bash
# Start local FalkorDB
docker run -d --name falkordb-exp -p 6380:6379 falkordb/falkordb:latest

# Generate chunks with different strategies
python3 experiments/chunk.py --strategy heading-aware-500
python3 experiments/chunk.py --strategy naive-500
python3 experiments/chunk.py --strategy line-break
python3 experiments/chunk.py --strategy no-chunk

# Embed with different models
python3 experiments/embed.py --model voyage-3 --chunks chunks-heading-500.jsonl
python3 experiments/embed.py --model gemini-embedding-001 --chunks chunks-heading-500.jsonl

# Load and test
node experiments/load-test.js --port 6380 --embeddings voyage-heading-500.jsonl
node experiments/eval-retrieval.js --port 6380
```
