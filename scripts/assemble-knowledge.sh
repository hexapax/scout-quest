#!/bin/bash
# Assemble the interim BSA knowledge document from scouting-knowledge/ markdown files.
# Output: backend/knowledge/interim-bsa-knowledge.md
#
# Usage: bash scripts/assemble-knowledge.sh
#
# Run this whenever scouting-knowledge/ content is updated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
KNOWLEDGE_DIR="${PROJECT_ROOT}/docs/scouting-knowledge"
OUTPUT="${PROJECT_ROOT}/backend/knowledge/interim-bsa-knowledge.md"

mkdir -p "$(dirname "$OUTPUT")"

{
  cat <<'HEADER'
# BSA Knowledge Reference — Scout Quest Interim Context
# This document is assembled from scouting-knowledge/ markdown files.
# It is injected into every Scout Coach conversation via Anthropic prompt caching.
# Last assembled: $(date -u +"%Y-%m-%d")

HEADER

  echo "---"
  echo ""
  echo "# RANK REQUIREMENTS"
  echo ""

  for f in \
    "$KNOWLEDGE_DIR/ranks/scout.md" \
    "$KNOWLEDGE_DIR/ranks/tenderfoot.md" \
    "$KNOWLEDGE_DIR/ranks/second-class.md" \
    "$KNOWLEDGE_DIR/ranks/first-class.md" \
    "$KNOWLEDGE_DIR/ranks/star.md" \
    "$KNOWLEDGE_DIR/ranks/life.md" \
    "$KNOWLEDGE_DIR/ranks/eagle.md"; do
    if [ -f "$f" ]; then
      echo "---"
      cat "$f"
      echo ""
    fi
  done

  echo "---"
  echo ""
  echo "# BSA POLICIES"
  echo ""

  for f in \
    "$KNOWLEDGE_DIR/policies/guide-to-advancement.md" \
    "$KNOWLEDGE_DIR/policies/youth-protection.md" \
    "$KNOWLEDGE_DIR/policies/eagle-required-merit-badges.md" \
    "$KNOWLEDGE_DIR/policies/eagle-project.md" \
    "$KNOWLEDGE_DIR/policies/board-of-review.md"; do
    if [ -f "$f" ]; then
      echo "---"
      cat "$f"
      echo ""
    fi
  done

  echo "---"
  echo ""
  echo "# BSA PROCEDURES"
  echo ""

  for f in \
    "$KNOWLEDGE_DIR/procedures/age-and-time-requirements.md" \
    "$KNOWLEDGE_DIR/procedures/blue-card-process.md" \
    "$KNOWLEDGE_DIR/procedures/leadership-positions.md" \
    "$KNOWLEDGE_DIR/procedures/safety-policies.md"; do
    if [ -f "$f" ]; then
      echo "---"
      cat "$f"
      echo ""
    fi
  done

  echo "---"
  echo ""
  echo "# EAGLE-REQUIRED MERIT BADGES"
  echo ""

  for f in \
    "$KNOWLEDGE_DIR/merit-badges/camping.md" \
    "$KNOWLEDGE_DIR/merit-badges/personal-fitness.md" \
    "$KNOWLEDGE_DIR/merit-badges/first-aid.md" \
    "$KNOWLEDGE_DIR/merit-badges/swimming.md" \
    "$KNOWLEDGE_DIR/merit-badges/family-life.md" \
    "$KNOWLEDGE_DIR/merit-badges/personal-management.md" \
    "$KNOWLEDGE_DIR/merit-badges/citizenship-in-the-world.md" \
    "$KNOWLEDGE_DIR/merit-badges/citizenship-in-the-community.md" \
    "$KNOWLEDGE_DIR/merit-badges/citizenship-in-the-nation.md" \
    "$KNOWLEDGE_DIR/merit-badges/citizenship-in-society.md" \
    "$KNOWLEDGE_DIR/merit-badges/communication.md" \
    "$KNOWLEDGE_DIR/merit-badges/cooking.md" \
    "$KNOWLEDGE_DIR/merit-badges/emergency-preparedness.md" \
    "$KNOWLEDGE_DIR/merit-badges/environmental-science.md"; do
    if [ -f "$f" ]; then
      echo "---"
      cat "$f"
      echo ""
    fi
  done

  echo "---"
  echo ""
  echo "# TROOP 489 CONTEXT"
  echo ""

  for f in \
    "$KNOWLEDGE_DIR/troop/overview.md" \
    "$KNOWLEDGE_DIR/troop/advancement-practices.md" \
    "$KNOWLEDGE_DIR/troop/campouts-and-events.md" \
    "$KNOWLEDGE_DIR/troop/eagle-process.md" \
    "$KNOWLEDGE_DIR/troop/finances.md" \
    "$KNOWLEDGE_DIR/troop/leadership.md" \
    "$KNOWLEDGE_DIR/troop/patrols.md" \
    "$KNOWLEDGE_DIR/troop/policies.md" \
    "$KNOWLEDGE_DIR/troop/meeting-history.md" \
    "$KNOWLEDGE_DIR/troop/newsletters.md"; do
    if [ -f "$f" ]; then
      echo "---"
      cat "$f"
      echo ""
    fi
  done

} > "$OUTPUT"

CHARS=$(wc -c < "$OUTPUT")
APPROX_TOKENS=$(( CHARS / 4 ))
echo "Knowledge document assembled: $OUTPUT"
echo "  Size: ${CHARS} chars (~${APPROX_TOKENS} tokens)"
