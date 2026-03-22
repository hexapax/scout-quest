"""Eval Genie tool implementations — pure Python, no LLM calls.

Each tool function takes a dict of params and returns a dict of results.
All data comes from MongoDB scoutquest.eval_results; all stats from scipy/numpy.
"""

import os
import json
import math
from datetime import datetime
from pathlib import Path
from collections import defaultdict

import numpy as np
from pymongo import MongoClient
from scipy import stats as scipy_stats

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# MongoDB connection
# ---------------------------------------------------------------------------

_client = None

def get_collection():
    global _client
    if _client is None:
        _client = MongoClient("mongodb://localhost:27017")
    return _client["scoutquest"]["eval_results"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

AXES = ["perspective", "config_id", "layer", "model_id", "category", "run_id"]

PLOT_DIR = Path(__file__).parent.parent / "docs" / "genie" / "plots"
FINDING_DIR = Path(__file__).parent.parent / "docs" / "genie" / "findings"


def _ensure_dirs():
    PLOT_DIR.mkdir(parents=True, exist_ok=True)
    FINDING_DIR.mkdir(parents=True, exist_ok=True)


def _build_filter(f: dict | None) -> dict:
    """Convert a user-facing filter dict into a MongoDB query."""
    if not f:
        return {}
    q = {}
    for key in ["perspective", "config_id", "layer", "model_id", "category",
                 "run_id", "question_id", "eval_version", "knowledge"]:
        if key in f:
            val = f[key]
            if isinstance(val, list):
                q[key] = {"$in": val}
            else:
                q[key] = val
    return q


def _resolve_metric(metric: str) -> str:
    """Turn a short metric name into a dotted field path."""
    if metric.startswith("scores."):
        return metric
    if metric == "overall_score":
        return metric
    return f"scores.{metric}"


def _extract_values(docs, metric_field: str) -> list[float]:
    """Extract numeric values from docs for a metric field."""
    vals = []
    for d in docs:
        if metric_field.startswith("scores."):
            dim = metric_field.split(".", 1)[1]
            score_dict = d.get("scores", {})
            if isinstance(score_dict, dict) and dim in score_dict:
                v = score_dict[dim]
                if isinstance(v, (int, float)) and not math.isnan(v):
                    vals.append(float(v))
        else:
            v = d.get(metric_field)
            if isinstance(v, (int, float)) and not math.isnan(v):
                vals.append(float(v))
    return vals


def _effect_label(d: float) -> str:
    d = abs(d)
    if d < 0.2:
        return "negligible"
    if d < 0.5:
        return "small"
    if d < 0.8:
        return "medium"
    return "large"


def _eta_sq_label(eta: float) -> str:
    if eta < 0.01:
        return "negligible"
    if eta < 0.06:
        return "small"
    if eta < 0.14:
        return "medium"
    return "large"


def _cohens_d(a, b):
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return 0.0
    pooled_std = math.sqrt(((na - 1) * np.std(a, ddof=1)**2 + (nb - 1) * np.std(b, ddof=1)**2) / (na + nb - 2))
    if pooled_std == 0:
        return 0.0
    return (np.mean(a) - np.mean(b)) / pooled_std


def _n_for_power(d: float, alpha: float = 0.05, power: float = 0.80) -> int:
    """Estimate N per group needed for given power with a two-sample t-test."""
    if abs(d) < 0.001:
        return 99999
    z_alpha = scipy_stats.norm.ppf(1 - alpha / 2)
    z_beta = scipy_stats.norm.ppf(power)
    n = ((z_alpha + z_beta) / d) ** 2
    return max(int(math.ceil(n)), 2)


def _post_hoc_power(d: float, n: int, alpha: float = 0.05) -> float:
    """Compute achieved power for observed effect size and sample size."""
    if abs(d) < 0.001 or n < 2:
        return 0.0
    se = d * math.sqrt(n / 2)  # noncentrality approx
    z_alpha = scipy_stats.norm.ppf(1 - alpha / 2)
    power = scipy_stats.norm.cdf(se - z_alpha) + scipy_stats.norm.cdf(-se - z_alpha)
    return round(max(0.0, min(1.0, power)), 3)


def _setup_plot():
    """Apply dark theme for plots."""
    plt.style.use("dark_background")
    plt.rcParams.update({
        "figure.facecolor": "#1a1a2e",
        "axes.facecolor": "#16213e",
        "text.color": "#e0e0e0",
        "axes.labelcolor": "#e0e0e0",
        "xtick.color": "#e0e0e0",
        "ytick.color": "#e0e0e0",
        "axes.edgecolor": "#444444",
        "grid.color": "#333333",
        "figure.figsize": (10, 6),
    })


# ---------------------------------------------------------------------------
# Tool: describe_data
# ---------------------------------------------------------------------------

def describe_data(params: dict) -> dict:
    coll = get_collection()
    filt = _build_filter(params.get("filter"))

    total = coll.count_documents(filt)

    axis_values = {}
    for axis in AXES:
        pipeline = [{"$match": filt}] if filt else []
        pipeline.append({"$group": {"_id": f"${axis}", "count": {"$sum": 1}}})
        pipeline.append({"$sort": {"count": -1}})
        results = list(coll.aggregate(pipeline))
        axis_values[axis] = {str(r["_id"]): r["count"] for r in results if r["_id"] is not None}

    # Detect score dimensions from a sample
    sample_docs = list(coll.find(filt, {"scores": 1}).limit(50))
    score_dims = set()
    for d in sample_docs:
        s = d.get("scores", {})
        if isinstance(s, dict):
            score_dims.update(s.keys())

    # Date range
    earliest = coll.find_one(filt, {"timestamp": 1}, sort=[("timestamp", 1)])
    latest = coll.find_one(filt, {"timestamp": 1}, sort=[("timestamp", -1)])
    date_range = {}
    if earliest and "timestamp" in earliest:
        date_range["earliest"] = str(earliest["timestamp"])
    if latest and "timestamp" in latest:
        date_range["latest"] = str(latest["timestamp"])

    # Gaps: detect groups with very few results
    gaps = []
    for axis in ["perspective", "config_id", "layer", "model_id", "category"]:
        for name, count in axis_values.get(axis, {}).items():
            if count < 5:
                gaps.append(f"{axis}={name} has only {count} results")

    # Has overall_score?
    with_overall = coll.count_documents({**filt, "overall_score": {"$exists": True}})
    if with_overall < total:
        gaps.append(f"{total - with_overall} of {total} docs lack overall_score")

    return {
        "total_docs": total,
        "perspectives": axis_values.get("perspective", {}),
        "config_ids": axis_values.get("config_id", {}),
        "layers": axis_values.get("layer", {}),
        "model_ids": axis_values.get("model_id", {}),
        "categories": axis_values.get("category", {}),
        "run_ids": axis_values.get("run_id", {}),
        "score_dimensions": sorted(score_dims),
        "date_range": date_range,
        "gaps": gaps,
    }


# ---------------------------------------------------------------------------
# Tool: query_results
# ---------------------------------------------------------------------------

def query_results(params: dict) -> dict:
    coll = get_collection()
    filt = _build_filter(params.get("filter"))
    fields = params.get("fields", [])
    group_by = params.get("group_by")
    limit = params.get("limit", 100)

    if group_by:
        # Aggregation mode
        group_spec = {"_id": f"${group_by}", "count": {"$sum": 1}}
        for f in fields:
            safe = f.replace(".", "_")
            if f.startswith("scores.") or f == "overall_score":
                group_spec[f"avg_{safe}"] = {"$avg": f"${f}"}
                group_spec[f"min_{safe}"] = {"$min": f"${f}"}
                group_spec[f"max_{safe}"] = {"$max": f"${f}"}
            else:
                group_spec[f"vals_{safe}"] = {"$addToSet": f"${f}"}

        pipeline = []
        if filt:
            pipeline.append({"$match": filt})
        pipeline.append({"$group": group_spec})
        pipeline.append({"$sort": {"_id": 1}})
        pipeline.append({"$limit": limit})

        rows = []
        for r in coll.aggregate(pipeline):
            row = {group_by: r["_id"], "count": r["count"]}
            for k, v in r.items():
                if k not in ("_id", "count"):
                    row[k] = v
            rows.append(row)
        return {"rows": rows, "count": len(rows), "mode": "aggregated"}
    else:
        # Raw query mode
        projection = {"_id": 0}
        for f in fields:
            projection[f] = 1
        if not fields:
            projection = {"_id": 0, "response": 0, "eval_notes": 0,
                          "scores_notes": 0, "scores_assessments": 0}

        docs = list(coll.find(filt, projection).limit(limit))
        # Convert datetime objects
        for d in docs:
            for k, v in list(d.items()):
                if isinstance(v, datetime):
                    d[k] = str(v)
        return {"rows": docs, "count": len(docs), "mode": "raw"}


# ---------------------------------------------------------------------------
# Tool: list_runs
# ---------------------------------------------------------------------------

def list_runs(params: dict) -> dict:
    coll = get_collection()
    pipeline = [
        {"$group": {
            "_id": "$run_id",
            "count": {"$sum": 1},
            "perspectives": {"$addToSet": "$perspective"},
            "configs": {"$addToSet": "$config_id"},
            "earliest": {"$min": "$timestamp"},
            "latest": {"$max": "$timestamp"},
        }},
        {"$sort": {"earliest": -1}},
    ]
    runs = []
    for r in coll.aggregate(pipeline):
        runs.append({
            "run_id": r["_id"],
            "count": r["count"],
            "perspectives": r["perspectives"],
            "configs": r["configs"],
            "date": str(r.get("earliest", "")),
        })
    return {"runs": runs, "total_runs": len(runs)}


# ---------------------------------------------------------------------------
# Tool: compare_groups
# ---------------------------------------------------------------------------

def compare_groups(params: dict) -> dict:
    coll = get_collection()
    metric = params["metric"]
    group_by = params["group_by"]
    filt = _build_filter(params.get("filter"))
    test_mode = params.get("test", "auto")

    metric_field = _resolve_metric(metric)

    # Fetch docs grouped by the group_by field
    docs = list(coll.find(filt, {"scores": 1, "overall_score": 1, group_by: 1, "question_id": 1}))

    groups = defaultdict(list)
    group_qids = defaultdict(set)
    for d in docs:
        gname = d.get(group_by)
        if gname is None:
            continue
        vals = _extract_values([d], metric_field)
        if vals:
            groups[str(gname)].append(vals[0])
            group_qids[str(gname)].add(d.get("question_id", ""))

    if len(groups) < 2:
        return {"error": f"Need at least 2 groups, found {len(groups)}", "groups": list(groups.keys())}

    # Build group summaries
    group_summaries = []
    for name in sorted(groups.keys()):
        arr = np.array(groups[name])
        group_summaries.append({
            "name": name,
            "N": len(arr),
            "mean": round(float(np.mean(arr)), 3),
            "sd": round(float(np.std(arr, ddof=1)), 3) if len(arr) > 1 else 0.0,
            "median": round(float(np.median(arr)), 3),
            "min": round(float(np.min(arr)), 3),
            "max": round(float(np.max(arr)), 3),
        })

    warnings = []

    # Check for unequal group sizes
    sizes = [g["N"] for g in group_summaries]
    if max(sizes) > 2 * min(sizes):
        warnings.append(f"Unequal group sizes: {min(sizes)} to {max(sizes)}")

    # Check normality for each group
    for g in group_summaries:
        arr = np.array(groups[g["name"]])
        if len(arr) >= 8:
            _, p_norm = scipy_stats.shapiro(arr)
            if p_norm < 0.05:
                warnings.append(f"Non-normal distribution in {g['name']} (Shapiro p={p_norm:.4f})")

    # Small sample warning
    for g in group_summaries:
        if g["N"] < 10:
            warnings.append(f"Small sample in {g['name']} (N={g['N']})")

    n_groups = len(groups)
    group_names = sorted(groups.keys())
    arrays = [np.array(groups[n]) for n in group_names]

    test_result = {}
    pairwise = None

    if n_groups == 2:
        a, b = arrays[0], arrays[1]
        # Auto-detect paired vs independent
        qids_a = group_qids[group_names[0]]
        qids_b = group_qids[group_names[1]]
        shared = qids_a & qids_b

        if test_mode == "auto":
            if len(shared) > 0 and len(shared) >= 0.8 * min(len(a), len(b)):
                test_mode = "paired"
            else:
                test_mode = "t_test"

        d_val = _cohens_d(a, b)

        if test_mode == "paired":
            # Build paired arrays
            docs_a = {d.get("question_id"): d for d in coll.find(
                {**filt, group_by: group_names[0]}, {"scores": 1, "overall_score": 1, "question_id": 1})}
            docs_b = {d.get("question_id"): d for d in coll.find(
                {**filt, group_by: group_names[1]}, {"scores": 1, "overall_score": 1, "question_id": 1})}
            paired_a, paired_b = [], []
            for qid in shared:
                va = _extract_values([docs_a[qid]], metric_field) if qid in docs_a else []
                vb = _extract_values([docs_b[qid]], metric_field) if qid in docs_b else []
                if va and vb:
                    paired_a.append(va[0])
                    paired_b.append(vb[0])
            if len(paired_a) >= 2:
                stat, pval = scipy_stats.ttest_rel(paired_a, paired_b)
                test_result = {
                    "name": "Paired t-test",
                    "statistic": round(float(stat), 4),
                    "p_value": round(float(pval), 6),
                    "significant": pval < 0.05,
                    "effect_size": round(d_val, 3),
                    "effect_label": _effect_label(d_val),
                    "df": len(paired_a) - 1,
                    "n_paired": len(paired_a),
                }
            else:
                test_mode = "t_test"
                warnings.append("Too few paired observations, fell back to independent t-test")

        if test_mode == "t_test":
            stat, pval = scipy_stats.ttest_ind(a, b, equal_var=False)
            test_result = {
                "name": "Independent t-test (Welch's)",
                "statistic": round(float(stat), 4),
                "p_value": round(float(pval), 6),
                "significant": pval < 0.05,
                "effect_size": round(d_val, 3),
                "effect_label": _effect_label(d_val),
            }

        if test_mode == "mann_whitney":
            stat, pval = scipy_stats.mannwhitneyu(a, b, alternative="two-sided")
            test_result = {
                "name": "Mann-Whitney U",
                "statistic": round(float(stat), 4),
                "p_value": round(float(pval), 6),
                "significant": pval < 0.05,
                "effect_size": round(d_val, 3),
                "effect_label": _effect_label(d_val),
            }

        avg_n = int(np.mean([len(a), len(b)]))
        power_achieved = _post_hoc_power(d_val, avg_n)
        n_needed = _n_for_power(d_val)

    else:
        # 3+ groups: ANOVA
        stat, pval = scipy_stats.f_oneway(*arrays)
        # Eta-squared
        grand_mean = np.mean(np.concatenate(arrays))
        ss_between = sum(len(arr) * (np.mean(arr) - grand_mean)**2 for arr in arrays)
        ss_total = sum(np.sum((arr - grand_mean)**2) for arr in arrays)
        eta_sq = ss_between / ss_total if ss_total > 0 else 0.0

        test_result = {
            "name": "One-way ANOVA",
            "statistic": round(float(stat), 4),
            "p_value": round(float(pval), 6),
            "significant": pval < 0.05,
            "effect_size": round(eta_sq, 4),
            "effect_label": _eta_sq_label(eta_sq),
            "effect_type": "eta_squared",
        }

        # Post-hoc Tukey if significant
        if pval < 0.05:
            all_vals = np.concatenate(arrays)
            all_labels = []
            for i, name in enumerate(group_names):
                all_labels.extend([name] * len(arrays[i]))
            try:
                tukey = scipy_stats.tukey_hsd(*arrays)
                pairwise = []
                for i in range(len(group_names)):
                    for j in range(i + 1, len(group_names)):
                        diff = float(np.mean(arrays[i]) - np.mean(arrays[j]))
                        p_pair = float(tukey.pvalue[i][j])
                        pairwise.append({
                            "a": group_names[i],
                            "b": group_names[j],
                            "diff": round(diff, 3),
                            "p": round(p_pair, 6),
                            "significant": p_pair < 0.05,
                        })
            except Exception as e:
                warnings.append(f"Tukey HSD failed: {e}")

        # Power approximation using average effect size
        avg_n = int(np.mean([len(arr) for arr in arrays]))
        # Convert eta-squared to Cohen's f for power calculation
        f_effect = math.sqrt(eta_sq / (1 - eta_sq)) if eta_sq < 1 else 0.0
        power_achieved = _post_hoc_power(f_effect, avg_n)
        d_val = f_effect  # for n_needed calc
        n_needed = _n_for_power(f_effect)

    result = {
        "groups": group_summaries,
        "test": test_result,
        "power": {
            "achieved": power_achieved,
            "n_needed_80": n_needed,
        },
        "warnings": warnings,
    }
    if pairwise is not None:
        result["pairwise"] = pairwise
    return result


# ---------------------------------------------------------------------------
# Tool: correlate
# ---------------------------------------------------------------------------

def correlate(params: dict) -> dict:
    coll = get_collection()
    x_name = params["x"]
    y_name = params["y"]
    filt = _build_filter(params.get("filter"))

    x_field = _resolve_metric(x_name)
    y_field = _resolve_metric(y_name)

    docs = list(coll.find(filt, {"scores": 1, "overall_score": 1, "config_id": 1, "question_id": 1}))

    x_vals, y_vals, labels = [], [], []
    for d in docs:
        xv = _extract_values([d], x_field)
        yv = _extract_values([d], y_field)
        if xv and yv:
            x_vals.append(xv[0])
            y_vals.append(yv[0])
            labels.append(d.get("config_id", "") + "/" + d.get("question_id", ""))

    if len(x_vals) < 3:
        return {"error": f"Need at least 3 data points, found {len(x_vals)}"}

    x_arr = np.array(x_vals)
    y_arr = np.array(y_vals)

    r, p = scipy_stats.pearsonr(x_arr, y_arr)
    r_sq = r ** 2

    # Interpretation
    abs_r = abs(r)
    if abs_r < 0.1:
        interp = "negligible"
    elif abs_r < 0.3:
        interp = "weak"
    elif abs_r < 0.5:
        interp = "moderate"
    elif abs_r < 0.7:
        interp = "strong"
    else:
        interp = "very strong"

    direction = "positive" if r > 0 else "negative"
    interp_text = f"{interp} {direction} correlation"

    # Build data_points (limit to avoid huge payloads)
    data_points = []
    for i in range(min(len(x_vals), 200)):
        data_points.append({"x": x_vals[i], "y": y_vals[i], "label": labels[i]})

    return {
        "r": round(float(r), 4),
        "p_value": round(float(p), 6),
        "N": len(x_vals),
        "r_squared": round(float(r_sq), 4),
        "interpretation": interp_text,
        "data_points": data_points,
    }


# ---------------------------------------------------------------------------
# Tool: distribution
# ---------------------------------------------------------------------------

def distribution(params: dict) -> dict:
    coll = get_collection()
    metric = params["metric"]
    filt = _build_filter(params.get("filter"))
    group_by = params.get("group_by")

    metric_field = _resolve_metric(metric)

    docs = list(coll.find(filt, {"scores": 1, "overall_score": 1, group_by: 1} if group_by else {"scores": 1, "overall_score": 1}))

    all_vals = _extract_values(docs, metric_field)
    if not all_vals:
        return {"error": f"No values found for {metric}"}

    arr = np.array(all_vals)

    # Overall stats
    shapiro_p = None
    if 3 <= len(arr) <= 5000:
        _, shapiro_p = scipy_stats.shapiro(arr)
        shapiro_p = round(float(shapiro_p), 6)

    overall = {
        "mean": round(float(np.mean(arr)), 3),
        "sd": round(float(np.std(arr, ddof=1)), 3) if len(arr) > 1 else 0.0,
        "median": round(float(np.median(arr)), 3),
        "skew": round(float(scipy_stats.skew(arr)), 3) if len(arr) > 2 else None,
        "kurtosis": round(float(scipy_stats.kurtosis(arr)), 3) if len(arr) > 3 else None,
        "shapiro_p": shapiro_p,
        "N": len(arr),
    }

    # Histogram
    n_bins = min(20, max(5, int(len(arr) ** 0.5)))
    counts_arr, bin_edges = np.histogram(arr, bins=n_bins)
    histogram = {
        "bins": [round(float(b), 3) for b in bin_edges],
        "counts": [int(c) for c in counts_arr],
    }

    result = {"overall": overall, "histogram": histogram}

    # Group breakdown
    if group_by:
        group_data = defaultdict(list)
        for d in docs:
            gname = d.get(group_by)
            if gname is None:
                continue
            vals = _extract_values([d], metric_field)
            if vals:
                group_data[str(gname)].append(vals[0])

        groups = []
        for name in sorted(group_data.keys()):
            g = np.array(group_data[name])
            groups.append({
                "name": name,
                "mean": round(float(np.mean(g)), 3),
                "sd": round(float(np.std(g, ddof=1)), 3) if len(g) > 1 else 0.0,
                "median": round(float(np.median(g)), 3),
                "N": len(g),
            })
        result["groups"] = groups

    return result


# ---------------------------------------------------------------------------
# Tool: plot
# ---------------------------------------------------------------------------

def plot(params: dict) -> dict:
    _ensure_dirs()
    _setup_plot()

    plot_type = params["type"]
    title = params["title"]
    data = params.get("data", {})
    filename = params.get("filename")

    ACCENT = "#e94560"
    COLORS = ["#e94560", "#0f3460", "#00b4d8", "#e0e0e0", "#f77f00",
              "#06d6a0", "#8338ec", "#ff006e", "#3a86a7", "#fb5607"]

    if not filename:
        safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in title)
        safe_title = safe_title.replace(" ", "-").lower()[:60]
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = f"{timestamp}-{safe_title}.png"

    if not filename.endswith(".png"):
        filename += ".png"

    path = PLOT_DIR / filename
    fig, ax = plt.subplots()

    if plot_type == "bar":
        labels = data.get("labels", [])
        values = data.get("values", [])
        errors = data.get("errors", None)
        ax.bar(labels, values, yerr=errors, color=ACCENT, edgecolor="none",
               capsize=4, alpha=0.85)
        ax.set_ylabel(data.get("ylabel", "Score"))
        for i, v in enumerate(values):
            ax.text(i, v + (errors[i] if errors else 0) + 0.1,
                    f"{v:.2f}", ha="center", va="bottom", fontsize=9, color="#e0e0e0")

    elif plot_type == "box":
        groups = data.get("groups", {})
        labels = list(groups.keys())
        values = [groups[l] for l in labels]
        bp = ax.boxplot(values, labels=labels, patch_artist=True)
        for i, box in enumerate(bp["boxes"]):
            box.set_facecolor(COLORS[i % len(COLORS)])
            box.set_alpha(0.7)
        for median in bp["medians"]:
            median.set_color("#ffffff")
        ax.set_ylabel(data.get("ylabel", "Score"))

    elif plot_type == "scatter":
        x = data.get("x", [])
        y = data.get("y", [])
        ax.scatter(x, y, color=ACCENT, alpha=0.6, s=40, edgecolors="none")
        # Regression line
        if len(x) >= 2:
            x_arr = np.array(x, dtype=float)
            y_arr = np.array(y, dtype=float)
            slope, intercept = np.polyfit(x_arr, y_arr, 1)
            x_line = np.linspace(x_arr.min(), x_arr.max(), 100)
            ax.plot(x_line, slope * x_line + intercept, color="#00b4d8",
                    linewidth=2, linestyle="--", alpha=0.8)
        ax.set_xlabel(data.get("xlabel", "X"))
        ax.set_ylabel(data.get("ylabel", "Y"))

    elif plot_type == "heatmap":
        matrix = np.array(data.get("matrix", [[]]))
        row_labels = data.get("row_labels", [])
        col_labels = data.get("col_labels", [])
        im = ax.imshow(matrix, cmap="RdYlGn", aspect="auto")
        ax.set_xticks(range(len(col_labels)))
        ax.set_xticklabels(col_labels, rotation=45, ha="right", fontsize=8)
        ax.set_yticks(range(len(row_labels)))
        ax.set_yticklabels(row_labels, fontsize=8)
        # Annotate cells
        for i in range(len(row_labels)):
            for j in range(len(col_labels)):
                val = matrix[i][j] if i < len(matrix) and j < len(matrix[i]) else 0
                ax.text(j, i, f"{val:.1f}", ha="center", va="center",
                        fontsize=8, color="black" if val > np.mean(matrix) else "white")
        fig.colorbar(im, ax=ax)

    else:
        return {"error": f"Unknown plot type: {plot_type}"}

    ax.set_title(title, fontsize=13, fontweight="bold", color="#e0e0e0")
    fig.tight_layout()
    fig.savefig(str(path), dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)

    return {"path": str(path)}


# ---------------------------------------------------------------------------
# Tool: save_finding
# ---------------------------------------------------------------------------

def save_finding(params: dict) -> dict:
    _ensure_dirs()

    claim = params["claim"]
    confidence = params.get("confidence", "medium")
    evidence = params.get("evidence", {})
    caveats = params.get("caveats", [])
    next_steps = params.get("next_steps", [])

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_claim = "".join(c if c.isalnum() or c in "-_ " else "" for c in claim)
    safe_claim = safe_claim.replace(" ", "-").lower()[:60]
    filename = f"{timestamp}-{safe_claim}.md"
    path = FINDING_DIR / filename

    lines = [
        f"# Finding: {claim}",
        "",
        f"**Confidence:** {confidence}",
        f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Evidence",
        "",
    ]

    if isinstance(evidence, dict):
        for k, v in evidence.items():
            lines.append(f"- **{k}:** {v}")
    elif isinstance(evidence, str):
        lines.append(evidence)

    if caveats:
        lines.extend(["", "## Caveats", ""])
        for c in caveats:
            lines.append(f"- {c}")

    if next_steps:
        lines.extend(["", "## Next Steps", ""])
        for s in next_steps:
            lines.append(f"- {s}")

    lines.append("")
    path.write_text("\n".join(lines))

    return {"path": str(path)}


# ---------------------------------------------------------------------------
# Tool registry — maps tool names to (function, description, input_schema)
# ---------------------------------------------------------------------------

TOOLS = {
    "describe_data": {
        "function": describe_data,
        "description": "Describe the eval dataset: count documents, list distinct values for each axis (perspective, config_id, layer, model_id, category, run_id), detect score dimensions, and find gaps. Optionally filter to a subset.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filter": {
                    "type": "object",
                    "description": "Optional MongoDB filter on perspective, config_id, layer, model_id, category, run_id, question_id, eval_version, knowledge.",
                    "properties": {
                        "perspective": {"type": "string"},
                        "config_id": {"type": "string"},
                        "layer": {"type": "string"},
                        "model_id": {"type": "string"},
                        "category": {"type": "string"},
                        "run_id": {"type": "string"},
                    },
                },
            },
        },
    },
    "query_results": {
        "function": query_results,
        "description": "Query eval results from MongoDB. Returns raw rows or aggregated groups. Use this to fetch specific data for analysis.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filter": {
                    "type": "object",
                    "description": "MongoDB filter on perspective, config_id, layer, model_id, category, run_id, question_id, eval_version, knowledge.",
                },
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Fields to return, e.g. ['config_id', 'question_id', 'scores.accuracy']. Empty = all fields (minus large text).",
                },
                "group_by": {
                    "type": "string",
                    "description": "Aggregate results by this field (e.g. 'config_id', 'layer'). Returns means of numeric fields.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return (default 100).",
                    "default": 100,
                },
            },
            "required": ["fields"],
        },
    },
    "list_runs": {
        "function": list_runs,
        "description": "List all distinct eval runs with their run_id, document count, perspectives, and configs.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    "compare_groups": {
        "function": compare_groups,
        "description": "Compare groups on a metric with statistical testing. Auto-detects the right test: 2 groups with shared questions -> paired t-test, 2 independent groups -> Welch's t-test, 3+ groups -> one-way ANOVA with Tukey HSD post-hoc. Reports effect size (Cohen's d or eta-squared), post-hoc power, and N needed for 80% power.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "description": "Score dimension to compare, e.g. 'accuracy', 'coaching', 'overall_score', 'safety'.",
                },
                "group_by": {
                    "type": "string",
                    "description": "Field to group by: 'layer', 'config_id', 'model_id', 'category', 'perspective'.",
                },
                "filter": {
                    "type": "object",
                    "description": "Optional filter to restrict data before grouping.",
                },
                "test": {
                    "type": "string",
                    "enum": ["auto", "t_test", "anova", "mann_whitney", "paired"],
                    "description": "Statistical test to use. Default 'auto' picks based on group count and data pairing.",
                    "default": "auto",
                },
            },
            "required": ["metric", "group_by"],
        },
    },
    "correlate": {
        "function": correlate,
        "description": "Compute Pearson correlation between two score dimensions. Returns r, p-value, N, r-squared, interpretation, and data points for plotting.",
        "input_schema": {
            "type": "object",
            "properties": {
                "x": {
                    "type": "string",
                    "description": "First metric/dimension name, e.g. 'accuracy', 'coaching'.",
                },
                "y": {
                    "type": "string",
                    "description": "Second metric/dimension name.",
                },
                "filter": {
                    "type": "object",
                    "description": "Optional filter to restrict data.",
                },
            },
            "required": ["x", "y"],
        },
    },
    "distribution": {
        "function": distribution,
        "description": "Compute distribution statistics for a metric: mean, SD, median, skew, kurtosis, Shapiro normality test, histogram bins. Optionally split by group.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "description": "Score dimension to analyze, e.g. 'accuracy', 'overall_score'.",
                },
                "filter": {
                    "type": "object",
                    "description": "Optional filter to restrict data.",
                },
                "group_by": {
                    "type": "string",
                    "description": "Optional field to split distribution by (e.g. 'config_id', 'layer').",
                },
            },
            "required": ["metric"],
        },
    },
    "plot": {
        "function": plot,
        "description": "Generate a plot and save to docs/genie/plots/. Supported types: 'bar' (with error bars), 'box' (distribution per group), 'scatter' (with regression line), 'heatmap' (matrix with cell annotations).",
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["bar", "box", "scatter", "heatmap"],
                    "description": "Plot type.",
                },
                "title": {
                    "type": "string",
                    "description": "Plot title.",
                },
                "data": {
                    "type": "object",
                    "description": "Plot-specific data. Bar: {labels, values, errors, ylabel}. Box: {groups: {name: [values]}, ylabel}. Scatter: {x, y, xlabel, ylabel}. Heatmap: {matrix, row_labels, col_labels}.",
                },
                "filename": {
                    "type": "string",
                    "description": "Optional filename (auto-generated if omitted).",
                },
            },
            "required": ["type", "title", "data"],
        },
    },
    "save_finding": {
        "function": save_finding,
        "description": "Save a research finding to docs/genie/findings/ as a markdown file with structured claim, confidence level, evidence, caveats, and next steps.",
        "input_schema": {
            "type": "object",
            "properties": {
                "claim": {
                    "type": "string",
                    "description": "The finding claim, e.g. 'BSA knowledge improves accuracy by +1.3 points'.",
                },
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Confidence level in this finding.",
                },
                "evidence": {
                    "type": "object",
                    "description": "Supporting evidence: test results, N, runs used, etc.",
                },
                "caveats": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Limitations and caveats.",
                },
                "next_steps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Suggested follow-up analyses or experiments.",
                },
            },
            "required": ["claim", "confidence", "evidence", "caveats"],
        },
    },
}
