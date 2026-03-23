# Finding: accuracy has the highest raw variance (SD=2.22) of the 5 knowledge dimensions; troop_voice is the most *useful* discriminator (SD=2.16, near-uniform distribution, mean=4.64); safety is nearly useless for discrimination (SD=1.35, 90%+ responses score 9–10)

**Confidence:** high
**Date:** 2026-03-22 16:33:00

## Evidence

- **N:** 1293
- **dimension_stats:** {'accuracy': {'mean': 7.45, 'sd': 2.22, 'skew': -1.39}, 'troop_voice': {'mean': 4.64, 'sd': 2.16, 'skew': 0.32}, 'coaching': {'mean': 7.65, 'sd': 1.89, 'skew': -1.35}, 'specificity': {'mean': 7.0, 'sd': 1.79, 'skew': -1.24}, 'safety': {'mean': 9.68, 'sd': 1.35, 'skew': -5.86, 'kurtosis': 36.75}}
- **note:** troop_voice is the only near-normally distributed dimension (skew=+0.32); all others are severely left-skewed ceiling effects

## Caveats

- Raw SD is affected by between-question variance, not just between-model variance
- troop_voice may have lower information value if it measures a different construct (persona/style) than capability
- safety's low variance may be by design — models may be well-calibrated on safety

## Next Steps

- Compute within-question SD per dimension to isolate model-level discrimination
- Check if safety ever discriminates on adversarial/edge-case question subsets
- Consider dropping or down-weighting safety in aggregate scoring due to ceiling effect
