// pgvector connection pool — singleton, lazy-initialized

import pg from "pg";

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!pool) {
    const uri =
      process.env.POSTGRES_URI ||
      "postgresql://myuser:mypassword@ai-chat-vectordb:5432/scouting_knowledge";
    pool = new pg.Pool({ connectionString: uri, max: 5 });
  }
  return pool;
}
