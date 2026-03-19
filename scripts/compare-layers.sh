#!/bin/bash
# Generate a side-by-side comparison of responses across layer eval runs.
# Usage: ./scripts/compare-layers.sh <run_dir1> <run_dir2> [run_dir3...]
#
# Outputs a markdown file comparing responses for each question.

set -euo pipefail

REPORT_BASE="/opt/repos/scout-quest/mcp-servers/scout-quest/test/reports/layer-eval"
OUTPUT="$REPORT_BASE/comparison.md"

# Find all run directories if none specified
if [ $# -eq 0 ]; then
  RUNS=($(ls -d "$REPORT_BASE"/2026-* 2>/dev/null | sort))
else
  RUNS=("$@")
fi

if [ ${#RUNS[@]} -lt 2 ]; then
  echo "Need at least 2 runs to compare. Found: ${#RUNS[@]}"
  exit 1
fi

cat > /tmp/compare-layers.py << 'PYEOF'
import json
import sys
import os

runs = sys.argv[1:]
report_base = os.path.dirname(runs[0])

# Load all runs
all_results = {}
run_labels = []

for run_dir in runs:
    results_file = os.path.join(run_dir, "results.json")
    if not os.path.exists(results_file):
        print(f"Skipping {run_dir}: no results.json")
        continue

    with open(results_file) as f:
        results = json.load(f)

    # Use directory name as label
    label = os.path.basename(run_dir)
    run_labels.append(label)
    all_results[label] = {r["questionId"]: r for r in results if "scores" in r}

# Get all question IDs in order
all_qids = []
for label in run_labels:
    for qid in all_results[label]:
        if qid not in all_qids:
            all_qids.append(qid)

# Sort by category then number
all_qids.sort(key=lambda x: (x[0], int(''.join(c for c in x[1:] if c.isdigit()) or '0')))

# Generate markdown
md = []
md.append("# Layer Evaluation — Response Comparison\n")
md.append(f"Runs compared: {', '.join(run_labels)}\n")
md.append("---\n")

for qid in all_qids:
    # Get question text from first run that has it
    question = ""
    expected = ""
    for label in run_labels:
        if qid in all_results[label]:
            question = all_results[label][qid].get("question", "")
            expected = all_results[label][qid].get("expected", "")
            break

    md.append(f"\n## {qid}: {question}\n")
    md.append(f"**Expected:** {expected}\n")

    # Score comparison table
    md.append(f"| Run | Acc | Spec | Safe | Coach | Troop | Avg | Notes |")
    md.append(f"|---|---|---|---|---|---|---|---|")

    for label in run_labels:
        if qid not in all_results[label]:
            md.append(f"| {label} | — | — | — | — | — | — | not run |")
            continue
        r = all_results[label][qid]
        s = r["scores"]
        avg = (s["accuracy"] + s["specificity"] + s["safety"] + s["coaching"] + s["troop_voice"]) / 5
        notes = s.get("notes", "")[:80]
        md.append(f"| {label} | {s['accuracy']} | {s['specificity']} | {s['safety']} | {s['coaching']} | {s['troop_voice']} | {avg:.1f} | {notes} |")

    md.append("")

    # Show responses
    for label in run_labels:
        if qid not in all_results[label]:
            continue
        r = all_results[label][qid]
        response = r.get("response", "(no response)")
        # Truncate very long responses
        if len(response) > 1500:
            response = response[:1500] + "\n\n*[truncated]*"

        layer = r.get("layer", label)
        md.append(f"<details><summary>{label} ({layer}) response</summary>\n")
        md.append(response)
        md.append(f"\n</details>\n")

    md.append("---\n")

output_file = os.path.join(report_base, "comparison.md")
with open(output_file, "w") as f:
    f.write("\n".join(md))
print(f"Comparison written to {output_file}")
print(f"Questions: {len(all_qids)}, Runs: {len(run_labels)}")
PYEOF

python3 /tmp/compare-layers.py "${RUNS[@]}"
echo "Done: $OUTPUT"
