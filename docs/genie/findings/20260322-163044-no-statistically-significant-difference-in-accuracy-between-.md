# Finding: No statistically significant difference in accuracy between L0 (persona-only) and L3 (knowledge+troop) configurations

**Confidence:** low
**Date:** 2026-03-22 16:30:44

## Evidence

- **test:** Paired t-test (14 paired questions)
- **statistic:** t = -0.504
- **p_value:** 0.622
- **effect_size:** Cohen's d = -0.316 (small, favoring L3)
- **L0_mean:** 6.80 ± 2.37 (N=44)
- **L3_mean:** 7.50 ± 1.70 (N=14)
- **mean_difference:** +0.70 points in favor of L3
- **achieved_power:** 0.225
- **n_needed_for_80pct_power:** 79

## Caveats

- Very small sample: only 14 paired observations used in the test — achieved power is only 22.5%
- L0 has 44 docs vs L3's 14; the pairing uses only the overlapping 14 questions
- Both distributions are significantly non-normal (Shapiro-Wilk p < 0.01), which can affect t-test reliability
- L0 and L3 differ in layer stack (persona-only vs knowledge+troop) — any accuracy difference could be due to either knowledge injection or troop context, not isolatable here
- 79 paired observations per group would be needed to detect this effect size at 80% power

## Next Steps

- Collect more L3 evaluations — at least 79 per group for 80% power
- Use Mann-Whitney U test as a non-parametric alternative given non-normality
- Compare L1, L2, L3 together with ANOVA to see if there is a monotonic trend across layers
- Isolate the effect of knowledge vs troop context by comparing L1 (knowledge-only) vs L2 (troop-only) vs L3
