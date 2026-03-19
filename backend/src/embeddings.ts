/** Query embedding for vector search.
 * Uses Voyage AI to embed search queries at retrieval time.
 * The corpus was embedded with voyage-3 (1024 dimensions).
 */

let voyageApiKey: string | null = null;

function getVoyageKey(): string | null {
  if (voyageApiKey !== null) return voyageApiKey || null;
  voyageApiKey = process.env.VOYAGE_API_KEY ?? "";
  return voyageApiKey || null;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const key = getVoyageKey();
  if (!key) return null;

  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: [text],
        input_type: "query",
      }),
    });

    if (!res.ok) {
      console.error(`Voyage embed error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("Voyage embed error:", err);
    return null;
  }
}
