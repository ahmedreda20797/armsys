// ══════════════════════════════════════════════════════════════
//  Canonical metric layer — single source of truth for all KPIs.
//
//  Architecture:
//    Database
//      → src/lib/db.ts (data access + cache)
//      → src/lib/metrics/* (THIS — canonical calculations)
//      → src/app/api/* (HTTP layer, thin)
//      → UI components (display only — never recompute)
//
//  No module outside this folder may define a risk score, an overdue
//  rule, an SLA window, or an effectiveness percentage.
// ══════════════════════════════════════════════════════════════

export * from './riskMetrics';
export * from './followUpMetrics';
export * from './capaMetrics';
