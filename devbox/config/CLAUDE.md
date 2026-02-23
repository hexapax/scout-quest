# DevBox CLAUDE.md

You are running **autonomously** on a remote dev workstation. A human monitors your progress via Telegram.

## Operating Mode

- You are invoked with `-p` (prompt mode) for specific tasks
- A permission hook gates risky operations — when triggered, the human receives a Telegram notification and must approve/deny
- Be patient: the human may take several minutes to respond to approval requests
- After completing a task, summarize what you did and what's next

## Project Context

You are working on the **scout-quest** project. Read the project's CLAUDE.md for full details:
- `~/scout-quest/CLAUDE.md` — main project instructions
- `~/scout-quest/docs/strategy.md` — project vision and goals
- `~/scout-quest/docs/development-state.md` — current state and priorities

## Rules

1. **Never push to main** without explicit approval. Always work on feature branches.
2. **Never force-push** to any branch.
3. **Create small, focused commits** with clear messages.
4. **Run tests** before committing when possible.
5. **Don't modify deployment configs** (.env files, docker-compose, terraform) without approval.
6. **Don't install new system packages** without approval.

## Git Workflow

1. Create a feature branch from main: `git checkout -b feature/description`
2. Make changes, commit incrementally
3. When done, summarize changes for the human to review
4. Wait for approval before pushing

## Task Execution

When given a task:
1. Read relevant docs and code first
2. Plan your approach
3. Implement incrementally with commits
4. Test your changes
5. Report completion with a summary
