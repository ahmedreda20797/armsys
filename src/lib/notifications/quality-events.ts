// ══════════════════════════════════════════════════════════════
//  Quality notification events (Improvement #6)
//
//  Thin mapper that fires notifications through the EXISTING
//  Notification Center (createRecord('notifications')). No new
//  notification engine — follows the exact same pattern as
//  rules-engine.createSmartNotification.
//
//  All notifications include targetPage='observations' so the
//  notification links to the correct page.
//
//  Includes a 30-minute dedup window per title+entity to prevent
//  duplicate notifications from rapid retries.
// ══════════════════════════════════════════════════════════════

import { createRecord, findWhere, TTL } from '@/lib/db';
import type { Priority } from '@/types/quality-kpi';

type NotificationPriority = Priority;

/** Input for a quality-related notification. */
export interface QualityNotificationInput {
  title: string;
  description: string;
  priority?: NotificationPriority;
  /** Who triggered the event (appears in the notification). */
  actorId?: string;
  actorName?: string;
  /** Target employee (for employee-specific notifications). */
  employeeId?: string;
  employeeName?: string;
  /** Target observer/manager (for approval notifications). */
  assignedTo?: string;
  assignedToName?: string;
  /** Related observation ID. */
  sourceRecordId?: string;
  /** Optional deep-link action URL. */
  actionUrl?: string;
}

/** Dedup window: 30 minutes in ms. */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Fire a quality notification via the existing Notification Center.
 * Deduplicates within a 30-minute window per (title + sourceRecordId).
 * Failures are logged but never throw (notifications must not block
 * the primary operation).
 */
export async function fireQualityNotification(input: QualityNotificationInput): Promise<void> {
  const { title, sourceRecordId } = input;
  if (!title) return;

  try {
    // Dedup: check for recent duplicate within the window.
    if (sourceRecordId) {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
      const existing = await findWhere('notifications', { title, sourceRecordId } as Record<string, string>);
      const recent = existing.find(
        (n: Record<string, string>) => n.createdAt && n.createdAt >= cutoff,
      );
      if (recent) return; // Skip duplicate.
    }

    await createRecord('notifications', {
      title: input.title,
      description: input.description || '',
      priority: input.priority || 'medium',
      status: 'unread',
      category: 'quality',
      sourceModule: 'observations',
      sourceRecordId: input.sourceRecordId || null,
      targetPage: 'observations',
      sourceType: 'automation',
      employeeId: input.employeeId || null,
      employeeName: input.employeeName || null,
      assignedTo: input.assignedTo || null,
      assignedToName: input.assignedToName || null,
      ruleId: null,
      ruleName: null,
      actionUrl: input.actionUrl || (input.sourceRecordId ? `observations:${input.sourceRecordId}` : null),
    });
  } catch (error) {
    // Structured observability log — never throw from notification writes.
    console.error(JSON.stringify({
      level: 'error',
      module: 'quality-notifications',
      op: 'fireQualityNotification',
      message: error instanceof Error ? error.message : String(error),
      title: input.title,
      sourceRecordId: input.sourceRecordId,
    }));
  }
}

// ── Named notification helpers for common workflow events ──

export async function notifyObservationAwaitingApproval(
  employeeName: string,
  observerName: string,
  observationId: string,
): Promise<void> {
  await fireQualityNotification({
    title: 'ملاحظة جودة بانتظار الاعتماد',
    description: `ملاحظة جودة للموظف ${employeeName} بواسطة ${observerName} بانتظار مراجعة المدير`,
    priority: 'medium',
    sourceRecordId: observationId,
  });
}

export async function notifyObservationApproved(
  employeeName: string,
  approverName: string,
  observationId: string,
  points: number,
): Promise<void> {
  await fireQualityNotification({
    title: 'تم اعتماد ملاحظة الجودة',
    description: `تمت الموافقة على ملاحظة جودة للموظف ${employeeName} (${points} نقطة) بواسطة ${approverName}`,
    priority: 'low',
    employeeName,
    sourceRecordId: observationId,
  });
}

export async function notifyObservationRejected(
  employeeName: string,
  approverName: string,
  reason: string,
  observationId: string,
): Promise<void> {
  await fireQualityNotification({
    title: 'تم رفض ملاحظة الجودة',
    description: `تم رفض ملاحظة جودة للموظف ${employeeName} بواسطة ${approverName}: ${reason}`,
    priority: 'high',
    employeeName,
    sourceRecordId: observationId,
  });
}

export async function notifyMonthClosed(monthKey: string, closedByName: string): Promise<void> {
  await fireQualityNotification({
    title: 'تم إغلاق شهر الأداء',
    description: `تم إغلاق شهر ${monthKey} بواسطة ${closedByName}. البيانات أصبحت ثابتة.`,
    priority: 'high',
  });
}

export async function notifyMonthReopened(monthKey: string, actorName: string, reason: string): Promise<void> {
  await fireQualityNotification({
    title: 'تم إعادة فتح شهر الأداء',
    description: `تم إعادة فتح شهر ${monthKey} بواسطة ${actorName}: ${reason}`,
    priority: 'high',
  });
}
