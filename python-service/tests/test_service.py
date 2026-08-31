#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python Analytics Service — unit tests (Phase 5.2 spec §40).

Run:  python3 -m unittest discover -s python-service/tests -v
(no third-party dependencies; stdlib unittest only)

Covers spec §40 areas 1-12:
  1.  /health                    7.  schema mismatch
  2.  valid authentication       8.  malformed JSON
  3.  invalid authentication     9.  analytics result contract
  4.  missing authentication     10. insufficient analytical data
  5.  valid dataset                  (spec §42 partial-data scenario)
  6.  invalid dataset            11. service error
                                 12. response schema validation

Plus (spec §20/§3): basic rate limiting and the engine sync guard
(the shipped engine must be byte-identical to the canonical one).

The socket-free dispatch() core is exercised directly — no network
sockets are opened by this suite.
"""

import json
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))

# The service imports its colocated engine; the fixtures come from the
# canonical engine test-suite so the dataset contract is byte-identical.
sys.path.insert(0, os.path.join(_REPO_ROOT, "python-service"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "python-analytics", "tests"))

import app as service  # noqa: E402
from test_employee_analytics import make_dataset, envelope_of  # noqa: E402

TEST_KEY = "test-service-key-0123456789"


def make_partial_mtd_dataset():
    """Spec §42 exact scenario: observations=2, deductions=0,
    complaints=0, CAPA=0, followUps=3, deals=3, attendance
    unavailable, KPI available, valueBasis=MTD (single current
    month). Aggregate facts aligned with the monthly series."""
    window = ["2026-08"]
    monthly = {
        "observations": [{"month": window[0], "count": 2}],
        "complaints": [{"month": window[0], "count": 0}],
        "capa": [{"month": window[0], "count": 0}],
        "followUps": [{"month": window[0], "count": 3}],
        "deals": [{"month": window[0], "count": 3}],
    }
    d = make_dataset(scores={1: 88}, window=window, monthly=monthly,
                     reported_basis="MTD")
    q = d["quality"]
    q["observations"].update({
        "total": 2, "approved": 2, "pending": 0, "rejected": 0,
        "byResolutionStatus": {"open": 1, "resolved": 1},
        "bySeverity": {"low": 1, "medium": 1},
        "byCategory": [{"categoryId": "c1",
                        "categoryName": "توقيت المتابعة", "count": 2}],
    })
    q["repeatedIssues"]["byCategory"] = []
    q["repeatedIssues"]["windowByCategory"] = []
    q["deductions"].update({"count": 0, "totalDays": 0,
                            "totalAmount": 0, "byType": []})
    d["complaints"].update({"total": 0, "byStatus": {}, "byType": {},
                            "bySeverity": {}, "resolvedOrClosed": 0,
                            "stillOpen": 0, "viaDealCount": 0,
                            "avgResolutionDays": None})
    d["capa"].update({"total": 0, "byStatus": {}, "byPriority": {},
                      "bySource": {}, "active": 0, "terminal": 0,
                      "overdue": 0, "closedCount": 0})
    d["followUps"].update({"total": 3, "byStatus": {"open": 1, "completed": 2},
                           "active": 1, "terminal": 2, "overdue": 0,
                           "completed": 2})
    d["deals"].update({"total": 3,
                       "byStatus": {"upcoming": 1, "completed": 2},
                       "completed": 2, "canceled": 0, "active": 1})
    d["attendance"] = {"status": "UNAVAILABLE", "source": None,
                       "result": None}
    d["dataQuality"]["unattributedRecords"] = []
    ev = d["evidence"]
    ev["observations"]["recordIds"] = ["obs-1", "obs-2"]
    ev["deductions"]["recordIds"] = []
    ev["complaints"]["recordIds"] = []
    ev["capa"]["recordIds"] = []
    ev["followUps"]["recordIds"] = ["f1", "f2", "f3"]
    ev["deals"]["recordIds"] = ["t1", "t2", "t3"]
    ev["attendance"] = None
    return d


def call(method, path, headers=None, body=b"", env=None, rate_limiter=None,
         client_key="tester"):
    headers = dict(headers or {})
    return service.dispatch(method, path, headers, body,
                            rate_limiter=rate_limiter, client_key=client_key,
                            env=env if env is not None else
                            {"PYTHON_ANALYTICS_API_KEY": TEST_KEY})


def auth_headers(key=TEST_KEY):
    return {"Authorization": "Bearer %s" % key, "Content-Length": "0"}


def analyze_request(dataset, env=None, key=TEST_KEY):
    body = json.dumps(envelope_of(dataset)).encode("utf-8")
    headers = {"Authorization": "Bearer %s" % key,
               "Content-Length": str(len(body))}
    return call("POST", service.ANALYZE_PATH, headers, body, env=env)


# ══════════════════════════════════════════════════════════════
#  §40-1 Health
# ══════════════════════════════════════════════════════════════

class HealthTests(unittest.TestCase):

    def test_1_health_ok_without_auth(self):
        status, payload = call("GET", service.HEALTH_PATH)
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "ok")

    def test_1b_health_exposes_no_secrets_or_env_values(self):
        env = {"PYTHON_ANALYTICS_API_KEY": TEST_KEY,
               "FIREBASE_PRIVATE_KEY": "SUPER-SECRET",
               "PYTHON_ANALYTICS_URL": "https://internal.example.com"}
        status, payload = call("GET", service.HEALTH_PATH, env=env)
        body = json.dumps(payload)
        self.assertNotIn(TEST_KEY, body)
        self.assertNotIn("SUPER-SECRET", body)
        self.assertNotIn("internal.example.com", body)
        self.assertEqual(
            sorted(payload.keys()), ["engineVersion", "service", "status"])

    def test_1c_health_rejects_non_get(self):
        status, payload = call("POST", service.HEALTH_PATH,
                               auth_headers(), b"{}")
        self.assertEqual(status, 405)


# ══════════════════════════════════════════════════════════════
#  §40-2/3/4 Authentication
# ══════════════════════════════════════════════════════════════

class AuthenticationTests(unittest.TestCase):

    def setUp(self):
        self.dataset = make_dataset()

    def test_2_valid_authentication_accepted(self):
        status, payload = analyze_request(self.dataset)
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "OK")

    def test_3_invalid_authentication_rejected(self):
        status, payload = analyze_request(self.dataset, key="wrong-key-987654")
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "ERROR_UNAUTHORIZED")
        self.assertNotIn("analytics", payload)

    def test_4_missing_authentication_rejected(self):
        status, payload = call("POST", service.ANALYZE_PATH,
                               {"Content-Length": "2"}, b"{}")
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "ERROR_UNAUTHORIZED")

    def test_4b_fail_closed_when_service_key_not_configured(self):
        status, payload = analyze_request(self.dataset, env={})
        self.assertEqual(status, 500)
        self.assertEqual(payload["error"]["code"], "ERROR_SERVER_CONFIG")


# ══════════════════════════════════════════════════════════════
#  §40-5/6/7/8 Input validation
# ══════════════════════════════════════════════════════════════

class InputValidationTests(unittest.TestCase):

    def test_5_valid_dataset_produces_result(self):
        status, payload = analyze_request(make_dataset())
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "OK")

    def test_6_invalid_dataset_rejected_structured(self):
        dataset = make_dataset()
        del dataset["employee"]  # required field removed
        status, payload = analyze_request(dataset)
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "ERROR_INVALID_DATASET")
        self.assertIn("MISSING_DATASET_FIELDS", payload["error"]["message"])

    def test_6b_dataset_kind_mismatch_rejected(self):
        dataset = make_dataset()
        dataset["datasetKind"] = "SOMETHING_ELSE"
        status, payload = analyze_request(dataset)
        self.assertEqual(status, 400)
        self.assertIn("UNSUPPORTED_DATASET_KIND", payload["error"]["message"])

    def test_7_schema_version_mismatch_rejected(self):
        body = json.dumps({"schemaVersion": 2,
                           "dataset": make_dataset()}).encode("utf-8")
        headers = {"Authorization": "Bearer %s" % TEST_KEY,
                   "Content-Length": str(len(body))}
        status, payload = call("POST", service.ANALYZE_PATH, headers, body)
        self.assertEqual(status, 400)
        self.assertIn("UNSUPPORTED_SCHEMA_VERSION", payload["error"]["message"])

    def test_8_malformed_json_rejected(self):
        headers = {"Authorization": "Bearer %s" % TEST_KEY,
                   "Content-Length": "17"}
        status, payload = call("POST", service.ANALYZE_PATH, headers,
                               b'{"schemaVersion":')
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "ERROR_MALFORMED_JSON")

    def test_8b_empty_body_rejected(self):
        status, payload = call("POST", service.ANALYZE_PATH, auth_headers(), b"")
        self.assertEqual(status, 400)

    def test_8c_oversized_body_rejected(self):
        status, payload = call("POST", service.ANALYZE_PATH,
                               {"Authorization": "Bearer %s" % TEST_KEY,
                                "Content-Length": str(service.MAX_BODY_BYTES + 1)},
                               b"")
        self.assertEqual(status, 413)


# ══════════════════════════════════════════════════════════════
#  §40-9/12 Analytics result + response schema
# ══════════════════════════════════════════════════════════════

class AnalyticsResultTests(unittest.TestCase):

    def test_9_result_preserves_phase5_contract(self):
        status, payload = analyze_request(make_dataset())
        self.assertEqual(status, 200)
        for key in ("schemaVersion", "analyticsKind", "analyticsEngineVersion",
                    "deterministic", "status", "input", "kpiFactsEcho",
                    "trendAnalysis", "patternAnalysis", "anomalies",
                    "distributionAnalysis", "periodComparison",
                    "crossDomainPatterns", "correlations", "dataQuality",
                    "evidenceReferences", "overallConfidence"):
            self.assertIn(key, payload)
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertTrue(payload["deterministic"])
        self.assertTrue(str(payload["analyticsEngineVersion"]).count(".") >= 1)

    def test_9b_kpi_echo_never_recalculated(self):
        dataset = make_dataset()
        status, payload = analyze_request(dataset)
        expected = dataset["kpi"]["quality"]["weightedContribution"]
        self.assertEqual(payload["kpiFactsEcho"]["weightedContribution"],
                         expected)

    def test_12_service_error_is_structured(self):
        # §40-11 service error: the engine raising must produce a
        # structured 500, never a traceback dump or partial data.
        original = service.engine.build_result
        def boom(_dataset):
            raise RuntimeError("simulated engine crash")
        service.engine.build_result = boom
        try:
            status, payload = analyze_request(make_dataset())
        finally:
            service.engine.build_result = original
        self.assertEqual(status, 500)
        self.assertEqual(payload["error"]["code"], "ERROR_INTERNAL")


# ══════════════════════════════════════════════════════════════
#  §40-10 + §42 — partial current-month data stays analyzable
# ══════════════════════════════════════════════════════════════

class PartialDataTests(unittest.TestCase):
    """Exact current scenario (spec §42): MTD month, 2 observations,
    0 deductions/complaints/CAPA, 3 follow-ups, 3 deals, attendance
    unavailable, KPI available → service 200 (Python AVAILABLE) with
    per-method INSUFFICIENT_DATA and basic distributions AVAILABLE."""

    def setUp(self):
        self.dataset = make_partial_mtd_dataset()
        status, self.payload = analyze_request(self.dataset)

    def test_10_service_succeeds_on_partial_mtd_data(self):
        # Python = AVAILABLE (service 200, status OK) — a current
        # month with few records is analyzed, never “unavailable”.
        self.assertEqual(self.status_ok(), True)
        self.assertEqual(self.payload["input"]["valueBasis"], "MTD")

    def status_ok(self):
        return self.payload.get("status") == "OK"

    def test_10b_trend_is_insufficient_not_unavailable(self):
        self.assertEqual(self.payload["trendAnalysis"]["status"],
                         "INSUFFICIENT_DATA")

    def test_10c_anomalies_and_correlations_insufficient(self):
        # MTD excludes sensitive analyses by design — they come back
        # EMPTY/insufficient while the service itself succeeded.
        self.assertEqual(self.payload["correlations"], [])
        self.assertEqual(self.payload["anomalies"], [])

    def test_10d_basic_distributions_still_available(self):
        obs = self.payload["patternAnalysis"]["observations"]
        self.assertEqual(obs["status"], "OK")
        self.assertEqual(obs["total"], 2)
        fu = self.payload["distributionAnalysis"]["followUps"]
        self.assertEqual(fu["status"], "OK")
        self.assertEqual(fu["total"], 3)
        deals = self.payload["distributionAnalysis"]["deals"]
        self.assertEqual(deals["status"], "OK")
        self.assertEqual(deals["total"], 3)

    def test_10e_mtd_gap_is_explicit_not_hidden(self):
        areas = [s["area"] for s in self.payload["dataQuality"]["insufficientSamples"]]
        self.assertIn("mtdPartialMonth", areas)


# ══════════════════════════════════════════════════════════════
#  §20 — basic rate limiting
# ══════════════════════════════════════════════════════════════

class RateLimitTests(unittest.TestCase):

    def test_rate_limit_blocks_after_window_limit(self):
        limiter = service.FixedWindowRateLimiter(3)
        for _ in range(3):
            self.assertTrue(limiter.allow("client-a"))
        self.assertFalse(limiter.allow("client-a"))
        # Other clients unaffected.
        self.assertTrue(limiter.allow("client-b"))
        # Limit 0 disables protection entirely.
        self.assertTrue(service.FixedWindowRateLimiter(0).allow("client-a"))


# ══════════════════════════════════════════════════════════════
#  §3 — engine sync guard (no second analytics implementation)
# ══════════════════════════════════════════════════════════════

class EngineSyncGuardTests(unittest.TestCase):

    def test_shipped_engine_is_byte_identical_to_canonical(self):
        canonical = os.path.join(_REPO_ROOT, "python-analytics",
                                 "employee_analytics.py")
        shipped = os.path.join(_REPO_ROOT, "python-service",
                               "employee_analytics.py")
        with open(canonical, "rb") as f:
            canonical_bytes = f.read()
        with open(shipped, "rb") as f:
            shipped_bytes = f.read()
        self.assertEqual(
            canonical_bytes, shipped_bytes,
            "python-service/employee_analytics.py drifted from the "
            "canonical python-analytics/employee_analytics.py — copy the "
            "canonical file again; the service must expose ONE engine.")


if __name__ == "__main__":
    unittest.main()
