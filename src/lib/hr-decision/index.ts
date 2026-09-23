// ══════════════════════════════════════════════════════════════
//  HR Decision-Support Report — public surface
//
//  Extends the report-audience architecture with the RICHER HR
//  decision-support projection: the employee's overall performance
//  + operational behavior + daily execution, combined into a
//  deterministic status WITH the structured factors that explain it,
//  and a recommended management action (review wording only — never
//  an automatic employment decision).
//
//  Consumes ONLY canonical Qnals data (performance-intelligence
//  dataset + stored HR deduction summaries + kpiSettings baseline +
//  the canonical risk engine). No second KPI engine.
// ══════════════════════════════════════════════════════════════

export * from './types';
export * from './signals';
export * from './status-engine';
export {
  buildHrEmployeeDecisionReport,
  buildHrTeamDecisionReport,
  buildHrEmployeeOpsFacts,
  hrDecisionThresholds,
} from './report';
export type { AssembleHrEmployeeDecisionInput, AssembleHrTeamDecisionInput, HrEmployeeOpsFacts } from './report';
export {
  getHrEmployeeDecisionReport,
  getHrTeamDecisionReport,
} from './service';
export { pctAr, pointsAr, daysAr, countAr, minutesAr } from './format';
