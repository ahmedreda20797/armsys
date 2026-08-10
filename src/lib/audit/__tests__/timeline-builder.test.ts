// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/audit/timeline-builder.ts (pure functions)
//
//  Run: npx tsx --test src/lib/audit/__tests__/timeline-builder.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeline } from '../timeline-builder';
import type { AuditEvent, TimelineApprovalEvent } from '../types';

// ══════════════════════════════════════════════════════════════

describe('buildTimeline', () => {
  it('empty logs → empty timeline', () => {
    assert.deepEqual(buildTimeline([], []), []);
  });

  it('combines audit and approval events sorted newest-first', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T10:00:00Z', details: 'created' },
      { action: 'update', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T11:00:00Z', details: 'updated' },
    ];
    const approvalHistory: TimelineApprovalEvent[] = [
      { action: 'approve', actorId: 'm1', actorName: 'M', timestamp: '2026-08-02T09:00:00Z', notes: 'ok' },
    ];

    const timeline = buildTimeline(auditLog, approvalHistory);
    assert.equal(timeline.length, 3);
    // Newest first: approve (Aug 2), update (Aug 1 11:00), create (Aug 1 10:00)
    assert.equal(timeline[0].label, 'موافقة');
    assert.equal(timeline[1].label, 'تعديل');
    assert.equal(timeline[2].label, 'إنشاء');
  });

  it('approval actions map to expected tones', () => {
    const approvalHistory: TimelineApprovalEvent[] = [
      { action: 'approve', actorId: 'm', actorName: 'M', timestamp: '2026-08-02T09:00:00Z', notes: '' },
      { action: 'reject', actorId: 'm', actorName: 'M', timestamp: '2026-08-02T10:00:00Z', notes: '' },
      { action: 'submit', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T09:00:00Z', notes: '' },
    ];
    const timeline = buildTimeline([], approvalHistory);
    const byAction = Object.fromEntries(timeline.map((p) => [p.label, p.tone]));
    assert.equal(byAction['موافقة'], 'positive');
    assert.equal(byAction['رفض'], 'negative');
    assert.equal(byAction['إرسال للاعتماد'], 'neutral');
  });

  it('audit actions map to expected tones', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T10:00:00Z', details: '' },
      { action: 'delete', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T11:00:00Z', details: '' },
      { action: 'update', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T12:00:00Z', details: '' },
    ];
    const timeline = buildTimeline(auditLog, []);
    const byAction = Object.fromEntries(timeline.map((p) => [p.label, p.tone]));
    assert.equal(byAction['إنشاء'], 'positive');
    assert.equal(byAction['حذف'], 'negative');
    assert.equal(byAction['تعديل'], 'pending');
  });

  it('respects caller-provided label overrides', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T10:00:00Z', details: '' },
    ];
    const timeline = buildTimeline(auditLog, [], { create: 'Created' });
    assert.equal(timeline[0].label, 'Created');
  });

  it('unknown actions fall back to the raw action key', () => {
    const auditLog: AuditEvent[] = [
      { action: 'custom_action', actorId: 'u', actorName: 'U', timestamp: '2026-08-01T10:00:00Z', details: '' },
    ];
    const timeline = buildTimeline(auditLog, []);
    assert.equal(timeline[0].label, 'custom_action');
    assert.equal(timeline[0].tone, 'neutral');
  });

  it('approval notes populate the details field', () => {
    const approvalHistory: TimelineApprovalEvent[] = [
      { action: 'approve', actorId: 'm', actorName: 'M', timestamp: '2026-08-02T09:00:00Z', notes: 'great work' },
    ];
    const timeline = buildTimeline([], approvalHistory);
    assert.equal(timeline[0].details, 'great work');
  });
});
