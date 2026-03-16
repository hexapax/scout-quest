// Troop policy management — add/query troop customizations in pgvector

import { getPgPool } from "./pgvector.js";
import { embedText } from "./embeddings.js";
import type { TroopCustomization } from "./types.js";

export async function addTroopPolicy(params: {
  content: string;
  category: string;
  scope?: string;
  relationship: "supplement" | "override" | "aspirational";
  bsaReference?: string;
  source?: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_KEY || process.env.GOOGLE_KEY;
  if (!apiKey) throw new Error("GEMINI_KEY or GOOGLE_KEY required for embedding");

  const embedding = await embedText(params.content, apiKey);
  const vec = `[${embedding.join(",")}]`;
  const pool = getPgPool();

  const { rows } = await pool.query(
    `INSERT INTO troop_customizations (content, embedding, category, scope, relationship, bsa_reference, source, created_by)
     VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      params.content, vec, params.category, params.scope || null,
      params.relationship, params.bsaReference || null, params.source || "admin", "admin",
    ],
  );

  return `Troop policy added (id: ${rows[0].id}). Category: ${params.category}, Relationship: ${params.relationship}`;
}

export async function getAllTroopPolicies(): Promise<string> {
  const pool = getPgPool();
  const { rows } = await pool.query<TroopCustomization>(
    `SELECT id, troop_id AS "troopId", category, scope, content, priority,
            relationship, bsa_reference AS "bsaReference", source
     FROM troop_customizations
     WHERE troop_id = '2024'
     ORDER BY category, created_at`,
  );

  if (rows.length === 0) return "No troop policies configured yet. Use manage_troop_policy to add policies.";

  const lines: string[] = ["# Troop 2024 Policies & Customizations\n"];
  let currentCategory = "";

  for (const r of rows) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      lines.push(`\n## ${currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1)}\n`);
    }
    const tag =
      r.relationship === "override" ? "⚠️ TROOP OVERRIDE"
        : r.relationship === "aspirational" ? "🎯 JTE TARGET"
          : "ℹ️ SUPPLEMENT";
    lines.push(`**${tag}** — ${r.content}`);
    if (r.bsaReference) lines.push(`  ↳ BSA ref: ${r.bsaReference}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function getJTEGaps(): Promise<string> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT o.id, o.category, o.content AS override_content, o.bsa_reference,
            a.content AS aspirational_content
     FROM troop_customizations o
     LEFT JOIN troop_customizations a ON a.id = o.related_policy_id AND a.relationship = 'aspirational'
     WHERE o.relationship = 'override' AND o.troop_id = '2024'
     ORDER BY o.category`,
  );

  if (rows.length === 0) return "No JTE gaps identified. All troop practices align with BSA policy (or no overrides have been documented).";

  const lines: string[] = ["# Journey to Excellence — Gap Analysis\n"];
  lines.push("These are areas where Troop 2024 practice differs from BSA policy.\n");

  for (const r of rows) {
    lines.push(`## ${r.category}\n`);
    lines.push(`**Current Practice:** ${r.override_content}`);
    if (r.bsa_reference) lines.push(`**BSA Policy:** ${r.bsa_reference}`);
    if (r.aspirational_content) lines.push(`**JTE Target:** ${r.aspirational_content}`);
    else lines.push(`**JTE Target:** Not yet defined`);
    lines.push("");
  }

  return lines.join("\n");
}
