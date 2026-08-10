// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/approvals/approval-history.ts (pure functions)
//
//  Run: npx tsx --test src/lib/approvals/__tests__/approval-history.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeApprovalEvent,
  appendApprovalEvent,
  projectLatestApprovalStatus,
  isApprovedStatus,
  isPendingStatus,
  isRejectedStatus,
} from '../approval-history';
import type { ApprovalEvent } from '../types';

const NOW = new Date('2026-08-01T10:00:00.000Z');

function evt(action: ApprovalEvent['action'], extra: Partial<ApprovalEvent> = {}): ApprovalEvent {
  return makeApprovalEvent({
    action,
    actorId: 'u1',
    actorName: 'أحمد',
    notes: 'note',
    now: NOW,
    ...extra,
  });
}

// ══════════════════════════════════════════════════════════════

describe('makeApprovalEvent', () => {
  it('stamps the provided timestamp and defaults notes to empty', () => {
    const e = makeApprovalEvent({ action: 'submit', actorId: 'u1', actorName: 'A', now: NOW });
    assert.equal(e.timestamp, NOW.toISOString());
    assert.equal(e.notes, '');
    assert.equal(e.action, 'submit');
  });

  it('includes pointsBefore/pointsAfter only when provided', () => {
    const e = makeApprovalEvent({
      action: 'override', actorId: 'u1', actorName: 'A', now: NOW,
      pointsBefore: 5, pointsAfter: 3,
    });
    assert.equal(e.pointsBefore, 5);
    assert.equal(e.pointsAfter, 3);

    const e2 = makeApprovalEvent({ action: 'approve', actorId: 'u1', actorName: 'A', now: NOW });
    assert.equal('pointsBefore' in e2, false);
    assert.equal('pointsAfter' in e2, false);
  });
});

// ══════════════════════════════════════════════════════════════

describe('appendApprovalEvent', () => {
  it('returns a NEW array and leaves the input untouched', () => {
    const original: ApprovalEvent[] = [evt('submit')];
    const next = appendApprovalEvent(original, evt('approve'));
    assert.equal(next.length, 2);
    assert.equal(original.length, 1, 'input must not be mutated');
    assert.notEqual(next, original);
  });

  it('appends to the end (chronological order preserved)', () => {
    const next = appendApprovalEvent([evt('submit')], evt('approve'));
    assert.equal(next[0].action, 'submit');
    assert.equal(next[1].action, 'approve');
  });
});

// ══════════════════════════════════════════════════════════════

describe('projectLatestApprovalStatus', () => {
  it('empty history → pending', () => {
    assert.equal(projectLatestApprovalStatus([]), 'pending');
  });

  it('latest approve → approved', () => {
    const h = [evt('submit'), evt('approve')];
    assert.equal(projectLatestApprovalStatus(h), 'approved');
  });

  it('latest reject → rejected', () => {
    const h = [evt('submit'), evt('reject')];
    assert.equal(projectLatestApprovalStatus(h), 'rejected');
  });

  it('reopen after reject → pending', () => {
    const h = [evt('submit'), evt('reject'), evt('reopen')];
    assert.equal(projectLatestApprovalStatus(h), 'pending');
  });

  it('submit only (no decisive action) → pending', () => {
    assert.equal(projectLatestApprovalStatus([evt('submit')]), 'pending');
  });

  it('override preserves the latest decisive status (approved stays approved)', () => {
    const h = [evt('submit'), evt('approve'), evt('override', { pointsBefore: 5, pointsAfter: 3 })];
    assert.equal(projectLatestApprovalStatus(h), 'approved');
  });

  it('override after submit only → pending (no decisive action)', () => {
    const h = [evt('submit'), evt('override', { pointsBefore: 5, pointsAfter: 3 })];
    assert.equal(projectLatestApprovalStatus(h), 'pending');
  });

  it('newest decisive action wins (approve then reject → rejected)', () => {
    const h = [evt('submit'), evt('approve'), evt('reject')];
    assert.equal(projectLatestApprovalStatus(h), 'rejected');
  });
});

// ══════════════════════════════════════════════════════════════

describe('status helpers', () => {
  it('isApprovedStatus', () => {
    assert.equal(isApprovedStatus('approved'), true);
    assert.equal(isApprovedStatus('pending'), false);
    assert.equal(isApprovedStatus('rejected'), false);
  });

  it('isPendingStatus', () => {
    assert.equal(isPendingStatus('pending'), true);
    assert.equal(isPendingStatus('approved'), false);
  });

  it('isRejectedStatus', () => {
    assert.equal(isRejectedStatus('rejected'), true);
    assert.equal(isRejectedStatus('approved'), false);
  });
});
