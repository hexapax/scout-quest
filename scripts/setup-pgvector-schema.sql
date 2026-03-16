-- Scouting Knowledge Base pgvector schema
-- Run against: ai-chat-vectordb container, database: scouting_knowledge

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS scouting_knowledge (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  category TEXT NOT NULL,
  source TEXT,
  section TEXT,
  tags TEXT[],
  rank TEXT,
  merit_badge TEXT,
  version TEXT,
  effective_date DATE,
  superseded_by TEXT,
  metadata JSONB,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS troop_customizations (
  id SERIAL PRIMARY KEY,
  troop_id TEXT NOT NULL DEFAULT '2024',
  category TEXT NOT NULL,
  scope TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  priority TEXT DEFAULT 'info',
  relationship TEXT DEFAULT 'supplement',
  bsa_reference TEXT,
  related_policy_id INTEGER REFERENCES troop_customizations(id),
  source TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sk_embedding ON scouting_knowledge
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_sk_category ON scouting_knowledge (category);
CREATE INDEX IF NOT EXISTS idx_sk_version ON scouting_knowledge (version);
CREATE INDEX IF NOT EXISTS idx_sk_tags ON scouting_knowledge USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_sk_hash ON scouting_knowledge (content_hash);

CREATE INDEX IF NOT EXISTS idx_tc_embedding ON troop_customizations
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS idx_tc_troop_cat ON troop_customizations (troop_id, category);
