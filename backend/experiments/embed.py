#!/usr/bin/env python3
"""Embed chunks with different models for comparison.

Usage:
  python3 embed.py --model voyage-3 --chunks output/chunks-heading-aware-500.jsonl
  python3 embed.py --model gemini-embedding-001 --chunks output/chunks-heading-aware-500.jsonl

Output: embeddings-{model}-{strategy}.jsonl in experiments/output/
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"


def embed_voyage(chunks, model="voyage-3"):
    import voyageai
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        print("ERROR: VOYAGE_API_KEY not set")
        sys.exit(1)
    vo = voyageai.Client(api_key=api_key)

    results = []
    batch_size = 128
    total_tokens = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i+batch_size]
        texts = [c["text"] for c in batch]

        # Voyage-3 max input is 32K tokens — truncate if needed
        texts = [t[:128000] for t in texts]

        try:
            resp = vo.embed(texts, model=model, input_type="document")
            total_tokens += resp.total_tokens
            for j, emb in enumerate(resp.embeddings):
                results.append({**batch[j], "embedding": emb, "dimensions": len(emb)})
            print(f"  {min(i+batch_size, len(chunks))}/{len(chunks)} ({total_tokens:,} tokens)")
        except Exception as e:
            print(f"  ERROR batch {i}: {e}")
            # Retry individually
            for c in batch:
                try:
                    resp = vo.embed([c["text"][:128000]], model=model, input_type="document")
                    total_tokens += resp.total_tokens
                    results.append({**c, "embedding": resp.embeddings[0], "dimensions": len(resp.embeddings[0])})
                except Exception as e2:
                    print(f"    Skip {c['id']}: {e2}")
            time.sleep(1)

    return results, total_tokens


def embed_gemini(chunks, model="gemini-embedding-001"):
    from google import genai
    api_key = os.environ.get("GEMINI_KEY") or os.environ.get("GOOGLE_KEY")
    if not api_key:
        print("ERROR: GEMINI_KEY not set")
        sys.exit(1)
    client = genai.Client(api_key=api_key)

    results = []
    batch_size = 100
    errors = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i+batch_size]
        # Gemini max input 2048 tokens (~8K chars)
        texts = [c["text"][:8000] for c in batch]

        try:
            resp = client.models.embed_content(
                model=model,
                contents=texts,
                config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 1024},
            )
            for j, emb in enumerate(resp.embeddings):
                results.append({**batch[j], "embedding": emb.values, "dimensions": len(emb.values)})
            print(f"  {min(i+batch_size, len(chunks))}/{len(chunks)}")
        except Exception as e:
            print(f"  ERROR batch {i}: {e}")
            errors += 1
            time.sleep(3)
            # Retry individually
            for c in batch:
                try:
                    resp = client.models.embed_content(
                        model=model, contents=[c["text"][:8000]],
                        config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 1024},
                    )
                    results.append({**c, "embedding": resp.embeddings[0].values, "dimensions": len(resp.embeddings[0].values)})
                except:
                    pass
            time.sleep(2)

    return results, 0  # Gemini doesn't report token count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, choices=["voyage-3", "gemini-embedding-001"])
    parser.add_argument("--chunks", required=True, help="Path to chunks JSONL file")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load chunks
    chunks = []
    with open(args.chunks) as f:
        for line in f:
            chunks.append(json.loads(line))
    print(f"Loaded {len(chunks)} chunks from {args.chunks}")

    # Embed
    strategy = Path(args.chunks).stem.replace("chunks-", "")
    print(f"Embedding with {args.model}...")
    start = time.time()

    if args.model.startswith("voyage"):
        results, tokens = embed_voyage(chunks, args.model)
    elif args.model.startswith("gemini"):
        results, tokens = embed_gemini(chunks, args.model)

    elapsed = time.time() - start

    # Save
    outname = f"embeddings-{args.model}-{strategy}.jsonl"
    outfile = OUTPUT_DIR / outname
    with open(outfile, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    print(f"\nDone: {len(results)} embeddings in {elapsed:.1f}s")
    print(f"Dimensions: {results[0]['dimensions'] if results else '?'}")
    if tokens:
        print(f"Tokens: {tokens:,}")
    print(f"Output: {outfile}")


if __name__ == "__main__":
    main()
