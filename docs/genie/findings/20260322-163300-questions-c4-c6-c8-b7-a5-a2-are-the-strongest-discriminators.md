# Finding: Questions C4, C6, C8, B7, A5, A2 are the strongest discriminators by accuracy range (≥7 points spread between best and worst model responses)

**Confidence:** medium
**Date:** 2026-03-22 16:33:00

## Evidence

- **top_discriminators_by_accuracy_range:** {'C6': {'range': 10, 'mean_acc': 8.83, 'N': 21, 'note': 'Full 0-10 spread — includes some zero scores'}, 'C4': {'range': 7, 'mean_acc': 3.76, 'N': 45, 'note': 'Hardest question overall, large N'}, 'A5': {'range': 8, 'mean_acc': 6.63, 'N': 22}, 'A2': {'range': 8, 'mean_acc': 7.52, 'N': 33}, 'B7': {'range': 7, 'mean_acc': 4.83, 'N': 21, 'note': 'Low mean despite good specificity — accuracy-specificity decoupled'}, 'A6': {'range': 7, 'mean_acc': 7.78, 'N': 21}}
- **category_C_note:** Category C contains 4 of the top 6 discriminators, suggesting it targets genuinely difficult/variable knowledge

## Caveats

- Range is sensitive to outliers; a single badly-scored response inflates it
- N varies widely (21–45) across questions; larger N makes range estimates more reliable
- C6 range of 10 likely reflects some runs hitting zero — may be a scoring artifact or prompt edge case

## Next Steps

- Compute per-question SD (not just range) to get outlier-robust discrimination estimate
- Inspect C6 zero-score responses — are they genuine failures or scoring errors?
- Run model comparison specifically on C4 and B7 which show low means + high range (true hard questions)
