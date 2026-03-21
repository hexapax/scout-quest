#!/usr/bin/env python3
"""Multi-model evaluation: run the same 54 questions across Scout Coach candidates.

Each model gets:
- Its tuned persona from model-personas.json
- Appropriate knowledge doc (full 177K or compact 115K based on context limit)
- The same 54 questions
- Scored by Claude Sonnet evaluator

Keys are loaded automatically from:
  1. Environment variables (if already set)
  2. /home/devuser/LibreChat/.env (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_KEY)
  3. GCP Secret Manager (hexapax-devbox project)

Usage:
  python3 run-model-eval.py [--model claude,gpt41,gemini25flash,...] [--category all] [--budget 5.00]

Output: test/reports/model-comparison/<timestamp>/
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from pymongo import MongoClient
    MONGO_AVAILABLE = True
except ImportError:
    MONGO_AVAILABLE = False

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")

PROJECT_ROOT = Path(__file__).parent.parent
KNOWLEDGE_FULL = PROJECT_ROOT / "backend" / "knowledge" / "interim-bsa-knowledge.md"
KNOWLEDGE_COMPACT = PROJECT_ROOT / "backend" / "knowledge" / "compact-bsa-knowledge.md"
TROOP_CONTEXT = PROJECT_ROOT / "backend" / "knowledge" / "troop-context.md"
PERSONAS_FILE = PROJECT_ROOT / "backend" / "experiments" / "model-personas.json"
REPORT_DIR = PROJECT_ROOT / "mcp-servers" / "scout-quest" / "test" / "reports" / "model-comparison"
LIBRECHAT_ENV = Path("/home/devuser/LibreChat/.env")

# ---------------------------------------------------------------
# Key loading
# ---------------------------------------------------------------

def load_dotenv_key(name):
    """Load a key from LibreChat .env file."""
    if not LIBRECHAT_ENV.exists():
        return None
    for line in LIBRECHAT_ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return None

def load_secret(name):
    """Load a key from GCP Secret Manager (hexapax-devbox project)."""
    try:
        result = subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest",
             "--secret", name, "--project", "hexapax-devbox"],
            capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None

def get_key(env_var, dotenv_name=None, secret_name=None):
    """Get API key from env, dotenv, or secret manager (in that order)."""
    val = os.environ.get(env_var)
    if val:
        return val
    if dotenv_name:
        val = load_dotenv_key(dotenv_name)
        if val:
            os.environ[env_var] = val
            return val
    if secret_name:
        val = load_secret(secret_name)
        if val:
            os.environ[env_var] = val
            return val
    return ""

def load_all_keys():
    """Load all API keys, print status."""
    keys = {
        "ANTHROPIC_API_KEY": get_key("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "anthropic-api-key"),
        "OPENAI_API_KEY": get_key("OPENAI_API_KEY", "OPENAI_API_KEY", "openai-api-key"),
        "GOOGLE_KEY": get_key("GOOGLE_KEY", "GOOGLE_KEY", None),
        "DEEPSEEK_API_KEY": get_key("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", "deepseek-api-key"),
        "OPENROUTER_KEY": get_key("OPENROUTER_KEY", "OPENROUTER_KEY", "openrouter-api-key"),
    }
    print("API Keys:")
    for name, val in keys.items():
        status = f"OK ({len(val)} chars)" if val else "MISSING"
        print(f"  {name}: {status}")
    print()
    return keys

# ---------------------------------------------------------------
# Load personas and knowledge
# ---------------------------------------------------------------

with open(PERSONAS_FILE) as f:
    PERSONAS = json.load(f)

knowledge_full = KNOWLEDGE_FULL.read_text() if KNOWLEDGE_FULL.exists() else ""
knowledge_compact = KNOWLEDGE_COMPACT.read_text() if KNOWLEDGE_COMPACT.exists() else ""
troop_context = TROOP_CONTEXT.read_text() if TROOP_CONTEXT.exists() else ""

# ---------------------------------------------------------------
# Questions
# ---------------------------------------------------------------

QUESTIONS = [
    {"id":"A1","cat":"A","q":"Can a board of review reject me for not being active enough in the troop?","expect":"G2A: 'reasonable' standard, cannot hold to unwritten expectations"},
    {"id":"A2","cat":"A","q":"My scoutmaster says I have to redo a merit badge requirement because a different counselor started it. Is that true?","expect":"G2A: Scouts need not pass all requirements with same counselor. Partials have no expiration except 18th birthday."},
    {"id":"A3","cat":"A","q":"Do partial merit badge completions expire? My troop says they expire after 6 months.","expect":"G2A: Units must NOT establish expiration dates beyond 18th birthday."},
    {"id":"A4","cat":"A","q":"My board of review wants to retest me on the requirements. Can they do that?","expect":"G2A: BOR is NOT a retest/examination."},
    {"id":"A5","cat":"A","q":"I was told I can't work on Star requirements until I finish First Class. Is that right?","expect":"You CAN work on requirements for future ranks, but must earn them in sequence."},
    {"id":"A6","cat":"A","q":"My counselor says I have to redo a requirement because I completed it at summer camp. Can he require that?","expect":"Once signed off by any registered counselor, it's complete. Cannot be required to redo."},
    {"id":"A7","cat":"A","q":"I'm 17 and a half. Is it too late to start working on Eagle?","expect":"Must complete before 18th birthday. BOR can happen after if reqs met before."},
    {"id":"A8","cat":"A","q":"Our troop committee says I need my Eagle project approved before my Life board of review. Is that right?","expect":"Life BOR has nothing to do with Eagle project. Separate ranks."},
    {"id":"B1","cat":"B","q":"I don't really want to go on the campout this weekend. Is that OK?","expect":"Reference troop camping culture, outdoor values, patrol method"},
    {"id":"B2","cat":"B","q":"My mom wants to help with my Eagle project. How much can she do?","expect":"Scout must plan, develop, give leadership. Family can help but scout leads."},
    {"id":"B3","cat":"B","q":"What should I wear to the meeting on Tuesday?","expect":"Troop 2024: Class B (troop t-shirt) for regular biweekly meetings",
     "eval_notes":"Troop 2024 uses Class B (troop t-shirt) for regular meetings, full uniform (Class A) for courts of honor. Meetings are biweekly."},
    {"id":"B4","cat":"B","q":"How do I get started on a new merit badge? What's the process?","expect":"Blue card process, talk to scoutmaster/advancement chair, find counselor"},
    {"id":"B5","cat":"B","q":"Is it OK to use ChatGPT to help me write my Personal Management budget plan?","expect":"AI as tool not shortcut, scout does the work"},
    {"id":"B6","cat":"B","q":"Who should I talk to about getting a leadership position?","expect":"Troop 2024 leadership info — SPL, scoutmaster",
     "eval_notes":"Jeremy Bramwell is real Scoutmaster. Troop has SPL and patrol leaders. Any named troop leaders should be verified against troop data."},
    {"id":"B7","cat":"B","q":"When is the next court of honor?","expect":"Reference troop schedule or say doesn't know exact date"},
    {"id":"B8","cat":"B","q":"What patrols does our troop have?","expect":"Troop 2024 patrol names from troop context",
     "eval_notes":"Troop 2024 patrol names are in the troop context data. Any patrol names referenced should be verified against troop data, not assumed fabricated."},
    {"id":"C1","cat":"C","q":"How many camping nights do I need for the Camping merit badge?","expect":"20 days AND nights total with subrequirements"},
    {"id":"C2","cat":"C","q":"What changed in the Eagle Scout requirements recently?","expect":"v2026 Eagle requirements effective 2026-02-27",
     "eval_notes":"Eagle requirements v2026 effective 2026-02-27 are REAL. Citizenship in Society WAS removed from Eagle-required list in this version. This is a verified fact from the knowledge base."},
    {"id":"C3","cat":"C","q":"For Personal Fitness, do I need to actually follow a 12-week exercise plan or just create one?","expect":"Must develop AND follow for 12 weeks, keep a log"},
    {"id":"C4","cat":"C","q":"What are the requirements for Citizenship in Society?","expect":"Current version from official requirements",
     "eval_notes":"CIS was removed from Eagle-required list effective 2026-02-27. Nicole Allen is real Advancement Chair. Jeremy Bramwell is real Scoutmaster. The model has BSA requirement text — paraphrasing is acceptable, fabrication is not. If the model names troop contacts, verify against troop data before penalizing."},
    {"id":"C5","cat":"C","q":"Can I count my Eagle project service hours toward Star Scout service requirement?","expect":"Depends on timing and G2A double-counting rules"},
    {"id":"C6","cat":"C","q":"How many merit badges do I need for Eagle?","expect":"21 total, 13 Eagle-required, 8 electives"},
    {"id":"C7","cat":"C","q":"What's the difference between requirement 4a and 4b for First Aid merit badge?","expect":"Should look up exact text, not guess"},
    {"id":"C8","cat":"C","q":"For Environmental Science, do I do the experiments in requirement 3 or 4?","expect":"Should look up exact requirement structure"},
    {"id":"D1","cat":"D","q":"Mr. Johnson offered to drive me to the campout since my parents can't. Is that OK?","expect":"G2SS: Two-deep leadership for transport. No one-on-one."},
    {"id":"D2","cat":"D","q":"We want to go kayaking at the lake. What do we need to set up?","expect":"G2SS: Safe Swim Defense AND Safety Afloat both apply.",
     "eval_notes":"BOTH Safe Swim Defense AND Safety Afloat are required for kayaking. Missing either one is an accuracy issue. Jeremy Bramwell is the real Scoutmaster."},
    {"id":"D3","cat":"D","q":"My assistant scoutmaster wants to follow me on Instagram. Should I accept?","expect":"YPT: No private one-on-one digital contact between adults and youth."},
    {"id":"D4","cat":"D","q":"We're driving to summer camp — it's about 12 hours away. Can we do it in one day?","expect":"G2SS: Max 10 hours driving in one 24-hour period."},
    {"id":"D5","cat":"D","q":"Can our patrol go on a hike without any adults? We're all 15+.","expect":"Two-deep adult leadership required for all outings regardless of age."},
    {"id":"D6","cat":"D","q":"My den leader from Cub Scouts wants to text me. Is that OK since he knows me?","expect":"No one-on-one electronic communication regardless of prior relationship."},
    {"id":"E1","cat":"E","q":"What merit badges would help me prepare for my Eagle project?","expect":"Cross-reference project management skills with MB requirements"},
    {"id":"E2","cat":"E","q":"I really like cooking and outdoor stuff. What merit badges are related?","expect":"Cooking, Camping, Backpacking connections"},
    {"id":"E3","cat":"E","q":"Which First Class requirements could I complete at a Camping MB campout?","expect":"Cross-reference rank + MB requirements for overlap",
     "eval_notes":"The model has actual BSA requirement text. Specific requirement numbers and cross-references may be correct even if you don't recognize them. Only penalize if you can verify a claim is WRONG, not if you can't verify it's right."},
    {"id":"E4","cat":"E","q":"I completed Swimming MB. Does that help with any rank requirements?","expect":"Swimming MB → rank requirement connections",
     "eval_notes":"Swimming IS one of the Eagle-required alternatives at requirement 3(k): Swimming OR Hiking OR Cycling. This is a verified fact. Nicole Allen is the real Advancement Chair."},
    {"id":"E5","cat":"E","q":"What requirements changed between 2023 and 2025 for badges I'm working on?","expect":"MUST use tool — do NOT guess at specific changes",
     "eval_notes":"The model has version history data (2019-2025) in its knowledge block. Specific version change details may be accurate. Only penalize if a stated change is provably wrong."},
    {"id":"E6","cat":"E","q":"What are all the Eagle-required merit badges? Which ones have I completed?","expect":"Should use cross_reference(eagle_requirements)"},
    {"id":"E7","cat":"E","q":"I want to do a merit badge about nature or the environment. What are my options?","expect":"Should find nature/environment category badges"},
    {"id":"E8","cat":"E","q":"Are there any merit badges related to First Aid?","expect":"Should find First Aid's category and related badges"},
    {"id":"E9","cat":"E","q":"What's different about Camping MB now vs two years ago?","expect":"MUST use tool for version changes — do NOT fabricate",
     "eval_notes":"The model has Camping MB version history in its knowledge block. Changes cited may be accurate. Only penalize fabrication, not unverifiable details."},
    {"id":"E10","cat":"E","q":"I'm interested in computers or technology. What badges should I look at?","expect":"Should find technology-related badges"},
    {"id":"F1","cat":"F","q":"I hate doing community service. It's boring. Can I just skip it?","expect":"Validate feeling, help find service they'd enjoy, connect to values WITHOUT lecturing"},
    {"id":"F2","cat":"F","q":"This kid in my patrol is really annoying and nobody likes him. What should I do?","expect":"Encourage empathy and inclusion. Do NOT lecture about bullying policy."},
    {"id":"F3","cat":"F","q":"My dad says scouting is a waste of time and I should focus on sports.","expect":"Be empathetic, validate feelings, suggest ways to talk to dad. Do NOT be defensive about scouting."},
    {"id":"F4","cat":"F","q":"I cheated on a requirement — I said I did the hike but I didn't do all the miles. Should I tell someone?","expect":"Encourage honesty (Trustworthy) while being understanding, not judgmental."},
    {"id":"F5","cat":"F","q":"Why do I have to learn outdoor stuff? I want to be a programmer.","expect":"Connect outdoor skills to broader life skills. Mention tech badges. Be genuine."},
    {"id":"F6","cat":"F","q":"I'm nervous about my board of review. What if they ask something I don't know?","expect":"Be reassuring and practical. NOT dump G2A BOR rules."},
    {"id":"F7","cat":"F","q":"My friend wants to join scouts but he's worried nobody will like him.","expect":"Encourage welcoming friend. Be warm and genuine."},
    {"id":"F8","cat":"F","q":"I don't really believe in God. Do I have to say 'duty to God' in the Scout Oath?","expect":"Respectful, honest. BSA interprets broadly. Do NOT lecture on religious policy."},
    {"id":"G1","cat":"G","q":"I failed my board of review. I feel terrible.","expect":"Empathize FIRST. Do NOT cite G2A appeal procedures unless asked."},
    {"id":"G2","cat":"G","q":"I don't think I'll ever make Eagle. It seems impossible.","expect":"Encourage, break it down. Do NOT list all Eagle requirements."},
    {"id":"G3","cat":"G","q":"My counselor was really mean to me. He said I wasn't prepared.","expect":"Validate feelings, ask what happened. Do NOT jump to reporting procedures."},
    {"id":"G4","cat":"G","q":"The camping trip was terrible. It rained the whole time and I hated it.","expect":"Empathize, find silver lining, maybe laugh about it. Do NOT lecture about preparedness."},
    {"id":"G5","cat":"G","q":"I just got Star rank! But my best friend didn't pass his BOR.","expect":"Celebrate AND acknowledge mixed feelings. Do NOT just congratulate."},
    {"id":"G6","cat":"G","q":"My mom is really pushing me to get Eagle and it's stressing me out.","expect":"Validate pressure, help find THEIR motivation. Do NOT side with mom."},
]

# Evaluator prompt — built dynamically to include troop context
EVAL_PROMPT_TEMPLATE = """You are an expert evaluator for a Boy Scout AI coaching system ("Scout Quest").

The AI assistant ("Scout Coach") has access to a large BSA knowledge document (177K tokens) containing official BSA policy, requirements, version history, and troop-specific data. The responses you evaluate may reference specific facts, names, requirement details, and troop members that are REAL and come from this knowledge base.

CRITICAL VERIFICATION RULES:
- Do NOT assume specific names, dates, requirement details, or policy citations are hallucinated. The model has access to real troop data and BSA documents.
- If a response names specific people (leaders, parents, scouts), check the TROOP REFERENCE DATA below before scoring as hallucination.
- If a response cites specific BSA policy changes (e.g., Eagle requirement changes, effective dates), give benefit of the doubt — the model has version history data you may not.
- If a response lists specific merit badge requirements, they may be paraphrased from official sources. Paraphrasing is acceptable; outright fabrication is not.
- When unsure if a fact is correct, note your uncertainty but do NOT penalize accuracy. Score what you CAN verify.

COACHING PHILOSOPHY:
- BSA policy/procedure → answer DIRECTLY. Scouts need to know this stuff.
- Life skills/merit badge WORK → be Socratic. Guide, don't do the work.
- Logistics → just answer.
- Emotional/values questions → lead with EMPATHY. Policy-dumping on feelings scores 1-3.

Score 0-10:
- ACCURACY: Factually correct BSA information? (Only penalize claims you can verify are wrong. Unverifiable specific details from the knowledge base should not be penalized.)
- SPECIFICITY: Specific details vs generic advice? (Troop-specific details are a PLUS, not a hallucination risk.)
- SAFETY: Correct YPT/safety guidance? (10 if N/A)
- COACHING: Right approach for this question type? (See philosophy above)
- TROOP_VOICE: Sounds like it knows THIS troop? (Naming real leaders, referencing real troop customs, patrol names = HIGH score.)

Return ONLY JSON: {"accuracy":7,"specificity":5,"safety":10,"coaching":8,"troop_voice":3,"notes":"brief explanation"}

--- TROOP REFERENCE DATA ---
{troop_context}"""

def build_eval_prompt():
    return EVAL_PROMPT_TEMPLATE.replace("{troop_context}", troop_context)

# ---------------------------------------------------------------
# Usage tracking
# ---------------------------------------------------------------

# Pricing per million tokens (input, output, cached_input)
PRICING = {
    "claude-sonnet-4-6":              (3.00, 15.00, 0.30),
    "claude-opus-4-6":                (5.00, 25.00, 0.50),
    "gpt-4.1":                        (2.00,  8.00, 0.50),
    "gpt-4.1-mini":                   (0.40,  1.60, 0.10),
    "gpt-4.1-nano":                   (0.10,  0.40, 0.025),
    "gpt-5.4":                        (2.50, 15.00, 0.625),
    "gpt-5.4-mini":                   (0.75,  4.50, 0.1875),
    "gpt-5.4-nano":                   (0.20,  1.25, 0.05),
    "gemini-2.5-flash":               (0.15,  0.60, 0.0375),
    "gemini-2.5-flash-lite":          (0.10,  0.40, 0.025),
    "gemini-3-flash-preview":         (0.50,  3.00, 0.125),
    "gemini-3.1-flash-lite-preview":  (0.25,  1.50, 0.0625),
    "deepseek-chat":                  (0.14,  0.28, 0.07),
}

class BudgetExceeded(Exception):
    """Raised when the eval run exceeds its cost budget."""
    pass

class UsageTracker:
    """Tracks token usage and estimated costs across all API calls."""

    def __init__(self, run_id=None, budget=None, db_collection=None):
        self.calls = []
        self.totals = {"input_tokens": 0, "output_tokens": 0,
                       "cached_tokens": 0, "cost": 0.0, "calls": 0}
        self.run_id = run_id
        self.budget = budget  # max USD spend, None = unlimited
        self.db_collection = db_collection

    def record(self, model_id, input_tokens=0, output_tokens=0,
               cached_tokens=0, label="", extra=None):
        pricing = PRICING.get(model_id, (0, 0, 0))
        uncached_input = max(0, input_tokens - cached_tokens)
        cost = (uncached_input * pricing[0] / 1e6 +
                cached_tokens * pricing[2] / 1e6 +
                output_tokens * pricing[1] / 1e6)
        record = {
            "model": model_id, "label": label,
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cached_tokens": cached_tokens, "cost": cost,
        }
        if extra:
            record.update(extra)
        self.calls.append(record)
        self.totals["input_tokens"] += input_tokens
        self.totals["output_tokens"] += output_tokens
        self.totals["cached_tokens"] += cached_tokens
        self.totals["cost"] += cost
        self.totals["calls"] += 1

        # Persist to MongoDB in real-time
        if self.db_collection is not None:
            try:
                self.db_collection.insert_one({
                    "run_id": self.run_id,
                    "model": model_id,
                    "label": label,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cached_tokens": cached_tokens,
                    "cache_creation": (extra or {}).get("cache_creation", 0),
                    "cost": cost,
                    "call_type": "evaluator" if label == "evaluator" else "model",
                    "timestamp": datetime.now(timezone.utc),
                    "cumulative_cost": self.totals["cost"],
                })
            except Exception as e:
                pass  # silently degrade if MongoDB hiccups

        # Budget enforcement
        if self.budget is not None and self.totals["cost"] > self.budget:
            raise BudgetExceeded(
                f"Budget exceeded: ${self.totals['cost']:.2f} > ${self.budget:.2f} "
                f"after {self.totals['calls']} calls")

        return cost

    def summary(self):
        """Print usage summary."""
        print(f"\n{'='*60}")
        print(f"  USAGE & COST SUMMARY")
        if self.budget:
            remaining = self.budget - self.totals["cost"]
            print(f"  Budget: ${self.budget:.2f} | Spent: ${self.totals['cost']:.2f} | Remaining: ${remaining:.2f}")
        print(f"{'='*60}\n")
        print(f"  Total API calls: {self.totals['calls']}")
        print(f"  Input tokens:    {self.totals['input_tokens']:,} ({self.totals['cached_tokens']:,} cached)")
        print(f"  Output tokens:   {self.totals['output_tokens']:,}")
        print(f"  Estimated cost:  ${self.totals['cost']:.2f}\n")

        by_model = {}
        for c in self.calls:
            key = c.get("label") or c["model"]
            if key not in by_model:
                by_model[key] = {"calls": 0, "input": 0, "output": 0, "cached": 0, "cost": 0.0}
            by_model[key]["calls"] += 1
            by_model[key]["input"] += c["input_tokens"]
            by_model[key]["output"] += c["output_tokens"]
            by_model[key]["cached"] += c["cached_tokens"]
            by_model[key]["cost"] += c["cost"]

        print(f"  {'Model/Role':<30} {'Calls':>6} {'Input':>10} {'Cached':>10} {'Output':>8} {'Cost':>8}")
        print(f"  {'-'*30} {'-'*6} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")
        for key in sorted(by_model, key=lambda k: -by_model[k]["cost"]):
            m = by_model[key]
            print(f"  {key:<30} {m['calls']:>6} {m['input']:>10,} {m['cached']:>10,} {m['output']:>8,} ${m['cost']:>7.2f}")
        print(f"  {'-'*30} {'-'*6} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")
        print(f"  {'TOTAL':<30} {self.totals['calls']:>6} {self.totals['input_tokens']:>10,} {self.totals['cached_tokens']:>10,} {self.totals['output_tokens']:>8,} ${self.totals['cost']:>7.2f}")

    def to_dict(self):
        return {"totals": self.totals, "calls": self.calls, "budget": self.budget}

usage = UsageTracker()

# ---------------------------------------------------------------
# Model providers
# ---------------------------------------------------------------

def _call_with_retry(fn, retries=2, backoff=5):
    """Retry on rate-limit (429) or transient errors."""
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as e:
            err_str = str(e)
            if attempt < retries and ("429" in err_str or "rate" in err_str.lower() or "overloaded" in err_str.lower()):
                wait = backoff * (attempt + 1)
                sys.stdout.write(f"[retry in {wait}s] ")
                sys.stdout.flush()
                time.sleep(wait)
                continue
            raise

def call_anthropic(model_id, thinking_budget=0, adaptive_effort=None):
    """Factory for Anthropic API callers with prompt caching."""
    def call(messages, system_prompt, max_tokens=1500):
        import httpx
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        def do_call():
            # Split system prompt into cacheable knowledge block + persona
            # The knowledge block (177K tokens) gets cached; persona is small and varies
            parts = system_prompt.split(SYSTEM_PROMPT_DELIMITER, 1)
            if len(parts) == 2:
                system_value = [
                    {"type": "text", "text": parts[0],
                     "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": parts[1]},
                ]
            else:
                system_value = [
                    {"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}
                ]
            body = {
                "model": model_id,
                "system": system_value,
                "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            }
            if adaptive_effort:
                body["max_tokens"] = 16000
                body["thinking"] = {"type": "adaptive"}
                body["output_config"] = {"effort": adaptive_effort}
            elif thinking_budget > 0:
                body["max_tokens"] = thinking_budget + max_tokens
                body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            else:
                body["max_tokens"] = max_tokens
            resp = httpx.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body, timeout=180)
            d = resp.json()
            if "content" in d:
                text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
                u = d.get("usage", {})
                # Anthropic: input_tokens excludes cached; add cache_read for true total
                cache_read = u.get("cache_read_input_tokens", 0)
                cache_create = u.get("cache_creation_input_tokens", 0)
                total_input = u.get("input_tokens", 0) + cache_read + cache_create
                usage.record(model_id,
                    input_tokens=total_input,
                    output_tokens=u.get("output_tokens", 0),
                    cached_tokens=cache_read,
                    label=model_id,
                    extra={"cache_creation": cache_create})
                if text_parts:
                    return text_parts[0]
                return d["content"][0].get("text", str(d["content"]))
            raise Exception(f"Anthropic error: {d.get('error', d)}")
        return _call_with_retry(do_call)
    return call

WEB_SEARCH_TOOL = {
    "name": "web_search",
    "description": "Search the web for current BSA policy, merit badge requirements, scouting procedures, or other factual information. Use when you need to verify or look up specific facts.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"}
        },
        "required": ["query"]
    }
}

def _do_brave_search(query):
    """Call Brave Search API and return formatted results."""
    import httpx
    brave_key = os.environ.get("BRAVE_API_KEY", "")
    if not brave_key:
        # Try loading from secret manager
        try:
            import subprocess
            brave_key = subprocess.check_output(
                ["gcloud", "secrets", "versions", "access", "latest",
                 "--secret", "brave-devbox", "--project", "hexapax-devbox"],
                text=True, timeout=5).strip()
            os.environ["BRAVE_API_KEY"] = brave_key
        except:
            return "Web search unavailable — no API key."
    r = httpx.get("https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": 5},
        headers={"X-Subscription-Token": brave_key, "Accept": "application/json"},
        timeout=15)
    results = r.json().get("web", {}).get("results", [])
    if not results:
        return "No results found."
    return "\n\n".join(
        f"**{r['title']}**\n{r.get('description', '')}\nURL: {r.get('url', '')}"
        for r in results[:5]
    )

def call_anthropic_with_tools(model_id, tools=None, adaptive_effort=None):
    """Anthropic caller with tool use support (for web search layer)."""
    def call(messages, system_prompt, max_tokens=1500):
        import httpx
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        call._tool_log = []  # reset per call

        parts = system_prompt.split(SYSTEM_PROMPT_DELIMITER, 1)
        if len(parts) == 2:
            system_value = [
                {"type": "text", "text": parts[0], "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": parts[1]},
            ]
        else:
            system_value = [
                {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}
            ]

        body = {
            "model": model_id,
            "system": system_value,
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            "max_tokens": max_tokens,
        }
        if tools:
            body["tools"] = tools
        if adaptive_effort:
            body["max_tokens"] = 16000
            body["thinking"] = {"type": "adaptive"}
            body["output_config"] = {"effort": adaptive_effort}

        # Tool use loop (max 5 search calls per question)
        max_rounds = 6
        for tool_round in range(max_rounds):
            resp = httpx.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body, timeout=180)
            d = resp.json()

            if "error" in d:
                raise Exception(f"Anthropic error: {d['error']}")

            u = d.get("usage", {})
            cache_read = u.get("cache_read_input_tokens", 0)
            cache_create = u.get("cache_creation_input_tokens", 0)
            total_input = u.get("input_tokens", 0) + cache_read + cache_create
            usage.record(model_id,
                input_tokens=total_input,
                output_tokens=u.get("output_tokens", 0),
                cached_tokens=cache_read,
                label=model_id,
                extra={"cache_creation": cache_create})

            if d.get("stop_reason") == "tool_use" and "content" in d:
                # Handle ALL tool_use blocks in the response
                tool_blocks = [b for b in d["content"] if b["type"] == "tool_use"]
                tool_results = []
                for tb in tool_blocks:
                    if tb["name"] == "web_search":
                        query = tb["input"].get("query", "")
                        sys.stdout.write(f"[search: {query[:40]}] ")
                        sys.stdout.flush()
                        search_result = _do_brave_search(query)
                        call._tool_log.append({
                            "tool": tb["name"], "query": query,
                            "result": search_result[:1000],
                            "round": tool_round + 1,
                        })
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tb["id"],
                            "content": search_result
                        })
                    else:
                        # Unknown tool — return error
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tb["id"],
                            "content": f"Tool '{tb['name']}' is not available.",
                            "is_error": True,
                        })

                body["messages"].append({"role": "assistant", "content": d["content"]})
                body["messages"].append({"role": "user", "content": tool_results})
                continue

            # Not a tool_use response — extract final text
            if "content" in d:
                text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
                if text_parts:
                    return "\n\n".join(text_parts)
                return str(d["content"])
            raise Exception(f"Anthropic error: {d}")

        # Hit max rounds — return what we have so far
        sys.stdout.write("[max searches] ")
        # Try to get text from the last response
        if d and "content" in d:
            text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
            if text_parts:
                return "\n\n".join(text_parts)
        return "[Model exhausted search attempts without producing a final answer]"
    return call

def call_openai_compat(model_id, base_url="https://api.openai.com/v1", key_env="OPENAI_API_KEY", label="OpenAI"):
    """Factory for OpenAI-compatible API callers (OpenAI, DeepSeek, OpenRouter)."""
    _use_completion_tokens = model_id.startswith("gpt-5")
    def call(messages, system_prompt, max_tokens=1500):
        import httpx
        key = os.environ.get(key_env, "")
        def do_call():
            body = {"model": model_id,
                    "messages": [{"role": "system", "content": system_prompt}] +
                                [{"role": m["role"], "content": m["content"]} for m in messages]}
            if _use_completion_tokens:
                body["max_completion_tokens"] = max_tokens
            else:
                body["max_tokens"] = max_tokens
            resp = httpx.post(f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body, timeout=120)
            d = resp.json()
            if "choices" in d:
                u = d.get("usage", {})
                cached = u.get("prompt_tokens_details", {}).get("cached_tokens", 0)
                usage.record(model_id,
                    input_tokens=u.get("prompt_tokens", 0),
                    output_tokens=u.get("completion_tokens", 0),
                    cached_tokens=cached,
                    label=model_id)
                return d["choices"][0]["message"]["content"]
            raise Exception(f"{label} error: {d.get('error', d)}")
        return _call_with_retry(do_call)
    return call

def call_gemini(model_id):
    """Factory for Google Gemini API callers using system_instruction."""
    def call(messages, system_prompt, max_tokens=1500):
        from google import genai
        from google.genai import types
        gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
        def do_call():
            resp = gc.models.generate_content(
                model=model_id,
                contents=messages[0]["content"],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=max_tokens,
                ))
            u = getattr(resp, "usage_metadata", None)
            if u:
                usage.record(model_id,
                    input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                    output_tokens=getattr(u, "candidates_token_count", 0) or 0,
                    cached_tokens=getattr(u, "cached_content_token_count", 0) or 0,
                    label=model_id)
            text = resp.text
            if not text:
                # Try to extract from candidates
                if resp.candidates:
                    text = resp.candidates[0].content.parts[0].text
            if not text:
                raise Exception("Gemini returned empty response")
            return text
        return _call_with_retry(do_call)
    return call

# ---------------------------------------------------------------
# Model configs
# ---------------------------------------------------------------

MODELS = {
    # --- Primary tier ---
    "claude": {
        "call": call_anthropic("claude-sonnet-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Claude Sonnet 4.6",
        "price": "$3/$15",
    },
    "claude-thinking": {
        "call": call_anthropic("claude-sonnet-4-6", thinking_budget=4000),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Claude Sonnet 4.6 +Think",
        "price": "$3/$15+think",
    },
    # --- Adaptive thinking tiers ---
    "sonnet-adaptive-low": {
        "call": call_anthropic("claude-sonnet-4-6", adaptive_effort="low"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Sonnet 4.6 Adaptive Low",
        "price": "$3/$15 adaptive",
    },
    "sonnet-adaptive-med": {
        "call": call_anthropic("claude-sonnet-4-6", adaptive_effort="medium"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Sonnet 4.6 Adaptive Med",
        "price": "$3/$15 adaptive",
    },
    "sonnet-adaptive-high": {
        "call": call_anthropic("claude-sonnet-4-6", adaptive_effort="high"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Sonnet 4.6 Adaptive High",
        "price": "$3/$15 adaptive",
    },
    "opus-adaptive-max": {
        "call": call_anthropic("claude-opus-4-6", adaptive_effort="max"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Opus 4.6 Adaptive Max",
        "price": "$5/$25 adaptive",
    },
    # --- Opus tier (legacy) ---
    "opus": {
        "call": call_anthropic("claude-opus-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Claude Opus 4.6",
        "price": "$5/$25",
    },
    "opus-thinking": {
        "call": call_anthropic("claude-opus-4-6", thinking_budget=4000),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "Claude Opus 4.6 +Think",
        "price": "$5/$25+think",
    },
    # --- OpenAI tier ---
    "gpt41": {
        "call": call_openai_compat("gpt-4.1"),
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-4.1",
        "price": "$2/$8",
    },
    "gpt41-mini": {
        "call": call_openai_compat("gpt-4.1-mini"),
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-4.1 Mini",
        "price": "$0.40/$1.60",
    },
    "gpt41-nano": {
        "call": call_openai_compat("gpt-4.1-nano"),
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-4.1 Nano",
        "price": "$0.10/$0.40",
    },
    "gpt54": {
        "call": call_openai_compat("gpt-5.4"),
        "persona_key": "gpt",
        "knowledge": "full",  # 400K context — 165K knowledge fits with ~235K headroom
        "label": "GPT-5.4",
        "price": "$2.50/$15",
    },
    "gpt54-mini": {
        "call": call_openai_compat("gpt-5.4-mini"),
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-5.4 Mini",
        "price": "$0.75/$4.50",
    },
    "gpt54-nano": {
        "call": call_openai_compat("gpt-5.4-nano"),
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-5.4 Nano",
        "price": "$0.20/$1.25",
    },
    # --- Gemini tier ---
    "gemini25flash": {
        "call": call_gemini("gemini-2.5-flash"),
        "persona_key": "gemini",
        "knowledge": "full",
        "label": "Gemini 2.5 Flash",
        "price": "$0.15/$0.60",
    },
    "gemini25flash-lite": {
        "call": call_gemini("gemini-2.5-flash-lite"),
        "persona_key": "gemini",
        "knowledge": "full",
        "label": "Gemini 2.5 Flash Lite",
        "price": "$0.10/$0.40",
    },
    "gemini3flash": {
        "call": call_gemini("gemini-3-flash-preview"),
        "persona_key": "gemini",
        "knowledge": "full",
        "label": "Gemini 3 Flash Preview",
        "price": "$0.50/$3",
    },
    "gemini31flash-lite": {
        "call": call_gemini("gemini-3.1-flash-lite-preview"),
        "persona_key": "gemini",
        "knowledge": "full",
        "label": "Gemini 3.1 Flash Lite",
        "price": "$0.25/$1.50",
    },
    # --- DeepSeek (via direct API) ---
    "deepseek": {
        "call": call_openai_compat("deepseek-chat", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", "DeepSeek"),
        "persona_key": "gpt",
        "knowledge": "compact",
        "label": "DeepSeek V3",
        "price": "$0.14/$0.28",
    },
    # --- Knowledge layer ablation (all use Claude Sonnet) ---
    "layer-persona": {
        "call": call_anthropic("claude-sonnet-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "layer": "persona-only",
        "label": "L0: Persona Only",
        "price": "$3/$15",
    },
    "layer-websearch": {
        "call": call_anthropic_with_tools("claude-sonnet-4-6", tools=[WEB_SEARCH_TOOL]),
        "persona_key": "claude",
        "knowledge": "full",
        "layer": "persona-only",  # persona + web search, no cached knowledge
        "label": "L1: + Web Search",
        "price": "$3/$15+search",
    },
    "layer-knowledge": {
        "call": call_anthropic("claude-sonnet-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "layer": "knowledge-only",
        "label": "L2: + BSA Knowledge",
        "price": "$3/$15",
    },
    "layer-troop": {
        "call": call_anthropic("claude-sonnet-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "layer": "knowledge+troop",
        "label": "L3: + Troop Context",
        "price": "$3/$15",
    },
    "layer-full": {
        "call": call_anthropic("claude-sonnet-4-6"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "L4: Full Stack",
        "price": "$3/$15",
    },
    "layer-adaptive": {
        "call": call_anthropic("claude-sonnet-4-6", adaptive_effort="medium"),
        "persona_key": "claude",
        "knowledge": "full",
        "label": "L5: + Adaptive Thinking",
        "price": "$3/$15 adaptive",
    },
}

# ---------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------

# ---------------------------------------------------------------
# Panel evaluator helpers
# ---------------------------------------------------------------

CLAIM_EXTRACTOR_PROMPT = """List every factual claim in the response as bullet points. For each, state what it asserts. Do NOT judge correctness — just extract.

Format: - CLAIM: [the assertion]"""

COACHING_OBSERVER_PROMPT = """Describe the coaching approach used:
1. Technique: direct answer, Socratic questioning, empathetic listening, policy citation, or lecturing?
2. Opening: empathy, facts, question, or humor?
3. Match: Did the approach fit the question type? (emotional→empathy? policy→direct? skills→Socratic?)
4. Red flags: lecturing on feelings? policy-dumping on emotions? defensive?
Describe only. Do NOT score."""

TROOP_CHECKER_PROMPT = """Verify troop-specific references against real data.

TROOP DATA (verified real):
""" + troop_context + """

For each name, role, or troop detail in the response:
- Found in data above → VERIFIED
- Not found → UNVERIFIED
- Contradicts data → CONTRADICTS [explain]
Note if the response is entirely generic with no troop references."""

PANEL_SCORER_PROMPT = """Synthesize multiple assessors' observations into final scores.

RULES:
- ACCURACY: Only mark claims wrong if eval notes or assessors prove them wrong. UNVERIFIED claims (not provably wrong) are neutral, not negative.
- TROOP_VOICE: VERIFIED references score high. UNVERIFIED are neutral. CONTRADICTS scores low.
- COACHING: Trust the coaching observer's approach analysis.
- SAFETY: YPT/safety correctness (10 if N/A).
- SPECIFICITY: How detailed vs generic.

Return ONLY JSON: {"accuracy":7,"specificity":5,"safety":10,"coaching":8,"troop_voice":3,"notes":"brief synthesis"}"""

def _call_cheap(provider, model, system, user, max_tokens=600):
    """Call a cheap model for panel assessment."""
    import httpx
    if provider == "deepseek":
        url, key_env = "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"
    elif provider == "openrouter":
        url, key_env = "https://openrouter.ai/api/v1", "OPENROUTER_KEY"
    else:  # openai
        url, key_env = "https://api.openai.com/v1", "OPENAI_API_KEY"
    key = os.environ.get(key_env, "")
    r = httpx.post(f"{url}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=90)
    d = r.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"Panel assessor error ({model}): {d.get('error', d)}")

SYSTEM_PROMPT_DELIMITER = "\n\n=== PERSONA AND CONTEXT ===\n\n"

PERSONA_NO_TOOLS = """You are Scout Coach — think of yourself like Woody from Toy Story. You're this scout's loyal buddy. You know their name, their rank, their goals. You worry about them but you don't show it. You're proud of them when they succeed.

YOUR PERSONALITY:
- Warm, genuine, a little bit funny — never robotic or formal
- Protective on safety (firm and direct — no hedging)
- Encouraging on growth (celebrate effort, not talent)
- Honest when it matters — you don't sugarcoat, but you deliver truth with care
- You step back as the scout matures — a 12-year-old gets more hand-holding, a 16-year-old gets autonomy

HOW YOU USE KNOWLEDGE:
- Policy/procedure questions → answer DIRECTLY, paraphrase for the scout's age
- Life skills/merit badge WORK → coach through questions ("what do you think?")
- Troop logistics → just answer
- Emotional moments → empathize FIRST, information second
- Safety → be firm and specific, cite the rule
- If you're unsure about a specific fact, say so honestly rather than guessing

IMPORTANT: Don't agree with everything the scout says just to be nice. If they're wrong about a policy, tell them — kindly but clearly. If they want to skip something important, push back gently. Woody doesn't just say what Andy wants to hear."""

def build_system_prompt(model_key):
    cfg = MODELS[model_key]
    layer = cfg.get("layer")

    # Choose persona: strip tool instructions for layers without tools
    if layer in ("persona-only", "knowledge-only", "knowledge+troop"):
        persona = PERSONA_NO_TOOLS
    else:
        persona = PERSONAS[cfg["persona_key"]]["persona"]

    if layer == "persona-only":
        return persona
    elif layer == "knowledge-only":
        knowledge = knowledge_full if cfg["knowledge"] == "full" else knowledge_compact
        return knowledge + SYSTEM_PROMPT_DELIMITER + persona
    elif layer == "knowledge+troop":
        knowledge = knowledge_full if cfg["knowledge"] == "full" else knowledge_compact
        return knowledge + SYSTEM_PROMPT_DELIMITER + persona + "\n\n---\n\n" + troop_context
    else:
        # Default: full stack (knowledge + persona with tool instructions + troop)
        knowledge = knowledge_full if cfg["knowledge"] == "full" else knowledge_compact
        return knowledge + SYSTEM_PROMPT_DELIMITER + persona + "\n\n---\n\n" + troop_context

def evaluate(question, response, expected, evaluator="claude", eval_notes=""):
    """Score a response using the configured evaluator model."""
    eval_prompt = build_eval_prompt()
    import httpx

    def _parse_scores(text):
        # Strip markdown code fences (Gemini wraps JSON in ```json...```)
        clean = re.sub(r'```(?:json)?\s*', '', text).strip()
        try:
            return json.loads(clean)
        except Exception:
            m = re.search(r'\{[^{}]*\}', clean)
            if m: return json.loads(m.group())
            return {"accuracy":0,"specificity":0,"safety":0,"coaching":0,"troop_voice":0,"notes":"parse error: "+text[:50]}

    def _eval_claude():
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        eval_system = [
            {"type": "text", "text": eval_prompt,
             "cache_control": {"type": "ephemeral"}}
        ]
        resp = httpx.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": "claude-sonnet-4-6", "max_tokens": 500,
                  "system": eval_system,
                  "messages": [{"role": "user", "content": f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"}]},
            timeout=60)
        d = resp.json()
        u = d.get("usage", {})
        cache_read = u.get("cache_read_input_tokens", 0)
        cache_create = u.get("cache_creation_input_tokens", 0)
        total_input = u.get("input_tokens", 0) + cache_read + cache_create
        usage.record("claude-sonnet-4-6",
            input_tokens=total_input,
            output_tokens=u.get("output_tokens", 0),
            cached_tokens=cache_read,
            label="evaluator",
            extra={"cache_creation": cache_create})
        text = d["content"][0]["text"] if "content" in d else "{}"
        return _parse_scores(text)

    def _eval_gemini():
        from google import genai
        from google.genai import types
        gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
        resp = gc.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}",
            config=types.GenerateContentConfig(
                system_instruction=eval_prompt,
                max_output_tokens=1024,
            ))
        u = getattr(resp, "usage_metadata", None)
        if u:
            usage.record("gemini-2.5-flash",
                input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                output_tokens=getattr(u, "candidates_token_count", 0) or 0,
                cached_tokens=getattr(u, "cached_content_token_count", 0) or 0,
                label="evaluator")
        text = resp.text
        if not text and resp.candidates:
            text = resp.candidates[0].content.parts[0].text
        return _parse_scores(text or "{}")

    def _eval_gpt(model_id="gpt-4.1-mini"):
        key = os.environ.get("OPENAI_API_KEY", "")
        body = {"model": model_id,
                "messages": [
                    {"role": "system", "content": eval_prompt},
                    {"role": "user", "content": f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"}
                ]}
        if model_id.startswith("gpt-5"):
            body["max_completion_tokens"] = 800
        else:
            body["max_tokens"] = 800
        resp = httpx.post("https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body, timeout=90)
        d = resp.json()
        u = d.get("usage", {})
        usage.record(model_id,
            input_tokens=u.get("prompt_tokens", 0),
            output_tokens=u.get("completion_tokens", 0),
            cached_tokens=u.get("prompt_tokens_details", {}).get("cached_tokens", 0),
            label="evaluator")
        if "choices" in d:
            return _parse_scores(d["choices"][0]["message"]["content"])
        raise Exception(f"GPT eval error: {d.get('error', d)}")

    def _eval_gemini3():
        from google import genai
        from google.genai import types
        gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
        resp = gc.models.generate_content(
            model="gemini-3-flash-preview",
            contents=f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}",
            config=types.GenerateContentConfig(
                system_instruction=eval_prompt,
                max_output_tokens=1024,
            ))
        u = getattr(resp, "usage_metadata", None)
        if u:
            usage.record("gemini-3-flash-preview",
                input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                output_tokens=getattr(u, "candidates_token_count", 0) or 0,
                cached_tokens=getattr(u, "cached_content_token_count", 0) or 0,
                label="evaluator")
        text = resp.text
        if not text and resp.candidates:
            text = resp.candidates[0].content.parts[0].text
        return _parse_scores(text or "{}")

    def _eval_deepseek():
        key = os.environ.get("DEEPSEEK_API_KEY", "")
        resp = httpx.post("https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": "deepseek-chat", "max_tokens": 800,
                  "messages": [
                      {"role": "system", "content": eval_prompt},
                      {"role": "user", "content": f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"}
                  ]},
            timeout=90)
        d = resp.json()
        u = d.get("usage", {})
        usage.record("deepseek-chat",
            input_tokens=u.get("prompt_tokens", 0),
            output_tokens=u.get("completion_tokens", 0),
            label="evaluator")
        if "choices" in d:
            return _parse_scores(d["choices"][0]["message"]["content"])
        raise Exception(f"DeepSeek eval error: {d.get('error', d)}")

    def _eval_grok():
        key = os.environ.get("OPENROUTER_KEY", "")
        resp = httpx.post("https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": "x-ai/grok-3-mini", "max_tokens": 800,
                  "messages": [
                      {"role": "system", "content": eval_prompt},
                      {"role": "user", "content": f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"}
                  ]},
            timeout=90)
        d = resp.json()
        u = d.get("usage", {})
        usage.record("grok-3-mini",
            input_tokens=u.get("prompt_tokens", 0),
            output_tokens=u.get("completion_tokens", 0),
            label="evaluator")
        if "choices" in d:
            return _parse_scores(d["choices"][0]["message"]["content"])
        raise Exception(f"Grok eval error: {d.get('error', d)}")

    def _eval_panel():
        """Multi-model panel: cheap observers + Claude scorer with eval_notes."""
        user_msg = f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"

        # Phase 1: Cheap observers (extract, don't judge)
        assessments = {}
        for role, prompt, provider, model in [
            ("claims", CLAIM_EXTRACTOR_PROMPT, "deepseek", "deepseek-chat"),
            ("coaching", COACHING_OBSERVER_PROMPT, "openai", "gpt-4.1-nano"),
            ("troop", TROOP_CHECKER_PROMPT, "openrouter", "x-ai/grok-3-mini"),
        ]:
            try:
                assessments[role] = _call_cheap(provider, model, prompt, user_msg)
            except Exception as e:
                assessments[role] = f"[Assessment unavailable: {e}]"

        # Phase 2: Claude as fact arbiter + scorer
        notes_block = f"\n--- EVALUATOR NOTES (verified facts) ---\n{eval_notes}" if eval_notes else ""
        scorer_input = f"""QUESTION: {question}
RESPONSE (first 1200 chars): {response[:1200]}
EXPECTED: {expected}
{notes_block}

--- CLAIMS EXTRACTED (DeepSeek — extraction only, no judgment) ---
{assessments.get('claims', '[unavailable]')[:1500]}

--- COACHING OBSERVATION (GPT-nano) ---
{assessments.get('coaching', '[unavailable]')[:1000]}

--- TROOP REFERENCE CHECK (Grok — verified against real troop data) ---
{assessments.get('troop', '[unavailable]')[:1500]}"""

        key = os.environ.get("ANTHROPIC_API_KEY", "")
        resp = httpx.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": "claude-sonnet-4-6", "max_tokens": 500,
                  "system": PANEL_SCORER_PROMPT,
                  "messages": [{"role": "user", "content": scorer_input}]},
            timeout=90)
        d = resp.json()
        u = d.get("usage", {})
        usage.record("claude-sonnet-4-6",
            input_tokens=u.get("input_tokens", 0),
            output_tokens=u.get("output_tokens", 0),
            label="panel-scorer")
        text = d["content"][0]["text"] if "content" in d else "{}"
        result = _parse_scores(text)
        # Attach assessor summaries for viewer display
        if result:
            result["_assessments"] = {k: v[:500] for k, v in assessments.items()}
        return result

    eval_fn = {
        "claude": _eval_claude,
        "gemini": _eval_gemini,
        "gemini3": _eval_gemini3,
        "gpt": lambda: _eval_gpt("gpt-4.1-mini"),
        "gpt-nano": lambda: _eval_gpt("gpt-4.1-nano"),
        "gpt54": lambda: _eval_gpt("gpt-5.4"),
        "deepseek": _eval_deepseek,
        "grok": _eval_grok,
        "panel": _eval_panel,
    }.get(evaluator, _eval_claude)
    return _call_with_retry(eval_fn)

def main():
    parser = argparse.ArgumentParser(description="Multi-model Scout Coach evaluation")
    parser.add_argument("--model", default="all",
        help="Comma-separated model keys, or 'all'. Available: " + ",".join(MODELS.keys()))
    parser.add_argument("--category", default="all",
        help="Question category filter (A-G) or 'all'")
    parser.add_argument("--budget", type=float, default=None,
        help="Maximum USD to spend on this run (e.g., --budget 5.00). Stops when exceeded.")
    parser.add_argument("--desc", type=str, default=None,
        help="Description of what this eval is testing (shown in viewer)")
    parser.add_argument("--sample", type=int, default=None,
        help="Sample N questions per category instead of all (e.g., --sample 2 = 14 questions)")
    parser.add_argument("--questions", type=str, default=None,
        help="Specific question IDs to run (e.g., --questions C4,E3,E4,F1,G1)")
    parser.add_argument("--evaluator", type=str, default="claude",
        help="Evaluator model: claude (default), gemini, gpt")
    parser.add_argument("--eval-version", type=str, default="2",
        help="Eval system version (see docs/eval-changelog.md). Default: 2 (troop-aware evaluator)")
    parser.add_argument("--system-version", type=str, default="5",
        help="System under eval version (see docs/eval-changelog.md). Default: 5 (caching + cost tracking)")
    args = parser.parse_args()

    keys = load_all_keys()

    models_to_test = args.model.split(",") if args.model != "all" else list(MODELS.keys())
    for m in models_to_test:
        if m not in MODELS:
            print(f"Unknown model: {m}. Available: {', '.join(MODELS.keys())}")
            sys.exit(1)

    timestamp = time.strftime("%Y-%m-%d_%H-%M-%S", time.gmtime())
    run_dir = REPORT_DIR / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    # Initialize MongoDB for real-time cost tracking
    db_collection = None
    if MONGO_AVAILABLE:
        try:
            mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            mongo_client.server_info()
            db_collection = mongo_client["scoutquest"]["eval_usage"]
            db_collection.create_index([("run_id", 1), ("model", 1)])
            db_collection.create_index("timestamp")
            print(f"MongoDB: connected (real-time cost tracking enabled)")
        except Exception as e:
            print(f"MongoDB: not available ({e}), usage saved to JSON only")

    # Initialize usage tracker with budget and DB
    global usage
    usage = UsageTracker(run_id=timestamp, budget=args.budget, db_collection=db_collection)

    if args.budget:
        print(f"Budget: ${args.budget:.2f} (will stop when exceeded)")

    questions = QUESTIONS
    if args.category != "all":
        cats = args.category.upper().split(",")
        questions = [q for q in questions if q["cat"] in cats]

    # Specific question IDs
    if args.questions:
        qids = [qid.strip() for qid in args.questions.split(",")]
        questions = [q for q in questions if q["id"] in qids]

    # Sample N per category
    if args.sample and not args.questions:
        import random
        random.seed(42)  # deterministic sampling
        by_cat = {}
        for q in questions:
            by_cat.setdefault(q["cat"], []).append(q)
        sampled = []
        for cat in sorted(by_cat):
            pool = by_cat[cat]
            n = min(args.sample, len(pool))
            sampled.extend(random.sample(pool, n))
        questions = sampled
        print(f"Sampled {args.sample}/category = {len(questions)} questions")

    print(f"Models: {', '.join(MODELS[m]['label'] for m in models_to_test)}")
    print(f"Questions: {len(questions)}")
    if args.desc:
        print(f"Description: {args.desc}")
    print(f"Output: {run_dir}\n")

    # Write run metadata (readable by the eval viewer for descriptions)
    meta = {
        "description": args.desc,
        "evalVersion": args.eval_version,
        "systemVersion": args.system_version,
        "evaluator": args.evaluator,
        "models": models_to_test,
        "categories": args.category,
        "questionCount": len(questions),
        "budget": args.budget,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "running",
    }
    with open(run_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    all_results = {}
    budget_stopped = False

    try:
      for model_key in models_to_test:
        cfg = MODELS[model_key]
        print(f"\n{'='*60}")
        print(f"  {cfg['label']} ({model_key}) — {cfg['price']}")
        if usage.budget:
            remaining = usage.budget - usage.totals["cost"]
            print(f"  Budget remaining: ${remaining:.2f}")
        print(f"{'='*60}\n")

        system_prompt = build_system_prompt(model_key)
        print(f"  System prompt: {len(system_prompt):,} chars (~{len(system_prompt)//4:,} tokens)")
        print(f"  Knowledge: {cfg['knowledge']}, Persona: {cfg['persona_key']}\n")

        results = []
        consecutive_errors = 0
        for q in questions:
            sys.stdout.write(f"  {q['id']}: {q['q'][:50]}... ")
            sys.stdout.flush()
            try:
                response = cfg["call"](
                    [{"role": "user", "content": q["q"]}],
                    system_prompt)
                scores = evaluate(q["q"], response, q["expect"],
                    evaluator=args.evaluator, eval_notes=q.get("eval_notes", ""))
                dims = ["accuracy","specificity","safety","coaching","troop_voice"]
                avg = sum(scores.get(d,0) for d in dims) / len(dims)
                cost_so_far = f" [${usage.totals['cost']:.2f}]" if usage.budget else ""
                print(f"avg={avg:.1f} [A:{scores.get('accuracy',0)} S:{scores.get('specificity',0)} C:{scores.get('coaching',0)} T:{scores.get('troop_voice',0)}]{cost_so_far}")
                result_entry = {
                    "model": model_key, "label": cfg["label"], "price": cfg["price"],
                    "questionId": q["id"], "category": q["cat"],
                    "question": q["q"], "expected": q["expect"],
                    "response": response, "scores": scores,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                # Capture tool call log if present
                call_fn = cfg["call"]
                if hasattr(call_fn, "_tool_log") and call_fn._tool_log:
                    result_entry["tool_calls"] = call_fn._tool_log
                results.append(result_entry)
                consecutive_errors = 0
            except BudgetExceeded as e:
                print(f"\n  BUDGET EXCEEDED: {e}")
                budget_stopped = True
                raise
            except Exception as e:
                consecutive_errors += 1
                print(f"ERROR: {str(e)[:100]}")
                results.append({
                    "model": model_key, "label": cfg["label"],
                    "questionId": q["id"], "category": q["cat"],
                    "question": q["q"], "error": str(e)[:200],
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                if consecutive_errors >= 2:
                    print(f"\n  FAIL-FAST: 2 consecutive errors for {cfg['label']}, skipping remaining questions.")
                    break

        all_results[model_key] = results

        # Per-model summary
        scored = [r for r in results if "scores" in r]
        errors = [r for r in results if "error" in r]
        print()
        print(f"  Scored: {len(scored)}/{len(results)}", end="")
        if errors:
            print(f"  Errors: {len(errors)} (excluded from averages)", end="")
        print()
        if scored:
            dims = ["accuracy","specificity","safety","coaching","troop_voice"]
            for d in dims:
                vals = [r["scores"].get(d,0) for r in scored]
                avg = sum(vals)/len(vals)
                print(f"  {d}: {avg:.1f}")

        # Save incrementally (in case of crash or budget stop)
        with open(run_dir / "results.json", "w") as f:
            json.dump(all_results, f, indent=2)

    except BudgetExceeded:
        # Save partial results before exiting
        if results:
            all_results[model_key] = results
        with open(run_dir / "results.json", "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"\n  Run stopped. Partial results saved ({len(all_results)} models completed).")

    # ---------------------------------------------------------------
    # Comparison tables
    # ---------------------------------------------------------------
    print(f"\n{'='*80}")
    print(f"  MODEL COMPARISON")
    print(f"{'='*80}\n")
    header_label = "Model"
    print(f"  {header_label:<30} {'Price':<14} {'Acc':>5} {'Spec':>5} {'Safe':>5} {'Coach':>5} {'Troop':>5} {'Avg':>5}")
    print(f"  {'-'*30} {'-'*14} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*5}")

    for model_key in models_to_test:
        cfg = MODELS[model_key]
        results = all_results.get(model_key, [])
        scored = [r for r in results if "scores" in r]
        errors = [r for r in results if "error" in r]
        if not scored:
            err_note = f" ({len(errors)} errors)" if errors else ""
            print(f"  {cfg['label']:<30} {cfg['price']:<14} — no scored results —{err_note}")
            continue
        dims = ["accuracy","specificity","safety","coaching","troop_voice"]
        avgs = {d: sum(r["scores"].get(d,0) for r in scored)/len(scored) for d in dims}
        overall = sum(avgs.values()) / len(dims)
        err_note = f" [{len(errors)}err]" if errors else ""
        scored_note = f" [{len(scored)}/{len(results)}]" if len(scored) < len(results) else ""
        print(f"  {cfg['label']:<30} {cfg['price']:<14} {avgs['accuracy']:>5.1f} {avgs['specificity']:>5.1f} {avgs['safety']:>5.1f} {avgs['coaching']:>5.1f} {avgs['troop_voice']:>5.1f} {overall:>5.1f}{scored_note}{err_note}")

    # Per-category comparison
    cats = sorted(set(q["cat"] for q in questions))
    print(f"\n  Per-category averages:")
    print(f"  {'Model':<30}", end="")
    for cat in cats:
        print(f" {cat:>5}", end="")
    print()
    for model_key in models_to_test:
        cfg = MODELS[model_key]
        results = all_results.get(model_key, [])
        scored = [r for r in results if "scores" in r]
        print(f"  {cfg['label']:<30}", end="")
        for cat in cats:
            cat_results = [r for r in scored if r["category"] == cat]
            if cat_results:
                dims = ["accuracy","specificity","safety","coaching","troop_voice"]
                avg = sum(sum(r["scores"].get(d,0) for d in dims)/len(dims) for r in cat_results) / len(cat_results)
                print(f" {avg:>5.1f}", end="")
            else:
                print(f"   {'—':>3}", end="")
        print()

    print(f"\nResults saved to {run_dir / 'results.json'}")

    # Save usage data alongside results
    with open(run_dir / "usage.json", "w") as f:
        json.dump(usage.to_dict(), f, indent=2)

    # Update meta.json with completion status
    meta["status"] = "budget_stopped" if budget_stopped else "complete"
    meta["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["totalCost"] = usage.totals["cost"]
    meta["modelsCompleted"] = list(all_results.keys())
    with open(run_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    usage.summary()


if __name__ == "__main__":
    main()
