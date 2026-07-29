import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';
import { isOverdueCAPA, capaDueDateMs, isTerminalCAPA, CAPA_SLA_DAYS } from '@/lib/metrics';

const SLA_DAYS = CAPA_SLA_DAYS;

// SLA notification thresholds (in days)
const WARNING_THRESHOLD = 1;    // Warn when 1 day remaining
const CRITICAL_THRESHOLD = 0;  // Critical when at or past due date
const ESCALATION_THRESHOLD = 2; // Escalate when 2 days past due

/**
 * GET /api/capa-sla — Run SLA monitoring check
 *
 * Scans all open CAPA cases and generates notifications for:
 * - Warning: Due soon (within WARNING_THRESHOLD days)
 * - Critical: Past due date
 * - Escalation: Escalation threshold exceeded
 *
 * Designed to be called by a scheduler/cron job periodically.
 * Uses duplicate detection in createSmartNotification to avoid spam.
 */
export async function GET(request: NextRequest) {
  try {
    // Allow internal scheduler calls (bypass auth for x-internal-scheduler header)
    const isInternalScheduler = request.headers.get('x-internal-scheduler') === 'true';
    const auth = isInternalScheduler || await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    const ONE_DAY_MS = 86400000;

    const capaCases = await getAll<any>('capaCases');

    const openCases = capaCases.filter((c: any) => !isTerminalCAPA(c));

    const results: {
      checked: number;
      warningGenerated: number;
      criticalGenerated: number;
      escalationGenerated: number;
      skipped: number;
      details: Array<{
        capaId: string;
        capaTitle: string;
        status: string;
        priority: string;
        assignedTo: string | null;
        slaDays: number;
        daysRemaining: number;
        action: 'warning' | 'critical' | 'escalation' | 'none';
      }>;
    } = {
      checked: openCases.length,
      warningGenerated: 0,
      criticalGenerated: 0,
      escalationGenerated: 0,
      skipped: 0,
      details: [],
    };

    for (const capa of openCases) {
      const slaDays = capa.slaDays || SLA_DAYS[capa.priority] || 7;
      const nowDate = new Date();
      // Use canonical capaDueDateMs — if correctiveDueDate is set, it IS the due date
      // (no double-add of SLA). Otherwise due = createdAt + slaDays.
      const dueMs = capaDueDateMs(capa);

      if (dueMs === null) {
        // Cannot determine due date — skip this case
        results.skipped++;
        continue;
      }

      const daysRemaining = Math.ceil((dueMs - now) / ONE_DAY_MS);
      const overdueDays = Math.max(0, Math.floor((now - dueMs) / ONE_DAY_MS));

      let action: 'warning' | 'critical' | 'escalation' | 'none' = 'none';

      // Escalation check: past due by ESCALATION_THRESHOLD days
      if (overdueDays >= ESCALATION_THRESHOLD) {
        action = 'escalation';
      }
      // Critical check: at or past due date
      else if (daysRemaining <= CRITICAL_THRESHOLD) {
        action = 'critical';
      }
      // Warning check: approaching due date
      else if (daysRemaining <= WARNING_THRESHOLD) {
        action = 'warning';
      }

      results.details.push({
        capaId: capa.capaId,
        capaTitle: capa.title,
        status: capa.status,
        priority: capa.priority,
        assignedTo: capa.assignedTo || null,
        slaDays,
        daysRemaining,
        action,
      });

      if (action === 'none') {
        results.skipped++;
        continue;
      }

      // Generate SLA notification (duplicate detection prevents spam)
      try {
        const NOTIFICATION_CONFIG = {
          warning: {
            title: `تنبيه مهلة كابا: ${capa.title}`,
            description: `حالة كابا (${capa.capaId}) بأولوية ${capa.priority} على وشك انتهاء المهلة. متبقي ${daysRemaining} يوم. يرجى تسريع الإجراءات.`,
            priority: 'medium' as const,
          },
          critical: {
            title: `تجاوز مهلة كابا: ${capa.title}`,
            description: `حالة كابا (${capa.capaId}) بأولوية ${capa.priority} تجاوزت المهلة المحددة (${slaDays} يوم). الإجراء الفوري مطلوب. متأخر ${overdueDays} يوم.`,
            priority: 'high' as const,
          },
          escalation: {
            title: `تصعيد كابا - تجاوز مهلة مزدوج: ${capa.title}`,
            description: `حالة كابا (${capa.capaId}) بأولوية ${capa.priority} تجاوزت المهلة بـ ${overdueDays} يوم. يتطلب تصعيد فوري للإدارة. المهلة الأصلية: ${slaDays} يوم.`,
            priority: 'critical' as const,
          },
        };

        const config = NOTIFICATION_CONFIG[action];
        await createSmartNotification({
          title: config.title,
          description: config.description,
          priority: config.priority,
          category: 'capa',
          sourceModule: 'capa',
          sourceRecordId: capa.id,
          employeeId: capa.employeeId || null,
          employeeName: capa.employeeName || null,
          assignedTo: capa.assignedTo || null,
          assignedToName: capa.assignedToName || null,
          actionUrl: `capa:${capa.id}`,
        });

        if (action === 'warning') results.warningGenerated++;
        else if (action === 'critical') results.criticalGenerated++;
        else if (action === 'escalation') results.escalationGenerated++;
      } catch (notifErr) {
        console.error(`[SLA Monitor] Notification failed for ${capa.capaId}:`, notifErr);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        checked: results.checked,
        warningGenerated: results.warningGenerated,
        criticalGenerated: results.criticalGenerated,
        escalationGenerated: results.escalationGenerated,
        skipped: results.skipped,
        totalAlerts: results.warningGenerated + results.criticalGenerated + results.escalationGenerated,
      },
      details: results.details,
    });
  } catch (error) {
    console.error('[GET /api/capa-sla] Error:', error);
    return NextResponse.json({ error: 'SLA monitoring failed' }, { status: 500 });
  }
}
