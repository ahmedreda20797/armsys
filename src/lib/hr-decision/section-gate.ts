// ══════════════════════════════════════════════════════════════
//  §HR-DECISION SECTION GATE — shared server-side factor filtering
//
//  The HR-decision report's factors and scorecard entries are owned
//  by the Employee360 sections listed in HR_FACTOR_SECTION_BY_CATEGORY
//  (permissions/employee360-access). A viewer without a section must
//  not receive that dimension's factor lines or scorecard metrics —
//  the same no-leak rule the Employee360 profile applies. Both the
//  Employee360 route and the Smart Quality Report route filter
//  through THIS one helper, so the rule exists exactly once.
// ══════════════════════════════════════════════════════════════

import type { Employee360SectionGate } from '@/lib/permissions/employee360-access';
import { HR_FACTOR_SECTION_BY_CATEGORY } from '@/lib/permissions/employee360-access';
import type { HrDecisionFactor, HrDimensionScorecardEntry } from './types';

/** Drop factors whose owning section is denied (overall status stays). */
export function filterFactorsBySectionGate(
  factors: ReadonlyArray<HrDecisionFactor>,
  gate: Employee360SectionGate,
): HrDecisionFactor[] {
  return factors.filter((f) => {
    const owner = HR_FACTOR_SECTION_BY_CATEGORY[f.category];
    return !owner || gate[owner];
  });
}

/** Drop scorecard entries whose owning section is denied. */
export function filterScorecardBySectionGate(
  entries: ReadonlyArray<HrDimensionScorecardEntry>,
  gate: Employee360SectionGate,
): HrDimensionScorecardEntry[] {
  return entries.filter((e) => {
    const owner = HR_FACTOR_SECTION_BY_CATEGORY[e.category];
    return !owner || gate[owner];
  });
}
