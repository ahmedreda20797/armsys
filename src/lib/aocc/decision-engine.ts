// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — Decision Engine
//
//  Pure functions — no React, no API calls, no side effects.
//
//  Consumes the ALREADY-COMPUTED operational pipeline (actions,
//  correlations, departments, raw data) and DERIVES decisions,
//  next-best-actions, explanations, predictive alerts, coaching
//  opportunities, and executive priorities.
//
//  Core principle: one decision aggregates multiple related events
//  so the user never sees duplicate issues for the same root cause.
// ═══════════════════════════════════════════════════════════════

import { isOverdue, getSLAInfo, calculateProgress } from '@/lib/capa-helpers';
import {
  computeDecisionScore,
  decisionPriorityFromScore,
  type ScoreInput,
} from '@/lib/aocc/decision-score';
import type {
  ActionItem,
  EmployeeCorrelation,
  DepartmentHealth,
  OperationalRecommendation,
  PriorityLevel,
  SourceModule,
  TrendDirection,
} from '@/lib/aocc/types';
import type { RawDataBundle } from '@/lib/aocc/types';
import type {
  Decision,
  DecisionType,
  DecisionScore,
  DecisionExplanation,
  DecisionEvidence,
  NextBestAction,
  UrgencyLevel,
  BusinessImpact,
  PredictiveAlert,
  PredictiveAlertType,
  CoachingOpportunity,
  CoachingCategory,
  ExecutivePriorities,
  ExecutivePriorityItem,
  ExecutiveAlert,
  BusinessBottleneck,
} from '@/lib/aocc/decision-types';

// ═══════════════════════════════════════════════════════════════
//  Helpers — time math
// ═══════════════════════════════════════════════════════════════

function hoursUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.round((t - Date.now()) / (60 * 60 * 1000));
}

function daysUntil(iso: string | null): number | null {
  const h = hoursUntil(iso);
  if (h === null) return null;
  return Math.floor(h / 24);
}

function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (60 * 60 * 1000)));
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  return iso.startsWith(new Date().toISOString().split('T')[0]);
}

/** Format an estimated resolution time band. */
function estimateResolution(type: DecisionType, hoursUntilDue: number | null): string {
  if (type === 'immediate_intervention' || type === 'sla_breach') return '~30 دقيقة';
  if (hoursUntilDue !== null && hoursUntilDue <= 0) return '~1 ساعة';
  if (type === 'complaint_escalation' || type === 'risk_escalation') return '~2 ساعة';
  if (hoursUntilDue !== null && hoursUntilDue <= 24) return '~3 ساعات';
  return '~نصف يوم';
}

// ═══════════════════════════════════════════════════════════════
//  Decision Type Visuals (label + icon key + colors)
// ═══════════════════════════════════════════════════════════════

interface TypeMeta {
  label: string;
  iconKey: string;
  accentClass: string;
  bgTintClass: string;
}

const TYPE_META: Record<DecisionType, TypeMeta> = {
  immediate_intervention: { label: 'تدخل فوري', iconKey: 'siren', accentClass: 'text-red-400', bgTintClass: 'bg-red-500/5' },
  manager_review: { label: 'مراجعة المدير', iconKey: 'manager', accentClass: 'text-amber-400', bgTintClass: 'bg-amber-500/5' },
  quality_investigation: { label: 'تحقيق جودة', iconKey: 'search', accentClass: 'text-emerald-400', bgTintClass: 'bg-emerald-500/5' },
  attendance_review: { label: 'مراجعة الحضور', iconKey: 'clock', accentClass: 'text-amber-400', bgTintClass: 'bg-amber-500/5' },
  capa_required: { label: 'كابا مطلوبة', iconKey: 'shield', accentClass: 'text-purple-400', bgTintClass: 'bg-purple-500/5' },
  complaint_escalation: { label: 'تصعيد شكوى', iconKey: 'alert', accentClass: 'text-orange-400', bgTintClass: 'bg-orange-500/5' },
  hr_action_required: { label: 'إجراء موارد بشرية', iconKey: 'banknote', accentClass: 'text-rose-400', bgTintClass: 'bg-rose-500/5' },
  risk_escalation: { label: 'تصعيد مخاطر', iconKey: 'shield-alert', accentClass: 'text-red-400', bgTintClass: 'bg-red-500/5' },
  customer_follow_up: { label: 'متابعة عميل', iconKey: 'user', accentClass: 'text-sky-400', bgTintClass: 'bg-sky-500/5' },
  executive_attention: { label: 'انتباه تنفيذي', iconKey: 'crown', accentClass: 'text-indigo-400', bgTintClass: 'bg-indigo-500/5' },
  policy_violation: { label: 'مخالفة سياسة', iconKey: 'gavel', accentClass: 'text-red-400', bgTintClass: 'bg-red-500/5' },
  training_required: { label: 'تدريب مطلوب', iconKey: 'graduation', accentClass: 'text-cyan-400', bgTintClass: 'bg-cyan-500/5' },
  repeated_behavior: { label: 'سلوك متكرر', iconKey: 'repeat', accentClass: 'text-amber-400', bgTintClass: 'bg-amber-500/5' },
  system_health: { label: 'صحة النظام', iconKey: 'server', accentClass: 'text-teal-400', bgTintClass: 'bg-teal-500/5' },
  approval_required: { label: 'اعتماد مطلوب', iconKey: 'stamp', accentClass: 'text-sky-400', bgTintClass: 'bg-sky-500/5' },
  deadline_risk: { label: 'خطر موعد نهائي', iconKey: 'hourglass', accentClass: 'text-amber-400', bgTintClass: 'bg-amber-500/5' },
  sla_breach: { label: 'تجاوز SLA', iconKey: 'timer', accentClass: 'text-red-400', bgTintClass: 'bg-red-500/5' },
};

export function getDecisionTypeMeta(type: DecisionType): TypeMeta {
  return TYPE_META[type] ?? TYPE_META.manager_review;
}

// ═══════════════════════════════════════════════════════════════
//  PART 4: Next Best Action templates per decision type
// ═══════════════════════════════════════════════════════════════

/** Build the next-best-actions list for a decision based on its type + context. */
function buildNextBestActions(
  type: DecisionType,
  ctx: {
    employeeId: string | null;
    employeeName: string | null;
    department: string | null;
    sourceRecordId: string | null;
    primaryTargetPage: SourceModule | 'employee360';
  }
): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const eid = ctx.employeeId;
  const rid = ctx.sourceRecordId;

  const add = (
    label: string,
    description: string,
    kind: NextBestAction['kind'],
    iconKey: string,
    order: number,
    targetPage?: string,
    targetRecordId?: string,
    requiresPermission?: SourceModule
  ) => {
    actions.push({
      id: `${type}-${kind}-${order}`,
      label,
      description,
      kind,
      iconKey,
      order,
      targetPage,
      targetRecordId,
      requiresPermission,
    });
  };

  // ── Universal actions by type ──
  switch (type) {
    case 'immediate_intervention':
    case 'risk_escalation':
      if (eid) add('فتح ملف الموظف', 'عرض الملف الشامل للموظف', 'employee', 'user', 1, undefined, eid);
      add('فتح مركز المخاطر', 'مراجعة ملف المخاطر', 'navigate', 'shield-alert', 2, 'riskCenter');
      add('متابعة جديدة', 'فتح متابعة للموظف', 'create_fu', 'plus', 3, undefined, eid, 'followUps');
      add('إشعار المدير', 'تنبيه المدير المباشر', 'notify', 'bell', 4);
      add('تصعيد', 'تصعيد القرار لمستوى أعلى', 'notify', 'arrow-up', 5);
      break;

    case 'manager_review':
      if (eid) add('فتح ملف الموظف', 'مراجعة الملف الكامل', 'employee', 'user', 1, undefined, eid);
      add('مراجعة الحضور', 'تحليل سجل الحضور', 'navigate', 'clock', 2, 'attendance');
      add('جدولة توجيه', 'حجز جلسة توجيه', 'dialog', 'graduation', 3, undefined, eid, 'followUps');
      add('متابعة جديدة', 'إنشاء متابعة للمدير', 'create_fu', 'plus', 4, undefined, eid, 'followUps');
      add('إشعار المدير', 'إبلاغ المدير المباشر', 'notify', 'bell', 5);
      break;

    case 'quality_investigation':
    case 'capa_required':
      add('فتح كابا', 'إنشاء حالة كابا جديدة', 'create_capa', 'shield', 1, undefined, rid, 'capa');
      add('مراجعة الجودة', 'فحص سجل الجودة', 'navigate', 'search', 2, 'quality');
      add('فتح ملف الموظف', 'ربط بالموظف المعني', 'employee', 'user', 3, undefined, eid ?? undefined);
      add('متابعة جديدة', 'تتبع التحقيق', 'create_fu', 'plus', 4, undefined, eid, 'followUps');
      break;

    case 'attendance_review':
    case 'repeated_behavior':
      if (eid) add('فتح ملف الموظف', 'مراجعة الملف', 'employee', 'user', 1, undefined, eid);
      add('مراجعة الحضور', 'فحص سجل الحضور', 'navigate', 'clock', 2, 'attendance');
      add('جدولة توجيه', 'حجز جلسة توجيه', 'dialog', 'graduation', 3, undefined, eid, 'followUps');
      add('متابعة جديدة', 'تتبع الحضور', 'create_fu', 'plus', 4, undefined, eid, 'followUps');
      add('إشعار المدير', 'إبلاغ المدير', 'notify', 'bell', 5);
      break;

    case 'complaint_escalation':
    case 'customer_follow_up':
      add('مراجعة الشكاوى', 'فتح صفحة الشكاوى', 'navigate', 'alert', 1, 'complaints', rid ?? undefined);
      add('متابعة جديدة', 'متابعة مع العميل', 'create_fu', 'plus', 2, undefined, eid, 'followUps');
      add('تصعيد', 'تصعيد لمستوى أعلى', 'notify', 'arrow-up', 3);
      add('فتح كابا', 'ربط بكابا إن لزم', 'create_capa', 'shield', 4, undefined, rid, 'capa');
      break;

    case 'hr_action_required':
    case 'policy_violation':
      add('مراجعة الخصومات', 'فتح خصومات الموارد البشرية', 'navigate', 'banknote', 1, 'hrDeductions');
      if (eid) add('فتح ملف الموظف', 'ربط بالموظف', 'employee', 'user', 2, undefined, eid);
      add('متابعة جديدة', 'توثيق الإجراء', 'create_fu', 'plus', 3, undefined, eid, 'followUps');
      add('إشعار المدير', 'إبلاغ المدير', 'notify', 'bell', 4);
      break;

    case 'training_required':
      if (eid) add('فتح ملف الموظف', 'مراجعة الملف', 'employee', 'user', 1, undefined, eid);
      add('جدولة تدريب', 'حجز جلسة تدريب', 'dialog', 'graduation', 2, undefined, eid, 'followUps');
      add('متابعة جديدة', 'تتبع التقدم', 'create_fu', 'plus', 3, undefined, eid, 'followUps');
      add('إشعار المدير', 'إبلاغ المدير', 'notify', 'bell', 4);
      break;

    case 'executive_attention':
      add('مراجعة القسم', 'تحليل أداء القسم', 'navigate', 'building', 1, 'attendance');
      add('تصعيد', 'تصعيد تنفيذي', 'notify', 'arrow-up', 2);
      add('متابعة جديدة', 'تتبع خطة التحسين', 'create_fu', 'plus', 3, undefined, undefined, 'followUps');
      break;

    case 'system_health':
      add('مزامنة البصمة', 'فحص حالة المزامنة', 'navigate', 'fingerprint', 1, 'biometric');
      add('مركز التحكم', 'فحص حالة النظام', 'navigate', 'server', 2, 'controlPanel');
      break;

    case 'approval_required':
      add('مراجعة الطلبات', 'اعتماد أو رفض', 'navigate', 'stamp', 1, 'requests', rid ?? undefined);
      add('متابعة جديدة', 'تتبع الطلب', 'create_fu', 'plus', 2, undefined, eid, 'followUps');
      break;

    case 'deadline_risk':
    case 'sla_breach':
      add('فتح كابا', 'تسريع الإجراء', 'navigate', 'timer', 1, 'capa', rid ?? undefined, 'capa');
      add('تصعيد', 'تصعيد لتجنب التجاوز', 'notify', 'arrow-up', 2);
      add('متابعة جديدة', 'تتبع التقدم', 'create_fu', 'plus', 3, undefined, eid, 'followUps');
      break;
  }

  return actions.sort((a, b) => a.order - b.order);
}

// ═══════════════════════════════════════════════════════════════
//  Decision Builder — assembles one Decision from inputs
// ═══════════════════════════════════════════════════════════════

interface DecisionBuildContext {
  type: DecisionType;
  title: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  affectedModules: SourceModule[];
  sourceActionIds: string[];
  evidence: DecisionEvidence[];
  consequence: string;
  businessImpact: BusinessImpact;
  urgency: UrgencyLevel;
  dueDate: string | null;
  primaryTargetPage: SourceModule | 'employee360';
  primaryTargetRecordId: string | null;
  createdAt: string;
  // raw signals for scoring
  priorityRawScore: number;
  riskScore: number;
  employeeOpenActions: number;
  employeeOperationalStatus: 'critical' | 'at_risk' | 'monitoring' | 'healthy' | null;
  departmentHealthScore: number | null;
  openIssuesInDept: number;
  deductionAmount: number;
  confidenceEvidenceCount: number;
}

function buildDecision(ctx: DecisionBuildContext): Decision {
  const hoursUntilDue = hoursUntil(ctx.dueDate);
  const daysUntilDue = daysUntil(ctx.dueDate);

  const scoreInput: ScoreInput = {
    priorityLevel: 'critical', // placeholder, set below from overall
    priorityRawScore: ctx.priorityRawScore,
    businessImpact: ctx.businessImpact,
    deductionAmount: ctx.deductionAmount,
    affectedScope: ctx.affectedModules.length,
    urgency: ctx.urgency,
    hoursUntilDue,
    evidenceCount: ctx.confidenceEvidenceCount,
    moduleCount: ctx.affectedModules.length,
    riskScore: ctx.riskScore,
    employeeOpenActions: ctx.employeeOpenActions,
    employeeOperationalStatus: ctx.employeeOperationalStatus,
    affectedModuleCount: ctx.affectedModules.length,
    departmentHealthScore: ctx.departmentHealthScore,
    openIssuesInDept: ctx.openIssuesInDept,
    daysUntilDue,
  };

  const score: DecisionScore = computeDecisionScore(scoreInput);
  const priority: PriorityLevel = decisionPriorityFromScore(score.overall);

  const suggestedOwner = ctx.department ? `مدير ${ctx.department}` : 'غير معيّن';
  const suggestedOwnerType: Decision['suggestedOwnerType'] =
    ctx.type === 'executive_attention' ? 'executive' :
    ctx.department ? 'manager' : 'unassigned';

  const explanation: DecisionExplanation = {
    reason: ctx.title,
    evidence: ctx.evidence,
    consequence: ctx.consequence,
    confidence: score.confidence,
    businessImpact: ctx.businessImpact,
  };

  const actions = buildNextBestActions(ctx.type, {
    employeeId: ctx.employeeId,
    employeeName: ctx.employeeName,
    department: ctx.department,
    sourceRecordId: ctx.primaryTargetRecordId,
    primaryTargetPage: ctx.primaryTargetPage,
  });

  return {
    id: `dec-${ctx.type}-${ctx.employeeId || ctx.department || ctx.sourceActionIds[0] || 'op'}`,
    type: ctx.type,
    title: ctx.title,
    priority,
    score,
    affectedEmployeeId: ctx.employeeId,
    affectedEmployeeName: ctx.employeeName,
    affectedDepartment: ctx.department,
    affectedModules: ctx.affectedModules,
    sourceActionIds: ctx.sourceActionIds,
    urgency: ctx.urgency,
    businessImpact: ctx.businessImpact,
    dueDate: ctx.dueDate,
    estimatedResolutionTime: estimateResolution(ctx.type, hoursUntilDue),
    suggestedOwner,
    suggestedOwnerType,
    explanation,
    actions,
    primaryTargetPage: ctx.primaryTargetPage,
    primaryTargetRecordId: ctx.primaryTargetRecordId,
    createdAt: ctx.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════
//  PART 6 + 1: generateDecisions — the main entry point
//  Groups related actions/correlations into single decisions.
// ═══════════════════════════════════════════════════════════════

export interface DecisionEngineInput {
  actions: ActionItem[];
  correlations: EmployeeCorrelation[];
  departments: DepartmentHealth[];
  data: RawDataBundle;
}

/**
 * Generate all decisions from the operational pipeline.
 * This is the heart of the Decision Intelligence Layer.
 *
 * Strategy: iterate correlations + departments + standalone actions,
 * emit ONE decision per root cause. Decisions are deduplicated by id
 * (which encodes entity + type), so the same employee never produces
 * two decisions of the same type.
 */
export function generateDecisions(input: DecisionEngineInput): Decision[] {
  const { actions, correlations, departments, data } = input;
  const decisions: Decision[] = [];
  const seenIds = new Set<string>();

  const push = (d: Decision) => {
    if (!seenIds.has(d.id)) {
      seenIds.add(d.id);
      decisions.push(d);
    }
  };

  // ── 1. Per-employee decisions from correlations ──
  for (const emp of correlations) {
    const deptHealth = departments.find((d) => d.name === emp.department) || null;
    const openIssuesInDept = deptHealth?.openActions ?? emp.openActions;

    // (a) Immediate Intervention — critical risk + multiple open actions
    if ((emp.riskLevel === 'critical' && emp.openActions >= 2) || emp.openActions >= 4) {
      push(buildDecision({
        type: 'immediate_intervention',
        title: `تدخل فوري مطلوب — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: emp.affectedModules,
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: buildEmployeeEvidence(emp),
        consequence: 'تدهور محتمل في الأداء وزيادة المخاطر دون تدخل فوري',
        businessImpact: emp.riskLevel === 'critical' ? 'severe' : 'high',
        urgency: 'critical',
        dueDate: emp.lastActivity || new Date().toISOString(),
        primaryTargetPage: 'employee360',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: emp.affectedModules.length,
      }));
      continue; // immediate intervention supersedes other employee decisions
    }

    // (b) Risk Escalation — risk score crossed high threshold
    if (emp.riskLevel === 'high' && emp.trend === 'declining') {
      push(buildDecision({
        type: 'risk_escalation',
        title: `تصعيد مخاطر — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: emp.affectedModules,
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: buildEmployeeEvidence(emp),
        consequence: 'استمرار تدهور درجة المخاطر قد يؤدي لمخاطر حرجة',
        businessImpact: 'high',
        urgency: 'high',
        dueDate: null,
        primaryTargetPage: 'riskCenter',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: emp.affectedModules.length,
      }));
    }

    // (c) Manager Review — multi-module employee needing review
    if (emp.affectedModules.length >= 3 && emp.openActions >= 1) {
      push(buildDecision({
        type: 'manager_review',
        title: `مراجعة مدير مطلوبة — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: emp.affectedModules,
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: buildEmployeeEvidence(emp),
        consequence: 'تراكم القضايا عبر الوحدات قد يؤثر على الفريق',
        businessImpact: 'high',
        urgency: 'high',
        dueDate: null,
        primaryTargetPage: 'employee360',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: emp.affectedModules.length,
      }));
    }

    // (d) Attendance Review / Repeated Behavior — repeated attendance issues
    if (emp.attendanceIssues >= 3) {
      push(buildDecision({
        type: emp.attendanceIssues >= 5 ? 'repeated_behavior' : 'attendance_review',
        title: `${emp.attendanceIssues >= 5 ? 'سلوك متكرر' : 'مراجعة حضور'} — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: Array.from(new Set([...emp.affectedModules, 'attendance' as SourceModule])),
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: [
          { module: 'attendance', statement: `${emp.attendanceIssues} مشاكل حضور متكررة`, metric: String(emp.attendanceIssues) },
          { module: 'riskCenter', statement: `درجة المخاطر ${emp.riskScore}` },
          ...(emp.trend === 'declining' ? [{ module: 'riskCenter' as SourceModule, statement: 'الاتجاه في تدهور' }] : []),
        ],
        consequence: 'استمرار المشاكل قد يؤدي لخصومات وإجراءات تأديبية',
        businessImpact: 'moderate',
        urgency: emp.attendanceIssues >= 5 ? 'high' : 'medium',
        dueDate: null,
        primaryTargetPage: 'attendance',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: 2,
      }));
    }

    // (e) Complaint Escalation — critical complaints unresolved
    if (emp.criticalComplaints > 0) {
      push(buildDecision({
        type: 'complaint_escalation',
        title: `تصعيد شكوى حرجة — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: Array.from(new Set([...emp.affectedModules, 'complaints' as SourceModule])),
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: [
          { module: 'complaints', statement: `${emp.criticalComplaints} شكوى حرجة مفتوحة`, metric: String(emp.criticalComplaints) },
          ...buildEmployeeEvidence(emp).filter((e) => e.module !== 'complaints'),
        ],
        consequence: 'تدهور رضا العملاء واحتمال فقدانهم',
        businessImpact: 'high',
        urgency: 'high',
        dueDate: null,
        primaryTargetPage: 'complaints',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: 2,
      }));
    }

    // (f) CAPA Required — overdue CAPA for the employee
    if (emp.overdueCapaCount > 0) {
      push(buildDecision({
        type: 'capa_required',
        title: `${emp.overdueCapaCount} كابا متأخرة — ${emp.employeeName}`,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department,
        affectedModules: Array.from(new Set([...emp.affectedModules, 'capa' as SourceModule])),
        sourceActionIds: collectSourceIds(actions, emp.employeeId),
        evidence: [
          { module: 'capa', statement: `${emp.overdueCapaCount} كابا متجاوزة موعد الاستحقاق`, metric: String(emp.overdueCapaCount) },
          ...buildEmployeeEvidence(emp).filter((e) => e.module !== 'capa'),
        ],
        consequence: 'مخاطر جودة مستمرة وعدم امتثال للإجراءات',
        businessImpact: 'high',
        urgency: 'high',
        dueDate: null,
        primaryTargetPage: 'capa',
        primaryTargetRecordId: emp.employeeId,
        createdAt: emp.lastActivity || new Date().toISOString(),
        priorityRawScore: emp.riskScore,
        riskScore: emp.riskScore,
        employeeOpenActions: emp.openActions,
        employeeOperationalStatus: emp.operationalStatus,
        departmentHealthScore: deptHealth?.healthScore ?? null,
        openIssuesInDept,
        deductionAmount: emp.deductions,
        confidenceEvidenceCount: 2,
      }));
    }
  }

  // ── 2. Department-level decisions ──
  for (const dept of departments) {
    if (dept.healthScore < 50 || dept.criticalCount >= 2) {
      push(buildDecision({
        type: 'executive_attention',
        title: `انتباه تنفيذي — قسم ${dept.name}`,
        employeeId: null,
        employeeName: null,
        department: dept.name,
        affectedModules: inferDeptModules(dept),
        sourceActionIds: [],
        evidence: buildDeptEvidence(dept),
        consequence: 'استمرار التدهور قد يؤثر على الأقسام المرتبطة',
        businessImpact: dept.criticalCount >= 3 ? 'severe' : 'high',
        urgency: dept.healthScore < 40 ? 'critical' : 'high',
        dueDate: null,
        primaryTargetPage: 'attendance',
        primaryTargetRecordId: null,
        createdAt: new Date().toISOString(),
        priorityRawScore: 100 - dept.healthScore,
        riskScore: 100 - dept.healthScore,
        employeeOpenActions: 0,
        employeeOperationalStatus: null,
        departmentHealthScore: dept.healthScore,
        openIssuesInDept: dept.openActions,
        deductionAmount: 0,
        confidenceEvidenceCount: dept.warnings.length || 1,
      }));
    }
  }

  // ── 3. Standalone action-derived decisions (SLA, approvals, etc.) ──
  for (const action of actions) {
    const hoursUntilDueA = hoursSince(action.dueDate);

    // SLA Breach / Deadline Risk — from CAPA SLA state
    if (action.sourceModule === 'capa') {
      const capa = data.capaItems.find((c: any) => c.id === action.sourceRecordId);
      if (capa) {
        const sla = getSLAInfo(capa);
        if (sla.state === 'critical' || sla.state === 'escalation') {
          push(buildDecision({
            type: 'sla_breach',
            title: `تجاوز SLA — ${action.title}`,
            employeeId: action.employeeId,
            employeeName: action.employeeName,
            department: action.department,
            affectedModules: ['capa'],
            sourceActionIds: [action.id],
            evidence: [
              { module: 'capa', statement: `تجاوز ${sla.overdueDays} يوم عن موعد SLA`, metric: `${sla.overdueDays}d` },
              { module: 'capa', statement: `التقدم ${calculateProgress(capa)}%`, metric: `${calculateProgress(capa)}%` },
            ],
            consequence: 'مخاطر امتثال جودة وتأثير متسلسل على العمليات',
            businessImpact: 'high',
            urgency: 'critical',
            dueDate: action.dueDate,
            primaryTargetPage: 'capa',
            primaryTargetRecordId: action.sourceRecordId,
            createdAt: action.dueDate || new Date().toISOString(),
            priorityRawScore: action.score,
            riskScore: action.score,
            employeeOpenActions: 1,
            employeeOperationalStatus: null,
            departmentHealthScore: null,
            openIssuesInDept: 1,
            deductionAmount: 0,
            confidenceEvidenceCount: 2,
          }));
        } else if (sla.state === 'warning') {
          push(buildDecision({
            type: 'deadline_risk',
            title: `خطر موعد نهائي — ${action.title}`,
            employeeId: action.employeeId,
            employeeName: action.employeeName,
            department: action.department,
            affectedModules: ['capa'],
            sourceActionIds: [action.id],
            evidence: [
              { module: 'capa', statement: `${sla.daysRemaining} يوم متبقي لـ SLA`, metric: `${sla.daysRemaining}d` },
            ],
            consequence: 'احتمال تجاوز SLA قريباً',
            businessImpact: 'moderate',
            urgency: 'high',
            dueDate: action.dueDate,
            primaryTargetPage: 'capa',
            primaryTargetRecordId: action.sourceRecordId,
            createdAt: new Date().toISOString(),
            priorityRawScore: action.score,
            riskScore: action.score,
            employeeOpenActions: 1,
            employeeOperationalStatus: null,
            departmentHealthScore: null,
            openIssuesInDept: 1,
            deductionAmount: 0,
            confidenceEvidenceCount: 1,
          }));
        }
      }
    }

    // Approval Required — pending requests past expected turnaround
    if (action.sourceModule === 'requests' && action.status === 'pending') {
      const hoursPending = hoursSince(action.dueDate || action.id);
      push(buildDecision({
        type: 'approval_required',
        title: `اعتماد مطلوب — ${action.title}`,
        employeeId: action.employeeId,
        employeeName: action.employeeName,
        department: action.department,
        affectedModules: ['requests'],
        sourceActionIds: [action.id],
        evidence: [
          { module: 'requests', statement: `بانتظار الاعتماد منذ ${hoursPending} ساعة`, metric: `${hoursPending}h` },
        ],
        consequence: 'تأخر العمليات وزيادة عدم الرضا',
        businessImpact: hoursPending > 48 ? 'high' : 'moderate',
        urgency: hoursPending > 48 ? 'high' : 'medium',
        dueDate: null,
        primaryTargetPage: 'requests',
        primaryTargetRecordId: action.sourceRecordId,
        createdAt: new Date().toISOString(),
        priorityRawScore: action.score,
        riskScore: action.score,
        employeeOpenActions: 0,
        employeeOperationalStatus: null,
        departmentHealthScore: null,
        openIssuesInDept: 0,
        deductionAmount: 0,
        confidenceEvidenceCount: 1,
      }));
    }

    // HR Action Required — deductions
    if (action.sourceModule === 'hrDeductions') {
      push(buildDecision({
        type: 'hr_action_required',
        title: `إجراء موارد بشرية — ${action.title}`,
        employeeId: action.employeeId,
        employeeName: action.employeeName,
        department: action.department,
        affectedModules: ['hrDeductions'],
        sourceActionIds: [action.id],
        evidence: [{ module: 'hrDeductions', statement: action.reason }],
        consequence: 'تأثير مالي على الموظف وعدم توافق محتمل',
        businessImpact: 'moderate',
        urgency: 'medium',
        dueDate: action.dueDate,
        primaryTargetPage: 'hrDeductions',
        primaryTargetRecordId: action.sourceRecordId,
        createdAt: new Date().toISOString(),
        priorityRawScore: action.score,
        riskScore: action.score,
        employeeOpenActions: 0,
        employeeOperationalStatus: null,
        departmentHealthScore: null,
        openIssuesInDept: 0,
        deductionAmount: 0,
        confidenceEvidenceCount: 1,
      }));
    }
  }

  // ── 4. System Health — biometric sync degradation ──
  const biometricLastSync = data.stats?.biometricLastSync;
  if (biometricLastSync && hoursSince(biometricLastSync) > 6) {
    push(buildDecision({
      type: 'system_health',
      title: 'صحة النظام — تأخر مزامنة البصمة',
      employeeId: null,
      employeeName: null,
      department: null,
      affectedModules: ['biometric'],
      sourceActionIds: [],
      evidence: [{ module: 'biometric', statement: `آخر مزامنة منذ ${hoursSince(biometricLastSync)} ساعة`, metric: `${hoursSince(biometricLastSync)}h` }],
      consequence: 'بيانات حضور ناقصة وإجراءات خصم غير دقيقة',
      businessImpact: 'moderate',
      urgency: 'medium',
      dueDate: null,
      primaryTargetPage: 'biometric',
      primaryTargetRecordId: null,
      createdAt: biometricLastSync,
      priorityRawScore: 40,
      riskScore: 30,
      employeeOpenActions: 0,
      employeeOperationalStatus: null,
      departmentHealthScore: null,
      openIssuesInDept: 0,
      deductionAmount: 0,
      confidenceEvidenceCount: 1,
    }));
  }

  return decisions.sort((a, b) => b.score.overall - a.score.overall);
}

// ═══════════════════════════════════════════════════════════════
//  Evidence builders
// ═══════════════════════════════════════════════════════════════

function buildEmployeeEvidence(emp: EmployeeCorrelation): DecisionEvidence[] {
  const ev: DecisionEvidence[] = [];
  if (emp.riskScore > 0) ev.push({ module: 'riskCenter', statement: `درجة المخاطر ${emp.riskScore}`, metric: String(emp.riskScore) });
  if (emp.overdueCapaCount > 0) ev.push({ module: 'capa', statement: `${emp.overdueCapaCount} كابا متأخرة`, metric: String(emp.overdueCapaCount) });
  if (emp.criticalComplaints > 0) ev.push({ module: 'complaints', statement: `${emp.criticalComplaints} شكوى حرجة`, metric: String(emp.criticalComplaints) });
  if (emp.overdueFollowUps > 0) ev.push({ module: 'followUps', statement: `${emp.overdueFollowUps} متابعة مستحقة`, metric: String(emp.overdueFollowUps) });
  if (emp.attendanceIssues > 0) ev.push({ module: 'attendance', statement: `${emp.attendanceIssues} مشاكل حضور`, metric: String(emp.attendanceIssues) });
  if (emp.deductions > 0) ev.push({ module: 'hrDeductions', statement: `${emp.deductions} خصومات`, metric: String(emp.deductions) });
  if (emp.trend === 'declining') ev.push({ module: 'riskCenter', statement: 'الاتجاه في تدهور' });
  return ev;
}

function buildDeptEvidence(dept: DepartmentHealth): DecisionEvidence[] {
  const ev: DecisionEvidence[] = [{ module: 'attendance', statement: `صحة القسم ${dept.healthScore}%`, metric: `${dept.healthScore}%` }];
  if (dept.overdueCapaCount > 0) ev.push({ module: 'capa', statement: `${dept.overdueCapaCount} كابا متأخرة` });
  if (dept.riskCount > 0) ev.push({ module: 'riskCenter', statement: `${dept.riskCount} موظف عالي المخاطر` });
  if (dept.complaintCount > 0) ev.push({ module: 'complaints', statement: `${dept.complaintCount} شكوى` });
  return ev;
}

function inferDeptModules(dept: DepartmentHealth): SourceModule[] {
  const mods: SourceModule[] = ['attendance'];
  if (dept.overdueCapaCount > 0) mods.push('capa');
  if (dept.riskCount > 0) mods.push('riskCenter');
  if (dept.complaintCount > 0) mods.push('complaints');
  return mods;
}

function collectSourceIds(actions: ActionItem[], employeeId: string | null): string[] {
  if (!employeeId) return [];
  return actions.filter((a) => a.employeeId === employeeId).map((a) => a.id);
}

// ═══════════════════════════════════════════════════════════════
//  PART 5: explainDecision — human-readable explanation
// ═══════════════════════════════════════════════════════════════

/** Produce a formatted multi-line explanation string for display/dialogs. */
export function explainDecision(decision: Decision): string {
  const lines: string[] = [];
  lines.push(`القرار: ${getDecisionTypeMeta(decision.type).label}`);
  lines.push(`السبب: ${decision.explanation.reason}`);
  lines.push(`الثقة: ${decision.score.confidence}%`);
  lines.push(`التأثير: ${impactLabel(decision.businessImpact)}`);
  lines.push(`الإلحاح: ${urgencyLabel(decision.urgency)}`);
  if (decision.explanation.evidence.length > 0) {
    lines.push('الأدلة:');
    decision.explanation.evidence.forEach((e) => lines.push(`  • ${e.statement}`));
  }
  lines.push(`العاقبة: ${decision.explanation.consequence}`);
  return lines.join('\n');
}

function impactLabel(i: BusinessImpact): string {
  return { severe: 'حرج', high: 'عالي', moderate: 'متوسط', low: 'منخفض', minimal: 'ضئيل' }[i];
}
function urgencyLabel(u: UrgencyLevel): string {
  return { critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' }[u];
}

// ═══════════════════════════════════════════════════════════════
//  PART 12: Predictive Alerts (no AI — pure trajectory math)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate predictive alerts from existing historical data.
 * Pure heuristic math — no AI APIs. Each alert cites the trend/data
 * used and an ETA label.
 */
export function predictiveAlerts(input: DecisionEngineInput): PredictiveAlert[] {
  const { actions, correlations, departments, data } = input;
  const alerts: PredictiveAlert[] = [];

  // (1) Likely SLA Breach — CAPA with little progress and little time
  for (const capa of data.capaItems) {
    const sla = getSLAInfo(capa);
    const progress = calculateProgress(capa);
    if (sla.state === 'normal' || sla.state === 'closed') continue;
    if (sla.daysRemaining !== null && sla.daysRemaining <= 3 && progress < 50) {
      const probability = clamp(Math.round(60 + (3 - sla.daysRemaining) * 12 + (50 - progress)), 0, 98);
      alerts.push({
        id: `pred-sla-${capa.id}`,
        type: 'likely_sla_breach',
        title: `تجاوز SLA محتمل — ${capa.title || 'كابا'}`,
        probability,
        affectedName: capa.employeeName || capa.department || null,
        affectedEmployeeId: capa.employeeId || null,
        affectedDepartment: capa.department || null,
        reasoning: `${sla.daysRemaining} يوم متبقي، التقدم ${progress}% فقط`,
        etaLabel: sla.daysRemaining <= 1 ? 'خلال يوم' : `خلال ${sla.daysRemaining} أيام`,
        severity: probability >= 80 ? 'critical' : 'high',
        suggestedAction: 'تسريع الإجراء التصحيحي',
        targetPage: 'capa',
        sourceRecordId: capa.id,
      });
    }
  }

  // (2) Likely CAPA Overdue — open CAPA trending toward overdue
  for (const capa of data.capaItems) {
    const sla = getSLAInfo(capa);
    if (sla.state === 'warning' && (sla.daysRemaining ?? 99) <= 2) {
      alerts.push({
        id: `pred-capa-${capa.id}`,
        type: 'likely_capa_overdue',
        title: `كابا متأخرة محتملة — ${capa.title || 'كابا'}`,
        probability: 75,
        affectedName: capa.employeeName || capa.department || null,
        affectedEmployeeId: capa.employeeId || null,
        affectedDepartment: capa.department || null,
        reasoning: `SLA في حالة تحذير — ${sla.daysRemaining} يوم متبقي`,
        etaLabel: 'خلال يومين',
        severity: 'high',
        suggestedAction: 'تعيين مالك وتسريع الإجراء',
        targetPage: 'capa',
        sourceRecordId: capa.id,
      });
    }
  }

  // (3) Likely Complaint Escalation — complaint open > 2 days
  for (const c of data.complaintItems) {
    const ageHours = hoursSince(c.createdAt);
    if (ageHours > 48 && (c.severity === 'high' || c.severity === 'critical')) {
      const probability = clamp(Math.round(50 + ageHours / 4), 0, 95);
      alerts.push({
        id: `pred-comp-${c.id}`,
        type: 'likely_complaint_escalation',
        title: `تصعيد شكوى محتمل — ${c.customerName || 'عميل'}`,
        probability,
        affectedName: c.employeeName || c.customerName || null,
        affectedEmployeeId: c.employeeId || null,
        affectedDepartment: null,
        reasoning: `الشكوى مفتوحة منذ ${Math.round(ageHours / 24)} يوم`,
        etaLabel: 'خلال 3 أيام',
        severity: probability >= 75 ? 'high' : 'medium',
        suggestedAction: 'متابعة فورية مع العميل',
        targetPage: 'complaints',
        sourceRecordId: c.id,
      });
    }
  }

  // (4) Likely Attendance Issue / Burnout — declining employee with rising issues
  for (const emp of correlations) {
    if (emp.trend === 'declining' && emp.attendanceIssues >= 2) {
      const probability = clamp(Math.round(50 + emp.attendanceIssues * 8 + emp.riskScore * 0.2), 0, 95);
      alerts.push({
        id: `pred-burnout-${emp.employeeId}`,
        type: emp.attendanceIssues >= 4 ? 'likely_burnout' : 'likely_attendance_issue',
        title: `${emp.attendanceIssues >= 4 ? 'احتراق وظيفي' : 'مشكلة حضور'} محتملة — ${emp.employeeName}`,
        probability,
        affectedName: emp.employeeName,
        affectedEmployeeId: emp.employeeId,
        affectedDepartment: emp.department,
        reasoning: `${emp.attendanceIssues} مشاكل حضور، اتجاه متدهور، درجة مخاطر ${emp.riskScore}`,
        etaLabel: 'خلال أسبوع',
        severity: probability >= 75 ? 'high' : 'medium',
        suggestedAction: 'جدولة توجيه ومراجعة عبء العمل',
        targetPage: 'employee360',
        sourceRecordId: emp.employeeId,
      });
    }
  }

  // (5) Likely Department Decline — department with declining trend and rising issues
  for (const dept of departments) {
    if (dept.trend === 'declining' && dept.healthScore < 70) {
      const probability = clamp(Math.round(40 + (70 - dept.healthScore) + dept.criticalCount * 5), 0, 95);
      alerts.push({
        id: `pred-dept-${dept.name}`,
        type: 'likely_department_decline',
        title: `تدهور قسم محتمل — ${dept.name}`,
        probability,
        affectedName: dept.name,
        affectedEmployeeId: null,
        affectedDepartment: dept.name,
        reasoning: `صحة القسم ${dept.healthScore}%، اتجاه متدهور، ${dept.criticalCount} قضايا حرجة`,
        etaLabel: 'خلال أسبوعين',
        severity: probability >= 70 ? 'high' : 'medium',
        suggestedAction: 'مراجعة شاملة للعمليات',
        targetPage: 'attendance',
        sourceRecordId: null,
      });
    }
  }

  return alerts.sort((a, b) => b.probability - a.probability);
}

// ═══════════════════════════════════════════════════════════════
//  PART 11: Coaching Opportunities
// ═══════════════════════════════════════════════════════════════

/** Generate manager coaching opportunities from correlations + departments. */
export function generateCoachingOpportunities(
  correlations: EmployeeCorrelation[],
  departments: DepartmentHealth[]
): CoachingOpportunity[] {
  const opps: CoachingOpportunity[] = [];

  for (const emp of correlations) {
    // Attendance coaching
    if (emp.attendanceIssues >= 3) {
      opps.push({
        id: `coach-att-${emp.employeeId}`,
        category: 'attendance' as CoachingCategory,
        title: `توجيه حضور — ${emp.employeeName}`,
        affectedEmployeeId: emp.employeeId,
        affectedEmployeeName: emp.employeeName,
        affectedDepartment: emp.department,
        evidence: `${emp.attendanceIssues} مشاكل حضور${emp.trend === 'declining' ? '، اتجاه متدهور' : ''}`,
        suggestedAction: 'جدولة جلسة توجيه',
        priority: emp.attendanceIssues >= 5 ? 'high' : 'medium',
        decisionId: `dec-attendance_review-${emp.employeeId}`,
      });
    }

    // Complaint increase coaching
    if (emp.complaints >= 2) {
      opps.push({
        id: `coach-comp-${emp.employeeId}`,
        category: 'complaint_increase' as CoachingCategory,
        title: `توجيه تعامل مع العملاء — ${emp.employeeName}`,
        affectedEmployeeId: emp.employeeId,
        affectedEmployeeName: emp.employeeName,
        affectedDepartment: emp.department,
        evidence: `${emp.complaints} شكاوى مفتوحة`,
        suggestedAction: 'تدريب على خدمة العملاء',
        priority: emp.criticalComplaints > 0 ? 'high' : 'medium',
        decisionId: null,
      });
    }

    // Performance drop — multiple open actions + declining
    if (emp.openActions >= 3 && emp.trend === 'declining') {
      opps.push({
        id: `coach-perf-${emp.employeeId}`,
        category: 'performance_drop' as CoachingCategory,
        title: `مراجعة أداء — ${emp.employeeName}`,
        affectedEmployeeId: emp.employeeId,
        affectedEmployeeName: emp.employeeName,
        affectedDepartment: emp.department,
        evidence: `${emp.openActions} إجراءات مفتوحة، اتجاه متدهور، درجة مخاطر ${emp.riskScore}`,
        suggestedAction: 'مراجعة أداء شاملة',
        priority: 'high',
        decisionId: `dec-manager_review-${emp.employeeId}`,
      });
    }

    // Training recommendation — repeated CAPA
    if (emp.capaCount >= 3) {
      opps.push({
        id: `coach-train-${emp.employeeId}`,
        category: 'training_recommendation' as CoachingCategory,
        title: `توصية تدريب — ${emp.employeeName}`,
        affectedEmployeeId: emp.employeeId,
        affectedEmployeeName: emp.employeeName,
        affectedDepartment: emp.department,
        evidence: `${emp.capaCount} حالات كابا — قد يشير فجوة مهارات`,
        suggestedAction: 'تقييم احتياجات تدريبية',
        priority: 'medium',
        decisionId: null,
      });
    }
  }

  // Quality decline at department level
  for (const dept of departments) {
    if (dept.qualityIssues > 0 && dept.trend === 'declining') {
      opps.push({
        id: `coach-qual-${dept.name}`,
        category: 'quality_decline' as CoachingCategory,
        title: `توجيه جودة — قسم ${dept.name}`,
        affectedEmployeeId: '',
        affectedEmployeeName: `قسم ${dept.name}`,
        affectedDepartment: dept.name,
        evidence: `${dept.qualityIssues} انتهاكات جودة، اتجاه متدهور`,
        suggestedAction: 'ورشة عمل لتحسين الجودة',
        priority: 'medium',
        decisionId: null,
      });
    }
  }

  return opps.sort((a, b) => {
    const order: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  });
}

// ═══════════════════════════════════════════════════════════════
//  PART 10: Executive Priorities
// ═══════════════════════════════════════════════════════════════

/** Generate the executive priorities bundle from decisions + correlations + departments. */
export function generateExecutivePriorities(
  decisions: Decision[],
  correlations: EmployeeCorrelation[],
  departments: DepartmentHealth[]
): ExecutivePriorities {
  // Top priorities — highest-scoring decisions
  const topPriorities: ExecutivePriorityItem[] = decisions.slice(0, 5).map((d, i) => ({
    id: `exec-pri-${d.id}`,
    rank: i + 1,
    title: d.title,
    decisionId: d.id,
    priority: d.priority,
    score: d.score.overall,
    affectedName: d.affectedEmployeeName || d.affectedDepartment,
    targetPage: d.primaryTargetPage,
    sourceRecordId: d.primaryTargetRecordId,
  }));

  // Top risks — from correlations
  const topRisks: ExecutivePriorityItem[] = [...correlations]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3)
    .map((e, i) => ({
      id: `exec-risk-${e.employeeId}`,
      rank: i + 1,
      title: `${e.employeeName} — درجة مخاطر ${e.riskScore}`,
      decisionId: null,
      priority: e.riskLevel as PriorityLevel,
      score: e.riskScore,
      affectedName: e.employeeName,
      targetPage: 'riskCenter',
      sourceRecordId: e.employeeId,
    }));

  // Top employees needing attention — by open actions
  const topEmployeesNeedingAttention: ExecutivePriorityItem[] = [...correlations]
    .sort((a, b) => b.openActions - a.openActions || b.riskScore - a.riskScore)
    .slice(0, 3)
    .map((e, i) => ({
      id: `exec-emp-${e.employeeId}`,
      rank: i + 1,
      title: `${e.employeeName} — ${e.openActions} إجراءات مفتوحة`,
      decisionId: null,
      priority: e.operationalStatus === 'critical' ? 'critical' : 'high',
      score: e.openActions,
      affectedName: e.employeeName,
      targetPage: 'employee360',
      sourceRecordId: e.employeeId,
    }));

  // Top departments — worst health
  const topDepartments: ExecutivePriorityItem[] = departments.slice(0, 3).map((d, i) => ({
    id: `exec-dept-${d.name}`,
    rank: i + 1,
    title: `قسم ${d.name} — صحة ${d.healthScore}%`,
    decisionId: null,
    priority: d.healthScore < 50 ? 'critical' : d.healthScore < 70 ? 'high' : 'medium',
    score: d.healthScore,
    affectedName: d.name,
    targetPage: 'attendance',
    sourceRecordId: null,
  }));

  // Executive alerts — systemic issues
  const alerts: ExecutiveAlert[] = [];
  const criticalDept = departments.find((d) => d.healthScore < 40);
  if (criticalDept) {
    alerts.push({
      id: 'alert-dept-critical',
      title: `قسم حرج: ${criticalDept.name}`,
      severity: 'critical',
      scope: 'department',
      affectedName: criticalDept.name,
      description: `صحة القسم ${criticalDept.healthScore}% — ${criticalDept.criticalCount} قضايا حرجة`,
      targetPage: 'attendance',
    });
  }
  const unresolvedCritical = decisions.filter((d) => d.priority === 'critical').length;
  if (unresolvedCritical >= 3) {
    alerts.push({
      id: 'alert-critical-cluster',
      title: `${unresolvedCritical} قرارات حرجة غير معالجة`,
      severity: 'critical',
      scope: 'operation',
      affectedName: null,
      description: 'تركز القرارات الحرجة قد يشير لمشكلة نظامية',
      targetPage: 'operationsCenter',
    });
  }

  // Business bottlenecks — modules with many blocked decisions
  const moduleCounts: Record<string, number> = {};
  decisions.forEach((d) => d.affectedModules.forEach((m) => { moduleCounts[m] = (moduleCounts[m] || 0) + 1; }));
  const bottlenecks: BusinessBottleneck[] = Object.entries(moduleCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mod, count], i) => ({
      id: `bottleneck-${mod}-${i}`,
      title: `اختناق في ${moduleLabel(mod)}`,
      module: mod as SourceModule,
      affectedDecisionCount: count,
      description: `${count} قرارات محظورة في هذه الوحدة`,
      recommendedAction: 'تخصيص موارد إضافية لهذه الوحدة',
    }));

  return {
    topPriorities,
    topRisks,
    topEmployeesNeedingAttention,
    topDepartments,
    alerts,
    bottlenecks,
  };
}

function moduleLabel(mod: string): string {
  const labels: Record<string, string> = {
    capa: 'نظام كابا',
    complaints: 'الشكاوى',
    followUps: 'المتابعات',
    attendance: 'الحضور',
    riskCenter: 'المخاطر',
    hrDeductions: 'الخصومات',
    requests: 'الطلبات',
    quality: 'الجودة',
    biometric: 'البصمة',
  };
  return labels[mod] || mod;
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
