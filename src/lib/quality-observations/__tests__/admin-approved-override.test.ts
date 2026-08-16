// ══════════════════════════════════════════════════════════════
//  Admin approved-observation override — Phase 1 hardening
//  (Objective C)
//
//  Verifies the PURE policy used by PUT/DELETE /api/quality-observations/[id]:
//    • only the admin role may modify an approved observation
//    • non-KPI edits keep the approval
//    • KPI-affecting edits reset the approval to 'pending' with an
//      append-only history event recording the admin modification
//    • the canonical KPI engine stops counting the observation until
//      it is re-approved
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canModifyApprovedObservation,
  changedKpiFields,
  applyAdminEditPolicy,
  describeKpiChanges,
} from '@/lib/quality-observations/admin-approved-override';
import { computeEmployeeScore } from '@/lib/metrics/kpiMetrics';
import type { QualityObservation, KpiSettings } from '@/types/quality-kpi';

const SETTINGS: KpiSettings = {
  defaultScore: 100,
  minimumScore: 0,
  allowBonus: true,
  maximumBonus: 20,
  closeMonthLock: true,
  trendCalculation: 'rollingAverage',
} as unknown as KpiSettings;

/** A representative APPROVED deduction observation. */
function approvedObservation(overrides: Partial<QualityObservation> = {}): QualityObservation {
  return {
    id: 'obs1',
    schemaVersion: 1,
    employeeId: 'emp1',
    employeeName: 'موظف',
    department: 'قسم',
    positionSnapshot: '',
    observerId: 'obs',
    observerName: 'ملاحظ',
    observationDate: '05/08/2026',
    month: '2026-08',
    type: 'quality_observation',
    severity: 'medium',
    categoryId: 'cat1',
    categoryName: 'التزام',
    categoryWeight: 1,
    notes: '',
    evidence: '',
    status: 'open',
    relatedCapaId: null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: true,
    points: 10,
    isBonus: false,
    approvalStatus: 'approved',
    approvalHistory: [
      { action: 'submit', actorId: 'u1', actorName: 'ملاحظ', notes: '', timestamp: '2026-08-05T09:00:00.000Z' },
      { action: 'approve', actorId: 'u2', actorName: 'مدير', notes: 'موافقة', timestamp: '2026-08-05T10:00:00.000Z' },
    ],
    auditLog: [],
    createdById: 'u1',
    createdByName: 'ملاحظ',
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    clientRequestId: null,
  } as unknown as QualityObservation;
}

const ADMIN = { id: 'admin1', name: 'مدير النظام' };

// ─── Role gate ────────────────────────────────────────────────

test('only the admin role may modify an approved observation', () => {
  assert.equal(canModifyApprovedObservation('admin'), true);
  assert.equal(canModifyApprovedObservation('manager'), false, 'manager cannot bypass approval rules');
  assert.equal(canModifyApprovedObservation('quality'), false, 'quality cannot bypass approval rules');
  assert.equal(canModifyApprovedObservation('hr'), false);
  assert.equal(canModifyApprovedObservation('user'), false);
  assert.equal(canModifyApprovedObservation(null), false);
  assert.equal(canModifyApprovedObservation(undefined), false);
});

// ─── KPI-affecting change detection ───────────────────────────

test('KPI-affecting fields are detected', () => {
  const obs = approvedObservation();
  assert.deepEqual(changedKpiFields(obs, { points: 25 }), ['points']);
  assert.deepEqual(changedKpiFields(obs, { applyPointDeduction: false }), ['applyPointDeduction']);
  assert.deepEqual(changedKpiFields(obs, { isBonus: true }), ['isBonus']);
  assert.deepEqual(changedKpiFields(obs, { categoryId: 'cat2' }), ['categoryId']);
  assert.deepEqual(changedKpiFields(obs, { employeeId: 'emp2' }), ['employeeId']);
});

test('non-KPI fields are NOT KPI-affecting', () => {
  const obs = approvedObservation();
  assert.deepEqual(changedKpiFields(obs, { notes: 'نص جديد' }), []);
  assert.deepEqual(changedKpiFields(obs, { evidence: 'دليل' }), []);
  assert.deepEqual(changedKpiFields(obs, { severity: 'high' }), []);
  assert.deepEqual(changedKpiFields(obs, { correctiveAction: 'إجراء' }), []);
  assert.deepEqual(changedKpiFields(obs, { dueDate: '2026-08-10' }), []);
  assert.deepEqual(changedKpiFields(obs, { resolvedDate: '2026-08-11' }), []);
  assert.deepEqual(changedKpiFields(obs, { status: 'resolved' }), []);
});

test('a patch repeating identical values is not a KPI change', () => {
  const obs = approvedObservation();
  assert.deepEqual(changedKpiFields(obs, { points: 10 }), [], 'same points');
  assert.deepEqual(changedKpiFields(obs, { points: '10' }), [], 'numeric equivalence');
  assert.deepEqual(changedKpiFields(obs, { categoryId: 'cat1' }), [], 'same category');
});

test('a date change inside the same month is not KPI-affecting; across months it is', () => {
  const obs = approvedObservation({ observationDate: '05/08/2026' });
  assert.deepEqual(changedKpiFields(obs, { observationDate: '20/08/2026' }), [],
    'same month — attribution unchanged');
  assert.deepEqual(changedKpiFields(obs, { observationDate: '05/07/2026' }), ['observationDate'],
    'different month — attribution moves');
});

// ─── Admin edit policy ────────────────────────────────────────

test('non-KPI admin edit keeps the approval intact', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { notes: 'تحديث', severity: 'high' }, ADMIN);
  assert.equal(result.kpiReset, false);
  assert.equal(result.approvalStatus, 'approved');
  assert.equal(result.approvalHistory.length, obs.approvalHistory.length, 'no history append');
  assert.deepEqual(result.changedFields, []);
});

test('KPI-affecting admin edit invalidates the approval to pending', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { points: 25 }, ADMIN);
  assert.equal(result.kpiReset, true);
  assert.equal(result.approvalStatus, 'pending');
});

test('KPI-affecting admin edit preserves the approval history (append-only)', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { points: 25 }, ADMIN);
  assert.equal(result.approvalHistory.length, obs.approvalHistory.length + 1, 'exactly one new event');
  // The original events remain verbatim.
  for (let i = 0; i < obs.approvalHistory.length; i++) {
    assert.equal(result.approvalHistory[i], obs.approvalHistory[i]);
  }
  // The new event records the admin actor and magnitude.
  const evt = result.approvalHistory[result.approvalHistory.length - 1];
  assert.equal(evt.action, 'reopen', 'reopen projects the status back to pending');
  assert.equal(evt.actorId, ADMIN.id);
  assert.equal(evt.actorName, ADMIN.name);
  assert.equal(evt.pointsBefore, 10);
  assert.equal(evt.pointsAfter, 25);
  assert.ok(evt.notes.includes('مدير النظام'), 'notes identify the admin modification');
});

test('change summary lists the affected KPI fields with before → after', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { points: 25, categoryId: 'cat2' }, ADMIN);
  assert.ok(result.changeSummary.includes('points: 10 ← 25'));
  assert.ok(result.changeSummary.includes('categoryId: cat1 ← cat2'));
  assert.equal(describeKpiChanges(obs, {}, []), '');
});

// ─── KPI engine parity after the reset ────────────────────────

test('after an admin KPI reset, the canonical engine stops counting the observation', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { points: 25 }, ADMIN);

  // Simulate the persisted post-edit observation.
  const after = { ...obs, points: 25, approvalStatus: result.approvalStatus };
  const score = computeEmployeeScore([after as never], SETTINGS, 'emp1');
  assert.equal(score.deductionPoints, 0, 'pending observations have zero KPI impact');
  assert.equal(score.score, 100, 'score reverts to the default until re-approved');

  // Once re-approved, the new magnitude counts again.
  const reapproved = { ...after, approvalStatus: 'approved' as const };
  const score2 = computeEmployeeScore([reapproved as never], SETTINGS, 'emp1');
  assert.equal(score2.deductionPoints, 25);
  assert.equal(score2.score, 75);
});

test('a non-KPI admin edit leaves the KPI contribution unchanged', () => {
  const obs = approvedObservation();
  const result = applyAdminEditPolicy(obs, { notes: 'تحديث' }, ADMIN);
  const after = { ...obs, notes: 'تحديث', approvalStatus: result.approvalStatus };
  const score = computeEmployeeScore([after as never], SETTINGS, 'emp1');
  assert.equal(score.deductionPoints, 10, 'approved deduction still counts');
  assert.equal(score.score, 90);
});
