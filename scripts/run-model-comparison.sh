#!/bin/bash
# Run the 54-question eval across multiple models.
# Each model gets its tuned persona and appropriate knowledge doc.
#
# Usage: ./scripts/run-model-comparison.sh [model] [category]
#   model: claude, gpt, gemini, deepseek, grok, all (default: all)
#   category: A, B, C, D, E, F, G, all (default: all)
#
# Requires env vars or fetches from GCS/VM:
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_KEY, DEEPSEEK_API_KEY, OPENROUTER_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REPORT_DIR="$PROJECT_ROOT/mcp-servers/scout-quest/test/reports/model-comparison"
TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M-%S")
RUN_DIR="$REPORT_DIR/$TIMESTAMP"
mkdir -p "$RUN_DIR"

MODEL="${1:-all}"
CATEGORY="${2:-all}"

# Fetch keys if not set
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=anthropic-api-key --project=hexapax-devbox 2>/dev/null || echo "")
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  OPENAI_API_KEY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="grep '^OPENAI_API_KEY=' /opt/scoutcoach/scout-quest/.env | cut -d= -f2" 2>/dev/null || echo "")
fi
if [ -z "${GEMINI_KEY:-}" ]; then
  GEMINI_KEY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="grep -E '^GOOGLE_KEY=|^GEMINI_KEY=' /opt/scoutcoach/scout-quest/.env | head -1 | cut -d= -f2" 2>/dev/null || echo "")
fi
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  DEEPSEEK_API_KEY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="grep '^DEEPSEEK_API_KEY=' /opt/scoutcoach/scout-quest/.env | cut -d= -f2" 2>/dev/null || echo "")
fi
if [ -z "${OPENROUTER_KEY:-}" ]; then
  OPENROUTER_KEY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="grep '^OPENROUTER_KEY=' /opt/scoutcoach/scout-quest/.env | cut -d= -f2" 2>/dev/null || echo "")
fi

echo "============================================"
echo "Multi-Model Comparison Eval"
echo "============================================"
echo "  Model: $MODEL"
echo "  Category: $CATEGORY"
echo "  Output: $RUN_DIR"
echo "  Keys: Anthropic=${ANTHROPIC_API_KEY:+yes} OpenAI=${OPENAI_API_KEY:+yes} Gemini=${GEMINI_KEY:+yes} DeepSeek=${DEEPSEEK_API_KEY:+yes} OpenRouter=${OPENROUTER_KEY:+yes}"
echo ""

ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
GEMINI_KEY="$GEMINI_KEY" \
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
OPENROUTER_KEY="$OPENROUTER_KEY" \
MODEL_FILTER="$MODEL" \
CATEGORY_FILTER="$CATEGORY" \
RUN_DIR="$RUN_DIR" \
node --experimental-vm-modules "$RUN_DIR/run.mjs" 2>&1 || \
python3 "$RUN_DIR/run.py" 2>&1

echo ""
echo "Results in $RUN_DIR/"
