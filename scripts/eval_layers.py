"""Layer configuration for the unified eval engine.

Each layer defines what the model gets: prompt context + tool authorization.
All tools are always registered with the API (the model sees them). The layer
controls which tools are authorized to execute and which prompt components
are included.

Layers:
    P    = Persona only (baseline — model training only)
    PW   = Persona + Web Search
    PT   = Persona + Troop context
    PK   = Persona + BSA Knowledge doc
    PTW  = Persona + Troop + Web Search
    PKT  = Persona + Knowledge + Troop (production default)
    PKTW = Full stack + Web Search
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

# Add parent dir for imports
sys.path.insert(0, str(Path(__file__).parent))

from eval_tools import ALL_TOOL_NAMES, TOOL_CATEGORIES, ALL_GUIDE_TOOL_NAMES, GUIDE_TOOL_CATEGORIES

if TYPE_CHECKING:
    from eval_framework import RunConfig


# ---------------------------------------------------------------------------
# Guide persona — parent/scouter-facing, no gaming overlay
# ---------------------------------------------------------------------------

GUIDE_PERSONA = """You are the Scout Quest Guide — a professional assistant for parents and scouters who oversee scouts using the Scout Quest system.

YOUR ROLE:
- Help parents and scouters monitor their scout's progress
- Present data clearly in parent-friendly terms (no gaming jargon, no quest overlay)
- Support guide actions: viewing progress, adjusting settings, flagging concerns
- Be warm but professional — you're talking to adults, not youth

COMMUNICATION STYLE:
- Clear, concise, factual — parents want the bottom line
- Translate internal metrics into plain language (e.g., "15% toward his savings goal" not "quest progress 15%")
- Celebrate the scout's wins without being over-the-top
- When there are concerns, be honest and direct — parents appreciate candor
- Never reveal internal coaching strategy or AI character settings unless the guide specifically asks to adjust them

IMPORTANT:
- Always use real data from tools — never fabricate progress numbers
- Respect the scout's privacy while keeping the guide informed
- If asked about something outside your scope, say so clearly"""


# ---------------------------------------------------------------------------
# LayerConfig
# ---------------------------------------------------------------------------

@dataclass
class LayerConfig:
    """Defines what the model gets: prompt context + tool authorization."""

    name: str                                   # "P", "PKT", "PKTW", etc.
    label: str                                  # "Persona + Knowledge + Troop"

    # Prompt components
    include_knowledge: bool = False             # BSA knowledge doc in system prompt
    include_troop: bool = False                 # Troop context in system prompt
    include_tool_instructions: bool = False     # Tool descriptions in persona

    # Tool authorization (ALL tools always registered, this controls execution)
    authorized_tools: set[str] = field(default_factory=set)

    def is_authorized(self, tool_name: str) -> bool:
        """Check if a tool is authorized to execute in this layer."""
        return tool_name in self.authorized_tools

    def build_system_prompt(self, config: "RunConfig", endpoint: str = "scout") -> str:
        """Build the system prompt based on layer config.

        Reuses the knowledge loading and prompt building infrastructure from
        perspectives/knowledge.py to avoid duplication.

        Args:
            config: RunConfig with model/persona/knowledge settings.
            endpoint: "scout" (default) or "guide" — selects persona and tool instructions.
        """
        from perspectives.knowledge import (
            _load_knowledge,
            _knowledge_full,
            _knowledge_compact,
            _troop_context,
            _personas,
            SYSTEM_PROMPT_DELIMITER,
            TROOP_CONTEXT_DELIMITER,
            PERSONA_NO_TOOLS,
            PROJECT_ROOT,
        )

        _load_knowledge()

        # Import the module-level cached values after loading
        import perspectives.knowledge as k_mod
        knowledge_full = k_mod._knowledge_full
        knowledge_compact = k_mod._knowledge_compact
        troop_context = k_mod._troop_context
        personas = k_mod._personas

        # Choose persona based on endpoint
        if endpoint == "guide":
            persona = GUIDE_PERSONA
        elif self.include_tool_instructions and personas:
            persona = personas.get(config.persona_key, {}).get("persona", PERSONA_NO_TOOLS)
        else:
            persona = PERSONA_NO_TOOLS

        # Choose knowledge document
        knowledge = ""
        if self.include_knowledge:
            if config.knowledge == "full":
                knowledge = knowledge_full or ""
            elif config.knowledge == "compact":
                knowledge = knowledge_compact or ""
            elif config.knowledge == "none":
                knowledge = ""
            else:
                knowledge = knowledge_full or ""

            # Custom knowledge doc override
            if config.knowledge_doc:
                doc_path = PROJECT_ROOT / config.knowledge_doc
                if doc_path.exists():
                    knowledge = doc_path.read_text()

        # Add tool usage instructions if tools are authorized
        tool_instructions = ""
        if self.include_tool_instructions and self.authorized_tools:
            if endpoint == "guide":
                from eval_tools import GUIDE_TOOL_DEFINITIONS
                tool_defs = GUIDE_TOOL_DEFINITIONS
                tool_lines = [
                    "",
                    "AVAILABLE TOOLS:",
                ]
                for tool_name in sorted(self.authorized_tools):
                    tool_def = next((t for t in tool_defs if t["name"] == tool_name), None)
                    if tool_def:
                        tool_lines.append(f"- {tool_name}: {tool_def['description'][:150]}")
                tool_lines.extend([
                    "",
                    "TOOL USAGE RULES:",
                    "1. Always use read_linked_scouts first to identify which scouts you can access.",
                    "2. Use read_scout_* tools to get real data — never fabricate progress numbers.",
                    "3. Present data in parent-friendly terms — translate metrics into plain language.",
                    "4. For concerns, use flag_conversation to create a record and follow-up reminder.",
                    "5. For character adjustments, use adjust_character — explain what the change will do.",
                ])
            else:
                from eval_tools import TOOL_DEFINITIONS
                tool_defs = TOOL_DEFINITIONS
                tool_lines = [
                    "",
                    "DATA SOURCES — know what's where:",
                    "- YOUR KNOWLEDGE BASE (already in this prompt): BSA official policy, merit badge requirements,",
                    "  requirement version history, advancement procedures, safety rules. This is AUTHORITATIVE.",
                    "  Use it FIRST for any BSA facts, requirements, or policy questions.",
                    "- SCOUT DATA TOOLS (read_*): This specific scout's progress, quest state, chore streak, etc.",
                    "  Use these to PERSONALIZE — check what this scout has done, not what BSA requires.",
                    "",
                    "AVAILABLE TOOLS:",
                ]
                for tool_name in sorted(self.authorized_tools):
                    tool_def = next((t for t in tool_defs if t["name"] == tool_name), None)
                    if tool_def:
                        tool_lines.append(f"- {tool_name}: {tool_def['description'][:150]}")
                tool_lines.extend([
                    "",
                    "TOOL USAGE RULES:",
                    "1. BSA facts/requirements/policy → ANSWER DIRECTLY from your knowledge base. It's already in your",
                    "   context above. You do NOT need to call any tool to answer BSA policy or requirement questions.",
                    "   Just read your context and respond.",
                    "2. This scout's PERSONAL progress → use read_* tools (read_quest_state, read_requirements, etc.)",
                    "   to check THEIR specific status, savings, streak, or completed requirements.",
                    "3. web_search → ONLY for topics NOT covered in your knowledge base, or very recent news.",
                    "4. NEVER fabricate specific facts. If you genuinely can't find it in your context, say so.",
                    "5. Do NOT call tools just because they exist. Only call a tool when you NEED data you don't have.",
                ])
            tool_instructions = "\n".join(tool_lines)

        # Combine persona + tool instructions
        full_persona = persona + tool_instructions

        # Assemble prompt based on what components are included
        if self.include_knowledge and self.include_troop:
            return (
                knowledge
                + SYSTEM_PROMPT_DELIMITER
                + (troop_context or "")
                + TROOP_CONTEXT_DELIMITER
                + full_persona
            )
        elif self.include_knowledge and not self.include_troop:
            return knowledge + SYSTEM_PROMPT_DELIMITER + full_persona
        elif not self.include_knowledge and self.include_troop:
            return (troop_context or "") + TROOP_CONTEXT_DELIMITER + full_persona
        else:
            return full_persona


# ---------------------------------------------------------------------------
# Predefined layers
# ---------------------------------------------------------------------------

# Tools authorized for the PKT layer (everything except web_search)
_PKT_TOOLS = ALL_TOOL_NAMES - {"web_search"}

LAYERS: dict[str, LayerConfig] = {
    "P": LayerConfig(
        name="P",
        label="Persona Only",
        include_knowledge=False,
        include_troop=False,
        include_tool_instructions=False,
        authorized_tools=set(),
    ),
    "PW": LayerConfig(
        name="PW",
        label="Persona + Web Search",
        include_knowledge=False,
        include_troop=False,
        include_tool_instructions=False,
        authorized_tools={"web_search"},
    ),
    "PT": LayerConfig(
        name="PT",
        label="Persona + Troop",
        include_knowledge=False,
        include_troop=True,
        include_tool_instructions=False,
        authorized_tools=set(),
    ),
    "PK": LayerConfig(
        name="PK",
        label="Persona + Knowledge",
        include_knowledge=True,
        include_troop=False,
        include_tool_instructions=False,
        authorized_tools=set(),
    ),
    "PTW": LayerConfig(
        name="PTW",
        label="Persona + Troop + Web Search",
        include_knowledge=False,
        include_troop=True,
        include_tool_instructions=False,
        authorized_tools={"web_search"},
    ),
    "PKT": LayerConfig(
        name="PKT",
        label="Persona + Knowledge + Troop",
        include_knowledge=True,
        include_troop=True,
        include_tool_instructions=True,
        authorized_tools=_PKT_TOOLS,
    ),
    "PKTW": LayerConfig(
        name="PKTW",
        label="Full Stack + Web Search",
        include_knowledge=True,
        include_troop=True,
        include_tool_instructions=True,
        authorized_tools=ALL_TOOL_NAMES,
    ),
}


# ---------------------------------------------------------------------------
# Layer lookup with backward compatibility aliases
# ---------------------------------------------------------------------------

# Map old layer names to new short names
_ALIASES: dict[str, str] = {
    "persona-only": "P",
    "knowledge-only": "PK",
    "knowledge+troop": "PKT",
    "troop+websearch": "PTW",
    "troop-only": "PT",
    "full": "PKTW",
}


def get_layer(name: str) -> LayerConfig:
    """Get a layer config by name, with backward compatibility aliases.

    Args:
        name: Layer name ("P", "PKT", "PKTW") or legacy name ("persona-only", "full")

    Returns:
        LayerConfig for the requested layer. Falls back to PKT if unknown.
    """
    key = _ALIASES.get(name, name)
    return LAYERS.get(key, LAYERS["PKT"])
