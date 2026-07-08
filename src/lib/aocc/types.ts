// ═══════════════════════════════════════════════════════════════
//  AOCC Intelligence Layer — Type Definitions
//  Central types for the operational intelligence system.
//  No React, no API calls — pure type definitions.
// ═══════════════════════════════════════════════════════════════

/** Priority levels used across all operational artifacts */
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/** Operational status for an employee across modules */
export type OperationalStatus = 'critical' | 'at_risk' | 'monitoring' | 'healthy';

/** Source modules that can generate operational events */
export type SourceModule =
  | 'attendance'
  | 'biometric'
  | 'capa'
  | 'complaints'
  | 'quality'
  | 'hrDeductions'
  | 'travel'
  | 'followUps'
  | 'notifications'
  | 'riskCenter'
  | 'employee360'
  | 'requests'
  | 'rulesEngine';

/** Event types for the normalized operational event stream */
export type EventType =
  | 'capa_overdue'
  | 'capa_critical'
  | 'capa_high'
  | 'complaint_critical'
  | 'complaint_high'
  | 'followup_overdue'
  | 'followup_due'
  | 'request_pending'
  | 'travel_urgent'
  | 'risk_critical'
  | 'risk_high'
  | 'attendance_absent'
  | 'attendance_late'
  | 'quality_violation'
  | 'hr_deduction'
  | 'notification_critical'
  | 'notification_high'
  | 'sla_breach'
  | 'activity_log';

/** Trend direction */
export type TrendDirection = 'improving' | 'stable' | 'declining';

// ═══════════════════════════════════════════════════════════════
//  PART 1: Normalized Operational Event
// ═══════════════════════════════════════════════════════════════

/** A normalized event collected from any module — the common structure */
export interface OperationalEvent {
  id: string;
  type: EventType;
  severity: PriorityLevel;
  timestamp: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  source: SourceModule;
  sourceRecordId: string;
  actionUrl: string | null;
  targetPage: string;
  status: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
//  PART 2: Priority Score
// ═══════════════════════════════════════════════════════════════

/** A factor that contributes to the priority score */
export interface PriorityFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
}

/** An event that has been scored by the priority engine */
export interface PriorityScore {
  event: OperationalEvent;
  score: number;
  priorityLevel: PriorityLevel;
  factors: PriorityFactor[];
}

// ═══════════════════════════════════════════════════════════════
//  PART 3: Action Item (unified action queue)
// ═══════════════════════════════════════════════════════════════

/** A single actionable card in the unified action queue */
export interface ActionItem {
  id: string;
  title: string;
  reason: string;
  priority: PriorityLevel;
  score: number;
  sourceModule: SourceModule;
  assignedTo: string | null;
  assignedToName: string | null;
  department: string | null;
  dueDate: string | null;
  suggestedAction: string;
  actionUrl: string | null;
  targetPage: string;
  status: string;
  employeeId: string | null;
  employeeName: string | null;
  severity: PriorityLevel;
  factors: PriorityFactor[];
  sourceRecordId: string;
}

// ═══════════════════════════════════════════════════════════════
//  PART 4: Cross-Module Employee Correlation
// ═══════════════════════════════════════════════════════════════

/** Cross-module correlation for a single employee */
export interface EmployeeCorrelation {
  employeeId: string;
  employeeName: string;
  department: string | null;
  position: string | null;
  riskScore: number;
  riskLevel: PriorityLevel;
  trend: TrendDirection;
  attendanceIssues: number;
  lateCount: number;
  absentCount: number;
  deductions: number;
  complaints: number;
  criticalComplaints: number;
  qualityIssues: number;
  capaCount: number;
  overdueCapaCount: number;
  criticalCapaCount: number;
  followUps: number;
  overdueFollowUps: number;
  openActions: number;
  operationalStatus: OperationalStatus;
  topRecommendation: string | null;
  recommendations: string[];
  /** Modules that have flagged this employee */
  affectedModules: SourceModule[];
}

// ═══════════════════════════════════════════════════════════════
//  PART 5: Department Health
// ═══════════════════════════════════════════════════════════════

/** Multi-factor department health analysis */
export interface DepartmentHealth {
  name: string;
  attendanceRate: number;
  present: number;
  late: number;
  absent: number;
  total: number;
  complaintCount: number;
  qualityIssues: number;
  capaCount: number;
  overdueCapaCount: number;
  openActions: number;
  riskCount: number;
  pendingRequests: number;
  healthScore: number;
  trend: TrendDirection;
  criticalCount: number;
  warnings: string[];
  recommendedAction: string | null;
}

// ═══════════════════════════════════════════════════════════════
//  PART 6: Operational Recommendation
// ═══════════════════════════════════════════════════════════════

export type RecommendationCategory =
  | 'investigation'
  | 'assignment'
  | 'escalation'
  | 'coaching'
  | 'review'
  | 'correlation'
  | 'sla';

/** Intelligence-driven recommendation */
export interface OperationalRecommendation {
  id: string;
  reason: string;
  priority: PriorityLevel;
  category: RecommendationCategory;
  affectedModule: SourceModule;
  affectedEmployeeId: string | null;
  affectedEmployeeName: string | null;
  affectedDepartment: string | null;
  actionLabel: string;
  actionUrl: string | null;
  targetPage: string;
  /** Supporting evidence */
  evidence: string;
  evidenceCount: number;
  /** Linked record IDs for deep navigation */
  linkedRecordIds: string[];
}

// ═══════════════════════════════════════════════════════════════
//  PART 7: Visual Priority System
// ═══════════════════════════════════════════════════════════════

/** Visual configuration for a priority level */
export interface PriorityVisual {
  level: PriorityLevel;
  label: string;
  /** Border classes for cards */
  border: string;
  /** Accent text color */
  accent: string;
  /** Background tint */
  bgTint: string;
  /** Glow shadow effect */
  glow: string;
  /** Badge classes */
  badge: string;
  /** Icon color */
  iconColor: string;
  /** Dot color */
  dotColor: string;
}

// ═══════════════════════════════════════════════════════════════
//  PART 8: Activity Feed Entry
// ═══════════════════════════════════════════════════════════════

/** An entry in the realtime operational activity feed */
export interface ActivityFeedEntry {
  id: string;
  timestamp: string;
  timeLabel: string;
  title: string;
  description: string | null;
  sourceModule: SourceModule;
  iconType: string;
  colorClass: string;
  targetPage: string;
  sourceRecordId: string;
  employeeName: string | null;
  priority: PriorityLevel;
}

// ═══════════════════════════════════════════════════════════════
//  PART 9: Executive Summary Intelligence
// ═══════════════════════════════════════════════════════════════

/** Executive summary intelligence block */
export interface ExecutiveIntelligence {
  todayActionsCount: number;
  todayResolvedCount: number;
  todayEscalatedCount: number;
  criticalCount: number;
  highCount: number;
  /** Top 5 priority action items */
  topPriorities: ActionItem[];
  /** Worst-performing department */
  worstDepartment: DepartmentHealth | null;
  /** Employees needing escalation (top 3) */
  escalationCandidates: EmployeeCorrelation[];
  /** KPI trends */
  trends: {
    delaysChange: number;
    attendanceRateChange: number;
    deductionsChange: number;
    direction: TrendDirection;
  };
  currentMonth: string;
  lastMonth: string;
  totalPresent: number;
  totalAbsent: number;
  totalDeductions: number;
  openCAPACount: number;
  openComplaintsCount: number;
  pendingRequestsCount: number;
}

// ═══════════════════════════════════════════════════════════════
//  Raw data bundle passed to collector functions
// ═══════════════════════════════════════════════════════════════

/** Bundle of all raw data from hooks — passed to event-collector */
export interface RawDataBundle {
  stats: Record<string, any>;
  capaItems: any[];
  complaintItems: any[];
  followUpItems: any[];
  riskEmployees: any[];
  notifications: any[];
  activityLogs?: any[];
  riskSummary?: Record<string, any>;
  departmentAnalysis?: Record<string, any>;
}
