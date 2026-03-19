#!/usr/bin/env python3
"""Generate chunks using different strategies for comparison.

Usage:
  python3 chunk.py --strategy heading-aware-500
  python3 chunk.py --strategy naive-500
  python3 chunk.py --strategy line-break
  python3 chunk.py --strategy no-chunk
  python3 chunk.py --strategy heading-aware-1000
  python3 chunk.py --strategy contextual-prefix

Output: chunks-{strategy}.jsonl in the experiments/output/ directory
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

CORPUS_DIR = Path("/opt/repos/scout-corpus/extracted")
OUTPUT_DIR = Path(__file__).parent / "output"
CONTEXTUAL_CHUNKS = Path("/opt/repos/scout-corpus/enriched/contextual-chunks/chunks-contextual.jsonl")

# Same sources as the production pipeline
SOURCE_GLOBS = [
    ("merit-badges/*/requirements.md", "merit_badge_requirements", "high"),
    ("rank-requirements/structured/rank-*.md", "rank_requirements", "high"),
    ("guide-to-advancement/sections/gta-section-*.md", "advancement_policy", "high"),
    ("guide-to-safe-scouting/*.md", "safety_policy", "high"),
    ("youth-protection/*.md", "youth_protection", "high"),
    ("requirement-updates/*.md", "requirement_updates", "medium"),
    ("training/*.md", "training", "medium"),
    ("troop-leader-guidebook/*/full-text.md", "leader_guidebook", "medium"),
    ("program-features/*/full-text.md", "program_features", "medium"),
]


def load_sources():
    """Load all source documents."""
    docs = []
    for glob_pattern, doc_type, priority in SOURCE_GLOBS:
        for path in sorted(CORPUS_DIR.glob(glob_pattern)):
            text = path.read_text(errors="replace")
            if len(text.strip()) < 50:
                continue
            title = path.stem.replace("-", " ").replace("_", " ").title()
            docs.append({
                "path": str(path.relative_to(CORPUS_DIR)),
                "title": title,
                "type": doc_type,
                "priority": priority,
                "text": text,
            })
    return docs


def make_id(text, source):
    return hashlib.md5(f"{source}:{text[:200]}".encode()).hexdigest()[:12]


def chunk_heading_aware(docs, target_tokens=500, max_tokens=800, overlap_tokens=50):
    """Current production strategy: split on headings with overlap."""
    chunks = []
    for doc in docs:
        sections = re.split(r'((?:^|\n)#{1,4}\s+.+)', doc["text"])
        current = ""
        heading = ""

        for part in sections:
            if re.match(r'(?:^|\n)#{1,4}\s+', part.strip()):
                heading = part.strip()
                if len(current) // 4 >= target_tokens:
                    chunks.append(_make_chunk(current.strip(), heading, doc))
                    words = current.split()
                    overlap = " ".join(words[-overlap_tokens:]) if len(words) > overlap_tokens else ""
                    current = overlap + "\n" + heading + "\n"
                else:
                    current += "\n" + heading + "\n"
            else:
                current += part
                while len(current) // 4 > max_tokens:
                    split_target = target_tokens * 4
                    split_pos = current.rfind("\n\n", 0, split_target + 200)
                    if split_pos < split_target // 2:
                        split_pos = current.rfind("\n", 0, split_target + 200)
                    if split_pos < split_target // 2:
                        split_pos = split_target
                    chunk_part = current[:split_pos].strip()
                    if chunk_part:
                        chunks.append(_make_chunk(chunk_part, heading, doc))
                    words = chunk_part.split()
                    overlap = " ".join(words[-overlap_tokens:]) if len(words) > overlap_tokens else ""
                    current = overlap + "\n" + current[split_pos:]

        if current.strip():
            chunks.append(_make_chunk(current.strip(), heading, doc))
    return chunks


def chunk_naive(docs, target_tokens=500, overlap_tokens=50):
    """Fixed-size windows with no heading awareness."""
    chunks = []
    for doc in docs:
        words = doc["text"].split()
        step = target_tokens - overlap_tokens
        for i in range(0, len(words), step):
            window = " ".join(words[i:i + target_tokens])
            if len(window.strip()) > 50:
                chunks.append(_make_chunk(window.strip(), "", doc))
    return chunks


def chunk_line_break(docs):
    """Split on double newlines (paragraph boundaries)."""
    chunks = []
    for doc in docs:
        paragraphs = re.split(r"\n\n+", doc["text"])
        current = ""
        for para in paragraphs:
            if len((current + "\n\n" + para)) // 4 > 800 and current.strip():
                chunks.append(_make_chunk(current.strip(), "", doc))
                current = para
            else:
                current += "\n\n" + para if current else para
        if current.strip():
            chunks.append(_make_chunk(current.strip(), "", doc))
    return chunks


def chunk_no_chunk(docs):
    """Entire documents as single vectors."""
    chunks = []
    for doc in docs:
        text = doc["text"]
        # Truncate to 32K tokens (~128K chars) for Voyage, 8K chars for Gemini
        if len(text) > 128000:
            text = text[:128000]
        chunks.append(_make_chunk(text, doc["title"], doc))
    return chunks


def load_contextual_prefix():
    """Load the existing contextual-prefix chunks from the corpus pipeline."""
    chunks = []
    with open(CONTEXTUAL_CHUNKS) as f:
        for line in f:
            c = json.loads(line)
            # The contextual version has context prepended
            text = c.get("context", "") + "\n\n" + c["text"] if c.get("context") else c["text"]
            chunks.append({
                "id": c["id"],
                "source": c["source"],
                "title": c.get("title", ""),
                "type": c.get("type", ""),
                "text": text,
                "token_estimate": len(text) // 4,
            })
    return chunks


def _make_chunk(text, heading, doc):
    return {
        "id": make_id(text, doc["path"]),
        "source": doc["path"],
        "title": doc["title"],
        "type": doc["type"],
        "heading": heading,
        "text": text,
        "token_estimate": len(text) // 4,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strategy", required=True,
                        choices=["heading-aware-500", "naive-500", "line-break",
                                 "no-chunk", "heading-aware-1000", "contextual-prefix"])
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.strategy == "contextual-prefix":
        chunks = load_contextual_prefix()
    else:
        docs = load_sources()
        print(f"Loaded {len(docs)} source documents")

        if args.strategy == "heading-aware-500":
            chunks = chunk_heading_aware(docs, target_tokens=500)
        elif args.strategy == "naive-500":
            chunks = chunk_naive(docs, target_tokens=500)
        elif args.strategy == "line-break":
            chunks = chunk_line_break(docs)
        elif args.strategy == "no-chunk":
            chunks = chunk_no_chunk(docs)
        elif args.strategy == "heading-aware-1000":
            chunks = chunk_heading_aware(docs, target_tokens=1000, max_tokens=1500)

    outfile = OUTPUT_DIR / f"chunks-{args.strategy}.jsonl"
    with open(outfile, "w") as f:
        for c in chunks:
            f.write(json.dumps(c) + "\n")

    tokens = sum(c["token_estimate"] for c in chunks)
    print(f"Strategy: {args.strategy}")
    print(f"Chunks: {len(chunks)}")
    print(f"Total tokens: {tokens:,}")
    print(f"Avg tokens/chunk: {tokens // len(chunks) if chunks else 0}")
    print(f"Output: {outfile}")


if __name__ == "__main__":
    main()
