/**
 * Per-model pricing — loaded once at startup from `config/pricing.yaml`.
 *
 * The same YAML is consumed by `scripts/eval_panel.py` so eval cost figures
 * and production cost figures use the exact same rate card. When the pricing
 * file changes, restart the backend to pick up the new rates.
 *
 * The YAML schema is simple and stable, so we hand-parse it instead of pulling
 * in a `yaml` dependency. If we ever need real YAML support, swap in `yaml`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface ModelPricing {
  /** USD per 1M input tokens (uncached). */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** USD per 1M cached-read tokens (Anthropic, OpenAI, Gemini all bill these). */
  cacheReadPerMillion?: number;
  /** USD per 1M cache-creation tokens (Anthropic only). */
  cacheWritePerMillion?: number;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface PricingFileMeta {
  /** Path to the pricing.yaml relative to the repo root. */
  path: string;
  /** SHA-256 of the file contents — lets us audit which rate card a row used. */
  contentHash: string;
  /** Git short hash of the last commit that touched pricing.yaml. */
  commitHash: string | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// backend/dist/cost → ../../../config/pricing.yaml ; backend/src/cost → ../../../config/pricing.yaml
const PRICING_PATH = resolve(__dirname, "../../../config/pricing.yaml");

let pricing: Record<string, ModelPricing> = {};
let meta: PricingFileMeta = { path: "config/pricing.yaml", contentHash: "", commitHash: null };

/**
 * Load `pricing.yaml` into memory. Called once at startup; safe to call again
 * to pick up edits without restarting (e.g., from a future admin route).
 */
export function loadPricing(): void {
  let content: string;
  try {
    content = readFileSync(PRICING_PATH, "utf8");
  } catch (err) {
    console.error(`[cost] failed to read ${PRICING_PATH}: ${err instanceof Error ? err.message : err}`);
    pricing = {};
    return;
  }

  pricing = parsePricingYaml(content);
  meta = {
    path: "config/pricing.yaml",
    contentHash: createHash("sha256").update(content).digest("hex").slice(0, 16),
    commitHash: getGitCommitHash(PRICING_PATH),
  };

  console.log(
    `[cost] loaded pricing for ${Object.keys(pricing).length} models from ${PRICING_PATH} ` +
    `(hash=${meta.contentHash}, commit=${meta.commitHash ?? "unknown"})`,
  );
}

/** Look up pricing for a model. Returns null if the model isn't in the rate card. */
export function getModelPricing(modelId: string): ModelPricing | null {
  // Strip the persona prefix for backend-routed model strings ("scoutmaster:claude-opus-4-7")
  const bare = modelId.includes(":") ? modelId.substring(modelId.indexOf(":") + 1) : modelId;
  return pricing[bare] ?? pricing[modelId] ?? null;
}

/** Provenance metadata — written into every `message_usage` row for auditability. */
export function getPricingMeta(): PricingFileMeta {
  return meta;
}

/**
 * Compute the USD cost of a single request, given the model and the token counts.
 *
 * Cache_read tokens are billed at the cached rate; cache_creation is billed at
 * the cache-write rate when present, otherwise treated as ordinary input.
 * Tokens NOT served from cache and NOT cache-creation are billed at the input rate.
 *
 * Returns 0 (and logs a warning) if the model has no pricing entry — better to
 * record a free call than to crash the request hot path.
 */
export function computeCostUsd(modelId: string, usage: UsageTokens): number {
  const p = getModelPricing(modelId);
  if (!p) {
    console.warn(`[cost] no pricing entry for model "${modelId}" — recording cost as $0`);
    return 0;
  }
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);

  const inputCost = (uncachedInput / 1e6) * p.inputPerMillion;
  const cacheReadCost = (cacheRead / 1e6) * (p.cacheReadPerMillion ?? p.inputPerMillion);
  const cacheWriteCost = (cacheWrite / 1e6) * (p.cacheWritePerMillion ?? p.inputPerMillion);
  const outputCost = (usage.outputTokens / 1e6) * p.outputPerMillion;

  return round6(inputCost + cacheReadCost + cacheWriteCost + outputCost);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function getGitCommitHash(filePath: string): string | null {
  try {
    const out = execSync(`git log -1 --format=%h -- "${filePath}"`, {
      cwd: dirname(filePath),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Hand-parse `pricing.yaml`. The schema is intentionally narrow and stable:
 *
 *   models:
 *     <model-id>:
 *       input_per_million: <number>
 *       output_per_million: <number>
 *       cache_read_per_million: <number>   # optional
 *       cache_write_per_million: <number>  # optional
 *
 * Comments (`# ...`) and blank lines are skipped. Anything outside `models:`
 * is ignored. If the schema grows beyond this, swap in a real YAML parser.
 */
function parsePricingYaml(content: string): Record<string, ModelPricing> {
  const result: Record<string, ModelPricing> = {};
  const lines = content.split(/\r?\n/);

  let inModels = false;
  let currentModel: string | null = null;
  let currentEntry: Partial<ModelPricing> = {};

  const flush = (): void => {
    if (currentModel && currentEntry.inputPerMillion !== undefined && currentEntry.outputPerMillion !== undefined) {
      result[currentModel] = currentEntry as ModelPricing;
    }
    currentModel = null;
    currentEntry = {};
  };

  for (const raw of lines) {
    // Strip inline comments and trailing whitespace; keep leading indent.
    const line = raw.replace(/#.*$/, "").replace(/\s+$/, "");
    if (!line.trim()) continue;

    if (/^models:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    if (!inModels) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 2) {
      // New model entry: "claude-opus-4-7:"
      flush();
      const m = trimmed.match(/^([\w.\-/]+):\s*$/);
      if (m) currentModel = m[1];
    } else if (indent >= 4 && currentModel) {
      const m = trimmed.match(/^(\w+):\s*([\d.]+)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = parseFloat(m[2]);
      if (Number.isNaN(val)) continue;
      switch (key) {
        case "input_per_million":
          currentEntry.inputPerMillion = val;
          break;
        case "output_per_million":
          currentEntry.outputPerMillion = val;
          break;
        case "cache_read_per_million":
          currentEntry.cacheReadPerMillion = val;
          break;
        case "cache_write_per_million":
          currentEntry.cacheWritePerMillion = val;
          break;
      }
    }
  }
  flush();
  return result;
}
