// ══════════════════════════════════════════════════════════════
//  Analytics public surface (Phase 5.3)
//
//  TypeScript IS the canonical analytics implementation. The engine
//  runs in-process over the verified Performance Intelligence
//  dataset — no Python runtime, no subprocess, no remote service.
// ══════════════════════════════════════════════════════════════

export * from './types';
export {
  ANALYTICS_ENGINE_VERSION,
  ANALYTICS_THRESHOLDS,
  buildEmployeeAnalyticsResult,
  validateAnalyticsEnvelope,
} from './engine';
export {
  runEmployeeAnalytics,
  analyticsApiResponseBody,
  _resetAnalyticsCacheForTests,
  _analyticsCacheSizeForTests,
  type AnalyticsFailureReason,
  type AnalyticsServiceOutcome,
} from './service';
export { isValidAnalyticsResult } from './validate-result';
