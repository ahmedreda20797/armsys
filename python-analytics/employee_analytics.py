#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ARM ERP — Python Analytics Engine (Phase 5)
Deterministic Statistical & Pattern Analysis over the verified
EmployeePerformanceDataset produced by the existing Performance
Intelligence layer (TypeScript KPI Engine remains the ONLY KPI
source of truth).

ARCHITECTURAL BOUNDARY (Phase 5 spec):
  Canonical DB → KPI Engine → Performance Intelligence dataset
    → THIS SCRIPT (analysis only) → Verified Analytical Results
    → future AI Narrative Layer.

HARD RULES ENFORCED BY DESIGN:
  • READ-ONLY: input arrives on stdin, output leaves on stdout.
    No database drivers, no network modules, no filesystem writes.
  • NEVER recalculates Quality Score / Weight / Weighted
    Contribution / Company KPI. KPI facts are echoed VERBATIM
    (kpiFactsEcho) purely for traceability.
  • FACT + ANALYSIS only. No human judgment, no narratives,
    no recommendations, no psychological or managerial labels.
  • Deterministic: no wall-clock time, no randomness, no network.
    Same input bytes → same output bytes.

STATISTICAL SAFETY (documented thresholds, spec §11):
  • Trend statistics            : >= 3 available monthly scores
  • Anomaly detection baseline  : >= 5 complete months + |robust z| >= 3
  • Cross-domain patterns       : >= 4 months + >= 2 shared increase months
  • Correlation (Pearson)       : >= 8 paired numeric months
  • MTD (partial month)         : anomaly detection / cross-domain /
                                  correlation EXCLUDED (partial data bias);
                                  the raw MTD delta is still reported as FACT.
  • Missing KPI months are NEVER treated as zero.
    (Record-count series treat "no stored records in a month" as 0
    records — that is a stored fact, not a fabricated value.)

INPUT (stdin, UTF-8 JSON):
  {
    "schemaVersion": 1,
    "dataset": { ...EmployeePerformanceDataset (verbatim TS contract)... }
  }

OUTPUT (stdout, UTF-8 JSON): see build_result() / README.md.
  status "OK" → exit 0. Invalid input → error JSON on stdout, exit 2.
"""

import json
import math
import statistics
import sys
from datetime import date

SCHEMA_VERSION = 1
ANALYTICS_KIND = "EMPLOYEE_PERFORMANCE_ANALYTICS"
DATASET_KIND = "EMPLOYEE_PERFORMANCE_INTELLIGENCE"

# Phase 5.2 (spec §26): simple engine version identifier carried in the
# result — helps diagnose which engine produced production analytics.
# Deliberately NOT tied to the application package version. Additive
# field only; no algorithm or contract semantics change (schemaVersion
# stays 1).
ENGINE_VERSION = "1.0.0"

# ── Deterministic statistical thresholds (spec §11 — documented) ──
TREND_MIN_MONTHS = 3
ANOMALY_BASELINE_MIN_MONTHS = 5
ANOMALY_Z_THRESHOLD = 3.0
ANOMALY_Z_HIGH_SEVERITY = 5.0
SCORE_DROP_THRESHOLD_POINTS = 10.0
SCORE_DROP_HIGH_SEVERITY_POINTS = 20.0
CORRELATION_MIN_MONTHS = 8
CROSS_DOMAIN_MIN_MONTHS = 4
CROSS_DOMAIN_MIN_SHARED_INCREASES = 2
CONCENTRATION_MIN_COUNT = 3
CONCENTRATION_MIN_SHARE_PCT = 40.0
DIRECTION_SLOPE_THRESHOLD_PP = 0.5  # points per month

THRESHOLDS = {
    "trendMinMonths": TREND_MIN_MONTHS,
    "anomalyBaselineMinMonths": ANOMALY_BASELINE_MIN_MONTHS,
    "anomalyZThreshold": ANOMALY_Z_THRESHOLD,
    "scoreDropThresholdPoints": SCORE_DROP_THRESHOLD_POINTS,
    "correlationMinMonths": CORRELATION_MIN_MONTHS,
    "crossDomainMinMonths": CROSS_DOMAIN_MIN_MONTHS,
    "crossDomainMinSharedIncreases": CROSS_DOMAIN_MIN_SHARED_INCREASES,
    "concentrationMinCount": CONCENTRATION_MIN_COUNT,
    "concentrationMinSharePct": CONCENTRATION_MIN_SHARE_PCT,
    "directionSlopeThresholdPpPerMonth": DIRECTION_SLOPE_THRESHOLD_PP,
}

ANALYSIS_DOMAINS = ["observations", "complaints", "capa", "followUps", "deals"]

NOTE_CODES = {
    "ANOMALY_NOT_WRONGDOING": "An anomaly is a statistical deviation, "
                               "not a judgment about the employee.",
    "ASSOCIATION_NOT_CAUSATION": "Temporal association only — no causal "
                                 "claim is made or implied.",
    "CORRELATION_NOT_CAUSATION": "Correlation is not causation.",
    "MTD_PARTIAL_MONTH": "The reported month is MTD (partial); partial "
                         "counts bias month-level statistics, so those "
                         "analyses are skipped.",
    "ABSENT_MONTH_IS_ZERO_RECORDS": "Within the analysis window, a month "
                                    "with no stored records counts as 0 "
                                    "records (a stored fact). KPI score "
                                    "months without results are never "
                                    "zero-filled.",
}

CONFIDENCE_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "INSUFFICIENT_DATA": 0}


# ══════════════════════════════════════════════════════════════
#  Small deterministic helpers
# ══════════════════════════════════════════════════════════════

def _num(value):
    """Coerce to float, or None when not numeric (never raises)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    return None


def _r(value, digits=2):
    """Deterministic rounding; None passes through."""
    if value is None:
        return None
    return round(float(value), digits)


def _mean(values):
    return statistics.fmean(values) if values else None


def _median(values):
    return statistics.median(values) if values else None


def _stddev(values):
    """Sample standard deviation; None when fewer than 2 points."""
    if len(values) < 2:
        return None
    return statistics.stdev(values)


def _least_squares_slope(pairs):
    """Slope of y on x; None when not computable (n<2 or zero variance)."""
    if len(pairs) < 2:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mean_x = _mean(xs)
    mean_y = _mean(ys)
    if mean_x is None or mean_y is None:
        return None
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    var = sum((x - mean_x) ** 2 for x in xs)
    if var == 0:
        return None
    return cov / var


def _pearson(pairs):
    """Pearson r; None when not computable (n<2 or zero variance)."""
    if len(pairs) < 2:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mean_x = _mean(xs)
    mean_y = _mean(ys)
    if mean_x is None or mean_y is None:
        return None
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if var_x == 0 or var_y == 0:
        return None
    r = cov / math.sqrt(var_x * var_y)
    return max(-1.0, min(1.0, r))


def _robust_baseline(values):
    """Median / MAD baseline for conservative anomaly detection.

    Returns (median, sigma) where sigma is MAD scaled to a normal
    distribution; falls back to population standard deviation when
    MAD == 0. Returns (median, None) for a perfectly flat baseline
    (no spread → z-score undefined → detection skipped upstream).
    """
    if not values:
        return None, None
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values])
    sigma = (mad / 0.6745) if mad > 0 else None
    if sigma is None:
        if len(values) >= 2:
            mu = _mean(values)
            var = sum((v - mu) ** 2 for v in values) / len(values)
            sigma = math.sqrt(var) if var > 0 else None
        else:
            sigma = None
    return med, sigma


def _direction_from_slope(slope):
    if slope is None:
        return None
    if slope >= DIRECTION_SLOPE_THRESHOLD_PP:
        return "UP"
    if slope <= -DIRECTION_SLOPE_THRESHOLD_PP:
        return "DOWN"
    return "STABLE"


def _parse_stored_date(value):
    """Parse the stored 'DD/MM/YYYY' observation dates deterministically.

    Returns a date or None. Never guesses formats beyond the stored one.
    """
    if not isinstance(value, str):
        return None
    parts = value.strip().split("/")
    if len(parts) != 3:
        return None
    try:
        d, m, y = (int(p) for p in parts)
        return date(y, m, d)
    except ValueError:
        return None


def _month_index(window, month):
    try:
        return window.index(month)
    except ValueError:
        return None


def _pct(part, whole):
    if whole is None or whole <= 0:
        return None
    return _r((float(part) / float(whole)) * 100.0, 1)


def _distribution(entries, total):
    """Shared distribution builder.

    entries: iterable of (key, label, count) — sorted deterministically
    (count desc, then key asc). sharePct = count / total * 100.
    concentration entries are MEASURABLE FACTS only (spec §8):
    count >= 3 and share >= 40% of the period total.
    """
    cleaned = []
    for key, label, count in entries:
        n = _num(count)
        if n is None or n <= 0:
            continue
        cleaned.append((key if key is not None else "_unclassified",
                        label if label else "_unclassified", int(n)))
    cleaned.sort(key=lambda e: (-e[2], str(e[0])))
    total_n = float(total) if total else float(sum(e[2] for e in cleaned))
    items = [{
        "key": k,
        "label": lbl,
        "count": n,
        "sharePct": _pct(n, total_n),
    } for k, lbl, n in cleaned]
    concentration = []
    for item in items:
        if (item["count"] >= CONCENTRATION_MIN_COUNT
                and item["sharePct"] is not None
                and item["sharePct"] >= CONCENTRATION_MIN_SHARE_PCT):
            concentration.append({
                "key": item["key"],
                "label": item["label"],
                "count": item["count"],
                "sharePct": item["sharePct"],
            })
    return {
        "total": int(total_n),
        "items": items,
        "concentration": concentration,
    }


def _record_dist(record):
    """Distribution over a Record<string, number> mapping."""
    mapping = {}
    if isinstance(record, dict):
        mapping = record
    entries = [(k, k, v) for k, v in mapping.items()]
    total = sum(int(_num(v) or 0) for v in mapping.values())
    return _distribution(entries, total)


def _category_dist(category_counts):
    """Distribution over CategoryCount[] (categoryId + categoryName)."""
    rows = [c for c in (category_counts or []) if isinstance(c, dict)]
    entries = [
        (c.get("categoryId"), c.get("categoryName"), c.get("count"))
        for c in rows
    ]
    total = sum(int(_num(c.get("count")) or 0) for c in rows)
    return _distribution(entries, total)


def _monthly_series(window, monthly):
    """Complete count series over the window.

    `monthly` is the dataset's canonical 'Months WITH data' list of
    {month, count}. A window month absent from it has 0 stored records —
    that is a fact about stored data (spec-noted), never a fabricated
    observation. Months listed OUTSIDE the window are ignored (counted
    separately for the data-quality report).
    """
    counts = {}
    for row in (monthly or []):
        if not isinstance(row, dict):
            continue
        m = row.get("month")
        n = _num(row.get("count"))
        if m is None or n is None:
            continue
        counts[m] = int(n)
    series = [counts.get(m, 0) for m in window]
    outside = sorted(m for m in counts if m not in set(window))
    return series, outside


def _series_increases(series):
    """Indices where the count increased vs the previous month."""
    return [i for i in range(1, len(series)) if series[i] > series[i - 1]]


def _evidence_ref(ref, complete=True):
    """Normalize an evidence reference; never invents record ids."""
    if not isinstance(ref, dict):
        return None
    collection = ref.get("collection")
    ids = ref.get("recordIds")
    if not collection or not isinstance(ids, list):
        return None
    return {
        "collection": str(collection),
        "recordIds": [str(i) for i in ids],
        "completeRecordList": bool(complete),
    }


def _evidence_list(ref):
    out = []
    normalized = _evidence_ref(ref)
    if normalized:
        out.append(normalized)
    return out


def _worst_confidence(values):
    if not values:
        return None
    return min(values, key=lambda c: CONFIDENCE_RANK.get(c, -1))


# ══════════════════════════════════════════════════════════════
#  Input validation
# ══════════════════════════════════════════════════════════════

def _validate_envelope(envelope):
    """Return (dataset, None) or (None, error dict). Fail-closed."""
    if not isinstance(envelope, dict):
        return None, {"code": "INVALID_ENVELOPE", "message": "Input must be a JSON object."}
    if envelope.get("schemaVersion") != SCHEMA_VERSION:
        return None, {"code": "UNSUPPORTED_SCHEMA_VERSION",
                      "message": "schemaVersion must be %d." % SCHEMA_VERSION}
    dataset = envelope.get("dataset")
    if not isinstance(dataset, dict):
        return None, {"code": "MISSING_DATASET", "message": "dataset object is required."}
    if dataset.get("datasetKind") != DATASET_KIND:
        return None, {"code": "UNSUPPORTED_DATASET_KIND",
                      "message": "datasetKind must be %s." % DATASET_KIND}
    required = ["employee", "period", "kpi", "trend", "quality",
                "complaints", "capa", "followUps", "deals", "attendance",
                "dataQuality", "evidence"]
    missing = [k for k in required if k not in dataset]
    if missing:
        return None, {"code": "MISSING_DATASET_FIELDS",
                      "message": "Missing dataset fields: %s" % ", ".join(missing)}
    return dataset, None


# ══════════════════════════════════════════════════════════════
#  §7 Trend analysis
# ══════════════════════════════════════════════════════════════

def analyze_trend(dataset, window):
    trend = dataset.get("trend") or {}
    points = trend.get("points") or []
    window_list = list(window or [])

    available = {}
    for p in points:
        if not isinstance(p, dict):
            continue
        if not p.get("available"):
            continue
        score = _num(p.get("rawScore"))
        if score is None:
            continue
        available[p.get("monthKey")] = score

    missing_months = [m for m in window_list if m not in available]
    ordered = [(m, available[m]) for m in window_list if m in available]
    scores = [v for _, v in ordered]
    n = len(scores)

    result = {
        "status": "OK" if n >= TREND_MIN_MONTHS else "INSUFFICIENT_DATA",
        "availableMonths": n,
        "missingMonths": missing_months,
        "stats": None,
        "periodOverPeriod": [],
        "momEcho": trend.get("mom") if isinstance(trend.get("mom"), dict) else None,
        "directionEcho": trend.get("direction"),
        "confidence": "INSUFFICIENT_DATA",
        "noteCodes": [],
        "mtdPartial": False,
    }

    # Period-over-period deltas over consecutive AVAILABLE months only —
    # gaps never produce a delta and never produce a zero-filled score.
    for i in range(1, len(ordered)):
        prev_m, prev_v = ordered[i - 1]
        cur_m, cur_v = ordered[i]
        result["periodOverPeriod"].append({
            "fromMonth": prev_m,
            "toMonth": cur_m,
            "deltaPoints": _r(cur_v - prev_v, 2),
        })

    if n < TREND_MIN_MONTHS:
        result["noteCodes"].append("INSUFFICIENT_TREND_DATA")
        return result

    mean_v = _mean(scores)
    median_v = _median(scores)
    min_v = min(scores)
    max_v = max(scores)
    std_v = _stddev(scores)
    pairs = [(_month_index(window_list, m), v) for m, v in ordered]
    slope = _least_squares_slope(pairs)
    cv = None
    if std_v is not None and mean_v not in (None, 0):
        cv = _r((std_v / mean_v) * 100.0, 1)

    result["stats"] = {
        "metric": "kpi.quality.rawScore",
        "count": n,
        "mean": _r(mean_v),
        "median": _r(median_v),
        "min": _r(min_v),
        "max": _r(max_v),
        "range": _r(max_v - min_v),
        "stdDev": _r(std_v),
        "stdDevBasis": "SAMPLE",
        "slopePerMonth": _r(slope, 3),
        "slopeUnit": "ppPerMonth",
        "direction": _direction_from_slope(slope),
        "coefficientOfVariationPct": cv,
        "firstMonth": ordered[0][0],
        "lastMonth": ordered[-1][0],
    }
    result["confidence"] = "HIGH" if n >= 6 else "MEDIUM"
    return result


# ══════════════════════════════════════════════════════════════
#  §8 Observation patterns / §12-§16 domain distributions
# ══════════════════════════════════════════════════════════════

def analyze_observations(dataset, window, outside_months):
    quality = dataset.get("quality") or {}
    obs = quality.get("observations") or {}

    by_category = _category_dist(obs.get("byCategory"))
    by_severity = _record_dist(obs.get("bySeverity"))
    by_resolution = _record_dist(obs.get("byResolutionStatus"))

    series, outside = _monthly_series(window, obs.get("monthly"))
    outside_months.update(outside)

    slope = None
    if len(series) >= TREND_MIN_MONTHS:
        slope = _least_squares_slope([(i, v) for i, v in enumerate(series)])

    total = int(_num(obs.get("total")) or 0)
    return {
        "status": "OK" if total > 0 else "EMPTY",
        "total": total,
        "approvalDistribution": {
            "approved": int(_num(obs.get("approved")) or 0),
            "pending": int(_num(obs.get("pending")) or 0),
            "rejected": int(_num(obs.get("rejected")) or 0),
        },
        "byCategory": by_category,
        "bySeverity": by_severity,
        "byResolutionStatus": by_resolution,
        "monthlySeries": {"window": list(window), "counts": series},
        "monthlySlopePerMonth": _r(slope, 3),
        "noteCodes": [],
    }


def analyze_deductions(dataset):
    quality = dataset.get("quality") or {}
    ded = quality.get("deductions") or {}
    count = int(_num(ded.get("count")) or 0)
    total_days = _num(ded.get("totalDays"))
    total_amount = _num(ded.get("totalAmount"))
    by_type = _category_dist(ded.get("byType"))

    # Days and amounts stay SEPARATE (Phase 4 doctrine carries here):
    # never merged, never converted into each other.
    return {
        "status": "OK" if count > 0 else "EMPTY",
        "count": count,
        "totalDays": _r(total_days, 2),
        "totalAmount": _r(total_amount, 2),
        "avgDaysPerRecord": (_r(total_days / count, 2)
                             if count > 0 and total_days is not None else None),
        "byType": by_type,
        "noteCodes": [],
    }


def _relationship_of(facts):
    if not isinstance(facts, dict):
        return "NOT_AVAILABLE"
    rel = facts.get("relationship")
    return rel if isinstance(rel, str) else "NOT_AVAILABLE"


def analyze_complaints(dataset, window, outside_months):
    comp = dataset.get("complaints") or {}
    relationship = _relationship_of(comp)
    total = int(_num(comp.get("total")) or 0)

    series, outside = _monthly_series(window, comp.get("monthly"))
    outside_months.update(outside)

    result = {
        "relationship": relationship,
        "status": ("OK" if (total > 0 and relationship == "CONFIRMED")
                   else "EMPTY" if total == 0 else "NOT_CONFIRMED_ATTRIBUTION"),
        "total": total,
        "byStatus": _record_dist(comp.get("byStatus")),
        "byType": _record_dist(comp.get("byType")),
        "bySeverity": _record_dist(comp.get("bySeverity")),
        "resolution": {
            "resolvedOrClosed": int(_num(comp.get("resolvedOrClosed")) or 0),
            "stillOpen": int(_num(comp.get("stillOpen")) or 0),
            "avgResolutionDays": _r(_num(comp.get("avgResolutionDays")), 2),
        },
        "monthlySeries": {"window": list(window), "counts": series},
        "countTrend": None,
        "noteCodes": [],
    }

    if relationship != "CONFIRMED":
        # Spec §12: trend analysis only where attribution is confirmed.
        result["noteCodes"].append("ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION")
        return result

    if len(series) >= TREND_MIN_MONTHS:
        slope = _least_squares_slope([(i, v) for i, v in enumerate(series)])
        result["countTrend"] = {
            "slopePerMonth": _r(slope, 3),
            "direction": _direction_from_slope(slope),
        }
    else:
        result["noteCodes"].append("INSUFFICIENT_TREND_DATA")
    return result


def analyze_capa(dataset, window, outside_months):
    capa = dataset.get("capa") or {}
    total = int(_num(capa.get("total")) or 0)
    series, outside = _monthly_series(window, capa.get("monthly"))
    outside_months.update(outside)

    overdue = int(_num(capa.get("overdue")) or 0)
    slope = None
    if len(series) >= TREND_MIN_MONTHS:
        slope = _least_squares_slope([(i, v) for i, v in enumerate(series)])

    return {
        "relationship": _relationship_of(capa),
        "status": "OK" if total > 0 else "EMPTY",
        "total": total,
        "active": int(_num(capa.get("active")) or 0),
        "terminal": int(_num(capa.get("terminal")) or 0),
        "overdueRatePct": _pct(overdue, total),
        "byStatus": _record_dist(capa.get("byStatus")),
        "byPriority": _record_dist(capa.get("byPriority")),
        "bySource": _record_dist(capa.get("bySource")),
        "closure": {
            "closedCount": int(_num(capa.get("closedCount")) or 0),
            "avgClosureDays": _r(_num(capa.get("avgClosureDays")), 2),
            "avgOverdueDays": _r(_num(capa.get("avgOverdueDays")), 2),
        },
        "monthlySeries": {"window": list(window), "counts": series},
        "monthlySlopePerMonth": _r(slope, 3),
        "noteCodes": [],
    }


def analyze_follow_ups(dataset, window, outside_months):
    fu = dataset.get("followUps") or {}
    total = int(_num(fu.get("total")) or 0)
    overdue = int(_num(fu.get("overdue")) or 0)
    series, outside = _monthly_series(window, fu.get("monthly"))
    outside_months.update(outside)

    slope = None
    if len(series) >= TREND_MIN_MONTHS:
        slope = _least_squares_slope([(i, v) for i, v in enumerate(series)])

    return {
        "relationship": _relationship_of(fu),
        "status": "OK" if total > 0 else "EMPTY",
        "total": total,
        # Ratio of two CANONICAL counts — no new overdue definition.
        "overdueRatePct": _pct(overdue, total),
        "completionRatePctEcho": _r(_num(fu.get("completionRate")), 1),
        "byStatus": _record_dist(fu.get("byStatus")),
        "byType": _record_dist(fu.get("byType")),
        "byPriority": _record_dist(fu.get("byPriority")),
        "monthlySeries": {"window": list(window), "counts": series},
        "monthlySlopePerMonth": _r(slope, 3),
        "noteCodes": [],
    }


def analyze_deals(dataset, window, outside_months):
    # §DEAL-DATES — the analysis reads the TRAVEL dimension
    # (travelTotal, departure-month attribution); closedTotal is a
    # CLOSED-dimension (closedAt) echo, numeric or None.
    deals = dataset.get("deals") or {}
    total = int(_num(deals.get("travelTotal")) or 0)
    canceled = int(_num(deals.get("canceled")) or 0)
    series, outside = _monthly_series(window, deals.get("monthly"))
    outside_months.update(outside)

    slope = None
    if len(series) >= TREND_MIN_MONTHS:
        slope = _least_squares_slope([(i, v) for i, v in enumerate(series)])

    return {
        "relationship": _relationship_of(deals),
        "status": "OK" if total > 0 else "EMPTY",
        "travelTotal": total,
        "closedTotal": _num(deals.get("closedTotal")),
        "byStatus": _record_dist(deals.get("byStatus")),
        "cancellationRatePct": _pct(canceled, total),
        "completionRatePctEcho": _r(_num(deals.get("completionRate")), 1),
        "monthlySeries": {"window": list(window), "counts": series},
        "monthlySlopePerMonth": _r(slope, 3),
        # Spec §15: volume/status/cancellation analysis only —
        # NO sales-target calculations are performed anywhere.
        "noteCodes": [],
    }


def analyze_attendance(dataset):
    """§16 — attendance stays CONTEXT-ONLY and never feeds KPI analysis."""
    att = dataset.get("attendance") or {}
    status = att.get("status") or "NOT_AVAILABLE"
    result = att.get("result")
    out = {
        "status": status,
        "analysisRole": "CONTEXT_ONLY",
        "metrics": None,
        "noteCodes": [],
    }
    if status == "AVAILABLE" and isinstance(result, dict):
        out["metrics"] = {
            "month": result.get("month"),
            "workDays": _r(_num(result.get("workDays")), 2),
            "presentDays": _r(_num(result.get("presentDays")), 2),
            "lateDays": _r(_num(result.get("lateDays")), 2),
            "absentDays": _r(_num(result.get("absentDays")), 2),
            "totalMinutesLate": _r(_num(result.get("totalMinutesLate")), 2),
            "compliancePct": _r(_num(result.get("compliance")), 1),
        }
    else:
        out["noteCodes"].append("ATTENDANCE_NOT_AVAILABLE")
    return out


# ══════════════════════════════════════════════════════════════
#  §9 Repeated issue analysis (over the deterministic groups)
# ══════════════════════════════════════════════════════════════

def _analyze_period_group(group, obs_total):
    occ = int(_num(group.get("occurrenceCount")) or 0)
    first = _parse_stored_date(group.get("firstOccurrence"))
    last = _parse_stored_date(group.get("lastOccurrence"))
    interval = None
    if first and last and occ > 1 and last >= first:
        interval = _r((last - first).days / float(occ - 1), 1)
    return {
        "issueKey": group.get("issueKey"),
        "label": group.get("label"),
        "occurrenceCount": occ,
        "frequencyPctOfObservations": _pct(occ, obs_total),
        "recurrenceIntervalDays": interval,
        "observationIds": [str(i) for i in (group.get("observationIds") or [])],
    }


def _analyze_window_group(group, window):
    occ = int(_num(group.get("occurrenceCount")) or 0)
    months_present = int(_num(group.get("monthsPresent")) or 0)
    first_m = group.get("firstMonth")
    last_m = group.get("lastMonth")
    span = None
    i1 = _month_index(window, first_m) if first_m else None
    i2 = _month_index(window, last_m) if last_m else None
    if i1 is not None and i2 is not None and i2 >= i1:
        span = i2 - i1 + 1
    return {
        "issueKey": group.get("issueKey"),
        "label": group.get("label"),
        "occurrenceCount": occ,
        "monthsPresent": months_present,
        "monthsPresentPct": _pct(months_present, len(window)),
        "windowSpanMonths": span,
        "observationIds": [str(i) for i in (group.get("observationIds") or [])],
    }


def analyze_repeated_issues(dataset, window):
    quality = dataset.get("quality") or {}
    rep = quality.get("repeatedIssues") or {}
    obs = quality.get("observations") or {}
    obs_total = int(_num(obs.get("total")) or 0)

    return {
        "groupBasisEcho": rep.get("groupBasis"),
        "minOccurrencesEcho": rep.get("minOccurrences"),
        "byCategory": [_analyze_period_group(g, obs_total)
                       for g in (rep.get("byCategory") or []) if isinstance(g, dict)],
        "byType": [_analyze_period_group(g, obs_total)
                   for g in (rep.get("byType") or []) if isinstance(g, dict)],
        "windowByCategory": [_analyze_window_group(g, window)
                             for g in (rep.get("windowByCategory") or [])
                             if isinstance(g, dict)],
        "noteCodes": [],
    }


# ══════════════════════════════════════════════════════════════
#  §10 Anomaly detection (conservative, robust z-score)
# ══════════════════════════════════════════════════════════════

def detect_anomalies(dataset, window, series_by_domain, mtd_partial,
                     insufficient, trend_result):
    """Count-spike + score-drop anomalies.

    Conservative by construction:
      • baseline = window months EXCLUDING the reported month,
        requiring >= ANOMALY_BASELINE_MIN_MONTHS complete months;
      • only ABOVE-baseline spikes are flagged (no 'silence' flags);
      • robust z (median/MAD) with |z| >= 3;
      • an anomaly is explicitly NOT wrongdoing (note code).
    """
    anomalies = []
    evidence = dataset.get("evidence") or {}
    reported_month = window[-1] if window else None

    if mtd_partial:
        insufficient.append({
            "area": "anomalyDetection",
            "reason": "MTD_PARTIAL_MONTH",
            "detail": "Count-spike and score-drop detection skipped for the MTD reported month.",
        })
        return anomalies

    for domain in ANALYSIS_DOMAINS:
        series = series_by_domain.get(domain)
        if series is None or reported_month is None or len(series) < len(window):
            continue
        target = series[-1]
        baseline = series[:-1]
        if len(baseline) < ANOMALY_BASELINE_MIN_MONTHS:
            insufficient.append({
                "area": "anomalyDetection",
                "reason": "INSUFFICIENT_BASELINE",
                "detail": "%s: baseline has %d months, needs %d." % (
                    domain, len(baseline), ANOMALY_BASELINE_MIN_MONTHS),
            })
            continue
        med, sigma = _robust_baseline(baseline)
        if med is None or sigma is None or sigma == 0:
            insufficient.append({
                "area": "anomalyDetection",
                "reason": "FLAT_BASELINE",
                "detail": "%s: baseline has no spread; z-score undefined." % domain,
            })
            continue
        z = (target - med) / sigma
        if z < ANOMALY_Z_THRESHOLD:
            continue
        collection_ref = evidence.get(domain) if domain != "observations" \
            else evidence.get("observations")
        anomalies.append({
            "anomalyType": "%s_COUNT_SPIKE" % domain.upper(),
            "metric": "%s.monthlyCount" % domain,
            "month": reported_month,
            "observedValue": target,
            "expectedRange": {
                "low": _r(med - 3 * sigma, 2),
                "high": _r(med + 3 * sigma, 2),
                "medianBaseline": _r(med, 2),
                "method": "ROBUST_Z_MEDIAN_MAD",
            },
            "zScore": _r(z, 2),
            "direction": "ABOVE_EXPECTED",
            "severity": "HIGH" if z >= ANOMALY_Z_HIGH_SEVERITY else "MEDIUM",
            "confidence": "HIGH" if len(baseline) >= 12 else "MEDIUM",
            "noteCode": "ANOMALY_NOT_WRONGDOING",
            "supportingEvidence": _evidence_list(collection_ref),
        })

    # Sudden score drop — most recent period-over-period delta only.
    pops = (trend_result or {}).get("periodOverPeriod") or []
    if pops:
        last = pops[-1]
        delta = _num(last.get("deltaPoints"))
        if delta is not None and delta <= -SCORE_DROP_THRESHOLD_POINTS:
            anomalies.append({
                "anomalyType": "SCORE_DROP",
                "metric": "kpi.quality.rawScore.deltaPoints",
                "month": last.get("toMonth"),
                "observedValue": _r(delta, 2),
                "expectedRange": {
                    "low": None,
                    "high": -SCORE_DROP_THRESHOLD_POINTS,
                    "method": "FIXED_THRESHOLD",
                },
                "zScore": None,
                "direction": "BELOW_EXPECTED",
                "severity": ("HIGH" if delta <= -SCORE_DROP_HIGH_SEVERITY_POINTS
                             else "MEDIUM"),
                "confidence": (trend_result or {}).get("confidence"),
                "noteCode": "ANOMALY_NOT_WRONGDOING",
                "supportingEvidence": _evidence_list(evidence.get("kpi")),
            })
    return anomalies


# ══════════════════════════════════════════════════════════════
#  §17 Cross-domain temporal patterns + §18 correlation
# ══════════════════════════════════════════════════════════════

def _eligible_domains(series_by_domain, complaints_confirmed):
    eligible = {}
    for domain in ANALYSIS_DOMAINS:
        if domain == "complaints" and not complaints_confirmed:
            continue
        series = series_by_domain.get(domain)
        if series is not None:
            eligible[domain] = series
    return eligible


def analyze_cross_domain(series_by_domain, window, complaints_confirmed,
                         insufficient):
    patterns = []
    eligible = _eligible_domains(series_by_domain, complaints_confirmed)
    domains = sorted(eligible.keys())
    if len(window) < CROSS_DOMAIN_MIN_MONTHS:
        insufficient.append({
            "area": "crossDomainPatterns",
            "reason": "INSUFFICIENT_SAMPLE",
            "required": CROSS_DOMAIN_MIN_MONTHS,
            "actual": len(window),
        })
        return patterns
    for i in range(len(domains)):
        for j in range(i + 1, len(domains)):
            a, b = domains[i], domains[j]
            sa, sb = eligible[a], eligible[b]
            inc_a = set(_series_increases(sa))
            inc_b = set(_series_increases(sb))
            shared = sorted(inc_a & inc_b)
            if len(shared) < CROSS_DOMAIN_MIN_SHARED_INCREASES:
                continue
            patterns.append({
                "patternType": "TEMPORAL_ASSOCIATION",
                "domainA": a,
                "domainB": b,
                "sharedIncreaseMonthIndices": shared,
                "sharedIncreaseMonths": [window[k] for k in shared
                                         if 0 <= k < len(window)],
                "monthsAnalyzed": len(window),
                "confidence": ("HIGH" if len(window) >= 12 and len(shared) >= 3
                               else "MEDIUM"),
                "noteCode": "ASSOCIATION_NOT_CAUSATION",
            })
    return patterns


def analyze_correlations(series_by_domain, window, complaints_confirmed,
                         insufficient):
    correlations = []
    eligible = _eligible_domains(series_by_domain, complaints_confirmed)
    domains = sorted(eligible.keys())
    for i in range(len(domains)):
        for j in range(i + 1, len(domains)):
            a, b = domains[i], domains[j]
            pairs = list(zip(eligible[a], eligible[b]))
            n = len(pairs)
            if n < CORRELATION_MIN_MONTHS:
                insufficient.append({
                    "area": "correlation",
                    "reason": "INSUFFICIENT_SAMPLE",
                    "required": CORRELATION_MIN_MONTHS,
                    "actual": n,
                    "detail": "%s vs %s" % (a, b),
                })
                continue
            r = _pearson(pairs)
            if r is None:
                insufficient.append({
                    "area": "correlation",
                    "reason": "NO_VARIANCE",
                    "detail": "%s vs %s: zero variance in at least one series." % (a, b),
                })
                continue
            abs_r = abs(r)
            strength = ("STRONG" if abs_r >= 0.7 else
                        "MODERATE" if abs_r >= 0.4 else
                        "WEAK" if abs_r >= 0.2 else "NEGLIGIBLE")
            correlations.append({
                "variables": [a, b],
                "coefficient": _r(r, 4),
                "sampleSize": n,
                "strength": strength,
                "confidence": "HIGH" if n >= 12 else "MEDIUM",
                "noteCode": "CORRELATION_NOT_CAUSATION",
                "limitations": ["CORRELATION_NOT_CAUSATION", "SMALL_SAMPLE",
                                "COUNT_DATA_ONLY"],
            })
    return correlations


# ══════════════════════════════════════════════════════════════
#  §6 Period comparison (facts only)
# ══════════════════════════════════════════════════════════════

def build_period_comparison(series_by_domain, window, trend_result):
    if len(window) < 2:
        return {"status": "INSUFFICIENT_DATA", "current": None,
                "previous": None, "deltas": {},
                "kpiRawScoreDeltaPoints": None, "noteCode": None}
    current_m = window[-1]
    previous_m = window[-2]
    deltas = {}
    current = {"month": current_m}
    previous = {"month": previous_m}
    for domain in ANALYSIS_DOMAINS:
        series = series_by_domain.get(domain)
        if series is None or len(series) < len(window):
            continue
        current[domain] = series[-1]
        previous[domain] = series[-2]
        deltas[domain] = series[-1] - series[-2]
    score_delta = None
    pops = (trend_result or {}).get("periodOverPeriod") or []
    if pops:
        last = pops[-1]
        if (last.get("toMonth") == current_m
                and last.get("fromMonth") == previous_m):
            score_delta = last.get("deltaPoints")
    note = "MTD_PARTIAL_MONTH" if (trend_result or {}).get("mtdPartial") else None
    return {
        "status": "OK",
        "current": current,
        "previous": previous,
        "deltas": deltas,
        "kpiRawScoreDeltaPoints": score_delta,
        "noteCode": note,
    }


# ══════════════════════════════════════════════════════════════
#  §19 Data quality + §20 evidence
# ══════════════════════════════════════════════════════════════

def build_data_quality(dataset, window, trend_result, outside_months,
                       insufficient):
    dq = dataset.get("dataQuality") or {}
    employee = dataset.get("employee") or {}
    attendance = dataset.get("attendance") or {}

    missing = []
    if trend_result and trend_result.get("missingMonths"):
        missing.append({
            "area": "trend",
            "detail": "KPI months without results (never zero-filled): %s"
                      % ", ".join(trend_result["missingMonths"]),
        })
    if (attendance or {}).get("status") != "AVAILABLE":
        missing.append({"area": "attendance",
                        "detail": "attendanceResult not available"})

    ambiguous = []
    for domain in ("complaints", "capa", "followUps", "deals"):
        rel = _relationship_of(dataset.get(domain) or {})
        if rel != "CONFIRMED":
            ambiguous.append({"domain": domain, "relationship": rel})

    unavailable = []
    if (trend_result or {}).get("stats") is None:
        unavailable.append("trend.stats (insufficient available months)")
    fu = dataset.get("followUps") or {}
    if _num(fu.get("avgOverdueDays")) is None:
        unavailable.append("followUps.avgOverdueDays (not available in dataset)")

    notes = []
    if employee.get("archivedButEligible"):
        notes.append("ARCHIVED_BUT_ELIGIBLE: employee is archived now; the "
                     "reported period remains valid historical data. Only "
                     "stored records inside the window are analyzed — no "
                     "post-archive activity is fabricated.")
    notes.append("ABSENT_MONTH_IS_ZERO_RECORDS window convention applies to "
                 "record-count series only; KPI score gaps are never zero-filled.")
    if outside_months:
        notes.append("Monthly records outside the analysis window were "
                     "excluded: %s" % ", ".join(sorted(outside_months)))
    if (trend_result or {}).get("mtdPartial"):
        notes.append("MTD_PARTIAL_MONTH: partial-month analyses skipped "
                     "(count-spike anomalies, cross-domain, correlation).")

    return {
        "windowMonths": list(window),
        "missingData": missing,
        "ambiguousRelationships": ambiguous,
        "unattributedRecords": dq.get("unattributedRecords") or [],
        "insufficientSamples": insufficient,
        "unavailableMetrics": unavailable,
        "notes": notes,
        "sourceNotesEcho": dq.get("notes") or [],
    }


def build_evidence_references(dataset):
    evidence = dataset.get("evidence") or {}
    refs = []

    def add(ref):
        normalized = _evidence_ref(ref)
        if normalized:
            refs.append(normalized)

    kpi_ref = evidence.get("kpi")
    if isinstance(kpi_ref, list):
        for ref in kpi_ref:
            add(ref)
    for key in ("observations", "deductions", "complaints", "capa",
                "followUps", "deals"):
        add(evidence.get(key))
    add(evidence.get("attendance"))
    return refs


# ══════════════════════════════════════════════════════════════
#  Result assembly
# ══════════════════════════════════════════════════════════════

def build_result(dataset):
    employee = dataset.get("employee") or {}
    period = dataset.get("period") or {}
    kpi = dataset.get("kpi") or {}
    kpi_quality = kpi.get("quality") or {}
    dq = dataset.get("dataQuality") or {}

    window = [m for m in (dq.get("windowMonths") or []) if isinstance(m, str)]
    if not window:
        window = [m for m in ((dataset.get("trend") or {}).get("windowMonths") or [])
                  if isinstance(m, str)]

    value_basis = period.get("valueBasis")
    mtd_partial = value_basis == "MTD"
    outside_months = set()
    insufficient = []

    # ── Domain series (record counts; 0 = no stored records in month) ──
    series_by_domain = {}
    obs_result = analyze_observations(dataset, window, outside_months)
    comp_result = analyze_complaints(dataset, window, outside_months)
    capa_result = analyze_capa(dataset, window, outside_months)
    fu_result = analyze_follow_ups(dataset, window, outside_months)
    deals_result = analyze_deals(dataset, window, outside_months)
    series_by_domain["observations"] = obs_result["monthlySeries"]["counts"]
    series_by_domain["complaints"] = comp_result["monthlySeries"]["counts"]
    series_by_domain["capa"] = capa_result["monthlySeries"]["counts"]
    series_by_domain["followUps"] = fu_result["monthlySeries"]["counts"]
    series_by_domain["deals"] = deals_result["monthlySeries"]["counts"]

    complaints_confirmed = _relationship_of(
        dataset.get("complaints") or {}) == "CONFIRMED"

    trend_result = analyze_trend(dataset, window)
    trend_result["mtdPartial"] = mtd_partial

    anomalies = detect_anomalies(dataset, window, series_by_domain,
                                 mtd_partial, insufficient, trend_result)
    patterns = analyze_repeated_issues(dataset, window)
    cross_domain = analyze_cross_domain(series_by_domain, window,
                                        complaints_confirmed, insufficient)
    correlations = analyze_correlations(series_by_domain, window,
                                        complaints_confirmed, insufficient)
    period_comparison = build_period_comparison(series_by_domain, window,
                                                trend_result)
    attendance = analyze_attendance(dataset)

    # Confidence: deterministic worst-of over analyses that ran.
    confidences = [trend_result.get("confidence") or "INSUFFICIENT_DATA"]
    for a in anomalies:
        confidences.append(a.get("confidence") or "MEDIUM")
    for c in correlations:
        confidences.append(c.get("confidence") or "MEDIUM")
    for p in cross_domain:
        confidences.append(p.get("confidence") or "MEDIUM")
    overall = _worst_confidence(confidences) or "INSUFFICIENT_DATA"

    # kpiFactsEcho — VERBATIM pass-through of engine outputs (proof that
    # this layer never recalculates KPI values). Nothing else in the
    # result carries these fields.
    kpi_echo = {
        "source": kpi.get("source"),
        "rowStatus": kpi.get("rowStatus"),
        "overallStatus": kpi.get("overallStatus"),
        "componentId": kpi_quality.get("componentId"),
        "name": kpi_quality.get("name"),
        "status": kpi_quality.get("status"),
        "rawScore": kpi_quality.get("rawScore"),
        "weight": kpi_quality.get("weight"),
        "weightedContribution": kpi_quality.get("weightedContribution"),
        "maxContribution": kpi_quality.get("maxContribution"),
        "calculationVersion": kpi.get("calculationVersion"),
    }

    if mtd_partial:
        insufficient.insert(0, {
            "area": "mtdPartialMonth",
            "reason": "MTD_PARTIAL_MONTH",
            "detail": "Reported month is MTD; partial-month analyses are excluded by design.",
        })

    return {
        "schemaVersion": SCHEMA_VERSION,
        "analyticsKind": ANALYTICS_KIND,
        "analyticsEngineVersion": ENGINE_VERSION,
        "deterministic": True,
        "status": "OK",
        "input": {
            "employeeId": employee.get("employeeId"),
            "employeeName": employee.get("employeeName"),
            "employmentStatus": employee.get("employmentStatus"),
            "archivedButEligible": employee.get("archivedButEligible"),
            "monthKey": period.get("monthKey"),
            "valueBasis": value_basis,
            "finalized": period.get("finalized"),
            "windowMonths": window,
            "datasetGeneratedAt": dataset.get("generatedAt"),
        },
        "kpiFactsEcho": kpi_echo,
        "trendAnalysis": trend_result,
        "patternAnalysis": {
            "observations": obs_result,
            "repeatedIssues": patterns,
            "deductions": analyze_deductions(dataset),
        },
        "anomalies": anomalies,
        "distributionAnalysis": {
            "complaints": comp_result,
            "capa": capa_result,
            "followUps": fu_result,
            "deals": deals_result,
            "attendance": attendance,
        },
        "periodComparison": period_comparison,
        "crossDomainPatterns": cross_domain,
        "correlations": correlations,
        "dataQuality": build_data_quality(dataset, window, trend_result,
                                          outside_months, insufficient),
        "evidenceReferences": build_evidence_references(dataset),
        "overallConfidence": overall,
        "thresholds": THRESHOLDS,
        "noteCodes": sorted(NOTE_CODES.keys()),
        "interpretationBoundary": "FACT_AND_ANALYSIS_ONLY",
    }


# ══════════════════════════════════════════════════════════════
#  Entry point — stdin → stdout, nothing else
# ══════════════════════════════════════════════════════════════

def main():
    try:
        raw = sys.stdin.read()
        envelope = json.loads(raw)
    except Exception as exc:  # malformed JSON / unreadable stdin
        json.dump({"status": "INVALID_INPUT", "error": {
            "code": "UNREADABLE_INPUT", "message": str(exc)}},
            sys.stdout)
        sys.stdout.write("\n")
        return 2

    dataset, error = _validate_envelope(envelope)
    if error is not None:
        json.dump({"status": "INVALID_INPUT", "error": error}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    result = build_result(dataset)
    json.dump(result, sys.stdout, ensure_ascii=True, sort_keys=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
