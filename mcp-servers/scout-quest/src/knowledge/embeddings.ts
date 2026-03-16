// Gemini Embedding 2 API client for generating query embeddings

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "models/gemini-embedding-2-preview";
const DIMENSIONS = 1536;

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  const resp = await fetch(`${GEMINI_API_BASE}/${MODEL}:embedContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      content: { parts: [{ text }] },
      outputDimensionality: DIMENSIONS,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Gemini Embedding API error: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}
