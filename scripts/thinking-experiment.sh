#!/usr/bin/env bash
set -euo pipefail

export ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=anthropic-api-key-test --project=scout-assistant-487523)
NVM_RUN="/opt/repos/scout-quest/scripts/nvm-run.sh"
PREFIX="--prefix /opt/repos/scout-quest/mcp-servers/scout-quest"
HARNESS="/opt/repos/scout-quest/mcp-servers/scout-quest/test/harness.ts"
REPORTS="/opt/repos/scout-quest/mcp-servers/scout-quest/test/reports/experiment"

mkdir -p "$REPORTS"

SCENARIOS="daily-chore,budget-entry,requirement-advancement"
BUDGETS="0 2000 5000 10000"
RUNS=4

# CSV header
CSV="$REPORTS/results.csv"
echo "budget,run,scenario,score,state_mgmt,socratic,character,engagement,req_accuracy,ypt,scope" > "$CSV"

echo "=== Thinking Budget Experiment ==="
echo "Scenarios: $SCENARIOS"
echo "Budgets: $BUDGETS"
echo "Runs per budget: $RUNS"
echo "Total scenario executions: $((3 * RUNS * 4))"
echo ""

for BUDGET in $BUDGETS; do
  for RUN in $(seq 1 $RUNS); do
    LABEL="b${BUDGET}-r${RUN}"
    REPORT="$REPORTS/${LABEL}.md"

    if [ "$BUDGET" -eq 0 ]; then
      echo "[$(date +%H:%M:%S)] Running: budget=OFF  run=$RUN/4"
      $NVM_RUN npx $PREFIX tsx "$HARNESS" \
        --scenarios "$SCENARIOS" \
        --output "$REPORT" \
        2>&1 | tail -5
    else
      echo "[$(date +%H:%M:%S)] Running: budget=$BUDGET  run=$RUN/4"
      $NVM_RUN npx $PREFIX tsx "$HARNESS" \
        --scenarios "$SCENARIOS" \
        --thinking --thinking-budget "$BUDGET" \
        --output "$REPORT" \
        2>&1 | tail -5
    fi

    # Extract per-scenario scores from the markdown report
    # Parse the summary table rows only (they contain PASS/PARTIAL/FAIL)
    if [ -f "$REPORT" ]; then
      while IFS='|' read -r _ scenario score status _ _; do
        scenario=$(echo "$scenario" | xargs)
        score=$(echo "$score" | xargs)
        # Only match scenario rows (contain hyphen, e.g. daily-chore)
        if [[ "$scenario" =~ ^[a-z].*- ]] && [[ "$score" =~ ^[0-9] ]]; then
          # Extract per-criterion scores from the detail section "### scenario —"
          state_mgmt=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "state_management" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          socratic=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "socratic_method" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          character=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "character_consistency" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          engagement=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "engagement_quality" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          req_accuracy=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "requirement_accuracy" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          ypt=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "ypt_compliance" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          scope=$(grep -A 20 "### ${scenario} —" "$REPORT" | grep "scope_adherence" | head -1 | sed 's/.*| \([0-9]*\) |.*/\1/' || echo "")
          echo "$BUDGET,$RUN,$scenario,$score,$state_mgmt,$socratic,$character,$engagement,$req_accuracy,$ypt,$scope" >> "$CSV"
        fi
      done < <(grep "^|" "$REPORT" | grep -v "^|--" | grep -v "^| Scenario" | grep -v "^| Criterion")
    fi

    echo ""
  done
done

echo "=== Raw Results ==="
cat "$CSV"
echo ""

echo "=== Summary Statistics ==="
# Compute averages and std dev per budget using awk
echo ""
echo "Overall Score by Budget:"
echo "budget,mean,stddev,min,max,n"
for BUDGET in $BUDGETS; do
  awk -F, -v b="$BUDGET" '
    NR > 1 && $1 == b {
      sum += $4; sumsq += $4*$4; n++
      if (n == 1 || $4 < min) min = $4
      if (n == 1 || $4 > max) max = $4
    }
    END {
      if (n > 0) {
        mean = sum/n
        variance = (sumsq/n) - (mean*mean)
        if (variance < 0) variance = 0
        stddev = sqrt(variance)
        printf "%s,%.2f,%.2f,%.1f,%.1f,%d\n", b, mean, stddev, min, max, n
      }
    }
  ' "$CSV"
done

echo ""
echo "State Management by Budget:"
echo "budget,mean,stddev,min,max,n"
for BUDGET in $BUDGETS; do
  awk -F, -v b="$BUDGET" '
    NR > 1 && $1 == b && $5 != "" {
      sum += $5; sumsq += $5*$5; n++
      if (n == 1 || $5 < min) min = $5
      if (n == 1 || $5 > max) max = $5
    }
    END {
      if (n > 0) {
        mean = sum/n
        variance = (sumsq/n) - (mean*mean)
        if (variance < 0) variance = 0
        stddev = sqrt(variance)
        printf "%s,%.2f,%.2f,%.1f,%.1f,%d\n", b, mean, stddev, min, max, n
      }
    }
  ' "$CSV"
done

echo ""
echo "Socratic Method by Budget:"
echo "budget,mean,stddev,min,max,n"
for BUDGET in $BUDGETS; do
  awk -F, -v b="$BUDGET" '
    NR > 1 && $1 == b && $6 != "" {
      sum += $6; sumsq += $6*$6; n++
      if (n == 1 || $6 < min) min = $6
      if (n == 1 || $6 > max) max = $6
    }
    END {
      if (n > 0) {
        mean = sum/n
        variance = (sumsq/n) - (mean*mean)
        if (variance < 0) variance = 0
        stddev = sqrt(variance)
        printf "%s,%.2f,%.2f,%.1f,%.1f,%d\n", b, mean, stddev, min, max, n
      }
    }
  ' "$CSV"
done

echo ""
echo "Per-Scenario Averages by Budget:"
echo "budget,scenario,mean_score,n"
for BUDGET in $BUDGETS; do
  for SCEN in daily-chore budget-entry requirement-advancement; do
    awk -F, -v b="$BUDGET" -v s="$SCEN" '
      NR > 1 && $1 == b && $3 == s {
        sum += $4; n++
      }
      END {
        if (n > 0) printf "%s,%s,%.2f,%d\n", b, s, sum/n, n
      }
    ' "$CSV"
  done
done

echo ""
echo "Experiment complete. Reports in: $REPORTS"
echo "CSV data: $CSV"
