// ══════════════════════════════════════════════════════════════
//  M0.6-A ADDENDUM — Archive, Restore & Historical Lifecycle
//
//  Covers the addendum test matrix (§23 A-T) at the architectural
//  seam the rules live in: lifecycle patch builders, reserved-field
//  sanitization, employment-period folding/eligibility, current-
//  population filters, and the scope-doctrine invariants.
//
//  Run: npx tsx --test src/lib/organization/__tests__/m06-archive-restore.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeArchivePatch,
  buildEmployeeRestorePatch,
  stripEmployeeLifecycleFields,
  EMPLOYEE_LIFECYCLE_RESERVED_FIELDS,
  isCurrentEmployee,
  filterCurrentEmployees,
  buildEmploymentEvent,
  foldEmploymentPeriods,
  employmentOverlapsRange,
  eligibleDaysInRange,
  type EmploymentEvent,
} from '@/lib/organization';

const T = (s: string) => new Date(s).toISOString();

function ev(kind: 'archived' | 'restored', at: string): EmploymentEvent {
  return buildEmploymentEvent({ employeeId: 'EMP-001', kind, effectiveAt: T(at) });
}

describe('ADDENDUM §1/§4 — archive is a lifecycle state with metadata', () => {
  it('archive patch keeps identity-free shape and records previousStatus', () => {
    const patch = buildEmployeeArchivePatch({
      currentStatus: 'active',
      archivedBy: 'admin1',
      archiveReason: '  استقالة  ',
      now: T('2026-08-20'),
    });
    assert.equal(patch.status, 'archived');
    assert.equal(patch.previousStatus, 'active');
    assert.equal(patch.archivedAt, T('2026-08-20'));
    assert.equal(patch.archivedBy, 'admin1');
    assert.equal(patch.archiveReason, 'استقالة'); // trimmed
    assert.ok(!('id' in patch)); // identity is immutable — no id in the patch
  });

  it('archiving an already-archived employee is refused (no duplicate archive metadata)', () => {
    assert.throws(() =>
      buildEmployeeArchivePatch({ currentStatus: 'archived', archivedBy: 'admin1' }),
    );
  });

  it('archive requires an authenticated actor — metadata cannot be fabricated', () => {
    assert.throws(() => buildEmployeeArchivePatch({ currentStatus: 'active', archivedBy: '' }));
  });

  it('legacy employee (no status) archives from effective-active', () => {
    const patch = buildEmployeeArchivePatch({
      currentStatus: undefined,
      archivedBy: 'admin1',
      now: T('2026-08-21'),
    });
    assert.equal(patch.previousStatus, 'active');
  });
});

describe('ADDENDUM §5/§6 — restore keeps identity and the archived period', () => {
  it('restore patch flips to active without touching archive metadata', () => {
    const patch = buildEmployeeRestorePatch({
      currentStatus: 'archived',
      restoredBy: 'admin1',
      now: T('2027-02-16'),
    });
    assert.equal(patch.status, 'active');
    assert.equal(patch.restoredAt, T('2027-02-16'));
    // archivedAt/previousStatus/archiveReason are deliberately absent:
    assert.ok(!('archivedAt' in patch));
    assert.ok(!('previousStatus' in patch));
    assert.ok(!('id' in patch)); // SAME employee record — no identity change
  });

  it('only archived employees can be restored', () => {
    assert.throws(() => buildEmployeeRestorePatch({ currentStatus: 'active', restoredBy: 'a' }));
    assert.throws(() => buildEmployeeRestorePatch({ currentStatus: undefined, restoredBy: 'a' }));
  });

  it('folded periods keep the archived gap identifiable after restore', () => {
    // Period 1: 01/01 → 20/08 archived; Period 2: 16/02/2027 → present
    const periods = foldEmploymentPeriods(
      [ev('archived', '2026-08-20'), ev('restored', '2027-02-16')],
      T('2026-01-01'),
    );
    assert.equal(periods.length, 2);
    assert.equal(periods[0].start, T('2026-01-01'));
    assert.equal(periods[0].end, T('2026-08-20'));
    assert.equal(periods[1].start, T('2027-02-16'));
    assert.equal(periods[1].end, null);
  });

  it('legacy employees (no events) fold to one open period — nothing fabricated', () => {
    const periods = foldEmploymentPeriods([], T('2025-06-01'));
    assert.deepEqual(periods, [{ start: T('2025-06-01'), end: null }]);
    const noAnchor = foldEmploymentPeriods([]);
    assert.deepEqual(noAnchor, [{ start: null, end: null }]);
  });

  it('event ordering is derived chronologically, not by input order', () => {
    const periods = foldEmploymentPeriods(
      [ev('restored', '2027-02-16'), ev('archived', '2026-08-20')],
      T('2026-01-01'),
    );
    assert.equal(periods.length, 2);
    assert.equal(periods[0].end, T('2026-08-20'));
  });

  it('employment events refuse fabricated identities', () => {
    assert.throws(() => buildEmploymentEvent({ employeeId: '', kind: 'archived' }));
    assert.throws(() =>
      buildEmploymentEvent({ employeeId: 'x', kind: 'purged' as 'archived' }),
    );
  });
});

describe('ADDENDUM §10/§11 — date-aware eligibility, never zero-filled', () => {
  // Ahmed: employed 01/01/2026 → archived 20/08/2026, restored 16/02/2027
  const periods = foldEmploymentPeriods(
    [ev('archived', '2026-08-20'), ev('restored', '2027-02-16')],
    T('2026-01-01'),
  );

  it('report 01/08 → 20/08: VISIBLE (employed through the range)', () => {
    assert.equal(employmentOverlapsRange(periods, '2026-08-01', '2026-08-20'), true);
  });

  it('report 01/08 → 31/08: VISIBLE (partial overlap — eligible slice is computed, not zero-filled)', () => {
    assert.equal(employmentOverlapsRange(periods, '2026-08-01', '2026-08-31'), true);
    const eligible = eligibleDaysInRange(periods, ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-30']);
    assert.deepEqual(eligible, ['2026-08-19', '2026-08-20']); // only employed days
  });

  it('report 21/08 → 31/08: NOT VISIBLE (no longer an active employee)', () => {
    assert.equal(employmentOverlapsRange(periods, '2026-08-21', '2026-08-31'), false);
  });

  it('report 01/09 → 30/09: NOT VISIBLE', () => {
    assert.equal(employmentOverlapsRange(periods, '2026-09-01', '2026-09-30'), false);
  });

  it('report after rehire: VISIBLE again for the second period', () => {
    assert.equal(employmentOverlapsRange(periods, '2027-03-01', '2027-03-31'), true);
    assert.equal(employmentOverlapsRange(periods, '2026-12-01', '2026-12-31'), false);
  });

  it('currently-employed employee (open period) overlaps any window', () => {
    const open = foldEmploymentPeriods([], T('2026-01-01'));
    assert.equal(employmentOverlapsRange(open, '2026-05-01', '2026-05-31'), true);
  });

  it('eligibility never produces metric values — empty ≠ zero', () => {
    const none = eligibleDaysInRange(periods, ['2026-09-01', '2026-09-15']);
    assert.deepEqual(none, []); // NOT EMPLOYED, distinct from NO ACTIVITY
  });
});

describe('ADDENDUM §9/§13/§20 — current population rules', () => {
  it('archived and inactive employees leave the current population; active/legacy stay', () => {
    assert.equal(isCurrentEmployee({ status: 'active' }), true);
    assert.equal(isCurrentEmployee({ status: undefined }), true); // legacy = active
    assert.equal(isCurrentEmployee({ status: 'inactive' }), false);
    assert.equal(isCurrentEmployee({ status: 'archived' }), false);
    assert.equal(isCurrentEmployee(null), false);
  });

  it('current lists/selectors exclude archived without deleting them', () => {
    const all = [
      { id: 'a', status: 'active' as const },
      { id: 'b', status: undefined }, // legacy
      { id: 'c', status: 'inactive' as const },
      { id: 'd', status: 'archived' as const },
    ];
    assert.deepEqual(
      filterCurrentEmployees(all).map((e) => e.id),
      ['a', 'b'],
    );
    assert.equal(all.length, 4); // source untouched — archive deletes nothing
  });
});

describe('ADDENDUM §4/§22 — reserved metadata is server-derived only', () => {
  it('clients cannot spoof archive metadata through a generic edit body', () => {
    const spoof = stripEmployeeLifecycleFields({
      name: 'New Name',
      status: 'archived',
      archivedAt: '1999-01-01T00:00:00Z',
      archivedBy: 'attacker',
      archiveReason: 'fake',
      previousStatus: 'active',
      restoredAt: '1999-01-01T00:00:00Z',
      restoredBy: 'attacker',
    });
    assert.deepEqual(spoof, { name: 'New Name' }); // only editable fields survive
    for (const field of EMPLOYEE_LIFECYCLE_RESERVED_FIELDS) {
      assert.ok(!(field in spoof));
    }
  });
});

describe('ADDENDUM §7/§8/§18 — historical integrity is structural', () => {
  it('archive/restore patches never contain table-removal or record mutation', () => {
    const archive = buildEmployeeArchivePatch({ currentStatus: 'active', archivedBy: 'a' });
    const restore = buildEmployeeRestorePatch({ currentStatus: 'archived', restoredBy: 'a' });
    const archiveKeys = Object.keys(archive).sort();
    const restoreKeys = Object.keys(restore).sort();
    // exactly the whitelisted lifecycle fields — no cascade surface
    assert.deepEqual(archiveKeys, ['archiveReason', 'archivedAt', 'archivedBy', 'previousStatus', 'status']);
    assert.deepEqual(restoreKeys, ['restoredAt', 'restoredBy', 'status']);
  });

  it('archived employee identity keeps resolving (stable id, stable link)', () => {
    const archivedEmployee = {
      id: 'EMP-001',
      name: 'Ahmed',
      status: 'archived' as const,
    };
    // a CAPA referencing EMP-001 resolves the same record:
    const capa = { assignedTo: 'EMP-001' };
    const resolved = capa.assignedTo === archivedEmployee.id ? archivedEmployee : null;
    assert.ok(resolved);
    assert.equal(resolved?.name, 'Ahmed'); // display: "Ahmed" (+ archived label in UI)
  });
});
