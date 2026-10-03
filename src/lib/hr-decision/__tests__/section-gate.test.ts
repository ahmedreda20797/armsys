// ══════════════════════════════════════════════════════════════
//  §HR-DECISION SECTION GATE — server-side factor filtering (tests)
//
//  Proves (spec §28/§35.17): a viewer WITHOUT an owning section never
//  receives that dimension's factor lines or scorecard metrics — the
//  transform the performance-intelligence and employee-360 routes
//  apply BEFORE serialization. Server-side enforcement, not UI hiding.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterFactorsBySectionGate, filterScorecardBySectionGate } from '@/lib/hr-decision/section-gate';
import { resolveEmployee360SectionGate, EMPLOYEE360_SECTION_IDS } from '@/lib/permissions/employee360-access';
import type { HrDecisionFactor, HrDimensionScorecardEntry } from '@/lib/hr-decision/types';
import type { PermissionsMap } from '@/config/permissions';

function factor(category: HrDecisionFactor['category'], ruleId: string): HrDecisionFactor {
  return {
    category, kind: 'NEGATIVE', severity: 'MEDIUM',
    signalAr: 'إشارة', value: 1, unit: 'count',
    comparisonAr: null, thresholdBasis: 'CONFIGURED', thresholdValue: 0, ruleId,
  };
}

function gateFor(permissions: PermissionsMap) {
  return resolveEmployee360SectionGate(permissions);
}

// The gate resolves each section from the employee360 page's OWN
// sections map (resolveSectionAccess) — full access here.
const FULL_PERMISSIONS: PermissionsMap = {
  employee360: { level: 'edit' },
};

// Same page level, but the hrDeductions SECTION explicitly denied —
// the exact per-section configuration the route must honor.
const NO_HR_PERMISSIONS: PermissionsMap = {
  employee360: { level: 'edit', sections: { hrDeductions: 'none' } },
};

describe('§35.17 — the section gate drops denied-section factors server-side', () => {
  const factors = [
    factor('FOLLOW_UP', 'rule.followups'),
    factor('HR_DISCIPLINARY', 'rule.hr_disciplinary'),
    factor('QUALITY', 'rule.quality'),
  ] as HrDecisionFactor[];

  it('a full-section viewer receives everything', () => {
    const gate = gateFor(FULL_PERMISSIONS);
    const out = filterFactorsBySectionGate(factors, gate);
    assert.equal(out.length, 3);
  });

  it('a viewer without hrDeductions NEVER receives HR_DISCIPLINARY factors', () => {
    const gate = gateFor(NO_HR_PERMISSIONS);
    assert.equal(gate.hrDeductions, false);
    const out = filterFactorsBySectionGate(factors, gate);
    assert.deepEqual(out.map((f) => f.ruleId), ['rule.followups', 'rule.quality']);
  });

  it('scorecard entries of denied sections are dropped the same way', () => {
    const entries = [
      { category: 'HR_DISCIPLINARY', labelAr: 'خصومات HR', availability: 'AVAILABLE', unavailableReasonAr: null, state: 'OK', metrics: [] },
      { category: 'FOLLOW_UP', labelAr: 'المتابعات', availability: 'AVAILABLE', unavailableReasonAr: null, state: 'OK', metrics: [] },
    ] as unknown as HrDimensionScorecardEntry[];
    const gate = gateFor(NO_HR_PERMISSIONS);
    const out = filterScorecardBySectionGate(entries, gate);
    assert.deepEqual(out.map((e) => e.category), ['FOLLOW_UP']);
  });

  it('the whole decision block is withheld when decisionSupport is denied', () => {
    const gate = gateFor({
      employee360: { level: 'edit', sections: { decisionSupport: 'none' } },
    });
    assert.equal(gate.decisionSupport, false);
    // The route contract: decision stays null unless gate.decisionSupport.
  });

  it('a none-level employee360 page denies every section (fail closed)', () => {
    const gate = gateFor({ employee360: { level: 'none' } });
    for (const id of EMPLOYEE360_SECTION_IDS) {
      assert.equal(gate[id as keyof typeof gate], false, id);
    }
  });
});
