// ══════════════════════════════════════════════════════════════
//  Notification deep-link navigation (§NOTIFICATIONS-DEEPLINK)
//
//  ONE resolver from a stored notification to the canonical
//  navigateTo(page, highlightId, navParams) channel. The popover's
//  click handler consumes this — no page builds its own notification
//  → filter mapping.
//
//  A notification communicates WHAT (targetPage/category), WHO
//  (employeeId/employeeName), WHY (count/level/... in navParams)
//  and WHERE (the destination page). The destination page stays the
//  single owner of how it consumes each param (same contract it
//  already uses for every other deep link).
// ══════════════════════════════════════════════════════════════

import type { AppNotification } from '@/types';

export type NotificationNavParams = Record<string, string>;

/** The structural slice isRiskNotification needs. */
type NavSource = Pick<
  AppNotification,
  'navParams' | 'employeeId' | 'employeeName' | 'category' | 'sourceModule' | 'targetPage' | 'sourceRecordId'
>;

/** Risk Center risk notifications — targetPage/sourceModule keys. */
function isRiskNotification(notif: NavSource): boolean {
  return notif.targetPage === 'riskCenter'
    || notif.sourceModule === 'riskCenter'
    || notif.category === 'risk';
}

/**
 * Resolve the structured navigation context for one notification.
 *
 * Precedence: the notification's OWN stored navParams (structured,
 * written at creation time) carry the authoritative context; the
 * generic identity fields (employee) are merged underneath so legacy
 * notifications still deep-link by employee. String values only.
 */
export function buildNotificationNavParams(
  notif: Pick<AppNotification, 'navParams' | 'employeeId' | 'employeeName' | 'category' | 'sourceModule' | 'targetPage' | 'sourceRecordId'>,
): NotificationNavParams {
  const params: NotificationNavParams = {};

  // Generic WHO — every employee-linked notification keeps its subject.
  if (notif.employeeId) params.employeeId = notif.employeeId;
  if (notif.employeeName) params.employeeName = notif.employeeName;

  // Risk notifications store the EMPLOYEE id in sourceRecordId (the
  // risk subject), so it resolves as the employee even when the
  // generic employeeId field is absent (legacy rows).
  if (isRiskNotification(notif) && !params.employeeId && notif.sourceRecordId) {
    params.employeeId = notif.sourceRecordId;
  }

  // Structured WHY/WHERE — written by the creator, wins verbatim.
  if (notif.navParams) {
    for (const [key, value] of Object.entries(notif.navParams)) {
      if (typeof value === 'string' && value.length > 0) {
        params[key] = value;
      }
    }
  }

  return params;
}
