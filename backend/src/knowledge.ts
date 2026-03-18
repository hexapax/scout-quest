import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AnthropicSystemBlock } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let knowledgeBlock: AnthropicSystemBlock | null = null;

export function loadKnowledge(): void {
  const knowledgePath = join(__dirname, "../knowledge/interim-bsa-knowledge.md");
  const text = readFileSync(knowledgePath, "utf-8");
  knowledgeBlock = {
    type: "text",
    text,
    cache_control: { type: "ephemeral" },
  };
  const approxTokens = Math.round(text.length / 4);
  console.log(`BSA knowledge loaded: ${text.length} chars (~${approxTokens} tokens)`);
}

export function getKnowledgeBlock(): AnthropicSystemBlock {
  if (!knowledgeBlock) throw new Error("Knowledge not loaded — call loadKnowledge() first");
  return knowledgeBlock;
}
