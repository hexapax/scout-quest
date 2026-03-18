import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
const GRAPH_NAME = "scout_quest";

export async function connectFalkorDB(): Promise<void> {
  const host = process.env.FALKORDB_HOST || "scout-quest-falkordb";
  const port = Number(process.env.FALKORDB_PORT || 6379);

  client = createClient({ socket: { host, port } });
  client.on("error", (err: unknown) => console.error("FalkorDB client error:", err));

  await client.connect();
  console.log(`FalkorDB connected (${host}:${port})`);
}

export function isFalkorConnected(): boolean {
  return client !== null && client.isOpen;
}

/** Run a read Cypher query. Parameters are safely interpolated via CYPHER prefix. */
export async function graphQuery<T = Record<string, unknown>>(
  cypher: string,
  params?: Record<string, string | number | boolean | null>
): Promise<T[]> {
  if (!client) throw new Error("FalkorDB not connected");
  const query = params && Object.keys(params).length > 0
    ? `CYPHER ${buildParamStr(params)} ${cypher}`
    : cypher;

  const raw = await client.sendCommand(["GRAPH.QUERY", GRAPH_NAME, query]) as unknown;
  return parseGraphResponse<T>(raw);
}

/** Run a write Cypher query (CREATE / MERGE / DELETE). */
export async function graphWrite(
  cypher: string,
  params?: Record<string, string | number | boolean | null>
): Promise<void> {
  if (!client) throw new Error("FalkorDB not connected");
  const query = params && Object.keys(params).length > 0
    ? `CYPHER ${buildParamStr(params)} ${cypher}`
    : cypher;

  await client.sendCommand(["GRAPH.QUERY", GRAPH_NAME, query]);
}

/** Delete the entire graph. Used during graph reload. */
export async function graphDelete(): Promise<void> {
  if (!client) throw new Error("FalkorDB not connected");
  try {
    await client.sendCommand(["GRAPH.DELETE", GRAPH_NAME]);
  } catch {
    // Ignore "graph not found" error on first run
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildParamStr(params: Record<string, string | number | boolean | null>): string {
  return Object.entries(params)
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k} = null`;
      if (typeof v === "string") return `${k} = '${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      return `${k} = ${v}`;
    })
    .join(", ");
}

function parseGraphResponse<T>(raw: unknown): T[] {
  // FalkorDB GRAPH.QUERY response: [headers[], rows[][], stats[]]
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const headers = raw[0] as string[];
  const rows = raw[1] as unknown[][];
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      headers.forEach((h, i) => {
        record[h] = parseScalar(row[i]);
      });
    }
    return record as T;
  });
}

function parseScalar(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  // Scalars (string, number, boolean) pass through
  if (typeof val !== "object") return val;
  // FalkorDB returns some numbers as strings in certain contexts
  if (Array.isArray(val) && val.length === 0) return null;
  return val;
}
