# Prompt: Apply CLS Learning Architecture to jeremy-memory

Use this prompt in a new Claude Code session pointed at `/opt/repos/jeremy-memory`.

---

## Prompt

Read this article first: https://hcd.ai/ai-in-practice/your-ai-might-remember-but-does-it-learn/

The article proposes a Complementary Learning Systems (CLS) architecture for AI — 4 stages:
1. **Working Memory** — session pre-loaded with accumulated knowledge
2. **Episodic Memory** — structured session summaries (decisions, corrections, insights)
3. **Consolidation** — scheduled replay that extracts patterns from episodes
4. **Semantic Memory** — durable distilled knowledge (preferences, heuristics, failures)

Key design principles from the article:
- Confidence weighting: new patterns enter low, strengthen through recurrence; failures enter high
- Decay: patterns unused for 30 days lose confidence
- Auditability: everything is readable text files, inspectable and diffable
- Session handoff: forward-looking notes for session continuity

**Your task:** Apply these concepts to the jeremy-memory project at `/opt/repos/jeremy-memory`.

### Context on jeremy-memory

This is a personal knowledge management system that:
- Collects data from Gmail (3 accounts), calendar, and manual input
- Categorizes knowledge into domains (work, personal, scouts, development, family, anna)
- Stores domain files as markdown in `domains/`
- Generates views (daily brief, weekly review, priorities, todos)
- Embeds all domain files for semantic search via MCP server
- Runs as a Cloud Run job on a cron schedule (twice daily)
- Has an MCP server that Claude Desktop/Code uses for search, todo management, project tracking
- Everything is plain text markdown files in a git repo

### What to investigate

1. Read `CLAUDE.md`, `README.md`, and the pipeline code in `pipelines/`
2. Understand the current architecture: collectors → categorizer → views → embeddings
3. Look at the MCP server in `mcpserver/` — what tools does it expose?
4. Check the cron/pipeline orchestration in `scripts/` and `terraform/`

### What to design

The jeremy-memory system already has some CLS-like properties (it collects, categorizes, generates views). But it's missing:

1. **Episodic memory from Claude interactions** — when I use Claude Code or Claude Desktop with the MCP server, those interactions aren't captured. The system should learn from how I use it.

2. **Consolidation that extracts patterns** — the categorizer puts knowledge into domains, but doesn't extract cross-domain patterns, recurring themes, or evolving priorities over time.

3. **Learning profiles** — the system doesn't track what topics I search for most, what todos I complete vs dismiss, what knowledge I reference frequently. These signals should inform how it organizes and surfaces information.

4. **Decay and confidence** — old knowledge doesn't fade. A todo from 6 months ago has the same weight as one from today. Knowledge items don't have confidence scores that strengthen or weaken based on usage.

5. **Session handoff** — when I start a new Claude session, it has to re-discover context. The system should maintain a "current state" summary that any new session can load instantly.

### Deliverables

1. A phased implementation plan (4 phases, each ~1 session of work)
2. Data model for episodes, learning profiles, and confidence-weighted knowledge
3. Specific changes to the pipeline (new stages or modifications to existing ones)
4. MCP server additions (new tools for episode capture, learning profile queries)
5. Cron job changes for consolidation

Don't build it yet — just plan. Present the plan for review.
