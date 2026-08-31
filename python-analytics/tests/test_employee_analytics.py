#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python Analytics Engine — unit tests (Phase 5 spec §34).

Run:  python3 -m unittest discover -s python-analytics/tests -v
(no third-party dependencies; stdlib unittest only)

Covers: trend calculation, missing months, insufficient data,
mean/median, standard deviation, period comparison, repeated issue
analysis, complaint trend + attribution gating, CAPA trend,
follow-up trend, deal trend, attendance context-only, anomaly
detection, small-sample handling, evidence references, confidence
levels, archived employee, finalized months, KPI immutability,
determinism / JSON serialization, and the read-only source contract.
"""

import io
import json
import math
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import employee_analytics as ea  # noqa: E402


# ══════════════════════════════════════════════════════════════
#  Fixtures — minimal EmployeePerformanceDataset-shaped dicts
# ══════════════════════════════════════════════════════════════

def make_points(window, scores, value_basis="FINALIZED"):
    """scores: dict monthIndex(1-based) -> rawScore (None = unavailable)."""
    points = []
    for i, month in enumerate(window, start=1):
        s = scores.get(i)
        points.append({
            "monthKey": month,
            "valueBasis": value_basis if i == len(window) else "FINALIZED",
            "available": s is not None,
            "rawScore": s,
            "weightedContribution": (round(s * 15 / 100, 2) if s is not None else None),
            "weight": 15,
            "rowStatus": "AVAILABLE" if s is not None else "PENDING",
            "finalized": i < len(window),
            "schemeId": "scheme-1",
        })
    return points


def make_dataset(scores=None, window=None, monthly=None, complaints=None,
                 reported_basis="FINALIZED", archived=False):
    window = window or ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    scores = scores if scores is not None else {1: 80, 2: 85, 3: 90, 4: 88, 5: 92, 6: 91}
    monthly = monthly or {
        "observations": [{"month": m, "count": c} for m, c in
                         zip(window, [1, 2, 1, 2, 1, 20])],
        "complaints": [{"month": m, "count": c} for m, c in
                       zip(window, [0, 1, 0, 1, 0, 1])],
        "capa": [{"month": m, "count": c} for m, c in
                 zip(window, [0, 0, 1, 0, 0, 0])],
        "followUps": [{"month": m, "count": c} for m, c in
                      zip(window, [1, 1, 1, 2, 1, 1])],
        "deals": [{"month": m, "count": c} for m, c in
                  zip(window, [2, 3, 2, 3, 2, 3])],
    }
    return {
        "datasetKind": "EMPLOYEE_PERFORMANCE_INTELLIGENCE",
        "employee": {
            "employeeId": "emp-1",
            "employeeName": "موظف تجريبي",
            "employeeCode": "E-001",
            "department": "العمليات",
            "position": "مختص جودة",
            "employmentStatus": "archived" if archived else "active",
            "eligibleForPeriod": True,
            "archivedButEligible": archived,
            "archivedAt": "2026-07-01T00:00:00.000Z" if archived else None,
            "restoredAt": None,
            "relationship": "CONFIRMED",
        },
        "period": {
            "monthKey": window[-1],
            "valueBasis": reported_basis,
            "finalized": reported_basis == "FINALIZED",
            "finalizedAt": "2026-07-02T00:00:00.000Z" if reported_basis == "FINALIZED" else None,
        },
        "kpi": {
            "outcomeStatus": "VALUE",
            "message": None,
            "scheme": {"schemeId": "scheme-1", "schemeName": "الافتراضي",
                       "schemeVersion": 1, "qualityWeight": 15, "frozen": True},
            "quality": {
                "componentId": "quality",
                "name": "الجودة",
                "status": "AVAILABLE",
                "rawScore": scores.get(len(window)),
                "weight": 15,
                "weightedContribution": (round(scores.get(len(window)) * 15 / 100, 2)
                                         if scores.get(len(window)) is not None else None),
                "maxContribution": 15,
                "observationCount": 27,
                "deductionPoints": 0,
                "bonusPoints": 0,
            },
            "availableWeight": 15,
            "weightedTotal": (round(scores.get(len(window)) * 15 / 100, 2)
                              if scores.get(len(window)) is not None else None),
            "overallStatus": "AVAILABLE",
            "rowStatus": "AVAILABLE",
            "calculationVersion": "v1",
            "source": "kpi_engine",
        },
        "trend": {
            "windowMonths": list(window),
            "points": make_points(window, scores, reported_basis),
            "mom": None,
            "direction": None,
        },
        "quality": {
            "observations": {
                "total": 27, "approved": 20, "pending": 5, "rejected": 2,
                "byResolutionStatus": {"open": 5, "resolved": 22},
                "bySeverity": {"low": 10, "medium": 12, "high": 5},
                "byCategory": [
                    {"categoryId": "c1", "categoryName": "توقيت المتابعة", "count": 8},
                    {"categoryId": "c2", "categoryName": "دقة البيانات", "count": 5},
                ],
                "monthly": monthly["observations"],
            },
            "repeatedIssues": {
                "groupBasis": {"category": "categoryId", "type": "type"},
                "minOccurrences": 2,
                "byCategory": [{
                    "issueKey": "c1", "label": "توقيت المتابعة",
                    "occurrenceCount": 8,
                    "firstOccurrence": "01/02/2026",
                    "lastOccurrence": "20/05/2026",
                    "observationIds": ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"],
                }],
                "byType": [],
                "windowByCategory": [{
                    "issueKey": "c1", "label": "توقيت المتابعة",
                    "occurrenceCount": 8, "monthsPresent": min(3, len(window)),
                    "firstMonth": window[1] if len(window) > 1 else None,
                    "lastMonth": window[min(3, len(window) - 1)] if window else None,
                    "observationIds": ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"],
                }],
            },
            "deductions": {
                "count": 2, "totalDays": 3, "totalAmount": 500,
                "byType": [{"categoryId": "d1", "categoryName": "تأخير", "count": 2}],
                "records": [],
            },
        },
        "complaints": complaints if complaints is not None else {
            "relationship": "INDIRECT",
            "total": 3,
            "byStatus": {"open": 1, "resolved": 2},
            "byType": {"service": 2, "billing": 1},
            "bySeverity": {"low": 2, "high": 1},
            "repeatedTypes": [],
            "resolvedOrClosed": 2, "stillOpen": 1, "viaDealCount": 1,
            "avgResolutionDays": 4.5,
            "monthly": monthly["complaints"],
        },
        "capa": {
            "relationship": "CONFIRMED", "total": 1,
            "byStatus": {"open": 1}, "byPriority": {"medium": 1},
            "bySource": {"observation": 1},
            "active": 1, "terminal": 0, "overdue": 0, "avgOverdueDays": None,
            "correctiveStatus": {"not_started": 1, "in_progress": 0, "completed": 0},
            "preventiveStatus": {"not_started": 0, "in_progress": 0, "completed": 0},
            "closedCount": 0, "avgClosureDays": None, "indirectCount": 0,
            "monthly": monthly["capa"],
        },
        "followUps": {
            "relationship": "CONFIRMED", "total": 7,
            "byStatus": {"open": 2, "completed": 5},
            "active": 2, "terminal": 5, "overdue": 1, "dueToday": 0,
            "avgOverdueDays": None, "completed": 5, "completionRate": 71.4,
            "byType": {"call": 4, "visit": 3}, "byPriority": {"normal": 7},
            "monthly": monthly["followUps"],
        },
        "deals": {
            "relationship": "CONFIRMED", "total": 15,
            "byStatus": {"upcoming": 2, "in_progress": 3, "completed": 8, "canceled": 2},
            "completed": 8, "canceled": 2, "active": 5, "completionRate": 53.3,
            "monthly": monthly["deals"],
        },
        "attendance": {
            "status": "AVAILABLE", "source": "attendanceResults",
            "result": {
                "month": window[-1], "workDays": 26, "presentDays": 24,
                "lateDays": 2, "absentDays": 0, "exemptDays": 0,
                "unaccountedDays": 0, "totalMinutesLate": 45,
                "lateDeductionDays": 1, "absenceDeductionDays": 0,
                "attendanceDeductionDays": 1, "compliance": 92.3,
                "engineVersion": "v1", "generatedAt": "2026-07-01T00:00:00.000Z",
            },
        },
        "dataQuality": {
            "windowMonths": list(window),
            "unattributedRecords": [{"collection": "complaints", "count": 1}],
            "notes": ["fixture note"],
        },
        "evidence": {
            "kpi": [{"collection": "monthSnapshots", "recordIds": ["ms-1"]},
                    {"collection": "kpiSchemes", "recordIds": ["scheme-1"]}],
            "observations": {"collection": "qualityObservations",
                             "recordIds": ["o%d" % i for i in range(1, 28)]},
            "deductions": {"collection": "qualityDeductions", "recordIds": ["d1", "d2"]},
            "complaints": {"collection": "complaints", "recordIds": ["c1", "c2", "c3"]},
            "capa": {"collection": "capaCases", "recordIds": ["capa-1"]},
            "followUps": {"collection": "followUps", "recordIds": ["f1", "f2"]},
            "deals": {"collection": "travelDeals", "recordIds": ["t1"]},
            "attendance": {"collection": "attendanceResults", "recordIds": ["a1"]},
        },
        "generatedAt": "2026-07-02T10:00:00.000Z",
    }


def envelope_of(dataset):
    return {"schemaVersion": 1, "dataset": dataset}


def run_engine(envelope):
    """Run the CLI end-to-end through stdin/stdout (the real boundary)."""
    stdin = sys.stdin
    stdout = sys.stdout
    sys.stdin = io.StringIO(json.dumps(envelope))
    sys.stdout = io.StringIO()
    try:
        code = ea.main()
        out = sys.stdout.getvalue()
    finally:
        sys.stdin = stdin
        sys.stdout = stdout
    return code, json.loads(out)


# ══════════════════════════════════════════════════════════════
#  Tests
# ══════════════════════════════════════════════════════════════

class TrendAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.code, self.result = run_engine(envelope_of(make_dataset()))
        self.trend = self.result["trendAnalysis"]

    def test_exit_zero_and_ok(self):
        self.assertEqual(self.code, 0)
        self.assertEqual(self.result["status"], "OK")

    def test_trend_stats_exact_values(self):
        """§7: mean/median/min/max/range/slope on known scores."""
        scores = [80, 85, 90, 88, 92, 91]
        stats = self.trend["stats"]
        self.assertAlmostEqual(stats["mean"], round(sum(scores) / 6, 2))  # 87.67
        self.assertEqual(stats["median"], 89.0)
        self.assertEqual(stats["min"], 80.0)
        self.assertEqual(stats["max"], 92.0)
        self.assertEqual(stats["range"], 12.0)
        self.assertAlmostEqual(stats["slopePerMonth"], 2.114, places=2)
        self.assertEqual(stats["direction"], "UP")
        self.assertEqual(stats["firstMonth"], "2026-01")
        self.assertEqual(stats["lastMonth"], "2026-06")

    def test_standard_deviation_matches_sample_formula(self):
        scores = [80, 85, 90, 88, 92, 91]
        mean = sum(scores) / 6
        var = sum((s - mean) ** 2 for s in scores) / 5
        expected = round(math.sqrt(var), 2)
        self.assertEqual(self.trend["stats"]["stdDev"], expected)
        self.assertEqual(self.trend["stats"]["stdDevBasis"], "SAMPLE")

    def test_period_over_period_deltas(self):
        pops = self.trend["periodOverPeriod"]
        deltas = [p["deltaPoints"] for p in pops]
        self.assertEqual(deltas, [5.0, 5.0, -2.0, 4.0, -1.0])
        self.assertEqual(pops[0]["fromMonth"], "2026-01")
        self.assertEqual(pops[0]["toMonth"], "2026-02")

    def test_confidence_high_for_six_months(self):
        self.assertEqual(self.trend["confidence"], "HIGH")

    def test_missing_month_not_zero_filled(self):
        """§7: missing months never treated as zero (spec §7)."""
        ds = make_dataset(scores={1: 80, 2: 85, 4: 88, 5: 92, 6: 91})  # March missing
        _, result = run_engine(envelope_of(ds))
        trend = result["trendAnalysis"]
        self.assertEqual(trend["missingMonths"], ["2026-03"])
        self.assertEqual(trend["availableMonths"], 5)
        # zero-fill would give mean 72.67 — the real mean of available is 87.2
        self.assertEqual(trend["stats"]["mean"], 87.2)
        self.assertEqual(trend["stats"]["count"], 5)
        # no delta crosses INTO a fabricated zero month
        deltas = [p["deltaPoints"] for p in trend["periodOverPeriod"]]
        self.assertEqual(deltas, [5.0, 3.0, 4.0, -1.0])

    def test_insufficient_data_explicit_state(self):
        """§7/§11: 1-2 months → explicit insufficient-data state."""
        ds = make_dataset(
            scores={1: 80, 2: 85},
            window=["2026-05", "2026-06"])
        _, result = run_engine(envelope_of(ds))
        trend = result["trendAnalysis"]
        self.assertEqual(trend["status"], "INSUFFICIENT_DATA")
        self.assertIsNone(trend["stats"])
        self.assertEqual(trend["confidence"], "INSUFFICIENT_DATA")
        self.assertEqual(trend["availableMonths"], 2)

    def test_confidence_medium_for_three_months(self):
        ds = make_dataset(scores={1: 80, 2: 85, 3: 90},
                          window=["2026-04", "2026-05", "2026-06"])
        _, result = run_engine(envelope_of(ds))
        self.assertEqual(result["trendAnalysis"]["confidence"], "MEDIUM")


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.code, self.result = run_engine(envelope_of(make_dataset()))
        self.obs = self.result["patternAnalysis"]["observations"]

    def test_category_share_percentages(self):
        items = {i["key"]: i for i in self.obs["byCategory"]["items"]}
        self.assertEqual(items["c1"]["count"], 8)
        self.assertEqual(items["c1"]["sharePct"], 61.5)  # 8/13
        self.assertEqual(items["c2"]["sharePct"], 38.5)  # 5/13

    def test_concentration_is_measurable_fact_only(self):
        """§8: 'Category X: 8/14 observations' — measurable fact, no
        interpretation as employee weakness anywhere in the output."""
        conc = self.obs["byCategory"]["concentration"]
        self.assertEqual(len(conc), 1)
        self.assertEqual(conc[0]["key"], "c1")
        self.assertEqual(conc[0]["sharePct"], 61.5)

    def test_severity_and_resolution_distributions(self):
        self.assertEqual(self.obs["bySeverity"]["items"][0]["count"], 12)
        self.assertEqual(self.obs["approvalDistribution"]["approved"], 20)


class RepeatedIssueTests(unittest.TestCase):
    def setUp(self):
        self.code, self.result = run_engine(envelope_of(make_dataset()))
        self.rep = self.result["patternAnalysis"]["repeatedIssues"]

    def test_frequency_percentage(self):
        """§9: frequency percentage added over the deterministic grouping."""
        group = self.rep["byCategory"][0]
        self.assertEqual(group["occurrenceCount"], 8)
        self.assertEqual(group["frequencyPctOfObservations"], 29.6)  # 8/27

    def test_recurrence_interval_days(self):
        """Feb 1 → May 20 2026 = 108 days over 7 intervals = 15.4."""
        group = self.rep["byCategory"][0]
        self.assertEqual(group["recurrenceIntervalDays"], 15.4)

    def test_window_group_months_present_pct(self):
        group = self.rep["windowByCategory"][0]
        self.assertEqual(group["monthsPresentPct"], 50.0)   # 3 of 6 months
        self.assertEqual(group["windowSpanMonths"], 3)

    def test_observation_ids_preserved(self):
        group = self.rep["byCategory"][0]
        self.assertEqual(len(group["observationIds"]), 8)
        self.assertEqual(group["observationIds"][0], "o1")


class ComplaintTests(unittest.TestCase):
    def test_indirect_attribution_gates_trend(self):
        """§12: trend analysis ONLY when attribution is confirmed."""
        ds = make_dataset()  # default fixture: complaints INDIRECT
        _, result = run_engine(envelope_of(ds))
        comp = result["distributionAnalysis"]["complaints"]
        self.assertEqual(comp["status"], "NOT_CONFIRMED_ATTRIBUTION")
        self.assertIsNone(comp["countTrend"])
        self.assertIn("ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION", comp["noteCodes"])

    def test_confirmed_attribution_count_trend(self):
        window = ["2025-%02d" % m for m in range(7, 13)] + \
                 ["2026-%02d" % m for m in range(1, 7)]
        comp = {
            "relationship": "CONFIRMED", "total": 20,
            "byStatus": {"resolved": 20}, "byType": {"service": 20},
            "bySeverity": {"low": 20}, "repeatedTypes": [],
            "resolvedOrClosed": 20, "stillOpen": 0, "viaDealCount": 0,
            "avgResolutionDays": 3.0,
            # clean linear growth → slope exactly 1.0/month → direction UP
            "monthly": [{"month": m, "count": c} for m, c in zip(window, [
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])],
        }
        ds = make_dataset(window=window, complaints=comp)
        _, result = run_engine(envelope_of(ds))
        analysis = result["distributionAnalysis"]["complaints"]
        self.assertEqual(analysis["status"], "OK")
        self.assertIsNotNone(analysis["countTrend"])
        self.assertGreater(analysis["countTrend"]["slopePerMonth"], 0)
        self.assertEqual(analysis["countTrend"]["direction"], "UP")

    def test_no_causation_language(self):
        """§12: 'count increased' valid — 'employee caused' never output."""
        _, result = run_engine(envelope_of(make_dataset()))
        blob = json.dumps(result).lower()
        for phrase in ["caused", "because of the employee", "due to negligence"]:
            self.assertNotIn(phrase, blob)


class CapaFollowUpDealTests(unittest.TestCase):
    def setUp(self):
        self.code, self.result = run_engine(envelope_of(make_dataset()))
        self.capa = self.result["distributionAnalysis"]["capa"]
        self.fu = self.result["distributionAnalysis"]["followUps"]
        self.deals = self.result["distributionAnalysis"]["deals"]

    def test_capa_active_terminal_and_overdue_rate(self):
        self.assertEqual(self.capa["active"], 1)
        self.assertEqual(self.capa["terminal"], 0)
        self.assertEqual(self.capa["overdueRatePct"], 0.0)  # 0/1 overdue
        self.assertIn("closure", self.capa)

    def test_follow_up_overdue_rate_is_ratio_of_canonical_counts(self):
        """§14: overdueRatePct = overdue/total — canonical counts only."""
        self.assertEqual(self.fu["overdueRatePct"], 14.3)  # 1/7
        self.assertEqual(self.fu["completionRatePctEcho"], 71.4)

    def test_deal_status_distribution_and_cancellation(self):
        """§15: volume/status/cancellation only — no sales-target math."""
        items = {i["key"]: i["count"] for i in self.deals["byStatus"]["items"]}
        self.assertEqual(items["completed"], 8)
        self.assertEqual(items["canceled"], 2)
        self.assertEqual(self.deals["cancellationRatePct"], 13.3)  # 2/15

    def test_attendance_context_only_never_in_cross_domain(self):
        """§16: attendance analyzed contextually, NEVER alters Quality KPI
        and NEVER enters cross-domain patterns or correlations."""
        att = self.result["distributionAnalysis"]["attendance"]
        self.assertEqual(att["analysisRole"], "CONTEXT_ONLY")
        self.assertEqual(att["metrics"]["lateDays"], 2)
        blob = json.dumps(self.result["crossDomainPatterns"]) + \
            json.dumps(self.result["correlations"])
        self.assertNotIn("attendance", blob)


class AnomalyTests(unittest.TestCase):
    def spike_fixture(self, target):
        window = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        monthly = [{"month": m, "count": c} for m, c in
                   zip(window, [1, 2, 1, 2, 1, target])]
        return make_dataset(monthly={"observations": monthly,
                                    "complaints": [{"month": m, "count": 0} for m in window],
                                    "capa": [{"month": m, "count": 0} for m in window],
                                    "followUps": [{"month": m, "count": 0} for m in window],
                                    "deals": [{"month": m, "count": 0} for m in window]})

    def test_count_spike_detected_with_expected_range(self):
        """§10: unusually high observation count → structured anomaly."""
        _, result = run_engine(envelope_of(self.spike_fixture(20)))
        anomalies = [a for a in result["anomalies"]
                     if a["anomalyType"] == "OBSERVATIONS_COUNT_SPIKE"]
        self.assertEqual(len(anomalies), 1)
        a = anomalies[0]
        self.assertEqual(a["metric"], "observations.monthlyCount")
        self.assertEqual(a["observedValue"], 20)
        self.assertGreaterEqual(a["zScore"], 3.0)
        self.assertEqual(a["direction"], "ABOVE_EXPECTED")
        self.assertIn(a["severity"], ["MEDIUM", "HIGH"])
        self.assertIn(a["confidence"], ["MEDIUM", "HIGH"])
        self.assertEqual(a["noteCode"], "ANOMALY_NOT_WRONGDOING")
        self.assertEqual(a["expectedRange"]["method"], "ROBUST_Z_MEDIAN_MAD")

    def test_no_anomaly_below_threshold(self):
        # target 2 vs baseline [1,2,1,2,1] → z ≈ 2.04 < 3 → no anomaly
        _, result = run_engine(envelope_of(self.spike_fixture(2)))
        self.assertEqual(
            [a for a in result["anomalies"]
             if a["anomalyType"] == "OBSERVATIONS_COUNT_SPIKE"], [])

    def test_small_sample_baseline_skipped_and_surfaced(self):
        """§11/§34-14: baseline < 5 months → no detection, explicit note."""
        ds = self.spike_fixture(20)
        # trim window to 4 months → baseline = 3 months
        window = ds["dataQuality"]["windowMonths"] = ["2026-03", "2026-04", "2026-05", "2026-06"]
        for key in ("observations", "complaints", "capa", "followUps", "deals"):
            pass
        ds["quality"]["observations"]["monthly"] = [
            {"month": m, "count": c} for m, c in zip(window, [1, 2, 1, 20])]
        ds["trend"]["windowMonths"] = window
        ds["trend"]["points"] = [p for p in ds["trend"]["points"]
                                 if p["monthKey"] in window]
        _, result = run_engine(envelope_of(ds))
        self.assertEqual(result["anomalies"], [])
        areas = [s for s in result["dataQuality"]["insufficientSamples"]
                 if s["area"] == "anomalyDetection"]
        self.assertTrue(any(s["reason"] == "INSUFFICIENT_BASELINE" for s in areas))

    def test_score_drop_anomaly(self):
        """§10: sudden score drop → NOTABLE statistical change, not blame."""
        ds = make_dataset(scores={1: 80, 2: 85, 3: 90, 4: 88, 5: 92, 6: 74})
        _, result = run_engine(envelope_of(ds))
        drops = [a for a in result["anomalies"] if a["anomalyType"] == "SCORE_DROP"]
        self.assertEqual(len(drops), 1)
        self.assertEqual(drops[0]["observedValue"], -18.0)
        self.assertEqual(drops[0]["severity"], "MEDIUM")
        self.assertEqual(drops[0]["direction"], "BELOW_EXPECTED")

    def test_score_drop_high_severity(self):
        ds = make_dataset(scores={1: 80, 2: 85, 3: 90, 4: 88, 5: 92, 6: 68})
        _, result = run_engine(envelope_of(ds))
        drops = [a for a in result["anomalies"] if a["anomalyType"] == "SCORE_DROP"]
        self.assertEqual(drops[0]["severity"], "HIGH")

    def test_mtd_partial_month_skips_anomalies(self):
        """§11/§24: MTD is partial — anomaly detection is excluded."""
        ds = self.spike_fixture(20)
        ds["period"]["valueBasis"] = "MTD"
        ds["period"]["finalized"] = False
        ds["period"]["finalizedAt"] = None
        _, result = run_engine(envelope_of(ds))
        self.assertEqual(result["anomalies"], [])
        self.assertTrue(any(
            s["area"] == "anomalyDetection" and s["reason"] == "MTD_PARTIAL_MONTH"
            for s in result["dataQuality"]["insufficientSamples"]))


class CrossDomainAndCorrelationTests(unittest.TestCase):
    def twelve_month_fixture(self, complaints_confirmed=True):
        window = ["2025-%02d" % m for m in range(7, 13)] + \
                 ["2026-%02d" % m for m in range(1, 7)]
        obs = [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5]
        comp = [0, 0, 1, 1, 2, 2, 3, 2, 4, 3, 4, 6]
        monthly = {
            "observations": [{"month": m, "count": c} for m, c in zip(window, obs)],
            "complaints": [{"month": m, "count": c} for m, c in zip(window, comp)],
            "capa": [{"month": m, "count": 0} for m in window],
            "followUps": [{"month": m, "count": 0} for m in window],
            "deals": [{"month": m, "count": 0} for m in window],
        }
        complaints = {
            "relationship": "CONFIRMED" if complaints_confirmed else "INDIRECT",
            "total": sum(comp), "byStatus": {}, "byType": {}, "bySeverity": {},
            "repeatedTypes": [], "resolvedOrClosed": sum(comp), "stillOpen": 0,
            "viaDealCount": 0, "avgResolutionDays": 2.0,
            "monthly": monthly["complaints"],
        }
        return make_dataset(scores={i: 90 for i in range(1, 13)},
                            window=window, monthly=monthly,
                            complaints=complaints)

    def test_cross_domain_temporal_association(self):
        """§17: 'complaint volume increased during the same period in which
        observations increased' — temporal association, never causation."""
        _, result = run_engine(envelope_of(self.twelve_month_fixture()))
        patterns = result["crossDomainPatterns"]
        pair = [p for p in patterns if {p["domainA"], p["domainB"]} ==
                {"observations", "complaints"}]
        self.assertEqual(len(pair), 1)
        p = pair[0]
        self.assertEqual(p["patternType"], "TEMPORAL_ASSOCIATION")
        self.assertGreaterEqual(len(p["sharedIncreaseMonths"]), 2)
        self.assertEqual(p["noteCode"], "ASSOCIATION_NOT_CAUSATION")
        self.assertIn(p["confidence"], ["MEDIUM", "HIGH"])

    def test_correlation_only_with_sufficient_data(self):
        """§18: Pearson r with n=12 months; coefficient reported with
        sample size and limitations."""
        _, result = run_engine(envelope_of(self.twelve_month_fixture()))
        cors = [c for c in result["correlations"]
                if set(c["variables"]) == {"observations", "complaints"}]
        self.assertEqual(len(cors), 1)
        c = cors[0]
        self.assertEqual(c["sampleSize"], 12)
        self.assertTrue(-1.0 <= c["coefficient"] <= 1.0)
        self.assertGreater(c["coefficient"], 0)
        self.assertIn("CORRELATION_NOT_CAUSATION", c["limitations"])
        self.assertEqual(c["confidence"], "HIGH")  # n >= 12

    def test_correlation_insufficient_sample_surfaced(self):
        """§18/§11: n < 8 → NO correlation output, explicit entry instead."""
        _, result = run_engine(envelope_of(make_dataset()))  # 6-month window
        self.assertEqual(result["correlations"], [])
        entries = [s for s in result["dataQuality"]["insufficientSamples"]
                   if s["area"] == "correlation"]
        self.assertTrue(any(s["reason"] == "INSUFFICIENT_SAMPLE" and
                            s["required"] == 8 for s in entries))

    def test_unconfirmed_complaints_excluded_from_cross_domain(self):
        ds = self.twelve_month_fixture(complaints_confirmed=False)
        _, result = run_engine(envelope_of(ds))
        for p in result["crossDomainPatterns"]:
            self.assertNotIn("complaints", [p["domainA"], p["domainB"]])
        for c in result["correlations"]:
            self.assertNotIn("complaints", c["variables"])


class PeriodComparisonTests(unittest.TestCase):
    def test_period_comparison_counts_and_deltas(self):
        _, result = run_engine(envelope_of(make_dataset()))
        pc = result["periodComparison"]
        self.assertEqual(pc["status"], "OK")
        self.assertEqual(pc["current"]["month"], "2026-06")
        self.assertEqual(pc["previous"]["month"], "2026-05")
        self.assertEqual(pc["deltas"]["observations"], 19)   # 20 - 1
        self.assertEqual(pc["deltas"]["deals"], 1)
        self.assertEqual(pc["kpiRawScoreDeltaPoints"], -1.0)


class EvidenceTests(unittest.TestCase):
    def test_evidence_references_preserved(self):
        """§20: every analytical layer retains traceable source evidence."""
        _, result = run_engine(envelope_of(make_dataset()))
        refs = result["evidenceReferences"]
        collections = {r["collection"] for r in refs}
        self.assertIn("qualityObservations", collections)
        self.assertIn("monthSnapshots", collections)
        self.assertIn("complaints", collections)
        for r in refs:
            self.assertTrue(r["completeRecordList"])
            self.assertTrue(len(r["recordIds"]) > 0)

    def test_anomaly_carries_supporting_evidence(self):
        window = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        monthly = [{"month": m, "count": c} for m, c in
                   zip(window, [1, 2, 1, 2, 1, 20])]
        ds = make_dataset(monthly={"observations": monthly,
                                   "complaints": [], "capa": [],
                                   "followUps": [], "deals": []})
        _, result = run_engine(envelope_of(ds))
        a = [x for x in result["anomalies"]
             if x["anomalyType"] == "OBSERVATIONS_COUNT_SPIKE"][0]
        self.assertEqual(a["supportingEvidence"][0]["collection"],
                         "qualityObservations")


class ConfidenceTests(unittest.TestCase):
    def test_overall_confidence_is_deterministic_worst_of(self):
        _, result = run_engine(envelope_of(make_dataset()))
        # trend HIGH + correlation INSUFFICIENT entries don't downgrade
        # overall (they are documented gaps, not low-confidence results)
        self.assertIn(result["overallConfidence"], ["HIGH", "MEDIUM"])

    def test_overall_confidence_insufficient_with_no_data(self):
        ds = make_dataset(scores={1: 80, 2: 85},
                          window=["2026-05", "2026-06"])
        _, result = run_engine(envelope_of(ds))
        self.assertEqual(result["overallConfidence"], "INSUFFICIENT_DATA")


class LifecycleTests(unittest.TestCase):
    def test_archived_employee_history_analyzable(self):
        """§25: archived employee, valid historical periods remain
        analyzable; no post-archive fabricated activity."""
        ds = make_dataset(archived=True)
        _, result = run_engine(envelope_of(ds))
        self.assertEqual(result["input"]["employmentStatus"], "archived")
        self.assertTrue(result["input"]["archivedButEligible"])
        blob = json.dumps(result["dataQuality"]["notes"])
        self.assertIn("ARCHIVED_BUT_ELIGIBLE", blob)
        self.assertEqual(result["status"], "OK")

    def test_finalized_month_respected(self):
        """§24: finalized snapshots respected — values echoed, never
        recalculated."""
        _, result = run_engine(envelope_of(make_dataset()))
        self.assertEqual(result["input"]["valueBasis"], "FINALIZED")
        self.assertTrue(result["input"]["finalized"])
        self.assertEqual(result["kpiFactsEcho"]["rawScore"], 91)


class KpiImmutabilityTests(unittest.TestCase):
    def test_kpi_echo_verbatim(self):
        """§5: Python NEVER recalculates KPI values — engine outputs are
        echoed verbatim and nothing else in the result carries them."""
        ds = make_dataset()  # rawScore 91, weight 15 → contribution 13.65
        _, result = run_engine(envelope_of(ds))
        echo = result["kpiFactsEcho"]
        self.assertEqual(echo["rawScore"], ds["kpi"]["quality"]["rawScore"])
        self.assertEqual(echo["weight"], ds["kpi"]["quality"]["weight"])
        self.assertEqual(echo["weightedContribution"],
                         ds["kpi"]["quality"]["weightedContribution"])
        self.assertEqual(echo["source"], "kpi_engine")

        # The computed contribution value must appear EXACTLY once in the
        # output — inside the verbatim echo, never recomputed elsewhere.
        blob = json.dumps(result)

        def count_leaves(node, target):
            if isinstance(node, dict):
                return sum(count_leaves(v, target) for v in node.values())
            if isinstance(node, list):
                return sum(count_leaves(v, target) for v in node)
            if isinstance(node, float) and abs(node - 13.65) < 1e-9:
                return 1
            return 0

        self.assertEqual(count_leaves(result, 13.65), 1)

    def test_input_dataset_never_mutated(self):
        ds = make_dataset()
        snapshot = json.dumps(ds, sort_keys=True)
        run_engine(envelope_of(ds))
        self.assertEqual(json.dumps(ds, sort_keys=True), snapshot)


class DataQualityTests(unittest.TestCase):
    def test_missing_data_and_ambiguity_surfaced(self):
        """§19: missing data / ambiguous relationships never hidden."""
        ds = make_dataset(scores={1: 80, 2: 85, 3: 90, 4: None, 5: None, 6: 91})
        ds["attendance"] = {"status": "NOT_AVAILABLE", "source": "attendanceResults",
                            "result": None}
        _, result = run_engine(envelope_of(ds))
        dq = result["dataQuality"]
        self.assertTrue(any(m["area"] == "attendance" for m in dq["missingData"]))
        self.assertTrue(any(m["area"] == "trend" for m in dq["missingData"]))
        domains = {a["domain"] for a in dq["ambiguousRelationships"]}
        self.assertIn("complaints", domains)  # INDIRECT in fixture
        self.assertEqual(dq["unattributedRecords"],
                         [{"collection": "complaints", "count": 1}])

    def test_out_of_window_monthly_records_surfaced(self):
        ds = make_dataset()
        ds["quality"]["observations"]["monthly"].append(
            {"month": "2025-12", "count": 7})
        _, result = run_engine(envelope_of(ds))
        blob = json.dumps(result["dataQuality"]["notes"])
        self.assertIn("2025-12", blob)


class DeterminismAndSerializationTests(unittest.TestCase):
    def test_deterministic_output(self):
        """Same input → byte-identical output (no now(), no randomness)."""
        ds = make_dataset()
        _, r1 = run_engine(envelope_of(ds))
        _, r2 = run_engine(envelope_of(make_dataset()))
        self.assertEqual(json.dumps(r1, sort_keys=True),
                         json.dumps(r2, sort_keys=True))

    def test_json_serialization_round_trip(self):
        _, result = run_engine(envelope_of(make_dataset()))
        clone = json.loads(json.dumps(result))
        self.assertEqual(clone, result)

    def test_no_generated_timestamps(self):
        """Output never invents wall-clock time; only echoes dataset time."""
        _, result = run_engine(envelope_of(make_dataset()))
        self.assertEqual(result["input"]["datasetGeneratedAt"],
                         "2026-07-02T10:00:00.000Z")
        keys = json.dumps(list(result.keys()))
        self.assertNotIn("generatedAt", keys.replace("datasetGeneratedAt", ""))

    def test_invalid_input_fails_closed(self):
        """Wrong datasetKind / missing fields → explicit error, exit 2."""
        bad = envelope_of(make_dataset())
        bad["dataset"]["datasetKind"] = "SOMETHING_ELSE"
        code, out = run_engine(bad)
        self.assertEqual(code, 2)
        self.assertEqual(out["status"], "INVALID_INPUT")
        self.assertEqual(out["error"]["code"], "UNSUPPORTED_DATASET_KIND")

    def test_malformed_json_fails_closed(self):
        sys_stdin, sys_stdout = sys.stdin, sys.stdout
        sys.stdin = io.StringIO("not json at all")
        sys.stdout = io.StringIO()
        try:
            code = ea.main()
            out = json.loads(sys.stdout.getvalue())
        finally:
            sys.stdin, sys.stdout = sys_stdin, sys_stdout
        self.assertEqual(code, 2)
        self.assertEqual(out["error"]["code"], "UNREADABLE_INPUT")


class ReadOnlySourceContractTests(unittest.TestCase):
    """§4/§34-24: structural proof that the engine is read-only —
    no network, no database drivers, no filesystem writes, no
    subprocess escapes."""

    SOURCE = open(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..",
        "employee_analytics.py"), encoding="utf-8").read()

    FORBIDDEN_IMPORTS = [
        "socket", "urllib", "http", "ftplib", "smtplib", "telnetlib",
        "requests", "sqlite3", "pymysql", "psycopg2", "mysql",
        "firebase", "google.cloud", "subprocess", "multiprocessing",
        "ctypes", "random", "numpy", "pandas",
    ]

    def test_no_forbidden_imports(self):
        for name in self.FORBIDDEN_IMPORTS:
            self.assertNotIn("import %s" % name, self.SOURCE,
                             "forbidden module: %s" % name)
            self.assertNotIn("from %s" % name, self.SOURCE,
                             "forbidden module: %s" % name)

    def test_no_filesystem_writes(self):
        # NOTE: sys.stdout.write() is the output boundary and stays legal;
        # the tokens below cover filesystem / OS escape hatches.
        self.assertNotIn("open(", self.SOURCE)
        for token in ["os.remove", "os.system", "shutil", "os.rename",
                      "os.open", "pathlib", "tempfile", "writelines("]:
            self.assertNotIn(token, self.SOURCE)

    def test_no_eval_or_exec(self):
        self.assertNotIn("eval(", self.SOURCE)
        self.assertNotIn("exec(", self.SOURCE)

    def test_stdlib_imports_only(self):
        for line in self.SOURCE.splitlines():
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                module = stripped.split()[1].split(".")[0]
                self.assertIn(module,
                              ["json", "math", "statistics", "sys", "datetime"],
                              "unexpected import: %s" % module)


if __name__ == "__main__":
    unittest.main()
