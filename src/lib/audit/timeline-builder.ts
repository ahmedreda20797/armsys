// ══════════════════════════════════════════════════════════════
//  Generic timeline builder (Improvement #7)
//
//  Derives a chronological timeline from ANY combination of audit
//  events and approval events. This is the single source of truth
//  for the observation history timeline — no separate duplicated
//  fields are needed.
//
//  Quality observations are the first consumer; any future module
//  that maintains audit/approval histories can reuse this directly.
// ══════════════════════════════════════════════════════════════

import type { ApprovalAction, AuditEvent, TimelinePoint } from '@/types/quality-kpi';

/**
 * Arabic labels for common audit actions. Modules can extend
 * these via the `actionLabels` parameter if needed.
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
 * Map an approval action to its semantic tone (drives icon/color
 * in the presentation layer — not business logic).
 */
function toneForApprovalAction(action: ApprovalAction): TimelinePoint['tone'] {
  switch (action) {
    case 'approve': return 'positive';
    case 'reject': return 'negative';
    case 'reopen':
    case 'override': return 'pending';
    case 'submit': return 'neutral';
  }
}

/**
 * Build a chronological, de-duplicated timeline from audit and
 * approval events. The returned array is sorted newest-first.
 *
 * @param auditLog   - Per-record audit trail (every edit, status change, etc.).
 * @param approvalHistory - Append-only approval events (submit, approve, reject, etc.).
 * @param actionLabels - Optional module-specific label overrides.
 * @returns Sorted timeline points ready for the UI timeline component.
 */
export function buildTimeline(
  auditLog: AuditEvent[],
  approvalHistory: { action: ApprovalAction; actorId: string; actorName: string; timestamp: string; notes: string }[],
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

  // Approval events
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

/** Resolve semantic tone for an audit action. */
function resolveAuditTone(action: string): TimelinePoint['tone'] {
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
