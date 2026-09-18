// ══════════════════════════════════════════════════════════════
//  Quality DISCOUNT approval notifications — §APPROVAL-NOTIFY
//
//  Thin mapper over fireRoutedNotification (the ONE write-side
//  routing path). Two events:
//
//   1. discount submitted  → recipients = every user whose EFFECTIVE
//      permission map grants the 'approve' (or 'reject') ACTION on
//      the 'quality' page. PERMISSION-AWARE BY CONSTRUCTION: a user
//      who cannot decide on discounts never receives the request —
//      no role strings, no hardcoded emails, no broadcast.
//   2. discount decided    → directed at the record's creator so the
//      submitter learns the outcome without polling the page.
//
//  Both are fire-and-forget (never break the primary operation) and
//  deduplicated per record within the routing window.
// ══════════════════════════════════════════════════════════════

import { fireRoutedNotification } from '@/lib/notifications/routing';

const QUALITY_PAGE_KEY = 'quality' as const;

/** Fire-and-forget: tell every authorized approver a discount awaits review. */
export async function notifyQualityDiscountPending(input: {
  recordId: string;
  employeeName?: string | null;
  employeeId?: string | null;
  typeLabel?: string | null;
  deductionDays?: number | null;
  deductionAmount?: number | null;
  /** Creator user id — excluded from the recipient list (the actor). */
  actorId?: string | null;
  creatorName?: string | null;
}): Promise<void> {
  const who = input.employeeName || 'موظف';
  const parts: string[] = [`${input.typeLabel || 'خصم جودة'} — ${who}`];
  if (input.deductionDays) parts.push(`${input.deductionDays} يوم`);
  if (input.deductionAmount) parts.push(`${input.deductionAmount} ريال`);
  if (input.creatorName) parts.push(`بواسطة ${input.creatorName}`);

  await fireRoutedNotification({
    title: 'خصم جودة بانتظار الاعتماد',
    description: parts.join(' — '),
    priority: 'high',
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName ?? null,
    sourceRecordId: input.recordId,
    category: 'quality',
    sourceModule: 'quality',
    targetPage: 'quality',
    route: {
      pageKey: QUALITY_PAGE_KEY,
      requiredAction: 'approve',
      excludeUserIds: input.actorId ? [input.actorId] : undefined,
    },
  });
}

/** Fire-and-forget: tell the creator their discount was approved or rejected. */
export async function notifyQualityDiscountDecided(input: {
  recordId: string;
  decision: 'approved' | 'rejected';
  employeeName?: string | null;
  employeeId?: string | null;
  /** The deciding user — excluded so the actor is not notified about their own decision. */
  actorId?: string | null;
  actorName?: string | null;
  /** Creator of the record (recipient). */
  creatorUserId?: string | null;
  reason?: string | null;
}): Promise<void> {
  if (!input.creatorUserId) return;
  const who = input.employeeName || 'موظف';
  const approved = input.decision === 'approved';
  await fireRoutedNotification({
    title: approved ? 'تم اعتماد خصم الجودة' : 'تم رفض خصم الجودة',
    description: approved
      ? `تم اعتماد خصم الجودة للموظف ${who} بواسطة ${input.actorName || 'المختص'} — أصبح سارياً في التقارير.`
      : `تم رفض خصم الجودة للموظف ${who}${input.reason ? ` — السبب: ${input.reason}` : ''}.`,
    priority: approved ? 'low' : 'medium',
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName ?? null,
    sourceRecordId: input.recordId,
    category: 'quality',
    sourceModule: 'quality',
    targetPage: 'quality',
    route: {
      pageKey: QUALITY_PAGE_KEY,
      directUserIds: [input.creatorUserId],
      excludeUserIds: input.actorId ? [input.actorId] : undefined,
    },
  });
}
