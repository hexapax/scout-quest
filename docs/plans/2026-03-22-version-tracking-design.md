# Version Tracking & Eval Runner Design

**Date:** 2026-03-22
**Status:** Design

## Problem

When comparing eval scores across runs, you can't tell what changed. A score improvement could be from:
- Better model config (intended)
- Updated knowledge doc (unnoticed)
- Refined eval_notes (evaluator got easier)
- Fixed assessor prompts (scoring methodology changed)

Current tracking: manual `eval_version: "5"` and `system_version: "5"` — arbitrary numbers that don't capture what actually changed.

## Design: Content-Hash Versioning

Every versionable component gets a content hash at run time. Hashes are stored in each eval_results document. If any hash differs between runs, you know exactly what changed.

### Version Fingerprint

Captured automatically at the start of every eval run:

```python
"versions": {
    # System under eval
    "knowledge_doc": "abc12345",        # sha256(file content)[:8]
    "troop_context": "def67890",
    "persona_text": "ghi12345",         # sha256(resolved persona for this config)

    # Eval system
    "eval_set": "scout-coach-v5@jkl456",  # name@hash
    "scorer_prompt": "mno78901",
    "assessor_config": "pqr23456",      # hash of sorted(role+model+prompt for each assessor)

    # Code
    "runner_commit": "abc1234",         # git rev-parse HEAD (if in git repo)
    "harness_hash": "stu56789",         # sha256(harness.ts)[:8] for chain spectre

    # Composite
    "system_fingerprint": "SYS-abc123", # hash of knowledge_doc + troop_context + persona
    "eval_fingerprint": "EVL-def456",   # hash of eval_set + scorer_prompt + assessor_config
}
```

### How it works

1. **At run start**: Runner computes all hashes, stores in meta.json and every eval_results doc
2. **At run end**: Runner compares fingerprints to the previous run of the same config
3. **If changed**: Logs what changed: "knowledge_doc changed (abc→xyz), eval_set unchanged"
4. **In viewer**: Show fingerprint badges. Highlight when comparing runs with different fingerprints.
5. **In Genie**: When comparing across runs, Genie checks fingerprint compatibility automatically

### Implementation

```python
# In eval_framework.py
def compute_version_fingerprint(config: RunConfig, eval_set: EvalSetConfig) -> dict:
    """Compute content hashes for all versionable components."""
    import hashlib

    def hash_content(content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()[:8]

    def hash_file(path: str) -> str:
        try:
            return hash_content(Path(path).read_text())
        except:
            return "missing"

    # System under eval
    knowledge_path = PROJECT_ROOT / "backend" / "knowledge" / "interim-bsa-knowledge.md"
    troop_path = PROJECT_ROOT / "backend" / "knowledge" / "troop-context.md"

    knowledge_hash = hash_file(knowledge_path)
    troop_hash = hash_file(troop_path)
    persona_hash = hash_content(build_system_prompt(config))

    # Eval system
    eval_set_hash = hash_content(yaml.dump(eval_set.raw))
    scorer_hash = hash_content(eval_set.scorer_prompt)
    assessor_hash = hash_content(
        json.dumps(sorted([
            {"role": a.role, "model": a.model, "prompt": a.prompt}
            for a in eval_set.assessors
        ], key=lambda x: x["role"]))
    )

    # Code
    try:
        runner_commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, text=True
        ).strip()
    except:
        runner_commit = "unknown"

    system_fp = hash_content(knowledge_hash + troop_hash + persona_hash)
    eval_fp = hash_content(eval_set_hash + scorer_hash + assessor_hash)

    return {
        "knowledge_doc": knowledge_hash,
        "troop_context": troop_hash,
        "persona_text": persona_hash,
        "eval_set": f"{eval_set.name}-v{eval_set.version}@{eval_set_hash}",
        "scorer_prompt": scorer_hash,
        "assessor_config": assessor_hash,
        "runner_commit": runner_commit,
        "system_fingerprint": f"SYS-{system_fp}",
        "eval_fingerprint": f"EVL-{eval_fp}",
    }
```

### Diff between runs

```python
def diff_versions(v1: dict, v2: dict) -> list[str]:
    """Report what changed between two version fingerprints."""
    changes = []
    for key in set(v1) | set(v2):
        val1 = v1.get(key)
        val2 = v2.get(key)
        if val1 != val2:
            changes.append(f"{key}: {val1} → {val2}")
    return changes
```

## Eval Runner Page

### Separate from viewer

- **Viewer** (`eval.hexapax.com` / port 9090): Browse results, compare, drill down, TTS, Genie
- **Runner** (`eval.hexapax.com/run`): Configure and launch eval runs

Same server, different routes. Runner is a new HTML page.

### Runner page features

1. **Config picker**: Select spectre, eval set, configs (checkboxes from configs.yaml), question filters
2. **Cost estimator**: Based on selected configs × questions × approximate token cost
3. **Version display**: Show current fingerprints, diff against last run of same config
4. **Launch**: POST to `/api/eval/launch` → starts run as background process
5. **Monitor**: Live progress polling (reuses existing `/api/eval/reports/:ts/status`)
6. **History**: List of saved run definitions with their version fingerprints

### Saved run definitions

```yaml
# eval-sets/runs/full-model-comparison.yaml
name: Full Model Comparison
spectre: knowledge
eval_set: scout-coach-v5.yaml
configs:
  - claude
  - gpt41
  - gemini3flash
  - deepseek
budget: 25.00
sample: null        # all questions
description: "Cross-model comparison on full question set"
schedule: null      # manual trigger only
```

### API endpoints

```
POST /api/eval/launch
  body: { spectre, eval_set, configs, budget, sample?, questions?, desc }
  → starts background process, returns { run_id, pid }

GET /api/eval/launch/:run_id/status
  → { status: running|complete|error, progress, cost }

POST /api/eval/launch/:run_id/stop
  → kills background process

GET /api/eval/runs
  → list saved run definitions

POST /api/eval/runs
  → save a run definition

GET /api/eval/versions/current
  → current version fingerprint

GET /api/eval/versions/diff?run_a=X&run_b=Y
  → diff two runs' version fingerprints
```
