import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AnthropicSystemBlock } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let knowledgeBlock: AnthropicSystemBlock | null = null;
let compactKnowledgeBlock: AnthropicSystemBlock | null = null;

export function loadKnowledge(): void {
  const fullPath = join(__dirname, "../knowledge/interim-bsa-knowledge.md");
  const compactPath = join(__dirname, "../knowledge/compact-bsa-knowledge.md");

  const fullText = readFileSync(fullPath, "utf-8");
  knowledgeBlock = {
    type: "text",
    text: fullText,
    cache_control: { type: "ephemeral" },
  };
  console.log(`BSA knowledge (full) loaded: ${fullText.length} chars (~${Math.round(fullText.length / 4)} tokens)`);

  try {
    const compactText = readFileSync(compactPath, "utf-8");
    compactKnowledgeBlock = {
      type: "text",
      text: compactText,
      cache_control: { type: "ephemeral" },
    };
    console.log(`BSA knowledge (compact) loaded: ${compactText.length} chars (~${Math.round(compactText.length / 4)} tokens)`);
  } catch {
    console.log("Compact knowledge not found — will use full for all models");
  }
}

export function getKnowledgeBlock(compact = false): AnthropicSystemBlock {
  if (compact && compactKnowledgeBlock) return compactKnowledgeBlock;
  if (!knowledgeBlock) throw new Error("Knowledge not loaded — call loadKnowledge() first");
  return knowledgeBlock;
}
