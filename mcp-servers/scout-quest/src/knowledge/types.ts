// Knowledge base types for pgvector queries and MCP tool responses

export interface KnowledgeChunk {
  id: number;
  content: string;
  category: string;
  source: string | null;
  section: string | null;
  tags: string[];
  rank: string | null;
  meritBadge: string | null;
  version: string | null;
  similarity: number;
}

export interface TroopCustomization {
  id: number;
  troopId: string;
  category: string;
  scope: string | null;
  content: string;
  priority: string;
  relationship: "supplement" | "override" | "aspirational";
  bsaReference: string | null;
  relatedPolicyId: number | null;
  source: string | null;
  createdBy: string | null;
}

export interface SearchResult {
  bsaResults: KnowledgeChunk[];
  troopOverrides: TroopCustomization[];
}
