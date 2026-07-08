// ═══════════════════════════════════════════════════════════════
//  AOCC Event Collector & Intelligence Engine
//  Pure functions — no React, no API calls.
//  Takes raw API data and produces operational intelligence:
//  normalized events, scored actions, cross-module correlations,
//  department health, and smart recommendations.
// ═══════════════════════════════════════════════════════════════

import { isOverdue, getSLAInfo } from '@/lib/capa-helpers';
import { SLA_DAYS } from '@/lib/capa-constants';
import {
  calculatePriorityScore,
  getPriorityLevel,
  sortByPriority,
  scoreAndSortEvents,
} from '@/lib/aocc/priority-engine';
import type {
  OperationalEvent,
  ActionItem,
  EmployeeCorrelation,
  DepartmentHealth,
  OperationalRecommendation,
  ActivityFeedEntry,
  ExecutiveIntelligence,
  RawDataBundle,
  PriorityLevel,
  SourceModule,
  TrendDirection,
  OperationalStatus,
} from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function isToday(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  return dateStr.startsWith(todayStr());
}

function isOverdueDate(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (isNaN(target)) return null;
  const now = new Date(todayStr()).getTime();
  return Math.floor((target - now) / (24 * 60 * 60 * 1000));
}

function hoursSince(dateStr?: string | null): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (60 * 60 * 1000));
}

/** Count issues for an employee across modules in a 30-day window */
function countEmployeeIssues(employeeId: string, data: RawDataBundle): number {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let count = 0;

  // Attendance issues (late/absent)
  count += data.followUpItems.filter(
    (f) => f.employeeId === employeeId && new Date(f.createdAt || f.date).getTime() > thirtyDaysAgo
  ).length;

  // Quality + HR deductions
  count += data.capaItems.filter(
    (c) => c.employeeId === employeeId && new Date(c.createdAt).getTime() > thirtyDaysAgo
  ).length;

  count += data.complaintItems.filter(
    (c) => c.employeeId === employeeId && new Date(c.createdAt).getTime() > thirtyDaysAgo
  ).length;

  return count;
}

// ═══════════════════════════════════════════════════════════════
//  PART 1: Event Collection — normalize all data into events
// ═══════════════════════════════════════════════════════════════

/**
 * Collect and normalize operational events from all data sources.
 * Each record becomes an OperationalEvent with the common structure.
 */
export function collectEvents(data: RawDataBundle): OperationalEvent[] {
  const events: OperationalEvent[] = [];

  // ── CAPA Events ──
  data.capaItems.forEach((capa: any) => {
    const overdue = isOverdue(capa);
    const slaInfo = getSLAInfo(capa);
    const isCritical = capa.priority === 'critical';
    const isHigh = capa.priority === 'high';

    let type: OperationalEvent['type'];
    let severity: PriorityLevel;

    if (overdue) {
      type = 'capa_overdue';
      severity = 'critical';
    } else if (isCritical) {
      type = 'capa_critical';
      severity = 'critical';
    } else if (isHigh) {
      type = 'capa_high';
      severity = 'high';
    } else {
      // SLA warning — due within 1 day
      if (slaInfo.state === 'warning' || slaInfo.state === 'critical') {
        type = 'sla_breach';
        severity = 'high';
      } else {
        return; // skip non-urgent CAPA
      }
    }

    const employeeIssueCount = capa.employeeId ? countEmployeeIssues(capa.employeeId, data) : 0;

    events.push({
      id: `capa-${capa.id}`,
      type,
      severity,
      timestamp: capa.createdAt,
      employeeId: capa.employeeId || null,
      employeeName: capa.employeeName || null,
      department: capa.department || null,
      source: 'capa',
      sourceRecordId: capa.id,
      actionUrl: null,
      targetPage: 'capa',
      status: capa.status,
      title: capa.title || 'قضية كابا',
      description: capa.problemDescription || null,
      metadata: {
        priority: capa.priority,
        overdueDays: capa.overdueDays || slaInfo.overdueDays,
        daysRemaining: slaInfo.daysRemaining,
        slaDays: capa.slaDays || SLA_DAYS[capa.priority] || 7,
        employeeIssueCount,
        dueDate: capa.correctiveDueDate || capa.preventiveDueDate,
        assignedTo: capa.assignedTo,
        assignedToName: capa.assignedToName,
      },
    });
  });

  // ── Complaint Events ──
  data.complaintItems.forEach((complaint: any) => {
    if (complaint.severity === 'critical') {
      const employeeIssueCount = complaint.employeeId ? countEmployeeIssues(complaint.employeeId, data) : 0;
      events.push({
        id: `complaint-${complaint.id}`,
        type: 'complaint_critical',
        severity: 'critical',
        timestamp: complaint.createdAt,
        employeeId: complaint.employeeId || null,
        employeeName: complaint.employeeName || null,
        department: null,
        source: 'complaints',
        sourceRecordId: complaint.id,
        actionUrl: null,
        targetPage: 'complaints',
        status: complaint.status,
        title: complaint.customerName ? `شكوى: ${complaint.customerName}` : 'شكوى حرجة',
        description: complaint.description || null,
        metadata: {
          severity: complaint.severity,
          complaintType: complaint.complaintType,
          employeeIssueCount,
          dueDate: complaint.createdAt,
        },
      });
    } else if (complaint.severity === 'high') {
      events.push({
        id: `complaint-${complaint.id}`,
        type: 'complaint_high',
        severity: 'high',
        timestamp: complaint.createdAt,
        employeeId: complaint.employeeId || null,
        employeeName: complaint.employeeName || null,
        department: null,
        source: 'complaints',
        sourceRecordId: complaint.id,
        actionUrl: null,
        targetPage: 'complaints',
        status: complaint.status,
        title: complaint.customerName ? `شكوى: ${complaint.customerName}` : 'شكوى عالية',
        description: complaint.description || null,
        metadata: { severity: complaint.severity, dueDate: complaint.createdAt },
      });
    }
  });

  // ── Follow-Up Events ──
  data.followUpItems.forEach((fu: any) => {
    const isOverdueFu = fu.status === 'overdue' ||
      (fu.nextFollowUpDate && isOverdueDate(fu.nextFollowUpDate) && fu.status !== 'resolved' && fu.status !== 'closed');
    const isDueToday = fu.nextFollowUpDate && isToday(fu.nextFollowUpDate);

    if (isOverdueFu) {
      const employeeIssueCount = fu.employeeId ? countEmployeeIssues(fu.employeeId, data) : 0;
      events.push({
        id: `fu-${fu.id}`,
        type: 'followup_overdue',
        severity: fu.priorityLevel === 'critical' ? 'critical' : 'high',
        timestamp: fu.createdAt,
        employeeId: fu.employeeId || null,
        employeeName: fu.employeeName || null,
        department: fu.department || null,
        source: 'followUps',
        sourceRecordId: fu.id,
        actionUrl: null,
        targetPage: 'followUps',
        status: fu.status,
        title: fu.subject || 'متابعة مستحقة',
        description: fu.detailedDescription || null,
        metadata: {
          priorityLevel: fu.priorityLevel,
          employeeIssueCount,
          dueDate: fu.nextFollowUpDate || fu.date,
          responsiblePerson: fu.responsiblePersonName,
        },
      });
    } else if (isDueToday) {
      events.push({
        id: `fu-${fu.id}`,
        type: 'followup_due',
        severity: 'medium',
        timestamp: fu.createdAt,
        employeeId: fu.employeeId || null,
        employeeName: fu.employeeName || null,
        department: fu.department || null,
        source: 'followUps',
        sourceRecordId: fu.id,
        actionUrl: null,
        targetPage: 'followUps',
        status: fu.status,
        title: fu.subject || 'متابعة مجدولة اليوم',
        description: null,
        metadata: { dueDate: fu.nextFollowUpDate, responsiblePerson: fu.responsiblePersonName },
      });
    }
  });

  // ── Risk Center Events ──
  data.riskEmployees.forEach((emp: any) => {
    if (emp.riskLevel === 'critical' || emp.riskLevel === 'high') {
      const employeeIssueCount = countEmployeeIssues(emp.employeeId, data);
      events.push({
        id: `risk-${emp.employeeId}`,
        type: emp.riskLevel === 'critical' ? 'risk_critical' : 'risk_high',
        severity: emp.riskLevel === 'critical' ? 'critical' : 'high',
        timestamp: emp.lastActivity || new Date().toISOString(),
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department || null,
        source: 'riskCenter',
        sourceRecordId: emp.employeeId,
        actionUrl: null,
        targetPage: 'riskCenter',
        status: 'open',
        title: `${emp.employeeName} — مخاطر ${emp.riskLevel === 'critical' ? 'حرجة' : 'عالية'}`,
        description: `درجة المخاطر: ${emp.riskScore}`,
        metadata: {
          riskScore: emp.riskScore,
          riskLevel: emp.riskLevel,
          trend: emp.trend,
          employeeIssueCount,
          openCases: emp.openCases,
        },
      });
    }
  });

  // ── Travel Urgent Events ──
  const upcomingTrips = data.stats.upcomingTravel || [];
  upcomingTrips.forEach((trip: any) => {
    const days = daysUntil(trip.departureDate);
    if (days !== null && days >= 0 && days <= 2) {
      events.push({
        id: `travel-${trip.id}`,
        type: 'travel_urgent',
        severity: days <= 1 ? 'critical' : 'high',
        timestamp: trip.createdAt,
        employeeId: trip.employeeId || null,
        employeeName: null,
        department: null,
        source: 'travel',
        sourceRecordId: trip.id,
        actionUrl: null,
        targetPage: 'travel',
        status: trip.status,
        title: `سفر عاجل: ${trip.destination || 'وجهة غير محددة'}`,
        description: null,
        metadata: { dueDate: trip.departureDate, daysUntil: days },
      });
    }
  });

  // ── Pending Requests ──
  const pendingDetails = data.stats.pendingRequestsDetails || [];
  pendingDetails.forEach((req: any) => {
    const hours = hoursSince(req.createdAt);
    if (hours > 12) {
      events.push({
        id: `req-${req.id}`,
        type: 'request_pending',
        severity: hours > 48 ? 'high' : 'medium',
        timestamp: req.createdAt,
        employeeId: req.employeeId || null,
        employeeName: req.employeeName || null,
        department: req.employeeDepartment || null,
        source: 'requests',
        sourceRecordId: req.id,
        actionUrl: null,
        targetPage: 'requests',
        status: req.status,
        title: `طلب ${req.type}: ${req.employeeName || ''}`,
        description: req.reason || null,
        metadata: { hoursPending: hours, requestType: req.type, dueDate: req.date },
      });
    }
  });

  // ── Critical Notifications ──
  data.notifications.forEach((notif: any) => {
    if (notif.status !== 'unread') return;
    if (notif.priority === 'critical' || notif.priority === 'high') {
      events.push({
        id: `notif-${notif.id}`,
        type: notif.priority === 'critical' ? 'notification_critical' : 'notification_high',
        severity: notif.priority,
        timestamp: notif.createdAt,
        employeeId: notif.employeeId || null,
        employeeName: notif.employeeName || null,
        department: null,
        source: 'notifications',
        sourceRecordId: notif.id,
        actionUrl: notif.actionUrl,
        targetPage: notif.targetPage || 'notifications',
        status: notif.status,
        title: notif.title,
        description: notif.description || null,
        metadata: { priority: notif.priority, category: notif.category },
      });
    }
  });

  return events;
}

// ═══════════════════════════════════════════════════════════════
//  PART 2: Action Generation — convert events to actionable items
// ═══════════════════════════════════════════════════════════════

/** Suggested action text by event type */
const SUGGESTED_ACTIONS: Record<string, string> = {
  capa_overdue: 'مراجعة وتسريع الإجراء التصحيحي',
  capa_critical: 'تعيين مالك وتحديد خطة عمل',
  capa_high: 'متابعة تقدم الإجراءات التصحيحية',
  complaint_critical: 'تحقيق عاجل وتصعيد',
  complaint_high: 'مراجعة وتحديد مسؤول',
  followup_overdue: 'متابعة فورية مع الموظف',
  followup_due: 'إجراء المتابعة المجدولة',
  request_pending: 'مراجعة واعتماد/رفض',
  travel_urgent: 'تأكيد الترتيبات اللوجستية',
  risk_critical: 'تدخل فوري ومراجعة شاملة',
  risk_high: 'مراجعة وخطة تخفيف',
  sla_breach: 'تصعيد لتجنب تجاوز SLA',
  notification_critical: 'مراجعة الإشعار الحرج',
  notification_high: 'معالجة الإشعار عالي الأولوية',
  attendance_absent: 'التحقق من سبب الغياب',
  attendance_late: 'متابعة التأخير المتكرر',
  quality_violation: 'مراجعة الانتهاك وإنشاء كابا',
  hr_deduction: 'مراجعة الخصم',
};

/** Reason text by event type */
const REASON_TEXT: Record<string, string> = {
  capa_overdue: 'كابا متجاوزة موعد الاستحقاق',
  capa_critical: 'كابا بأولوية حرجة تتطلب تدخل فوري',
  capa_high: 'كابا عالية الأولوية قيد المعالجة',
  complaint_critical: 'شكوى حرجة من عميل',
  complaint_high: 'شكوى عالية الأولوية',
  followup_overdue: 'متابعة لم تُنجز في موعدها',
  followup_due: 'متابعة مجدولة لليوم',
  request_pending: 'طلب بانتظار الموافقة',
  travel_urgent: 'سفر عاجل خلال يومين',
  risk_critical: 'موظف بمستوى مخاطر حرج',
  risk_high: 'موظف بمستوى مخاطر عالي',
  sla_breach: 'اقتراب موعد SLA',
  notification_critical: 'إشعار حرج غير مقروء',
  notification_high: 'إشعار عالي الأولوية غير مقروء',
  sla_breach_warning: 'تحذير SLA',
  attendance_absent: 'غياب اليوم',
  attendance_late: 'تأخير اليوم',
  quality_violation: 'انتهاك جودة',
  hr_deduction: 'خصم موارد بشرية',
};

/**
 * Generate a unified, priority-sorted action queue from collected events.
 * Each action includes reason, suggested action, and navigation target.
 */
export function generateActions(events: OperationalEvent[]): ActionItem[] {
  const scored = scoreAndSortEvents(events);

  const actions: ActionItem[] = scored.map((scored) => {
    const event = scored.event;
    const meta = event.metadata || {};

    return {
      id: event.id,
      title: event.title,
      reason: REASON_TEXT[event.type] || 'يتطلب اهتمام',
      priority: scored.priorityLevel,
      score: scored.score,
      sourceModule: event.source,
      assignedTo: (meta.assignedTo as string) || (meta.responsiblePerson as string) || null,
      assignedToName: (meta.assignedToName as string) || (meta.responsiblePerson as string) || null,
      department: event.department,
      dueDate: (meta.dueDate as string) || event.timestamp,
      suggestedAction: SUGGESTED_ACTIONS[event.type] || 'مراجعة',
      actionUrl: event.actionUrl,
      targetPage: event.targetPage,
      status: event.status,
      employeeId: event.employeeId,
      employeeName: event.employeeName,
      severity: event.severity,
      factors: scored.factors,
      sourceRecordId: event.sourceRecordId,
    };
  });

  return sortByPriority(actions);
}

// ═══════════════════════════════════════════════════════════════
//  PART 3: Cross-Module Employee Correlation
// ═══════════════════════════════════════════════════════════════

/**
 * Correlate all data for a single employee across modules.
 * Produces a unified operational picture.
 */
export function correlateEmployee(employeeId: string, data: RawDataBundle): EmployeeCorrelation | null {
  // Find employee in risk center data
  const riskEmp = data.riskEmployees.find((e) => e.employeeId === employeeId);
  if (!riskEmp) return null;

  // Gather cross-module data
  const employeeCapas = data.capaItems.filter((c) => c.employeeId === employeeId);
  const employeeComplaints = data.complaintItems.filter((c) => c.employeeId === employeeId);
  const employeeFollowUps = data.followUpItems.filter((f) => f.employeeId === employeeId);

  const overdueCapas = employeeCapas.filter((c) => isOverdue(c));
  const criticalCapas = employeeCapas.filter((c) => c.priority === 'critical');
  const criticalComplaints = employeeComplaints.filter((c) => c.severity === 'critical');
  const overdueFollowUps = employeeFollowUps.filter(
    (f) => f.status === 'overdue' || (f.nextFollowUpDate && isOverdueDate(f.nextFollowUpDate) && f.status !== 'resolved' && f.status !== 'closed')
  );

  // Count affected modules
  const affectedModules: SourceModule[] = [];
  if (riskEmp.riskScore > 0) affectedModules.push('riskCenter');
  if (employeeCapas.length > 0) affectedModules.push('capa');
  if (employeeComplaints.length > 0) affectedModules.push('complaints');
  if (employeeFollowUps.length > 0) affectedModules.push('followUps');

  // Attendance from home stats (lateEmployees, topOffenders)
  const lateEmp = (data.stats.lateEmployees || []).find((e: any) => e.employeeName === riskEmp.employeeName);
  const topOffender = (data.stats.topOffenders || []).find((e: any) => e.employeeId === employeeId);
  const lateCount = lateEmp ? 1 : (topOffender?.delayCount || 0);
  const absentCount = 0; // not directly available per employee in home stats
  const attendanceIssues = lateCount + absentCount;

  // Deductions from quality summary (approximate via topOffender)
  const deductions = topOffender?.deductionAmount || 0;

  // Determine operational status
  const openActions = overdueCapas.length + criticalComplaints.length + overdueFollowUps.length;
  const operationalStatus: OperationalStatus = determineOperationalStatus(
    riskEmp.riskLevel,
    openActions,
    affectedModules.length
  );

  // Generate top recommendation
  const recommendations = generateEmployeeRecommendations(riskEmp, {
    capaCount: employeeCapas.length,
    overdueCapas: overdueCapas.length,
    criticalCapas: criticalCapas.length,
    complaints: employeeComplaints.length,
    criticalComplaints: criticalComplaints.length,
    followUps: employeeFollowUps.length,
    overdueFollowUps: overdueFollowUps.length,
    attendanceIssues,
  });

  return {
    employeeId: riskEmp.employeeId,
    employeeName: riskEmp.employeeName,
    department: riskEmp.department || null,
    position: riskEmp.position || null,
    riskScore: riskEmp.riskScore,
    riskLevel: riskEmp.riskLevel as PriorityLevel,
    trend: (riskEmp.trend === 'increasing' ? 'declining' : riskEmp.trend === 'improving' ? 'improving' : 'stable') as TrendDirection,
    attendanceIssues,
    lateCount,
    absentCount,
    deductions,
    complaints: employeeComplaints.length,
    criticalComplaints: criticalComplaints.length,
    qualityIssues: 0, // not directly available per employee without quality API call
    capaCount: employeeCapas.length,
    overdueCapaCount: overdueCapas.length,
    criticalCapaCount: criticalCapas.length,
    followUps: employeeFollowUps.length,
    overdueFollowUps: overdueFollowUps.length,
    openActions,
    operationalStatus,
    topRecommendation: recommendations[0] || null,
    recommendations,
    affectedModules,
  };
}

/** Determine operational status from risk level, open actions, and module count */
function determineOperationalStatus(
  riskLevel: string,
  openActions: number,
  moduleCount: number
): OperationalStatus {
  if (riskLevel === 'critical' || openActions >= 3) return 'critical';
  if (riskLevel === 'high' || (openActions >= 2 && moduleCount >= 2)) return 'at_risk';
  if (riskLevel === 'medium' || openActions >= 1) return 'monitoring';
  return 'healthy';
}

/** Generate targeted recommendations for an employee based on their correlation data */
function generateEmployeeRecommendations(emp: any, counts: Record<string, number>): string[] {
  const recs: string[] = [];

  if (counts.overdueCapas > 0) {
    recs.push(`تسريع ${counts.overdueCapas} كابا متأخرة`);
  }
  if (counts.criticalComplaints > 0) {
    recs.push(`تحقيق في ${counts.criticalComplaints} شكوى حرجة`);
  }
  if (counts.overdueFollowUps > 0) {
    recs.push(`متابعة ${counts.overdueFollowUps} متابعة مستحقة`);
  }
  if (counts.attendanceIssues >= 3) {
    recs.push('جدولة جلسة توجيه للحضور');
  }
  if (counts.capaCount >= 3 && counts.overdueCapas === 0) {
    recs.push('مراجعة عبء العمل — كابا متعددة');
  }
  if (emp.trend === 'increasing') {
    recs.push('الاتجاه في تدهور — مراجعة عاجلة');
  }
  if (recs.length === 0 && emp.riskScore > 10) {
    recs.push('متابعة دورية للحفاظ على التحسن');
  }

  return recs;
}

/** Correlate all high/critical risk employees */
export function correlateAllEmployees(data: RawDataBundle): EmployeeCorrelation[] {
  return data.riskEmployees
    .filter((e) => e.riskLevel === 'critical' || e.riskLevel === 'high')
    .slice(0, 12)
    .map((e) => correlateEmployee(e.employeeId, data))
    .filter((c): c is EmployeeCorrelation => c !== null)
    .sort((a, b) => b.openActions - a.openActions || b.riskScore - a.riskScore);
}

// ═══════════════════════════════════════════════════════════════
//  PART 4: Department Health Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Analyze department health using multi-factor scoring.
 * Factors: attendance, complaints, quality, CAPA, risk, pending requests.
 */
export function analyzeDepartmentHealth(deptName: string, data: RawDataBundle): DepartmentHealth {
  const deptToday = (data.stats.deptTodayStats || []).find((d: any) => d.name === deptName || d.department === deptName) || {};
  const deptAnalysis = data.departmentAnalysis?.[deptName] || {};

  const present = deptToday.present || 0;
  const late = deptToday.late || 0;
  const absent = deptToday.absent || 0;
  const total = deptToday.total || (present + late + absent) || 1;

  // Module-specific counts for this department
  const deptCapas = data.capaItems.filter((c) => c.department === deptName);
  const deptComplaints = data.complaintItems.filter((c) => {
    // Complaints don't have department directly — infer from employee
    if (!c.employeeId) return false;
    const emp = data.riskEmployees.find((e) => e.employeeId === c.employeeId);
    return emp?.department === deptName;
  });

  const overdueCapas = deptCapas.filter((c) => isOverdue(c));
  const riskCount = data.riskEmployees.filter((e) => e.department === deptName && (e.riskLevel === 'critical' || e.riskLevel === 'high')).length;
  const openActions = overdueCapas.length + deptComplaints.filter((c) => c.severity === 'critical').length;
  const pendingRequests = (data.stats.pendingRequestsDetails || []).filter((r: any) => r.employeeDepartment === deptName).length;

  // ── Multi-factor health score (0-100) ──
  const attendanceRate = ((present + late * 0.5) / total) * 100;

  // Deductions from each factor (starting at 100)
  let healthScore = 100;
  healthScore -= Math.max(0, (absent / total) * 40);           // absent: up to -40
  healthScore -= Math.min(20, deptCapas.length * 3);           // CAPA count: up to -20
  healthScore -= Math.min(15, overdueCapas.length * 5);        // overdue CAPA: up to -15
  healthScore -= Math.min(15, deptComplaints.length * 3);      // complaints: up to -15
  healthScore -= Math.min(10, riskCount * 3);                  // risk employees: up to -10
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  // ── Warnings ──
  const warnings: string[] = [];
  if (overdueCapas.length > 0) warnings.push(`${overdueCapas.length} كابا متأخرة`);
  if (riskCount > 0) warnings.push(`${riskCount} موظف بمخاطر عالية`);
  if (deptComplaints.length > 2) warnings.push(`${deptComplaints.length} شكوى مفتوحة`);
  if (pendingRequests > 3) warnings.push(`${pendingRequests} طلب معلق`);

  // ── Critical count ──
  const criticalCount = overdueCapas.filter((c) => c.priority === 'critical').length +
    deptComplaints.filter((c) => c.severity === 'critical').length + riskCount;

  // ── Trend ──
  const trend: TrendDirection = deptAnalysis.avgScore > 30 ? 'declining' : deptAnalysis.avgScore < 10 ? 'improving' : 'stable';

  // ── Recommended action ──
  let recommendedAction: string | null = null;
  if (criticalCount > 0) {
    recommendedAction = 'مراجعة عاجلة للقضايا الحرجة';
  } else if (overdueCapas.length > 0) {
    recommendedAction = 'متابعة الكابا المتأخرة';
  } else if (riskCount > 0) {
    recommendedAction = 'مراجعة موظفي المخاطر';
  } else if (healthScore < 70) {
    recommendedAction = 'مراجعة أداء القسم';
  }

  return {
    name: deptName,
    attendanceRate: Math.round(attendanceRate),
    present,
    late,
    absent,
    total,
    complaintCount: deptComplaints.length,
    qualityIssues: deptAnalysis.qualityViolations || 0,
    capaCount: deptCapas.length,
    overdueCapaCount: overdueCapas.length,
    openActions,
    riskCount,
    pendingRequests,
    healthScore,
    trend,
    criticalCount,
    warnings,
    recommendedAction,
  };
}

/** Analyze all departments from home stats */
export function analyzeAllDepartments(data: RawDataBundle): DepartmentHealth[] {
  const deptToday = data.stats.deptTodayStats || [];
  return deptToday
    .map((d: any) => analyzeDepartmentHealth(d.name || d.department, data))
    .sort((a, b) => a.healthScore - b.healthScore); // worst first
}

// ═══════════════════════════════════════════════════════════════
//  PART 5: Smart Recommendation Generation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate intelligence-driven recommendations based on cross-module analysis.
 * Not random — derived from actual patterns in the data.
 */
export function generateRecommendations(
  correlations: EmployeeCorrelation[],
  actions: ActionItem[],
  data: RawDataBundle
): OperationalRecommendation[] {
  const recs: OperationalRecommendation[] = [];

  // ── Recommendation 1: Employees with 3+ affected modules → holistic investigation ──
  correlations
    .filter((c) => c.affectedModules.length >= 3)
    .slice(0, 3)
    .forEach((c) => {
      recs.push({
        id: `rec-investigate-${c.employeeId}`,
        reason: `${c.employeeName} متأثر في ${c.affectedModules.length} وحدات — يتطلب تحقيق شامل`,
        priority: c.operationalStatus === 'critical' ? 'critical' : 'high',
        category: 'investigation',
        affectedModule: 'riskCenter',
        affectedEmployeeId: c.employeeId,
        affectedEmployeeName: c.employeeName,
        affectedDepartment: c.department,
        actionLabel: 'فتح ملف الموظف',
        actionUrl: null,
        targetPage: 'riskCenter',
        evidence: `مخاطر: ${c.riskScore}، كابا: ${c.capaCount}، شكاوى: ${c.complaints}، متابعات: ${c.followUps}`,
        evidenceCount: c.affectedModules.length,
        linkedRecordIds: [c.employeeId],
      });
    });

  // ── Recommendation 2: Overdue CAPA + related complaint → correlate root cause ──
  const overdueCapaEmployees = new Set(
    data.capaItems.filter((c) => isOverdue(c)).map((c) => c.employeeId).filter(Boolean)
  );
  const complaintEmployees = new Set(
    data.complaintItems.filter((c) => c.severity === 'critical' || c.severity === 'high').map((c) => c.employeeId).filter(Boolean)
  );
  const overlap = [...overdueCapaEmployees].filter((id) => complaintEmployees.has(id));
  overlap.slice(0, 2).forEach((empId) => {
    const emp = data.riskEmployees.find((e) => e.employeeId === empId);
    if (emp) {
      recs.push({
        id: `rec-correlate-${empId}`,
        reason: `${emp.employeeName} لديه كابا متأخرة وشكاوى — قد يكون هناك سبب جذر مشترك`,
        priority: 'high',
        category: 'correlation',
        affectedModule: 'capa',
        affectedEmployeeId: empId,
        affectedEmployeeName: emp.employeeName,
        affectedDepartment: emp.department,
        actionLabel: 'مراجعة الارتباط',
        actionUrl: null,
        targetPage: 'capa',
        evidence: 'كابا متأخرة + شكاوى مفتوحة لنفس الموظف',
        evidenceCount: 2,
        linkedRecordIds: [empId],
      });
    }
  });

  // ── Recommendation 3: Department health declining → review operations ──
  const departments = analyzeAllDepartments(data);
  departments
    .filter((d) => d.healthScore < 70 || d.criticalCount > 0)
    .slice(0, 2)
    .forEach((d) => {
      recs.push({
        id: `rec-dept-${d.name}`,
        reason: `قسم ${d.name} بصحة ${d.healthScore}% — ${d.criticalCount} قضايا حرجة`,
        priority: d.criticalCount > 0 ? 'high' : 'medium',
        category: 'review',
        affectedModule: 'attendance',
        affectedEmployeeId: null,
        affectedEmployeeName: null,
        affectedDepartment: d.name,
        actionLabel: 'مراجعة القسم',
        actionUrl: null,
        targetPage: 'attendance',
        evidence: d.warnings.join('، ') || `صحة القسم: ${d.healthScore}%`,
        evidenceCount: d.criticalCount,
        linkedRecordIds: [],
      });
    });

  // ── Recommendation 4: Repeated attendance issues → schedule coaching ──
  correlations
    .filter((c) => c.attendanceIssues >= 3 && c.trend === 'declining')
    .slice(0, 2)
    .forEach((c) => {
      recs.push({
        id: `rec-coaching-${c.employeeId}`,
        reason: `${c.employeeName} لديه ${c.attendanceIssues} مشاكل حضور والاتجاه متدهور`,
        priority: 'medium',
        category: 'coaching',
        affectedModule: 'followUps',
        affectedEmployeeId: c.employeeId,
        affectedEmployeeName: c.employeeName,
        affectedDepartment: c.department,
        actionLabel: 'جدولة توجيه',
        actionUrl: null,
        targetPage: 'followUps',
        evidence: `${c.attendanceIssues} مشاكل حضور، درجة المخاطر: ${c.riskScore}`,
        evidenceCount: c.attendanceIssues,
        linkedRecordIds: [c.employeeId],
      });
    });

  // ── Recommendation 5: Unassigned critical actions → assign owner ──
  const unassignedCritical = actions.filter((a) => a.priority === 'critical' && !a.assignedTo);
  if (unassignedCritical.length > 0) {
    recs.push({
      id: 'rec-assign-critical',
      reason: `${unassignedCritical.length} إجراءات حرجة بدون مسؤول — تحتاج تعيين فوري`,
      priority: 'critical',
      category: 'assignment',
      affectedModule: unassignedCritical[0].sourceModule,
      affectedEmployeeId: null,
      affectedEmployeeName: null,
      affectedDepartment: null,
      actionLabel: 'تعيين مسؤولين',
      actionUrl: null,
      targetPage: unassignedCritical[0].targetPage,
      evidence: `${unassignedCritical.length} إجراءات حرجة غير معينة`,
      evidenceCount: unassignedCritical.length,
      linkedRecordIds: unassignedCritical.slice(0, 5).map((a) => a.sourceRecordId),
    });
  }

  // ── Recommendation 6: SLA breaches → escalation ──
  const slaBreaches = actions.filter((a) => a.sourceModule === 'capa' && a.factors.some((f) => f.key === 'sla_breach' || f.key === 'capa_overdue'));
  if (slaBreaches.length >= 3) {
    recs.push({
      id: 'rec-escalate-sla',
      reason: `${slaBreaches.length} قضايا كابا تتجاوز أو تقترب من SLA — تصعيد مطلوب`,
      priority: 'high',
      category: 'escalation',
      affectedModule: 'capa',
      affectedEmployeeId: null,
      affectedEmployeeName: null,
      affectedDepartment: null,
      actionLabel: 'تصعيد القضايا',
      actionUrl: null,
      targetPage: 'capa',
      evidence: `${slaBreaches.length} قضايا SLA`,
      evidenceCount: slaBreaches.length,
      linkedRecordIds: slaBreaches.slice(0, 5).map((a) => a.sourceRecordId),
    });
  }

  // Sort by priority and limit
  const priorityOrder: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return recs
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════
//  PART 6: Activity Feed Generation
// ═══════════════════════════════════════════════════════════════

const MODULE_FEED_CONFIG: Record<string, { iconType: string; colorClass: string }> = {
  attendance: { iconType: 'clock', colorClass: 'text-amber-400' },
  biometric: { iconType: 'fingerprint', colorClass: 'text-violet-400' },
  capa: { iconType: 'shield', colorClass: 'text-purple-400' },
  complaints: { iconType: 'alert', colorClass: 'text-orange-400' },
  quality: { iconType: 'award', colorClass: 'text-emerald-400' },
  hrDeductions: { iconType: 'banknote', colorClass: 'text-rose-400' },
  travel: { iconType: 'plane', colorClass: 'text-sky-400' },
  followUps: { iconType: 'clipboard', colorClass: 'text-rose-400' },
  notifications: { iconType: 'bell', colorClass: 'text-violet-400' },
  riskCenter: { iconType: 'shield-alert', colorClass: 'text-amber-400' },
  requests: { iconType: 'file', colorClass: 'text-sky-400' },
  rulesEngine: { iconType: 'zap', colorClass: 'text-yellow-400' },
};

/**
 * Build a realtime activity feed from notifications and activity logs.
 * Newest first. Caps at 50 entries.
 */
export function buildActivityFeed(
  notifications: any[],
  activityLogs: any[] | undefined
): ActivityFeedEntry[] {
  const entries: ActivityFeedEntry[] = [];

  // ── From notifications (all users) ──
  notifications.forEach((notif: any) => {
    const config = MODULE_FEED_CONFIG[notif.sourceModule] || MODULE_FEED_CONFIG[notif.category] || MODULE_FEED_CONFIG.notifications;
    entries.push({
      id: `notif-${notif.id}`,
      timestamp: notif.createdAt,
      timeLabel: formatTimeLabel(notif.createdAt),
      title: notif.title,
      description: notif.description?.slice(0, 100) || null,
      sourceModule: (notif.sourceModule as SourceModule) || 'notifications',
      iconType: config.iconType,
      colorClass: config.colorClass,
      targetPage: notif.targetPage || 'notifications',
      sourceRecordId: notif.sourceRecordId || notif.id,
      employeeName: notif.employeeName || null,
      priority: (notif.priority as PriorityLevel) || 'low',
    });
  });

  // ── From activity logs (admin only) ──
  if (activityLogs && activityLogs.length > 0) {
    activityLogs.forEach((log: any) => {
      const config = MODULE_FEED_CONFIG[log.page] || MODULE_FEED_CONFIG.notifications;
      entries.push({
        id: `log-${log.id}`,
        timestamp: log.timestamp || log.createdAt,
        timeLabel: formatTimeLabel(log.timestamp || log.createdAt),
        title: log.details || log.action,
        description: log.userName ? `بواسطة ${log.userName}` : null,
        sourceModule: (log.page as SourceModule) || 'notifications',
        iconType: config.iconType,
        colorClass: config.colorClass,
        targetPage: log.page || 'home',
        sourceRecordId: log.id,
        employeeName: null,
        priority: 'low',
      });
    });
  }

  // Sort newest first, cap at 50
  return entries
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);
}

function formatTimeLabel(timestamp: string): string {
  if (!timestamp) return '--:--';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════
//  PART 7: Executive Intelligence Summary
// ═══════════════════════════════════════════════════════════════

/**
 * Generate executive intelligence summary answering:
 * - What happened today?
 * - What requires executive attention?
 * - Which department declined?
 * - Who needs escalation?
 * - Which KPI improved?
 */
export function generateExecutiveIntelligence(
  actions: ActionItem[],
  correlations: EmployeeCorrelation[],
  departments: DepartmentHealth[],
  data: RawDataBundle
): ExecutiveIntelligence {
  const stats = data.stats || {};
  const today = todayStr();

  // Today's counts from notifications
  const todayNotifs = (data.notifications || []).filter((n) => isToday(n.createdAt));
  const todayActionsCount = todayNotifs.length;
  const todayResolvedCount = todayNotifs.filter((n) => n.status === 'resolved' || n.status === 'read').length;
  const todayEscalatedCount = todayNotifs.filter((n) => n.priority === 'critical').length;

  // Priority counts
  const criticalCount = actions.filter((a) => a.priority === 'critical').length;
  const highCount = actions.filter((a) => a.priority === 'high').length;

  // Top 5 priorities
  const topPriorities = actions.slice(0, 5);

  // Worst department
  const worstDepartment = departments.length > 0 ? departments[0] : null;

  // Escalation candidates (top 3 by openActions + riskScore)
  const escalationCandidates = [...correlations]
    .sort((a, b) => b.openActions - a.openActions || b.riskScore - a.riskScore)
    .slice(0, 3);

  // KPI trends
  const curr = stats.currentMonthPerformance || {};
  const last = stats.lastMonthPerformance || {};

  const calcChange = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const delaysChange = calcChange(curr.totalDelays || 0, last.totalDelays || 0);
  const attendanceRateChange = calcChange(curr.totalPresent || 0, last.totalPresent || 0);
  const deductionsChange = calcChange(curr.totalDeductionAmount || 0, last.totalDeductionAmount || 0);

  // Overall trend direction
  let direction: TrendDirection = 'stable';
  if (delaysChange > 10 || deductionsChange > 10) direction = 'declining';
  else if (delaysChange < -10 || attendanceRateChange > 10) direction = 'improving';

  return {
    todayActionsCount,
    todayResolvedCount,
    todayEscalatedCount,
    criticalCount,
    highCount,
    topPriorities,
    worstDepartment,
    escalationCandidates,
    trends: {
      delaysChange,
      attendanceRateChange,
      deductionsChange,
      direction,
    },
    currentMonth: curr.monthLabel || 'هذا الشهر',
    lastMonth: last.monthLabel || 'الشهر السابق',
    totalPresent: curr.totalPresent || stats.presentCount || 0,
    totalAbsent: curr.totalAbsent || stats.absentCount || 0,
    totalDeductions: curr.totalDeductionAmount || 0,
    openCAPACount: data.capaItems.length,
    openComplaintsCount: data.complaintItems.length,
    pendingRequestsCount: stats.pendingRequests || 0,
  };
}
