/** Load pre-generated embeddings into FalkorDB as vector-indexed nodes.
 * Usage: node dist/load-vectors.js <embeddings.jsonl>
 *
 * Creates ChunkVector nodes with text, metadata, and embedding vector.
 * Creates a vector index for similarity search.
 */

import { readFileSync } from "fs";
import { connectFalkorDB, graphWrite, graphQuery } from "./falkordb.js";
import { connectDb } from "./db.js";

const VECTOR_DIM = 1024;

interface EmbeddingRecord {
  id: string;
  source: string;
  title: string;
  type: string;
  embedding: number[];
  dimensions: number;
}

async function loadChunkText(id: string): Promise<string> {
  // Load the original chunk text from the JSONL
  return chunkTextMap.get(id) ?? "";
}

// Pre-load chunk texts
const chunkTextMap = new Map<string, string>();

async function main(): Promise<void> {
  const embeddingsFile = process.argv[2];
  if (!embeddingsFile) {
    console.error("Usage: node dist/load-vectors.js <embeddings.jsonl>");
    process.exit(1);
  }

  // Load chunk texts from the chunks file (same directory)
  const chunksFile = embeddingsFile.replace(/[^/]+$/, "../contextual-chunks/chunks.jsonl");
  try {
    const chunksData = readFileSync(chunksFile, "utf-8");
    for (const line of chunksData.split("\n").filter(Boolean)) {
      const chunk = JSON.parse(line);
      chunkTextMap.set(chunk.id, chunk.text);
    }
    console.log(`Loaded ${chunkTextMap.size} chunk texts`);
  } catch {
    console.warn("Could not load chunk texts — nodes will have empty text");
  }

  // Load embeddings
  const data = readFileSync(embeddingsFile, "utf-8");
  const records: EmbeddingRecord[] = data
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  console.log(`Loaded ${records.length} embeddings (${records[0]?.dimensions ?? "?"} dimensions)`);

  await connectDb();
  await connectFalkorDB();

  // Clear existing vector nodes
  console.log("Clearing existing ChunkVector nodes...");
  try {
    await graphWrite("MATCH (c:ChunkVector) DELETE c");
  } catch {
    // May not exist yet
  }

  // Create nodes in batches
  const BATCH_SIZE = 50;
  let created = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const rec of batch) {
      const text = chunkTextMap.get(rec.id) ?? "";
      // Escape text for Cypher string
      const escapedText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
      const escapedTitle = (rec.title ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const escapedSource = (rec.source ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const escapedType = (rec.type ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

      // FalkorDB vector format: vecf32 expects a list of floats
      const vectorStr = `vecf32([${rec.embedding.join(",")}])`;

      await graphWrite(
        `CREATE (:ChunkVector {
          chunkId: '${rec.id}',
          source: '${escapedSource}',
          title: '${escapedTitle}',
          type: '${escapedType}',
          text: '${escapedText}',
          embedding: ${vectorStr}
        })`
      );
      created++;
    }

    console.log(`  ${created}/${records.length} nodes created`);
  }

  // Create vector index
  console.log("Creating vector index...");
  try {
    await graphWrite(
      `CREATE VECTOR INDEX FOR (c:ChunkVector) ON (c.embedding) OPTIONS {dimension: ${VECTOR_DIM}, similarityFunction: 'cosine'}`
    );
    console.log("  Vector index created");
  } catch (err) {
    console.log("  Vector index may already exist:", String(err).substring(0, 100));
  }

  console.log(`\n=== Done: ${created} ChunkVector nodes loaded with vector index ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
