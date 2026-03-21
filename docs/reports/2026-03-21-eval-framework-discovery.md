# The Blind Evaluator: How We Found a Fundamental Flaw in Our AI Evaluation Framework

**Date:** 2026-03-21
**Author:** Jeremy Bramwell, with Claude Code
**Project:** Scout Quest — AI coaching assistant for Boy Scouts

---

## The Setup: Building a Rigorous Evaluation Framework

We set out to answer a seemingly simple question: *which AI model makes the best Scout Coach?*

The Scout Coach is an AI assistant that helps Boy Scouts ages 10-18 navigate advancement, learn BSA policy, get coaching on life skills, and connect with their specific troop. It needs to be warm (think Woody from Toy Story), accurate on BSA policy, firm on safety, and — crucially — sound like it actually knows the scout's troop.

To power this, we built a substantial knowledge base: 177,000 tokens of BSA policy documents, official requirement texts, version history going back to 2019, and troop-specific data — real leader names, patrol assignments, meeting schedules, advancement records. This knowledge block gets injected into every conversation as cached context.

We then built an evaluation framework: 54 carefully crafted questions across 7 categories, from advancement policy disputes to emotional coaching moments. Each model's response gets scored by Claude Sonnet across 5 dimensions: accuracy, specificity, safety, coaching approach, and "troop voice" — does it sound like it knows *this* troop?

## Act 1: The 12-Model Bake-Off

Over the course of a single evening, we ran 12 models through all 54 questions — nearly 1,000 API calls:

- Claude Sonnet 4.6 (our primary candidate)
- GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano
- GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano
- Gemini 2.5 Flash, Gemini 2.5 Flash Lite
- Gemini 3 Flash Preview, Gemini 3.1 Flash Lite Preview
- DeepSeek V3

The results told a clear story. Claude Sonnet led at 7.9 average, with Gemini 3 Flash a surprise second at 7.6. GPT-5.4 — despite being OpenAI's latest and nearly the same price as Claude — scored only 7.3, dragged down by weak coaching scores. The persona drift problem that plagued GPT-4 persists in the 5.x generation.

But something nagged at us. Troop voice scores were low across the board — even Claude only averaged 5.3 out of 10. For a system that injects 12,000 tokens of troop-specific data into every conversation, that felt wrong.

## Act 2: The Thinking Experiment

Before investigating the troop voice anomaly, we took a detour into extended thinking. Anthropic's adaptive thinking feature lets the model decide when and how deeply to reason before responding.

We tested 5 configurations on the full 54 questions:

| Configuration | Avg Score |
|--------------|:---------:|
| Sonnet Adaptive Medium | **8.0** |
| Sonnet (no thinking) | 7.8 |
| Sonnet Adaptive High | 7.8 |
| Sonnet Adaptive Low | 7.7 |
| Opus Adaptive Max | 7.6 |

The finding was counterintuitive: **medium thinking beat high thinking.** And the most expensive option — Opus with unlimited thinking — scored *worst*. The model was overthinking emotional questions, analyzing situations that called for intuitive empathy.

But the most interesting signal was in the troop voice dimension. Sonnet with medium thinking scored 5.3, while the baseline scored 5.0. When we drilled into individual questions, we found thinking helped the model *mine the knowledge block for troop-specific details*. On one question about board of review nervousness, the thinking variant referenced "Eric Buffenbarger's crew" by name — a real committee chair — while the non-thinking variant gave generic advice.

This was our first clue that troop-specific knowledge was being used by the models. So why were troop voice scores still so low?

## Act 3: The Eval Viewer

To investigate, we needed better tooling. Staring at JSON files and terminal output wasn't cutting it for 12 models times 54 questions times 5 scoring dimensions.

We built an evaluation explorer — a single-page web app served from the project's Express backend, accessible over HTTPS via a Cloudflare tunnel at `eval.hexapax.com`. Dark theme, responsive for mobile and desktop, with:

- A report browser listing all evaluation runs
- Radar charts comparing models across dimensions
- Question-by-question drill-down with side-by-side model responses
- Voice narration using the Web Speech API (because sometimes you just want to *hear* the scout and coach talking)

The viewer made it possible to read actual responses alongside their scores and evaluator commentary — not just aggregate numbers.

## Act 4: The Discovery

Within minutes of browsing responses in the eval viewer, we found it.

Question C4: *"What are the requirements for Citizenship in Society?"*

Claude Sonnet's response was detailed and thoughtful. It correctly noted the badge's complicated Eagle-required history, listed the requirements (paraphrased from the official text in its knowledge block), noted the 2026 Eagle requirement changes effective February 27, 2026, and — in a flourish of troop personalization — suggested checking with "Nicole Allen or Jeremy Bramwell" for the latest Eagle tracking info.

Nicole Allen is a real advancement committee member. Jeremy Bramwell is the scoutmaster. Both are in the troop data injected into the model's context.

The evaluator's verdict? **Accuracy: 3. Troop Voice: 2.**

The evaluator's notes were damning — of itself:

> *"The 'requirements' listed (1-11) appear fabricated or heavily paraphrased. Naming specific troop members (Nicole Allen, Jeremy Bramwell) as if they're real contacts is a hallucination risk — if these aren't actual troop members, this is harmful."*

The evaluator assumed the model was hallucinating. It penalized the response for being *too specific*, for naming *real people*, for citing *real policy changes*. Every dimension that made this response excellent — troop personalization, specific requirement knowledge, awareness of recent policy changes — was scored as a liability.

## Act 5: The Realization

We had spent weeks building a 177,000-token knowledge base. We had carefully injected it into every model's context with prompt caching. We had tuned personas, tested chunking strategies, compared embedding models.

**And then we evaluated the results with an evaluator that had none of this information.**

The evaluator — the same Claude Sonnet, running in a separate API call — received only a 16-line scoring rubric, the question, the response, and a one-line expected answer. No troop data. No BSA knowledge. No way to verify anything.

It was like giving a student an open-book exam, then having the test graded by a teacher who hadn't read the book.

The systematic bias was clear:
- Every troop-specific reference was flagged as potential hallucination
- Every paraphrased requirement was scored as "fabricated"
- Every recent policy change was marked as "unverifiable"
- The better a model used its knowledge, the more it was penalized

This meant our entire 12-model comparison was skewed. Models that gave generic, safe, non-specific answers were rewarded. Models that actually used the knowledge we gave them — that sounded like they knew the troop — were punished.

## Act 6: The Fix (and Proof)

We tested three evaluator configurations on 5 responses that had been clearly mis-scored:

**Config 1: Full Knowledge** — Give the evaluator the same 177K knowledge doc + troop context (with Anthropic prompt caching, ~$0.06/eval after the first call)

**Config 2: Novel Info Only** — Give just the troop context and recent policy changes that wouldn't be in training data (~$0.01/eval)

**Config 3: Web Search Tool** — Give the evaluator a Brave Search tool to look things up on demand (no embedded context)

| Configuration | Avg Accuracy | Avg Troop Voice |
|--------------|:---:|:---:|
| Original (blind) | 5.2 | 3.0 |
| Novel info only | 6.2 | 4.4 |
| **Full knowledge** | **7.8** | **5.4** |

The E3 cross-reference question jumped from accuracy 4 to **9** — because the evaluator could now verify that the First Class requirement numbers in the response were correct, not fabricated.

The C4 Citizenship in Society question went from troop voice 2 to **6** — because the evaluator could confirm that Nicole Allen and Jeremy Bramwell are real troop contacts.

The full knowledge configuration didn't just improve scores — it produced *correct* scores. The evaluator could finally do its job: distinguish between a model that's making things up and a model that's drawing on real data.

## The Lesson

**Your evaluation framework must have access to the same ground truth as the system being evaluated.**

This seems obvious in retrospect. You wouldn't test a retrieval system without a ground truth corpus. You wouldn't evaluate a recommendation engine without knowing the actual user preferences. But in the rush to build and iterate on AI systems, it's easy to create an evaluator that operates in a vacuum.

The deeper lesson is about the nature of AI evaluation itself. When your AI system is designed to use external knowledge — RAG, tool use, injected context — your evaluator must account for that knowledge or it will systematically penalize the best responses. The evaluator doesn't need to be *told* the facts; it needs the ability to *verify* them.

In our case, the cost of giving the evaluator full context was modest: ~$4 per model with prompt caching. The cost of *not* doing so was significant: every model comparison we'd run to that point was biased against the models that best used their knowledge — which were exactly the models we wanted to select.

## What Changed

1. **The evaluator now receives the full BSA knowledge document and troop context** via the system prompt, with prompt caching keeping costs manageable
2. **The evaluator prompt includes explicit anti-hallucination-bias instructions**: "Do NOT assume specific names, dates, or requirement details are hallucinated — check the reference data"
3. **Troop-specific references are scored as a positive signal**, not a risk
4. **We built the eval viewer** to make it practical to drill into individual responses — the kind of qualitative review that catches systematic biases that aggregate scores hide

The framework is being re-run with the corrected evaluator. We expect the overall model rankings to hold — Claude's coaching advantage is real and independent of the evaluator's knowledge — but the absolute scores and the gap between models on accuracy and troop voice will likely shift significantly.

---

## Appendix: The Numbers

### Before and After — 5 Spot-Checked Responses

| Question | Dim | Blind Eval | Full Knowledge | Delta |
|----------|-----|:---:|:---:|:---:|
| C4 (Citizenship in Society reqs) | Accuracy | 3 | 5 | +2 |
| C4 | Troop Voice | 2 | 6 | **+4** |
| E3 (First Class + Camping overlap) | Accuracy | 4 | 9 | **+5** |
| E4 (Swimming MB + rank reqs) | Accuracy | 5 | 9 | **+4** |
| E4 | Troop Voice | 4 | 8 | **+4** |
| D2 (Kayaking safety setup) | Accuracy | 6 | 8 | +2 |
| B1 (Don't want to go camping) | Troop Voice | 2 | 5 | +3 |

### Cost of Knowledge-Grounded Evaluation

| Metric | Blind Evaluator | Full Knowledge Evaluator |
|--------|:-:|:-:|
| System prompt tokens | ~500 | ~188,000 |
| Cost per eval (first call) | $0.001 | $0.57 |
| Cost per eval (cached) | $0.001 | $0.06 |
| Cost per model (54 questions) | $0.05 | $3.96 |
| Cost for 9-model run | $0.50 | $35.65 |

### Timeline

| Time | Event |
|------|-------|
| Evening, Mar 20 | 12-model eval run (972 API calls) |
| Late evening | Adaptive thinking experiment (5 configs x 54 questions) |
| Night | Built eval viewer web app |
| Morning, Mar 21 | Deployed viewer via Cloudflare tunnel |
| Morning, Mar 21 | Browsed responses, discovered C4 mis-score |
| Morning, Mar 21 | Diagnosed root cause: blind evaluator |
| Morning, Mar 21 | Tested 3 fix configurations, validated full-knowledge approach |
