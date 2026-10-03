// ══════════════════════════════════════════════════════════════
//  §COMPLAINT-STATUS — the canonical status layer (tests)
//
//  Proves (spec §35.10): complaints aggregate through ONE canonical
//  status normalization — the legacy 'investigating' spelling maps
//  onto 'under_investigation', unknown values fail SAFE (counted
//  open, never resolved), and only the two canonical terminal
//  values count as closed.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComplaintStatus,
  isOpenComplaintStatus,
  isClosedComplaintStatus,
  COMPLAINT_STATUSES,
} from '@/lib/complaints/complaint-status';

describe('normalizeComplaintStatus — legacy alias onto the canonical vocabulary', () => {
  it('maps investigating → under_investigation (any case/whitespace)', () => {
    assert.equal(normalizeComplaintStatus('investigating'), 'under_investigation');
    assert.equal(normalizeComplaintStatus('  Investigating '), 'under_investigation');
  });
  it('passes the five canonical values through', () => {
    assert.deepEqual(
      COMPLAINT_STATUSES.map((s) => normalizeComplaintStatus(s)),
      ['open', 'under_investigation', 'pending_resolution', 'resolved', 'closed'],
    );
  });
  it('returns null for unrecognized values (writes reject, reads keep raw)', () => {
    assert.equal(normalizeComplaintStatus('escalated'), null);
    assert.equal(normalizeComplaintStatus(''), null);
    assert.equal(normalizeComplaintStatus(null), null);
    assert.equal(normalizeComplaintStatus(42), null);
  });
});

describe('open/terminal predicates — fail-safe for unknown values', () => {
  it('open set = open + under_investigation + pending_resolution (canonical AND legacy)', () => {
    assert.equal(isOpenComplaintStatus('open'), true);
    assert.equal(isOpenComplaintStatus('under_investigation'), true);
    assert.equal(isOpenComplaintStatus('investigating'), true);
    assert.equal(isOpenComplaintStatus('pending_resolution'), true);
  });
  it('terminal = only resolved/closed', () => {
    assert.equal(isClosedComplaintStatus('resolved'), true);
    assert.equal(isClosedComplaintStatus('closed'), true);
    assert.equal(isClosedComplaintStatus('investigating'), false);
    assert.equal(isClosedComplaintStatus('open'), false);
  });
  it('an unrecognized status counts OPEN (never silently resolved)', () => {
    assert.equal(isOpenComplaintStatus('weird_state'), true);
    assert.equal(isClosedComplaintStatus('weird_state'), false);
    assert.equal(isOpenComplaintStatus(''), false);
    assert.equal(isOpenComplaintStatus(undefined), false);
  });
});
