import { createId } from '@paralleldrive/cuid2';
import {
  getAll,
  createRecord,
  updateRecord,
  countWhere,
  findWhere,
  withEmployee,
  TTL,
} from '@/lib/db';
import type {
  AutomationRule,
  RuleConditionGroup,
  RuleCondition,
  RuleAction,
  RuleExecutionLog,
  AppNotification,
} from '@/types';

// ══════════════════════════════════════════════════════════════
//  Condition Evaluation
// ══════════════════════════════════════════════════════════════

/**
 * Evaluate a single condition against a data record.
 * Supports operators: equals, not_equals, contains, greater_than,
 * less_than, between, in_list, not_in_list, empty, not_empty.
 */
export function evaluateCondition(
  condition: RuleCondition,
  data: Record<string, any>
): boolean {
  const fieldValue = data[condition.field];
  const targetValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return fieldValue === targetValue;

    case 'not_equals':
      return fieldValue !== targetValue;

    case 'contains':
      if (typeof fieldValue !== 'string' || typeof targetValue !== 'string') return false;
      return fieldValue.toLowerCase().includes(targetValue.toLowerCase());

    case 'greater_than': {
      const fVal = Number(fieldValue);
      const tVal = Number(targetValue);
      if (isNaN(fVal) || isNaN(tVal)) return false;
      return fVal > tVal;
    }

    case 'less_than': {
      const fVal = Number(fieldValue);
      const tVal = Number(targetValue);
      if (isNaN(fVal) || isNaN(tVal)) return false;
      return fVal < tVal;
    }

    case 'between': {
      const fVal = Number(fieldValue);
      const from = Number(targetValue);
      const to = Number(condition.valueTo);
      if (isNaN(fVal) || isNaN(from) || isNaN(to)) return false;
      return fVal >= from && fVal <= to;
    }

    case 'in_list': {
      const list = Array.isArray(targetValue) ? targetValue : [targetValue];
      return list.some((v: any) => String(v) === String(fieldValue));
    }

    case 'not_in_list': {
      const list = Array.isArray(targetValue) ? targetValue : [targetValue];
      return !list.some((v: any) => String(v) === String(fieldValue));
    }

    case 'empty':
      return fieldValue === null || fieldValue === undefined || fieldValue === '' ||
        (Array.isArray(fieldValue) && fieldValue.length === 0);

    case 'not_empty':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== '' &&
        !(Array.isArray(fieldValue) && fieldValue.length === 0);

    default:
      console.warn(`[rules-engine] Unknown operator: ${condition.operator}`);
      return false;
  }
}

/**
 * Evaluate a condition group with AND/OR logic and nested sub-groups.
 */
export function evaluateConditionGroup(
  group: RuleConditionGroup,
  data: Record<string, any>
): boolean {
  const conditionResults = group.conditions.map((c) => evaluateCondition(c, data));

  // Evaluate nested groups if present
  const groupResults = (group.groups || []).map((g) => evaluateConditionGroup(g, data));

  // Combine all boolean results
  const allResults = [...conditionResults, ...groupResults];

  if (allResults.length === 0) return true;

  if (group.logic === 'or') {
    return allResults.some(Boolean);
  }

  // Default: 'and'
  return allResults.every(Boolean);
}

// ══════════════════════════════════════════════════════════════
//  Action Execution
// ══════════════════════════════════════════════════════════════

/**
 * Execute a list of rule actions (create_notification, create_follow_up, add_timeline_event, etc.)
 * Returns arrays of actions taken and any errors encountered.
 */
export async function executeRuleActions(
  actions: RuleAction[],
  context: {
    employeeId?: string;
    employeeName?: string;
    ruleId: string;
    ruleName: string;
    sourceModule: string;
    sourceRecordId?: string;
  }
): Promise<{ actionsTaken: string[]; errors: string[] }> {
  const actionsTaken: string[] = [];
  const errors: string[] = [];

  for (const action of actions) {
    try {
      const { type, config } = action;

      switch (type) {
        case 'create_notification': {
          const notification = await createSmartNotification({
            title: config.title || `قاعدة: ${context.ruleName}`,
            description: config.description || '',
            priority: config.priority || 'medium',
            category: config.category || 'automation',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.employeeId || context.employeeId || null,
            employeeName: config.employeeName || context.employeeName || null,
            assignedTo: config.assignedTo || null,
            assignedToName: config.assignedToName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
            actionUrl: config.actionUrl || null,
          });
          actionsTaken.push(`notification:${notification.id}`);
          break;
        }

        case 'create_follow_up': {
          const followUpData: Record<string, any> = {
            employeeId: config.employeeId || context.employeeId,
            date: config.date || new Date().toISOString().split('T')[0],
            followUpType: config.followUpType || 'other',
            subject: config.subject || `تلقائي: ${context.ruleName}`,
            detailedDescription: config.description || '',
            positiveNotes: '',
            negativeNotes: '',
            rootCause: config.rootCause || '',
            actionTaken: config.actionTaken || '',
            department: config.department || '',
            position: config.position || '',
            priorityLevel: config.priority || 'medium',
            responsiblePerson: config.responsiblePerson || '',
            nextFollowUpDate: config.nextFollowUpDate || null,
            followUpRequired: true,
            status: 'open',
            score: { low: 1, medium: 3, high: 5, critical: 10 }[config.priority || 'medium'] || 3,
            attachments: [],
            createdById: 'system',
            createdByName: 'محرك القواعد',
            relatedDeductionId: null,
          };

          // Resolve employee name if not provided
          if (followUpData.employeeId && !followUpData.employeeName) {
            const employees = await getAll('employees', TTL.MEDIUM);
            const emp = employees.find((e: any) => e.id === followUpData.employeeId);
            if (emp) {
              followUpData.employeeName = emp.name;
              if (!followUpData.department) followUpData.department = emp.department || '';
              if (!followUpData.position) followUpData.position = emp.position || '';
            }
          }

          const followUp = await createRecord('followUps', followUpData);
          actionsTaken.push(`followUp:${followUp.id}`);
          break;
        }

        case 'add_timeline_event': {
          // Timeline events are stored as notifications with category 'automation'
          const eventTitle = config.title || `حدث: ${context.ruleName}`;
          const eventDesc = config.description || '';

          await createSmartNotification({
            title: eventTitle,
            description: eventDesc,
            priority: 'low',
            category: 'automation',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.employeeId || context.employeeId || null,
            employeeName: config.employeeName || context.employeeName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push('timeline_event');
          break;
        }

        case 'update_risk_score': {
          // Log as a notification since risk score updates need UI tracking
          await createSmartNotification({
            title: `تحديث درجة المخاطر - ${config.targetEmployeeName || context.employeeName || ''}`,
            description: `تم تحديث درجة المخاطر بواسطة القاعدة "${context.ruleName}". القيمة الجديدة: ${config.score ?? 'N/A'}`,
            priority: config.priority || 'high',
            category: 'risk',
            sourceModule: context.sourceModule,
            sourceRecordId: config.targetEmployeeId || context.employeeId || null,
            employeeId: config.targetEmployeeId || context.employeeId || null,
            employeeName: config.targetEmployeeName || context.employeeName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push(`risk_score_update:${config.targetEmployeeId || 'unknown'}`);
          break;
        }

        case 'assign_user': {
          // Create a notification for the assigned user
          await createSmartNotification({
            title: config.title || `تعيين جديد - ${context.ruleName}`,
            description: config.description || `تم تعيينك بواسطة القاعدة التلقائية "${context.ruleName}"`,
            priority: config.priority || 'medium',
            category: 'automation',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.assignedUserId || null,
            employeeName: config.assignedUserName || null,
            assignedTo: config.assignedUserId || null,
            assignedToName: config.assignedUserName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push(`assign:${config.assignedUserId || 'unknown'}`);
          break;
        }

        case 'create_hr_warning': {
          await createSmartNotification({
            title: `تنبيه HR - ${config.title || context.ruleName}`,
            description: config.description || `تم إنشاء تنبيه HR تلقائي بواسطة القاعدة "${context.ruleName}"`,
            priority: config.priority || 'high',
            category: 'hr',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.employeeId || context.employeeId || null,
            employeeName: config.employeeName || context.employeeName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push('hr_warning');
          break;
        }

        case 'create_quality_review': {
          await createSmartNotification({
            title: `مراجعة جودة - ${config.title || context.ruleName}`,
            description: config.description || `تم إنشاء مراجعة جودة تلقائية بواسطة القاعدة "${context.ruleName}"`,
            priority: config.priority || 'high',
            category: 'quality',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.employeeId || context.employeeId || null,
            employeeName: config.employeeName || context.employeeName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push('quality_review');
          break;
        }

        case 'escalate_case': {
          await createSmartNotification({
            title: `تصعيد - ${config.title || context.ruleName}`,
            description: config.description || `تم تصعيد الحالة بواسطة القاعدة التلقائية "${context.ruleName}"`,
            priority: 'critical',
            category: 'automation',
            sourceModule: context.sourceModule,
            sourceRecordId: context.sourceRecordId || null,
            employeeId: config.escalatedTo || null,
            assignedTo: config.escalatedTo || null,
            assignedToName: config.escalatedToName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push(`escalate:${config.escalatedTo || 'unknown'}`);
          break;
        }

        case 'update_employee_status': {
          // Log the status update as a notification
          await createSmartNotification({
            title: `تحديث حالة الموظف - ${config.title || context.ruleName}`,
            description: config.description || `تم تحديث حالة الموظف بواسطة القاعدة "${context.ruleName}". الحالة الجديدة: ${config.newStatus ?? 'N/A'}`,
            priority: config.priority || 'high',
            category: 'employee',
            sourceModule: context.sourceModule,
            sourceRecordId: config.employeeId || context.employeeId || null,
            employeeId: config.employeeId || context.employeeId || null,
            employeeName: config.employeeName || context.employeeName || null,
            ruleId: context.ruleId,
            ruleName: context.ruleName,
          });
          actionsTaken.push(`employee_status_update:${config.employeeId || 'unknown'}`);
          break;
        }

        default: {
          console.warn(`[rules-engine] Unknown action type: ${type}`);
          errors.push(`unknown_action_type:${type}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${action.type}:${message}`);
      console.error(`[rules-engine] Action "${action.type}" failed:`, err);
    }
  }

  return { actionsTaken, errors };
}

// ══════════════════════════════════════════════════════════════
//  Rule Execution
// ══════════════════════════════════════════════════════════════

/**
 * Run a single automation rule against the provided context data.
 * Includes throttle checking (throttleMinutes), timing, and execution logging.
 */
export async function runRule(
  rule: AutomationRule,
  context: Record<string, any>
): Promise<RuleExecutionLog> {
  const startTime = Date.now();
  const now = new Date().toISOString();

  // Default execution log (will be updated)
  const logEntry: RuleExecutionLog = {
    id: createId(),
    ruleId: rule.id,
    ruleName: rule.name,
    executionDate: now.split('T')[0],
    executionTime: now,
    triggeredBy: context.triggeredBy || 'manual',
    affectedEmployeeId: context.employeeId || null,
    affectedEmployeeName: context.employeeName || null,
    result: 'skipped',
    status: 'skipped',
    executionDuration: 0,
    errorMessage: null,
    actionsTaken: [],
    createdAt: now,
  };

  // ── Throttle check ──
  if (rule.throttleMinutes > 0 && rule.lastRunAt) {
    const lastRun = new Date(rule.lastRunAt).getTime();
    const throttleMs = rule.throttleMinutes * 60 * 1000;
    if (Date.now() - lastRun < throttleMs) {
      logEntry.status = 'throttled';
      logEntry.errorMessage = `Throttled: last run was ${Math.round((Date.now() - lastRun) / 1000)}s ago, minimum ${rule.throttleMinutes}m`;
      logEntry.executionDuration = Date.now() - startTime;

      // Log and return early
      await createRecord('ruleExecutionLogs', logEntry);
      return logEntry;
    }
  }

  // ── Evaluate conditions ──
  try {
    const conditionsMet = evaluateConditionGroup(rule.conditions, context);

    if (!conditionsMet) {
      logEntry.status = 'conditions_not_met';
      logEntry.executionDuration = Date.now() - startTime;
      await createRecord('ruleExecutionLogs', logEntry);
      return logEntry;
    }

    // ── Execute actions ──
    const actionContext = {
      employeeId: context.employeeId,
      employeeName: context.employeeName,
      ruleId: rule.id,
      ruleName: rule.name,
      sourceModule: rule.module,
      sourceRecordId: context.sourceRecordId,
    };

    const { actionsTaken, errors } = await executeRuleActions(rule.actions, actionContext);

    // ── Determine result ──
    const hasErrors = errors.length > 0;
    const hasActions = actionsTaken.length > 0;

    if (hasErrors && !hasActions) {
      logEntry.result = 'failed';
      logEntry.status = 'failed';
      logEntry.errorMessage = errors.join('; ');
    } else if (hasErrors) {
      logEntry.result = 'success';
      logEntry.status = 'partial_success';
      logEntry.errorMessage = `Some actions failed: ${errors.join('; ')}`;
    } else {
      logEntry.result = 'success';
      logEntry.status = 'success';
    }

    logEntry.actionsTaken = actionsTaken;
    logEntry.executionDuration = Date.now() - startTime;

    // ── Update rule execution counters ──
    const isSuccessful = logEntry.result === 'success';
    await updateRecord('automationRules', rule.id, {
      lastRunAt: now,
      lastTriggeredBy: context.triggeredBy || 'manual',
      totalExecutions: (rule.totalExecutions || 0) + 1,
      successCount: (rule.successCount || 0) + (isSuccessful ? 1 : 0),
      failCount: (rule.failCount || 0) + (isSuccessful ? 0 : 1),
    });

    // ── Log execution ──
    await createRecord('ruleExecutionLogs', logEntry);

    return logEntry;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logEntry.result = 'failed';
    logEntry.status = 'error';
    logEntry.errorMessage = message;
    logEntry.executionDuration = Date.now() - startTime;

    // Update fail counter
    await updateRecord('automationRules', rule.id, {
      lastRunAt: now,
      totalExecutions: (rule.totalExecutions || 0) + 1,
      failCount: (rule.failCount || 0) + 1,
    });

    await createRecord('ruleExecutionLogs', logEntry);
    return logEntry;
  }
}

/**
 * Run all active automation rules, optionally filtered by module.
 * Returns counts of executed, failed, and skipped rules.
 */
export async function runAllActiveRules(
  module?: string
): Promise<{ executed: number; failed: number; skipped: number }> {
  const result = { executed: 0, failed: 0, skipped: 0 };

  try {
    const allRules = await getAll<AutomationRule>('automationRules', TTL.LONG);

    let activeRules = allRules.filter((r) => r.status === 'active');
    if (module) {
      activeRules = activeRules.filter((r) => r.module === module);
    }

    for (const rule of activeRules) {
      try {
        // Build context from rule configuration
        const context: Record<string, any> = {
          triggeredBy: 'batch_run',
          sourceModule: rule.module,
        };

        const log = await runRule(rule, context);

        if (log.result === 'success') {
          result.executed++;
        } else if (log.result === 'failed') {
          result.failed++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.failed++;
        console.error(`[rules-engine] Rule "${rule.name}" (${rule.id}) crashed:`, err);
      }
    }
  } catch (err) {
    console.error('[rules-engine] runAllActiveRules error:', err);
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
//  Smart Notification Helper
// ══════════════════════════════════════════════════════════════

/**
 * Create a notification with duplicate detection.
 * Checks for notifications with the same title + employeeId within the last hour
 * to avoid spam from rapidly re-evaluating rules.
 */
export async function createSmartNotification(
  data: Partial<AppNotification>
): Promise<AppNotification> {
  const title = data.title || '';
  const employeeId = data.employeeId;

  // Duplicate check: same title + employeeId within the last hour
  if (title && employeeId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const existing = await findWhere<AppNotification>('notifications', {
      title,
      employeeId,
    } as Record<string, any>);

    const recentDuplicate = existing.find(
      (n) => n.createdAt && n.createdAt >= oneHourAgo
    );

    if (recentDuplicate) {
      // Return the existing notification instead of creating a duplicate
      return recentDuplicate;
    }
  }

  // Auto-resolve targetPage from sourceModule/category if not explicitly provided
  const TARGET_PAGE_MAP: Record<string, string> = {
    attendance: 'attendance',
    biometric: 'biometric',
    requests: 'requests',
    quality: 'quality',
    hr: 'hrDeductions',
    hrDeductions: 'hrDeductions',
    risk: 'riskCenter',
    riskCenter: 'riskCenter',
    followUp: 'followUps',
    followUps: 'followUps',
    employee: 'employees',
    employees: 'employees',
    travel: 'travel',
    system: 'notifications',
    automation: 'rulesEngine',
    rulesEngine: 'rulesEngine',
    complaint: 'complaints',
    complaints: 'complaints',
    capa: 'capa',
  };

  const resolvedTargetPage = data.targetPage
    || TARGET_PAGE_MAP[data.sourceModule || '']
    || TARGET_PAGE_MAP[data.category || '']
    || null;

  // Auto-resolve actionUrl for employee-related notifications
  let resolvedActionUrl = data.actionUrl || null;
  if (!resolvedActionUrl && data.category === 'employee' && data.employeeId) {
    resolvedActionUrl = `employee360:${data.employeeId}`;
  }

  // Create the notification
  const notification = await createRecord<AppNotification>('notifications', {
    title: title || 'إشعار',
    description: data.description || '',
    priority: data.priority || 'medium',
    status: 'unread',
    category: data.category || 'system',
    sourceModule: data.sourceModule || '',
    sourceRecordId: data.sourceRecordId || null,
    targetPage: resolvedTargetPage,
    sourceType: data.sourceType || 'automation',
    employeeId: data.employeeId || null,
    employeeName: data.employeeName || null,
    assignedTo: data.assignedTo || null,
    assignedToName: data.assignedToName || null,
    ruleId: data.ruleId || null,
    ruleName: data.ruleName || null,
    actionUrl: resolvedActionUrl,
  });

  return notification;
}