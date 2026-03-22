#!/usr/bin/env python3
"""One-time migration: backfill perspective and config axis fields on existing eval_results.

Adds to all existing documents:
- perspective: "knowledge"
- item_type: "question"
- config_id, model_id, provider, layer, knowledge, etc. (derived from existing `model` field)

Safe to run multiple times — uses $set with upsert-safe logic.

Usage:
  python3 migrate-perspective.py [--dry-run] [--mongo-uri mongodb://localhost:27017]
"""

import argparse
import sys
from pymongo import MongoClient

# Mapping from old model key → config axis values
MODEL_TO_CONFIG = {
    "claude": {"config_id": "claude", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude"},
    "claude-thinking": {"config_id": "claude-thinking", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "thinking_budget": 4000},
    "sonnet-adaptive-low": {"config_id": "claude-adaptive-low", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "low"},
    "sonnet-adaptive-med": {"config_id": "claude-adaptive-med", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "medium"},
    "sonnet-adaptive-high": {"config_id": "claude-adaptive-high", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "high"},
    "opus": {"config_id": "opus", "model_id": "claude-opus-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude"},
    "opus-thinking": {"config_id": "opus", "model_id": "claude-opus-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "thinking_budget": 4000},
    "opus-adaptive-med": {"config_id": "opus-adaptive-med", "model_id": "claude-opus-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "medium"},
    "opus-adaptive-max": {"config_id": "opus", "model_id": "claude-opus-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "high"},
    "gpt41": {"config_id": "gpt41", "model_id": "gpt-4.1", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gpt41-mini": {"config_id": "gpt41-mini", "model_id": "gpt-4.1-mini", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gpt41-nano": {"config_id": "gpt41-nano", "model_id": "gpt-4.1-nano", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gpt54": {"config_id": "gpt54", "model_id": "gpt-5.4", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gpt54-mini": {"config_id": "gpt54-mini", "model_id": "gpt-5.4-mini", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gpt54-nano": {"config_id": "gpt54-nano", "model_id": "gpt-5.4-nano", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "gemini25flash": {"config_id": "gemini25flash", "model_id": "gemini-2.5-flash", "provider": "google", "knowledge": "full", "layer": "full", "persona_key": "gemini"},
    "gemini25flash-lite": {"config_id": "gemini25flash-lite", "model_id": "gemini-2.5-flash-lite", "provider": "google", "knowledge": "full", "layer": "full", "persona_key": "gemini"},
    "gemini3flash": {"config_id": "gemini3flash", "model_id": "gemini-3-flash-preview", "provider": "google", "knowledge": "full", "layer": "full", "persona_key": "gemini"},
    "gemini31flash-lite": {"config_id": "gemini31flash-lite", "model_id": "gemini-3.1-flash-lite-preview", "provider": "google", "knowledge": "full", "layer": "full", "persona_key": "gemini"},
    "deepseek": {"config_id": "deepseek", "model_id": "deepseek-chat", "provider": "deepseek", "knowledge": "compact", "layer": "full", "persona_key": "gpt"},
    "layer-persona": {"config_id": "layer-L0", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "none", "layer": "persona-only", "persona_key": "claude"},
    "layer-websearch": {"config_id": "layer-L1", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "none", "layer": "persona-only", "persona_key": "claude", "web_search": True},
    "layer-knowledge": {"config_id": "layer-L2", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "knowledge-only", "persona_key": "claude"},
    "layer-troop": {"config_id": "layer-L3", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "knowledge+troop", "persona_key": "claude"},
    "layer-full": {"config_id": "layer-L4", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude"},
    "layer-adaptive": {"config_id": "layer-L5", "model_id": "claude-sonnet-4-6", "provider": "anthropic", "knowledge": "full", "layer": "full", "persona_key": "claude", "adaptive_effort": "medium"},
    # Legacy model names from early runs
    "gemini": {"config_id": "gemini25flash", "model_id": "gemini-2.5-flash", "provider": "google", "knowledge": "full", "layer": "full", "persona_key": "gemini"},
    "gpt": {"config_id": "gpt41", "model_id": "gpt-4.1", "provider": "openai", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
    "grok": {"config_id": "grok", "model_id": "x-ai/grok-3-mini", "provider": "openrouter", "knowledge": "full", "layer": "full", "persona_key": "gpt"},
}


def main():
    parser = argparse.ArgumentParser(description="Migrate eval_results to unified schema")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be done without writing")
    parser.add_argument("--mongo-uri", default="mongodb://localhost:27017", help="MongoDB URI")
    args = parser.parse_args()

    client = MongoClient(args.mongo_uri, serverSelectionTimeoutMS=5000)
    db = client["scoutquest"]
    col = db["eval_results"]

    total = col.count_documents({})
    already_migrated = col.count_documents({"perspective": {"$exists": True}})
    needs_migration = col.count_documents({"perspective": {"$exists": False}})

    print(f"Total documents: {total}")
    print(f"Already migrated: {already_migrated}")
    print(f"Needs migration: {needs_migration}")

    if needs_migration == 0:
        print("Nothing to migrate.")
        return

    # Find all unique model values
    model_values = col.distinct("model", {"perspective": {"$exists": False}})
    print(f"\nUnique model values to migrate: {model_values}")

    updated = 0
    unmapped = 0

    for model_key in model_values:
        config = MODEL_TO_CONFIG.get(model_key)
        if config is None:
            count = col.count_documents({"model": model_key, "perspective": {"$exists": False}})
            print(f"  WARNING: No mapping for model='{model_key}' ({count} docs) — skipping")
            unmapped += count
            continue

        update_fields = {
            "perspective": "knowledge",
            "item_type": "question",
            "tools_enabled": config.get("web_search", False),
            "web_search": config.get("web_search", False),
            "chain_metadata": None,
        }
        update_fields.update(config)

        # Remove fields that aren't part of the schema
        for key in ["web_search"]:
            if key in update_fields and key not in ("web_search",):
                del update_fields[key]

        query = {"model": model_key, "perspective": {"$exists": False}}
        count = col.count_documents(query)

        if args.dry_run:
            print(f"  DRY RUN: Would update {count} docs with model='{model_key}' → config_id='{config['config_id']}'")
        else:
            result = col.update_many(query, {"$set": update_fields})
            print(f"  Updated {result.modified_count} docs: model='{model_key}' → config_id='{config['config_id']}'")
            updated += result.modified_count

    print(f"\nMigration {'would update' if args.dry_run else 'updated'}: {updated if not args.dry_run else needs_migration - unmapped} docs")
    if unmapped:
        print(f"Skipped (unmapped): {unmapped} docs")

    # Create new indexes
    if not args.dry_run:
        print("\nCreating indexes...")
        col.create_index([("perspective", 1), ("run_id", 1)])
        col.create_index("model_id")
        col.create_index("layer")
        col.create_index("knowledge")
        col.create_index("config_id")
        print("Done.")


if __name__ == "__main__":
    main()
