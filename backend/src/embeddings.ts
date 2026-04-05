/** Embedding for vector search.
 * Uses Gemini text-embedding-004 (768 dimensions, free tier) by default.
 * Falls back to Voyage AI voyage-3 (1024 dimensions) if VOYAGE_API_KEY is set.
 */

function getGeminiKey(): string | null {
  return process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || null;
}

function getVoyageKey(): string | null {
  return process.env.VOYAGE_API_KEY || null;
}

/** Embed a single query for retrieval. */
export async function embedQuery(text: string): Promise<number[] | null> {
  // Try Voyage first (higher quality, paid)
  const voyageKey = getVoyageKey();
  if (voyageKey) {
    return embedWithVoyage(text, voyageKey, "query");
  }

  // Fall back to Gemini (free tier)
  const geminiKey = getGeminiKey();
  if (geminiKey) {
    return embedWithGemini(text, geminiKey, "RETRIEVAL_QUERY");
  }

  return null;
}

/** Embed a batch of documents for indexing. */
export async function embedDocuments(texts: string[]): Promise<number[][] | null> {
  const voyageKey = getVoyageKey();
  if (voyageKey) {
    return batchEmbedVoyage(texts, voyageKey);
  }

  const geminiKey = getGeminiKey();
  if (geminiKey) {
    return batchEmbedGemini(texts, geminiKey);
  }

  return null;
}

/** Returns the embedding dimension for the active provider. */
export function embeddingDimension(): number {
  if (getVoyageKey()) return 1024;  // voyage-3
  if (getGeminiKey()) return 768;   // text-embedding-004
  return 0;
}

// ---------------------------------------------------------------------------
// Gemini text-embedding-004
// ---------------------------------------------------------------------------

async function embedWithGemini(
  text: string,
  apiKey: string,
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT"
): Promise<number[] | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        taskType,
      }),
    });

    if (!res.ok) {
      console.error(`Gemini embed error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { embedding: { values: number[] } };
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error("Gemini embed error:", err);
    return null;
  }
}

async function batchEmbedGemini(texts: string[], apiKey: string): Promise<number[][]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`;
  const results: number[][] = [];

  // Gemini batch limit is 100 per request
  const BATCH_SIZE = 100;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: "models/text-embedding-004",
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_DOCUMENT",
          })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`Gemini batch embed error (${res.status}): ${errText}`);
        break;
      }

      const data = (await res.json()) as { embeddings: Array<{ values: number[] }> };
      for (const e of data.embeddings) {
        results.push(e.values);
      }
    } catch (err) {
      console.error("Gemini batch embed error:", err);
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Voyage AI voyage-3
// ---------------------------------------------------------------------------

async function embedWithVoyage(
  text: string,
  apiKey: string,
  inputType: "query" | "document"
): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: [text],
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      console.error(`Voyage embed error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("Voyage embed error:", err);
    return null;
  }
}

async function batchEmbedVoyage(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  const BATCH_SIZE = 64;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3",
          input: batch.map((t) => t.substring(0, 4000)),
          input_type: "document",
        }),
      });

      if (!res.ok) {
        console.error(`Voyage batch error: ${res.status}`);
        break;
      }

      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      for (const d of data.data) {
        results.push(d.embedding);
      }
    } catch (err) {
      console.error("Voyage batch error:", err);
      break;
    }
  }

  return results;
}
