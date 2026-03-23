# Stateful Tool Handlers — Real MongoDB for All Tests

**Date:** 2026-03-23
**Status:** Design — needed before next eval runs
**Priority:** Critical

## Problem

Current Python tool handlers are stateless mocks — `log_chore` returns a nice message but `read_chore_streak` still returns the original fixture. Multi-turn tests and chains need mutations to persist so subsequent reads reflect changes.

Meanwhile the TypeScript chain harness has real MongoDB handlers that work correctly but live in a separate codebase. We have two tool systems that need to be one.

## Solution: Python Tool Handlers Against Test MongoDB

Port the TypeScript tool dispatch logic to Python. Each eval run seeds a test MongoDB database with scenario fixtures, and all tool calls operate on real collections. Reads reflect mutations.

### Architecture

```
Eval Engine
  ↓ tool_use
Tool Handler (Python)
  ↓ pymongo
Test MongoDB (scoutquest_test database)
  ├── scouts (scout profile with quest_state, character, chore_list)
  ├── chore_logs
  ├── budget_entries
  ├── requirements
  ├── session_notes
  ├── quest_plans
  ├── emails_sent (audit only, never actually sends)
  └── time_mgmt
```

### Per-Test Lifecycle

```python
class TestState:
    """Manages test MongoDB state for a single eval item."""

    def __init__(self, mongo_uri="mongodb://localhost:27017", db_name="scoutquest_test"):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]

    def seed(self, fixtures: dict):
        """Drop all collections and seed with scenario fixtures."""
        for col_name in self.db.list_collection_names():
            self.db[col_name].drop()

        if fixtures.get("scout"):
            self.db.scouts.insert_one(fixtures["scout"])
        if fixtures.get("requirements"):
            self.db.requirements.insert_many(fixtures["requirements"])
        if fixtures.get("chore_logs"):
            self.db.chore_logs.insert_many(fixtures["chore_logs"])
        # ... etc

    def snapshot(self) -> dict:
        """Capture current state for comparison."""
        return {
            "scout": self.db.scouts.find_one({"email": self.scout_email}),
            "chore_log_count": self.db.chore_logs.count_documents({"scout_email": self.scout_email}),
            "requirements": list(self.db.requirements.find({"scout_email": self.scout_email})),
            # ...
        }

    def cleanup(self):
        """Drop test database."""
        self.client.drop_database(self.db.name)
```

### Eval Set Fixtures

Questions can define custom initial state:

```yaml
- id: F5-no-chores
  question: "I want to earn money but I don't have any chores set up."
  fixtures:
    scout:
      chore_list: []  # empty — forces assistant to help brainstorm
      quest_state: { current_savings: 0, target_budget: 800 }
    requirements: default  # use standard fixture

- id: chore-streak-day-1
  question: "hey I did my chores today"
  fixtures:
    scout: default  # has chore_list with dishes, trash, laundry
    chore_logs:
      - { date: "2026-03-20", chores_completed: ["dishes", "trash"], income_earned: 2 }
      - { date: "2026-03-21", chores_completed: ["dishes", "trash"], income_earned: 2 }
      # 10 days of history for streak testing
```

### Tool Handler Port

Each handler is a Python function that takes `(db, scout_email, args)` and returns a string result. Direct port from TypeScript — same MongoDB operations, same field names, same response format.

```python
def handle_log_chore(db, scout_email: str, args: dict) -> str:
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return "Error: Scout profile not found."

    chores = args.get("chores_completed", [])
    chore_date = datetime.fromisoformat(args["date"]) if args.get("date") else datetime.now()
    chore_date = chore_date.replace(hour=0, minute=0, second=0, microsecond=0)

    # Calculate income from chore list
    income = 0
    chore_map = {c["id"]: c for c in (scout.get("chore_list") or [])}
    for chore_id in chores:
        chore = chore_map.get(chore_id)
        if chore and chore.get("earns_income") and chore.get("income_amount"):
            income += chore["income_amount"]

    # Check for existing entry
    next_day = chore_date + timedelta(days=1)
    existing = db.chore_logs.find_one({
        "scout_email": scout_email,
        "date": {"$gte": chore_date, "$lt": next_day}
    })

    if existing:
        prev_income = existing.get("income_earned", 0)
        diff = income - prev_income
        db.chore_logs.update_one(
            {"_id": existing["_id"]},
            {"$set": {"chores_completed": chores, "income_earned": income, "updated_at": datetime.now()}}
        )
        if diff != 0:
            db.scouts.update_one(
                {"email": scout_email},
                {"$inc": {"quest_state.current_savings": diff}}
            )
        return f"Chores updated: {len(chores)} chore(s). Earned: ${income:.2f}."

    db.chore_logs.insert_one({
        "scout_email": scout_email,
        "date": chore_date,
        "chores_completed": chores,
        "income_earned": income,
        "created_at": datetime.now()
    })
    if income > 0:
        db.scouts.update_one(
            {"email": scout_email},
            {"$inc": {"quest_state.current_savings": income}}
        )

    return f"Chores logged: {len(chores)} chore(s). Earned: ${income:.2f}."


def handle_read_quest_state(db, scout_email: str, args: dict) -> str:
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return json.dumps({"error": "Scout not found"})

    qs = scout.get("quest_state", {})
    return json.dumps({
        "goal_item": qs.get("goal_item"),
        "goal_description": qs.get("goal_description"),
        "target_budget": qs.get("target_budget", 0),
        "current_savings": qs.get("current_savings", 0),
        "quest_status": qs.get("quest_status", "active"),
        "progress_percent": round(qs.get("current_savings", 0) / max(qs.get("target_budget", 1), 1) * 100),
    })
```

### Integration with Eval Engine

```python
class ToolRegistry:
    def __init__(self, test_state: TestState):
        self.test_state = test_state
        self.handlers = {
            "log_chore": handle_log_chore,
            "read_quest_state": handle_read_quest_state,
            "web_search": handle_web_search,  # real Brave API
            # ... all handlers
        }

    def execute(self, tool_name, args, authorized=True):
        if not authorized:
            return {"error": f"Tool '{tool_name}' not enabled.", "unauthorized": True}

        handler = self.handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}

        result = handler(self.test_state.db, self.test_state.scout_email, args)
        return {"result": result}
```

### What About Vector Search?

`search_knowledge` (future vector search tool) would be another handler:

```python
def handle_search_knowledge(db, scout_email: str, args: dict) -> str:
    query = args.get("query", "")
    # Could use FalkorDB, pgvector, or simple text search on the knowledge collection
    # For now: text search on a knowledge_chunks collection
    results = db.knowledge_chunks.find(
        {"$text": {"$search": query}},
        {"score": {"$meta": "textScore"}}
    ).sort([("score", {"$meta": "textScore"})]).limit(5)

    return json.dumps([{"text": r["text"], "source": r["source"]} for r in results])
```

### Migration Path

1. Port the 17 tool handlers from TypeScript to Python (mostly CRUD)
2. Port the test fixtures from `test/fixtures/profiles.js` to Python
3. Update `ToolRegistry` to use `TestState` instead of static mocks
4. Update `EvalEngine.run()` to seed/cleanup test state per question
5. Test: run same chain scenario through Python engine, compare results to TypeScript harness
6. Gradually retire TypeScript harness as Python engine proves reliable

### What This Enables

- Single tool system for all eval types (knowledge, chain, safety, multi-turn)
- Mutations persist within a test (log_chore → read_chore_streak reflects change)
- Per-question fixtures (test "no chores" scenario vs "10-day streak" scenario)
- DB snapshots for mutation verification (same as TypeScript harness)
- Vector search as just another tool
- Production-identical tool behavior from the model's perspective
