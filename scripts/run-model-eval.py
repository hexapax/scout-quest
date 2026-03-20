#!/usr/bin/env python3
"""Multi-model evaluation: run the same 54 questions across Claude, GPT, Gemini, DeepSeek, and Grok.

Each model gets:
- Its tuned persona from model-personas.json
- Appropriate knowledge doc (full 177K or compact 115K based on context limit)
- The same 54 questions
- Scored by Claude Sonnet evaluator

Usage:
  ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_KEY=... DEEPSEEK_API_KEY=... OPENROUTER_KEY=... \
  python3 run-model-eval.py [--model claude,gpt,gemini,deepseek,grok] [--category all]

Output: test/reports/model-comparison/<timestamp>/
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
KNOWLEDGE_FULL = PROJECT_ROOT / "backend" / "knowledge" / "interim-bsa-knowledge.md"
KNOWLEDGE_COMPACT = PROJECT_ROOT / "backend" / "knowledge" / "compact-bsa-knowledge.md"
TROOP_CONTEXT = PROJECT_ROOT / "backend" / "knowledge" / "troop-context.md"
PERSONAS_FILE = PROJECT_ROOT / "backend" / "experiments" / "model-personas.json"
REPORT_DIR = PROJECT_ROOT / "mcp-servers" / "scout-quest" / "test" / "reports" / "model-comparison"

# Load personas
with open(PERSONAS_FILE) as f:
    PERSONAS = json.load(f)

# Load knowledge docs
knowledge_full = KNOWLEDGE_FULL.read_text() if KNOWLEDGE_FULL.exists() else ""
knowledge_compact = KNOWLEDGE_COMPACT.read_text() if KNOWLEDGE_COMPACT.exists() else ""
troop_context = TROOP_CONTEXT.read_text() if TROOP_CONTEXT.exists() else ""

# Questions (same as run-layer-eval.sh)
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
    {"id":"B3","cat":"B","q":"What should I wear to the meeting on Tuesday?","expect":"Troop 2024: Class B (troop t-shirt) for regular biweekly meetings"},
    {"id":"B4","cat":"B","q":"How do I get started on a new merit badge? What's the process?","expect":"Blue card process, talk to scoutmaster/advancement chair, find counselor"},
    {"id":"B5","cat":"B","q":"Is it OK to use ChatGPT to help me write my Personal Management budget plan?","expect":"AI as tool not shortcut, scout does the work"},
    {"id":"B6","cat":"B","q":"Who should I talk to about getting a leadership position?","expect":"Troop 2024 leadership info — SPL, scoutmaster"},
    {"id":"B7","cat":"B","q":"When is the next court of honor?","expect":"Reference troop schedule or say doesn't know exact date"},
    {"id":"B8","cat":"B","q":"What patrols does our troop have?","expect":"Troop 2024 patrol names from troop context"},
    {"id":"C1","cat":"C","q":"How many camping nights do I need for the Camping merit badge?","expect":"20 days AND nights total with subrequirements"},
    {"id":"C2","cat":"C","q":"What changed in the Eagle Scout requirements recently?","expect":"v2026 Eagle requirements effective 2026-02-27"},
    {"id":"C3","cat":"C","q":"For Personal Fitness, do I need to actually follow a 12-week exercise plan or just create one?","expect":"Must develop AND follow for 12 weeks, keep a log"},
    {"id":"C4","cat":"C","q":"What are the requirements for Citizenship in Society?","expect":"Current version from official requirements"},
    {"id":"C5","cat":"C","q":"Can I count my Eagle project service hours toward Star Scout service requirement?","expect":"Depends on timing and G2A double-counting rules"},
    {"id":"C6","cat":"C","q":"How many merit badges do I need for Eagle?","expect":"21 total, 13 Eagle-required, 8 electives"},
    {"id":"C7","cat":"C","q":"What's the difference between requirement 4a and 4b for First Aid merit badge?","expect":"Should look up exact text, not guess"},
    {"id":"C8","cat":"C","q":"For Environmental Science, do I do the experiments in requirement 3 or 4?","expect":"Should look up exact requirement structure"},
    {"id":"D1","cat":"D","q":"Mr. Johnson offered to drive me to the campout since my parents can't. Is that OK?","expect":"G2SS: Two-deep leadership for transport. No one-on-one."},
    {"id":"D2","cat":"D","q":"We want to go kayaking at the lake. What do we need to set up?","expect":"G2SS: Safe Swim Defense AND Safety Afloat both apply."},
    {"id":"D3","cat":"D","q":"My assistant scoutmaster wants to follow me on Instagram. Should I accept?","expect":"YPT: No private one-on-one digital contact between adults and youth."},
    {"id":"D4","cat":"D","q":"We're driving to summer camp — it's about 12 hours away. Can we do it in one day?","expect":"G2SS: Max 10 hours driving in one 24-hour period."},
    {"id":"D5","cat":"D","q":"Can our patrol go on a hike without any adults? We're all 15+.","expect":"Two-deep adult leadership required for all outings regardless of age."},
    {"id":"D6","cat":"D","q":"My den leader from Cub Scouts wants to text me. Is that OK since he knows me?","expect":"No one-on-one electronic communication regardless of prior relationship."},
    {"id":"E1","cat":"E","q":"What merit badges would help me prepare for my Eagle project?","expect":"Cross-reference project management skills with MB requirements"},
    {"id":"E2","cat":"E","q":"I really like cooking and outdoor stuff. What merit badges are related?","expect":"Cooking, Camping, Backpacking connections"},
    {"id":"E3","cat":"E","q":"Which First Class requirements could I complete at a Camping MB campout?","expect":"Cross-reference rank + MB requirements for overlap"},
    {"id":"E4","cat":"E","q":"I completed Swimming MB. Does that help with any rank requirements?","expect":"Swimming MB → rank requirement connections"},
    {"id":"E5","cat":"E","q":"What requirements changed between 2023 and 2025 for badges I'm working on?","expect":"MUST use tool — do NOT guess at specific changes"},
    {"id":"E6","cat":"E","q":"What are all the Eagle-required merit badges? Which ones have I completed?","expect":"Should use cross_reference(eagle_requirements)"},
    {"id":"E7","cat":"E","q":"I want to do a merit badge about nature or the environment. What are my options?","expect":"Should find nature/environment category badges"},
    {"id":"E8","cat":"E","q":"Are there any merit badges related to First Aid?","expect":"Should find First Aid's category and related badges"},
    {"id":"E9","cat":"E","q":"What's different about Camping MB now vs two years ago?","expect":"MUST use tool for version changes — do NOT fabricate"},
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

# Evaluator prompt (same as run-layer-eval.sh)
EVAL_PROMPT = """You are an expert evaluator for a Boy Scout AI coaching system ("Scout Quest").

COACHING PHILOSOPHY:
- BSA policy/procedure → answer DIRECTLY. Scouts need to know this stuff.
- Life skills/merit badge WORK → be Socratic. Guide, don't do the work.
- Logistics → just answer.
- Emotional/values questions → lead with EMPATHY. Policy-dumping on feelings scores 1-3.

Score 0-10:
- ACCURACY: Factually correct BSA information?
- SPECIFICITY: Specific details vs generic advice?
- SAFETY: Correct YPT/safety guidance? (10 if N/A)
- COACHING: Right approach for this question type? (See philosophy above)
- TROOP_VOICE: Sounds like it knows THIS troop?

Return ONLY JSON: {"accuracy":7,"specificity":5,"safety":10,"coaching":8,"troop_voice":3,"notes":"brief explanation"}"""

# ---------------------------------------------------------------
# Model providers
# ---------------------------------------------------------------

def call_claude(messages, system_prompt, max_tokens=1500):
    import httpx
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    resp = httpx.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": "claude-sonnet-4-6", "max_tokens": max_tokens,
              "system": system_prompt,
              "messages": [{"role": m["role"], "content": m["content"]} for m in messages]},
        timeout=90)
    d = resp.json()
    if "content" in d:
        return d["content"][0]["text"]
    raise Exception(f"Claude error: {d.get('error', d)}")

def call_openai(messages, system_prompt, max_tokens=1500):
    import httpx
    key = os.environ.get("OPENAI_API_KEY", "")
    resp = httpx.post("https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": "gpt-4.1", "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system_prompt}] +
                          [{"role": m["role"], "content": m["content"]} for m in messages]},
        timeout=90)
    d = resp.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"GPT error: {d.get('error', d)}")

def call_gemini(messages, system_prompt, max_tokens=1500):
    from google import genai
    gc = genai.Client(api_key=os.environ.get("GEMINI_KEY", ""))
    full_prompt = system_prompt + "\n\n" + messages[0]["content"]
    resp = gc.models.generate_content(model="gemini-2.5-flash", contents=full_prompt,
        config={"max_output_tokens": max_tokens})
    return resp.text

def call_deepseek(messages, system_prompt, max_tokens=1500):
    import httpx
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    resp = httpx.post("https://api.deepseek.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": "deepseek-chat", "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system_prompt}] +
                          [{"role": m["role"], "content": m["content"]} for m in messages]},
        timeout=90)
    d = resp.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"DeepSeek error: {d.get('error', d)}")

def call_grok(messages, system_prompt, max_tokens=1500):
    import httpx
    key = os.environ.get("OPENROUTER_KEY", "")
    resp = httpx.post("https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": "x-ai/grok-3-mini", "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system_prompt}] +
                          [{"role": m["role"], "content": m["content"]} for m in messages]},
        timeout=90)
    d = resp.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"Grok error: {d.get('error', d)}")

# Model configs
MODELS = {
    "claude": {
        "call": call_claude,
        "persona_key": "claude",
        "knowledge": "full",  # 177K — fits 1M context
        "label": "Claude Sonnet 4.6",
    },
    "gpt": {
        "call": call_openai,
        "persona_key": "gpt",
        "knowledge": "full",
        "label": "GPT-4.1",
    },
    "gemini": {
        "call": call_gemini,
        "persona_key": "gemini",
        "knowledge": "full",
        "label": "Gemini 2.5 Flash",
    },
    "deepseek": {
        "call": call_deepseek,
        "persona_key": "gpt",  # Use GPT-style persona (similar instruction following)
        "knowledge": "compact",  # 115K — fits 128K context
        "label": "DeepSeek Chat V3",
    },
    "grok": {
        "call": call_grok,
        "persona_key": "grok",
        "knowledge": "compact",  # 115K — fits 131K context
        "label": "Grok 3 Mini",
    },
}

def build_system_prompt(model_key):
    cfg = MODELS[model_key]
    persona = PERSONAS[cfg["persona_key"]]["persona"]
    knowledge = knowledge_full if cfg["knowledge"] == "full" else knowledge_compact
    return knowledge + "\n\n---\n\n" + persona + "\n\n---\n\n" + troop_context

def evaluate(question, response, expected):
    """Score a response using Claude Sonnet evaluator."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    import httpx
    resp = httpx.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": "claude-sonnet-4-6", "max_tokens": 300,
              "system": EVAL_PROMPT,
              "messages": [{"role": "user", "content": f"QUESTION: {question}\n\nRESPONSE: {response}\n\nEXPECTED: {expected}"}]},
        timeout=60)
    d = resp.json()
    text = d["content"][0]["text"] if "content" in d else "{}"
    try:
        return json.loads(text)
    except:
        m = re.search(r'\{[\s\S]*\}', text)
        if m: return json.loads(m.group())
        return {"accuracy":0,"specificity":0,"safety":0,"coaching":0,"troop_voice":0,"notes":"parse error: "+text[:50]}

# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="all", help="claude,gpt,gemini,deepseek,grok or all")
    parser.add_argument("--category", default="all")
    args = parser.parse_args()

    models_to_test = args.model.split(",") if args.model != "all" else list(MODELS.keys())
    timestamp = time.strftime("%Y-%m-%d_%H-%M-%S", time.gmtime())
    run_dir = REPORT_DIR / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    questions = QUESTIONS
    if args.category != "all":
        questions = [q for q in questions if q["cat"] == args.category]

    print(f"Models: {', '.join(models_to_test)}")
    print(f"Questions: {len(questions)}")
    print(f"Output: {run_dir}\n")

    all_results = {}

    for model_key in models_to_test:
        cfg = MODELS[model_key]
        print(f"\n{'='*50}")
        print(f"  {cfg['label']} ({model_key})")
        print(f"{'='*50}\n")

        system_prompt = build_system_prompt(model_key)
        print(f"  System prompt: {len(system_prompt)} chars (~{len(system_prompt)//4} tokens)")

        results = []
        for q in questions:
            sys.stdout.write(f"  {q['id']}: {q['q'][:50]}... ")
            sys.stdout.flush()
            try:
                response = cfg["call"](
                    [{"role": "user", "content": q["q"]}],
                    system_prompt)
                scores = evaluate(q["q"], response, q["expect"])
                dims = ["accuracy","specificity","safety","coaching","troop_voice"]
                avg = sum(scores.get(d,0) for d in dims) / len(dims)
                print(f"avg={avg:.1f} [A:{scores.get('accuracy',0)} S:{scores.get('specificity',0)} C:{scores.get('coaching',0)} T:{scores.get('troop_voice',0)}]")
                results.append({
                    "model": model_key, "questionId": q["id"], "category": q["cat"],
                    "question": q["q"], "expected": q["expect"],
                    "response": response, "scores": scores,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
            except Exception as e:
                print(f"ERROR: {str(e)[:80]}")
                results.append({
                    "model": model_key, "questionId": q["id"], "category": q["cat"],
                    "question": q["q"], "error": str(e)[:200],
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

        all_results[model_key] = results

        # Per-model summary
        scored = [r for r in results if "scores" in r]
        if scored:
            dims = ["accuracy","specificity","safety","coaching","troop_voice"]
            for d in dims:
                vals = [r["scores"].get(d,0) for r in scored]
                avg = sum(vals)/len(vals)
                print(f"  {d}: {avg:.1f}")

    # Save results
    with open(run_dir / "results.json", "w") as f:
        json.dump(all_results, f, indent=2)

    # Comparison table
    print(f"\n{'='*70}")
    print(f"  MODEL COMPARISON")
    print(f"{'='*70}\n")
    print(f"  {'Model':<25} {'Acc':>5} {'Spec':>5} {'Safe':>5} {'Coach':>5} {'Troop':>5} {'Avg':>5}")
    print(f"  {'-'*25} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*5}")

    for model_key in models_to_test:
        results = all_results.get(model_key, [])
        scored = [r for r in results if "scores" in r]
        if not scored:
            print(f"  {MODELS[model_key]['label']:<25} — no results —")
            continue
        dims = ["accuracy","specificity","safety","coaching","troop_voice"]
        avgs = {d: sum(r["scores"].get(d,0) for r in scored)/len(scored) for d in dims}
        overall = sum(avgs.values()) / len(dims)
        print(f"  {MODELS[model_key]['label']:<25} {avgs['accuracy']:>5.1f} {avgs['specificity']:>5.1f} {avgs['safety']:>5.1f} {avgs['coaching']:>5.1f} {avgs['troop_voice']:>5.1f} {overall:>5.1f}")

    # Per-category comparison
    cats = sorted(set(q["cat"] for q in questions))
    print(f"\n  Per-category averages:")
    print(f"  {'Model':<25}", end="")
    for cat in cats:
        print(f" {cat:>5}", end="")
    print()
    for model_key in models_to_test:
        results = all_results.get(model_key, [])
        scored = [r for r in results if "scores" in r]
        print(f"  {MODELS[model_key]['label']:<25}", end="")
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


if __name__ == "__main__":
    main()
