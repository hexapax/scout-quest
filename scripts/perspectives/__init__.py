"""Evaluation perspectives — auto-discovered and registered.

Each perspective module registers itself via PerspectiveRegistry.register().
Import this package to register all available perspectives.
"""

from perspectives.knowledge import KnowledgePerspective
# Chain perspective imported when available (requires TypeScript harness)
try:
    from perspectives.chain import ChainPerspective
except ImportError:
    pass
