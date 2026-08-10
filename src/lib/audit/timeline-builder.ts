// ══════════════════════════════════════════════════════════════
//  Generic timeline builder
//
//  Derives a chronological timeline from ANY combination of audit
//  events and approval-like events. This is the single source of
//  truth for history timelines — no separate duplicated fields are
//  needed.
//
//  The builder depends only on its own types. Approval events are
//  accepted as the structural {@link TimelineApprovalEvent} interface,
//  so the audit library has ZERO hard dependency on the approvals
//  library or any domain module.
//
//  Quality observations are the first consumer; any future module that
//  maintains audit/approval histories can reuse this directly.
// ══════════════════════════════════════════════════════════════

import type { AuditEvent, TimelineApprovalEvent, TimelinePoint, TimelineTone } from './types';

/**
 * Default Arabic labels for common audit/approval actions. Modules can
 * override any label via the `actionLabels` parameter.
 */
const DEFAULT_ACTION_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  status_change: 'تغيير الحالة',
  points_change: 'تغيير النقاط',
  submit: 'إرسال للاعتماد',
  approve: 'موافقة',
  reject: 'رفض',
  override: 'تجاوز',
  reopen: 'إعادة فتح',
  capa_linked: 'ربط بـ كابا',
  resolved: 'تم الحل',
  closed: 'إغلاق',
  month_closed: 'إغلاق الشهر',
  month_reopened: 'إعادة فتح الشهر',
};

/**
 * Resolve semantic tone for a timeline approval action.
 *
 * @param action - The approval action key (e.g. 'approve').
 * @returns The presentational tone (never used for business logic).
 */
function toneForApprovalAction(action: string): TimelineTone {
  switch (action) {
    case 'approve': return 'positive';
    case 'reject': return 'negative';
    case 'reopen':
    case 'override': return 'pending';
    case 'submit': return 'neutral';
    default: return 'neutral';
  }
}

/**
 * Resolve semantic tone for an audit action.
 *
 * @param action - The audit action key (e.g. 'create').
 * @returns The presentational tone.
 */
function resolveAuditTone(action: string): TimelineTone {
  if (action === 'create' || action === 'resolved' || action === 'closed' || action === 'capa_linked') {
    return 'positive';
  }
  if (action === 'delete' || action === 'reject') {
    return 'negative';
  }
  if (action === 'submit' || action === 'reopen' || action === 'update' || action === 'points_change') {
    return 'pending';
  }
  return 'neutral';
}

/**
 * Build a chronological, de-duplicated timeline from audit and
 * approval-like events. The returned array is sorted newest-first.
 *
 * @param auditLog         - Per-record audit trail (every edit, status change, etc.).
 * @param approvalHistory  - Approval-like events (submit, approve, reject, etc.).
 *                           Uses the structural {@link TimelineApprovalEvent} so any
 *                           object with the required fields satisfies it.
 * @param actionLabels     - Optional module-specific label overrides keyed by action.
 * @returns Sorted timeline points ready for the UI timeline component.
 *
 * @remarks
 * Side effects: none. This is a pure function.
 *
 * @example
 * ```ts
 * const timeline = buildTimeline(
 *   record.auditLog,
 *   record.approvalHistory,   // ApprovalEvent[] satisfies TimelineApprovalEvent
 *   { approve: 'Approved', reject: 'Rejected' },
 * );
 * ```
 */
export function buildTimeline(
  auditLog: AuditEvent[],
  approvalHistory: TimelineApprovalEvent[],
  actionLabels?: Record<string, string>,
): TimelinePoint[] {
  const labels: Record<string, string> = { ...DEFAULT_ACTION_LABELS, ...actionLabels };

  const points: TimelinePoint[] = [];

  // Audit events
  for (const event of auditLog) {
    points.push({
      key: `audit-${event.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      label: labels[event.action] ?? event.action,
      timestamp: event.timestamp,
      actorName: event.actorName,
      details: event.details,
      tone: resolveAuditTone(event.action),
    });
  }

  // Approval-like events
  for (const event of approvalHistory) {
    points.push({
      key: `approval-${event.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      label: labels[event.action] ?? event.action,
      timestamp: event.timestamp,
      actorName: event.actorName,
      details: event.notes,
      tone: toneForApprovalAction(event.action),
    });
  }

  // Sort newest-first
  return points.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
