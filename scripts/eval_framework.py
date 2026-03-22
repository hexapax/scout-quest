"""Core evaluation framework — perspective protocol, registry, shared types.

This module defines the extensible interface for evaluation perspectives.
Adding a new perspective (safety, regression, persona, etc.) means:
1. Implement EvalPerspective protocol in scripts/perspectives/<name>.py
2. Create an eval set YAML in eval-sets/<name>-v1.yaml
3. Register via PerspectiveRegistry.register()

The eval runner, panel evaluator, MongoDB storage, viewer, cost tracking,
and ranking system all work automatically with any registered perspective.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Scoring & evaluation configuration types
# ---------------------------------------------------------------------------

@dataclass
class ScoringDimension:
    """A single scoring axis (e.g., accuracy, tool_use)."""
    name: str
    weight: float
    description: str = ""


@dataclass
class AssessorConfig:
    """Configuration for a panel assessor (cheap observation model)."""
    role: str           # e.g., "claims", "coaching", "tool_use"
    model: str          # e.g., "gpt-4.1-nano"
    provider: str       # e.g., "openai", "deepseek", "openrouter"
    prompt: str         # Observation instructions (no scoring)


@dataclass
class EvalSetConfig:
    """Perspective-specific evaluation configuration loaded from YAML.

    Contains everything the panel evaluator needs: dimensions, assessors,
    scorer prompt, plus perspective-specific items (questions, chains, etc.).
    """
    name: str
    version: int
    perspective: str
    description: str
    dimensions: list[ScoringDimension]
    assessors: list[AssessorConfig]
    scorer_model: str
    scorer_prompt: str
    items: list[dict]                       # Perspective-specific raw items
    parent_version: int | None = None
    raw: dict = field(default_factory=dict)  # Full parsed YAML for perspective-specific access


# ---------------------------------------------------------------------------
# Run configuration — multi-axis experiment design
# ---------------------------------------------------------------------------

@dataclass
class RunConfig:
    """A specific configuration to evaluate.

    Multiple RunConfigs can use the same model with different knowledge,
    layers, or parameters. Each axis is stored as a separate indexed field
    in MongoDB so the viewer can group/filter by any axis.
    """
    # Identity
    config_id: str          # Unique key: "claude-L3-adaptive-med"
    label: str              # Display: "Claude Sonnet 4.6 (L3, Adaptive Med)"

    # Axis 1: Model
    model_id: str           # "claude-sonnet-4-6", "gpt-4.1", etc.
    provider: str           # "anthropic", "openai", "google", "deepseek", "openrouter"

    # Axis 2: Knowledge
    knowledge: str = "full"         # "full" (177K), "compact" (115K), "none"
    knowledge_doc: str = ""         # Path or identifier for the knowledge document

    # Axis 3: Layer (ablation)
    layer: str = "full"             # "full", "persona-only", "knowledge-only", "knowledge+troop", "no-tools"

    # Axis 4: Model parameters
    persona_key: str = "claude"     # "claude", "gpt", "gemini", "grok"
    max_tokens: int = 4096
    thinking: dict | None = None            # {"enabled": True, "budget": 4000}
    adaptive_effort: str | None = None      # "low", "medium", "high"
    temperature: float | None = None

    # Axis 5: Tools / capabilities
    tools_enabled: bool = True
    web_search: bool = False

    # Cost display
    price: str = ""                 # "$3/$15" for display

    def to_mongo_fields(self) -> dict:
        """Return config axes as flat dict for MongoDB document storage."""
        return {
            "config_id": self.config_id,
            "model_id": self.model_id,
            "provider": self.provider,
            "label": self.label,
            "knowledge": self.knowledge,
            "knowledge_doc": self.knowledge_doc,
            "layer": self.layer,
            "persona_key": self.persona_key,
            "adaptive_effort": self.adaptive_effort,
            "thinking_budget": self.thinking.get("budget") if self.thinking else None,
            "tools_enabled": self.tools_enabled,
            "web_search": self.web_search,
            "price": self.price,
        }


# ---------------------------------------------------------------------------
# Eval items and results
# ---------------------------------------------------------------------------

@dataclass
class EvalItem:
    """A single evaluable unit — question, scenario, or chain step."""
    id: str
    perspective: str
    item_type: str          # "question", "scenario", "chain_step"
    category: str
    description: str        # Human-readable (question text, step description)
    expected: str           # Expected behavior (answer, evaluatorContext)
    eval_notes: str = ""    # Ground truth hints for the evaluator
    question_type: str = "" # "policy", "coaching_values", "safety", "tool_use", etc.
    metadata: dict = field(default_factory=dict)  # Perspective-specific extras


@dataclass
class ExecutionResult:
    """Raw output from executing an eval item (before scoring)."""
    item: EvalItem
    config: RunConfig
    response_text: str          # Model's response (or formatted transcript)
    raw_data: dict = field(default_factory=dict)  # Perspective-specific
    timing_ms: int = 0
    error: str | None = None    # If execution failed


@dataclass
class ScoredResult:
    """Final scored result ready for MongoDB storage."""
    execution: ExecutionResult
    scores: dict[str, float]            # dimension_name → score (0-10)
    scores_notes: str = ""
    assessments: dict[str, str] = field(default_factory=dict)  # assessor_role → text
    overall_score: float = 0.0

    def __post_init__(self):
        if self.overall_score == 0.0 and self.scores:
            self.overall_score = sum(self.scores.values()) / len(self.scores)


# ---------------------------------------------------------------------------
# Perspective protocol — the extensible interface
# ---------------------------------------------------------------------------

@runtime_checkable
class EvalPerspective(Protocol):
    """Protocol that all perspectives must implement.

    Adding a new perspective = implement these methods + add a YAML eval set.
    The framework handles: CLI, panel evaluation, MongoDB storage, viewer
    integration, cost tracking, rankings.
    """

    @property
    def name(self) -> str:
        """Perspective identifier (e.g., 'knowledge', 'chain', 'safety')."""
        ...

    @property
    def description(self) -> str:
        """Human-readable description shown in viewer and CLI help."""
        ...

    @property
    def default_eval_set(self) -> str:
        """Default eval set YAML filename for this perspective."""
        ...

    def load_eval_set(self, yaml_path: str) -> EvalSetConfig:
        """Load perspective-specific eval set from YAML."""
        ...

    def resolve_items(self, eval_set: EvalSetConfig, filters: dict) -> list[EvalItem]:
        """Filter and resolve eval items based on CLI args.

        Common filters: category, sample, questions (IDs), chain, scenario.
        """
        ...

    def execute(self, item: EvalItem, config: RunConfig, **kwargs) -> ExecutionResult:
        """Run the model against this item and return raw output.

        For knowledge: single API call with config's model/knowledge/layer/params.
        For chain: subprocess to TypeScript harness with config's layer/tools/params.
        """
        ...

    def format_for_evaluation(self, result: ExecutionResult) -> tuple[str, str]:
        """Format execution output into (content, context) for panel evaluator.

        Returns:
            content: What to score (response text or formatted transcript)
            context: What it should accomplish (question+expected, scenario description)
        """
        ...

    def to_mongo_doc(self, scored: ScoredResult, run_id: str,
                     eval_version: str, system_version: str) -> dict:
        """Convert scored result into a MongoDB document.

        Must include all RunConfig axes as flat fields for indexing.
        Perspective adds its own metadata (chain_metadata, etc.).
        """
        ...


# ---------------------------------------------------------------------------
# Perspective registry
# ---------------------------------------------------------------------------

class PerspectiveRegistry:
    """Registry of available perspectives."""
    _perspectives: dict[str, EvalPerspective] = {}

    @classmethod
    def register(cls, perspective: EvalPerspective) -> None:
        cls._perspectives[perspective.name] = perspective

    @classmethod
    def get(cls, name: str) -> EvalPerspective:
        if name not in cls._perspectives:
            available = ", ".join(cls._perspectives.keys()) or "(none)"
            raise ValueError(
                f"Unknown perspective: {name}. Available: {available}"
            )
        return cls._perspectives[name]

    @classmethod
    def available(cls) -> list[str]:
        return list(cls._perspectives.keys())

    @classmethod
    def all(cls) -> dict[str, EvalPerspective]:
        return dict(cls._perspectives)


# ---------------------------------------------------------------------------
# Config loader — loads RunConfig from YAML with inheritance + CLI overrides
# ---------------------------------------------------------------------------

def load_configs_yaml(yaml_path: str) -> dict[str, dict]:
    """Load run configs from a YAML file with `extends` inheritance."""
    import yaml
    from pathlib import Path

    path = Path(yaml_path)
    if not path.exists():
        return {}

    with open(path) as f:
        data = yaml.safe_load(f) or {}

    raw_configs = data.get("configs", {})
    resolved: dict[str, dict] = {}

    def resolve(name: str) -> dict:
        if name in resolved:
            return resolved[name]
        raw = raw_configs.get(name)
        if raw is None:
            raise ValueError(f"Config '{name}' not found in {yaml_path}")
        # Resolve parent first
        parent_name = raw.get("extends")
        if parent_name:
            parent = resolve(parent_name)
            merged = {**parent, **{k: v for k, v in raw.items() if k != "extends"}}
        else:
            merged = dict(raw)
        resolved[name] = merged
        return merged

    for name in raw_configs:
        resolve(name)

    return resolved


def build_run_config(name: str, raw: dict, overrides: dict | None = None) -> RunConfig:
    """Build a RunConfig from a resolved config dict + CLI overrides."""
    if overrides:
        for key, val in overrides.items():
            if val is not None:
                raw[key] = val

    # Parse thinking config
    thinking = None
    if raw.get("thinking_enabled") or raw.get("thinking_budget"):
        thinking = {
            "enabled": raw.get("thinking_enabled", True),
            "budget": raw.get("thinking_budget", 4000),
        }

    return RunConfig(
        config_id=name,
        label=raw.get("label", name),
        model_id=raw.get("model_id", ""),
        provider=raw.get("provider", ""),
        knowledge=raw.get("knowledge", "full"),
        knowledge_doc=raw.get("knowledge_doc", ""),
        layer=raw.get("layer", "full"),
        persona_key=raw.get("persona_key", "claude"),
        max_tokens=raw.get("max_tokens", 2500),
        thinking=thinking,
        adaptive_effort=raw.get("adaptive_effort"),
        temperature=raw.get("temperature"),
        tools_enabled=raw.get("tools_enabled", True),
        web_search=raw.get("web_search", False),
        price=raw.get("price", ""),
    )


def load_run_configs(
    config_names: str,
    configs_yaml_path: str,
    overrides: dict | None = None,
) -> list[RunConfig]:
    """Load one or more RunConfigs by name from configs.yaml.

    Args:
        config_names: Comma-separated config names (e.g., "claude,gpt41")
        configs_yaml_path: Path to eval-sets/configs.yaml
        overrides: CLI overrides applied to all configs (e.g., {"layer": "persona-only"})

    Returns:
        List of RunConfig instances
    """
    all_configs = load_configs_yaml(configs_yaml_path)
    names = [n.strip() for n in config_names.split(",")]
    results = []

    for name in names:
        if name == "all":
            for cfg_name, cfg_data in all_configs.items():
                # Skip configs that are only meant as base (no model_id)
                if cfg_data.get("model_id"):
                    results.append(build_run_config(cfg_name, dict(cfg_data), overrides))
            break
        elif name not in all_configs:
            raise ValueError(
                f"Unknown config: {name}. Available: {', '.join(all_configs.keys())}"
            )
        else:
            results.append(build_run_config(name, dict(all_configs[name]), overrides))

    return results


# ---------------------------------------------------------------------------
# Version fingerprinting — content hashes + git provenance
# ---------------------------------------------------------------------------

def _hash_content(content: str) -> str:
    """SHA256 content hash, first 8 chars."""
    import hashlib
    return hashlib.sha256(content.encode()).hexdigest()[:8]


def _hash_file(path) -> str:
    """Hash a file's content. Returns 'missing' if file doesn't exist."""
    from pathlib import Path
    try:
        return _hash_content(Path(path).read_text())
    except Exception:
        return "missing"


def _git_head(repo_path) -> str:
    """Get current git HEAD short hash."""
    import subprocess
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(repo_path), text=True, timeout=5,
        ).strip()
    except Exception:
        return "unknown"


def _git_file_commit(repo_path, file_path) -> str:
    """Get the last commit that modified a specific file."""
    import subprocess
    try:
        return subprocess.check_output(
            ["git", "log", "-1", "--format=%h", "--", str(file_path)],
            cwd=str(repo_path), text=True, timeout=5,
        ).strip() or "untracked"
    except Exception:
        return "unknown"


def _git_dirty_files(repo_path, file_paths: list) -> list[str]:
    """Check which of the given files have uncommitted changes."""
    import subprocess
    dirty = []
    try:
        result = subprocess.check_output(
            ["git", "status", "--porcelain", "--"] + [str(p) for p in file_paths],
            cwd=str(repo_path), text=True, timeout=5,
        ).strip()
        if result:
            for line in result.split("\n"):
                if line.strip():
                    dirty.append(line.strip().split()[-1])
    except Exception:
        pass
    return dirty


def compute_version_fingerprint(
    project_root,
    eval_set: 'EvalSetConfig',
    system_prompt: str = "",
) -> dict:
    """Compute version fingerprint for an eval run.

    Captures content hashes + git provenance for every versionable component.
    Stored in MongoDB and meta.json for reproducibility and diff.

    Args:
        project_root: Path to the scout-quest repo root
        eval_set: The loaded eval set config
        system_prompt: The resolved system prompt (for persona hash)

    Returns:
        Dict with per-component hashes, git info, and composite fingerprints
    """
    import json
    from pathlib import Path

    root = Path(project_root)

    # File paths for versioned components
    knowledge_path = root / "backend" / "knowledge" / "interim-bsa-knowledge.md"
    troop_path = root / "backend" / "knowledge" / "troop-context.md"
    personas_path = root / "backend" / "experiments" / "model-personas.json"
    harness_path = root / "mcp-servers" / "scout-quest" / "test" / "harness.ts"

    # Content hashes
    knowledge_hash = _hash_file(knowledge_path)
    troop_hash = _hash_file(troop_path)
    personas_hash = _hash_file(personas_path)
    harness_hash = _hash_file(harness_path)
    persona_text_hash = _hash_content(system_prompt) if system_prompt else "not-captured"

    # Eval system hashes
    eval_set_hash = _hash_content(json.dumps(eval_set.raw, sort_keys=True, default=str))
    scorer_hash = _hash_content(eval_set.scorer_prompt)
    assessor_hash = _hash_content(json.dumps(
        sorted([
            {"role": a.role, "model": a.model, "prompt": a.prompt}
            for a in eval_set.assessors
        ], key=lambda x: x["role"]),
        sort_keys=True,
    ))

    # Git provenance
    git_head = _git_head(root)

    versioned_files = [knowledge_path, troop_path, personas_path, harness_path]
    dirty = _git_dirty_files(root, versioned_files)

    # Composite fingerprints
    system_fp = _hash_content(knowledge_hash + troop_hash + persona_text_hash)
    eval_fp = _hash_content(eval_set_hash + scorer_hash + assessor_hash)

    return {
        # System under eval
        "knowledge_doc": {
            "hash": knowledge_hash,
            "file": "backend/knowledge/interim-bsa-knowledge.md",
            "git_commit": _git_file_commit(root, knowledge_path),
        },
        "troop_context": {
            "hash": troop_hash,
            "file": "backend/knowledge/troop-context.md",
            "git_commit": _git_file_commit(root, troop_path),
        },
        "personas": {
            "hash": personas_hash,
            "file": "backend/experiments/model-personas.json",
            "git_commit": _git_file_commit(root, personas_path),
        },
        "persona_text": persona_text_hash,

        # Eval system
        "eval_set": {
            "name": f"{eval_set.name}-v{eval_set.version}",
            "hash": eval_set_hash,
        },
        "scorer_prompt": scorer_hash,
        "assessor_config": assessor_hash,

        # Code
        "harness": {
            "hash": harness_hash,
            "file": "mcp-servers/scout-quest/test/harness.ts",
            "git_commit": _git_file_commit(root, harness_path),
        },
        "git_head": git_head,
        "git_dirty": dirty,

        # Composite
        "system_fingerprint": f"SYS-{system_fp}",
        "eval_fingerprint": f"EVL-{eval_fp}",
    }


def diff_version_fingerprints(v1: dict, v2: dict) -> list[str]:
    """Report what changed between two version fingerprints.

    Returns human-readable list of changes. Empty list = identical.
    """
    changes = []

    def compare(key, a, b):
        if isinstance(a, dict) and isinstance(b, dict):
            h1 = a.get("hash", a.get("name", str(a)))
            h2 = b.get("hash", b.get("name", str(b)))
            if h1 != h2:
                gc1 = a.get("git_commit", "")
                gc2 = b.get("git_commit", "")
                f = a.get("file", "")
                detail = f" ({f}: {gc1} → {gc2})" if gc1 and gc2 else ""
                changes.append(f"{key}: {h1} → {h2}{detail}")
        elif a != b:
            changes.append(f"{key}: {a} → {b}")

    # Check key fields
    for key in ["knowledge_doc", "troop_context", "personas", "persona_text",
                "eval_set", "scorer_prompt", "assessor_config", "harness",
                "git_head", "system_fingerprint", "eval_fingerprint"]:
        a = v1.get(key)
        b = v2.get(key)
        if a is not None and b is not None:
            compare(key, a, b)

    return changes


# ---------------------------------------------------------------------------
# Shared eval set YAML loader
# ---------------------------------------------------------------------------

def load_eval_set_yaml(yaml_path: str) -> EvalSetConfig:
    """Load an eval set YAML file into an EvalSetConfig.

    Handles the common structure (evaluator, scoring, dimensions, assessors).
    Perspective-specific items (questions, chains, scenarios) are stored in
    the `items` list and `raw` dict for the perspective to interpret.
    """
    import yaml
    from pathlib import Path

    path = Path(yaml_path)
    with open(path) as f:
        data = yaml.safe_load(f) or {}

    # Parse evaluator config
    evaluator = data.get("evaluator", {})
    scoring = data.get("scoring", {})

    dimensions = [
        ScoringDimension(
            name=d["name"],
            weight=d.get("weight", 1.0),
            description=d.get("description", ""),
        )
        for d in scoring.get("dimensions", [])
    ]

    assessors = [
        AssessorConfig(
            role=a["role"],
            model=a["model"],
            provider=a["provider"],
            prompt=a.get("prompt", ""),
        )
        for a in evaluator.get("assessors", [])
    ]

    # Items: could be questions, chains, scenarios — perspective interprets
    items = data.get("questions", []) or data.get("chains", []) or data.get("scenarios", [])

    return EvalSetConfig(
        name=data.get("name", ""),
        version=data.get("version", 1),
        perspective=data.get("perspective", "knowledge"),
        description=data.get("description", ""),
        dimensions=dimensions,
        assessors=assessors,
        scorer_model=evaluator.get("scorer_model", "claude-sonnet-4-6"),
        scorer_prompt=scoring.get("scorer_prompt", ""),
        items=items,
        parent_version=data.get("parent_version"),
        raw=data,
    )
