// ══════════════════════════════════════════════════════════════
//  Analytics result validation (Phase 5 §9 — carried into 5.3)
//
//  DEEP structural validation of an EmployeeAnalyticsResult. The
//  production engine builds results in-process, but the API layer
//  still validates its OWN output before serving it (defense in
//  depth — a contract regression can never reach a client as a
//  silently-wrong payload). Statuses, analytics blocks, evidence
//  references and confidence values are all checked.
// ══════════════════════════════════════════════════════════════

import {
  ANALYTICS_KIND,
  ANALYTICS_SCHEMA_VERSION,
  type EmployeeAnalyticsResult,
} from './types';

const CONFIDENCE_VALUES: ReadonlySet<string> = new Set([
  'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA',
]);

function isConfidence(value: unknown): boolean {
  return typeof value === 'string' && CONFIDENCE_VALUES.has(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidEvidenceRefArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((ref) =>
    isPlainObject(ref) &&
    typeof ref.collection === 'string' &&
    Array.isArray(ref.recordIds) &&
    ref.recordIds.every((id) => typeof id === 'string') &&
    typeof ref.completeRecordList === 'boolean',
  );
}

export function isValidAnalyticsResult(value: unknown): value is EmployeeAnalyticsResult {
  if (!isPlainObject(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    v.schemaVersion !== ANALYTICS_SCHEMA_VERSION ||
    v.analyticsKind !== ANALYTICS_KIND ||
    v.status !== 'OK' ||
    v.deterministic !== true
  ) {
    return false;
  }
  // Engine version identifier — must be present so production results
  // can be attributed to an engine build.
  if (typeof v.analyticsEngineVersion !== 'string' || v.analyticsEngineVersion.length === 0) {
    return false;
  }
  // Top-level analytics blocks.
  for (const block of [
    'input', 'kpiFactsEcho', 'trendAnalysis', 'patternAnalysis',
    'distributionAnalysis', 'periodComparison', 'dataQuality',
  ]) {
    if (!isPlainObject(v[block])) return false;
  }
  // Trend must carry an explicit analytical status.
  const trend = v.trendAnalysis as Record<string, unknown>;
  if (trend.status !== 'OK' && trend.status !== 'INSUFFICIENT_DATA') return false;
  // patternAnalysis + distributionAnalysis sub-blocks.
  const pattern = v.patternAnalysis as Record<string, unknown>;
  for (const block of ['observations', 'repeatedIssues', 'deductions']) {
    if (!isPlainObject(pattern[block])) return false;
  }
  const dist = v.distributionAnalysis as Record<string, unknown>;
  for (const block of ['complaints', 'capa', 'followUps', 'deals', 'attendance']) {
    if (!isPlainObject(dist[block])) return false;
  }
  // Array-valued analytics blocks.
  for (const arr of ['anomalies', 'crossDomainPatterns', 'correlations', 'noteCodes']) {
    if (!Array.isArray(v[arr])) return false;
  }
  // Data quality gap list.
  const dq = v.dataQuality as Record<string, unknown>;
  if (!Array.isArray(dq.insufficientSamples)) return false;
  // Confidence values must be from the contract enum.
  if (!isConfidence(v.overallConfidence)) return false;
  const trendConfidence = (v.trendAnalysis as Record<string, unknown>).confidence;
  if (trendConfidence !== undefined && !isConfidence(trendConfidence)) return false;
  // Evidence references.
  if (!isValidEvidenceRefArray(v.evidenceReferences)) return false;
  return true;
}
