// src/types/index.ts

import type { EmployeeStatus } from '@/lib/organization/employee-status';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  rank: string;
  permissions: Record<string, any>;
  isSuspended?: boolean;
  suspendedAt?: string;
  /** §USER-PROFILE — profile photo URL (uploaded via admin, storage-backed). */
  photoURL?: string | null;
  /** §USER-PROFILE — linked employee record (User ↔ Employee bridge). */
  linkedEmployeeId?: string | null;
  /** §USER-PROFILE — position template id (permission overlay source). */
  positionId?: string | null;
}

export interface Employee {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  position: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  hireDate: string | null;
  mobile: string | null;
  /**
   * Milestone 7 §16 — residence/location. OPTIONAL free text
   * (legacy employees have no field); searchable/filterable in the
   * Employee Database and shown in Employee 360.
   */
  residence?: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Milestone 10 (organization): the employee's node in the
   * organization tree (arm_erp/orgNodes). OPTIONAL — legacy
   * employees have none. The free-text `department`/`position`
   * strings above remain display data and are NEVER rewritten by
   * organization moves (historical integrity).
   */
  orgNodeId?: string | null;
  /**
   * M0.6-A lifecycle. OPTIONAL — legacy employees have no field and
   * read as 'active' everywhere (normalizeEmployeeStatus), so no
   * migration is required. The canonical scope engine intentionally
   * does NOT consume this field yet (access evolution is its own
   * reviewed step); nothing in M0.6-A deletes on deactivation.
   */
  status?: EmployeeStatus;
}

export interface BiometricRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string;
}

/**
 * Milestone 7 §17 — employee document METADATA.
 *
 * Metadata-only design: the stack stores evidence as URLs (see
 * quality observations), so a document is its metadata plus an
 * OPTIONAL external link — no binary blobs in RTDB. Documents are
 * deliberately NOT a Global Search domain (restricted employee data
 * must not surface in search §17); access goes through the
 * employees permission + employee scope on every route.
 */
export interface EmployeeDocument {
  id: string;
  employeeId: string;
  /** Document type (card/contract/certificate/other — free vocabulary). */
  docType: string;
  title: string;
  /** Optional external link (existing evidence-as-URL doctrine). */
  url: string | null;
  /** Expiry day key YYYY-MM-DD when applicable (null = open-ended). */
  expiryDate: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: 'present' | 'late' | 'absent' | 'approved';
  checkIn: string | null;
  checkOut: string | null;
  minutesLate: number;
  notes: string | null;
  approvedRequestId: string | null;
  createdAt: string;
}

export interface RequestRecord {
  id: string;
  employeeId: string;
  type: string;
  date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DeductionRule {
  id: string;
  key: string;
  label: string;
  amount: number;
  unit: 'EGP' | 'days';
  createdAt: string;
  updatedAt: string;
}

export interface QualityDeduction {
  id: string;
  employeeId: string;
  date: string;
  type: string;
  description: string;
  deductionDays: number;
  deductionAmount: number;
  evidence: string | null;
  month: string;
  relatedCapaId: string | null;
  createdAt: string;
  /** §AUDIT — hidden metadata. Stored on every record, returned by
   *  the API ONLY to viewers with explicit audit permission
   *  (qualityAuditLog) or the system owner; the employee-facing card
   *  never renders it. */
  createdById?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  /** §WORKFLOW — approval lifecycle. Legacy records without this
   *  field are treated as approved. Only APPROVED discounts affect
   *  reports/totals/payroll. */
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  approvalHistory?: import('@/lib/approvals/types').ApprovalEvent[];
  /** §ARCHIVE — archived = historical, excluded from active totals/KPI. */
  archived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archivedByName?: string | null;
}

export interface HrDeduction {
  id: string;
  employeeId: string;
  employeeName?: string;
  type: string;
  amount: number;
  unit: 'days' | 'EGP';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  month: string;
  deductionDate: string | null;
  relatedCapaId: string | null;
  createdAt: string;
  updatedAt: string;
  /** §ARCHIVE — archived = historical, excluded from active totals/KPI. */
  archived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archivedByName?: string | null;
}

export interface TravelDeal {
  id: string;
  employeeId: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  dealerName: string | null;
  customerNames: string | null;
  hasInternationalFlight: boolean;
  hasDomesticFlight: boolean;
  hasHotel: boolean;
  hasVisa: boolean;
  hasTours: boolean;
  hasTransportation: boolean;
  internationalFlightStatus: string | null;
  domesticFlightStatus: string | null;
  hotelStatus: string | null;
  visaStatus: string | null;
  toursStatus: string | null;
  transportationStatus: string | null;
  notes: string | null;
  status: 'upcoming' | 'in_progress' | 'completed' | 'canceled';
  createdAt: string;
}

export interface FollowUp {
  id: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  followUpType: 'quality' | 'behavior' | 'attendance' | 'productivity' | 'training' | 'coaching' | 'complaint' | 'positive' | 'improvement' | 'other';
  subject: string;
  detailedDescription: string;
  positiveNotes: string;
  negativeNotes: string;
  rootCause: string;
  actionTaken: string;
  department: string;
  position: string;
  priorityLevel: 'low' | 'medium' | 'high' | 'critical';
  responsiblePerson: string;
  responsiblePersonName?: string;
  nextFollowUpDate: string | null;
  followUpRequired: boolean;
  status: 'open' | 'under_review' | 'under_follow_up' | 'resolved' | 'closed' | 'cancelled';
  score: number;
  attachments: string[];
  /** §EVIDENCE — dedicated evidence/link field (URL, Drive link,
   *  document link…). Not parsed out of the description text.
   *  Optional: legacy records predate the field. */
  evidence?: string | null;
  createdById: string;
  createdByName: string;
  relatedDeductionId: string | null;
  relatedCapaId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CAPACase {
  id: string;
  capaId: string;                    // Auto-generated: CAPA-2026-001
  title: string;
  department: string;
  employeeId: string | null;
  employeeName?: string;
  relatedFollowUpId: string | null;
  relatedRiskId: string | null;
  relatedComplaintId: string | null;
  relatedQualityDeductionId: string | null;
  relatedHrDeductionId: string | null;
  createdBy: string;
  createdByName?: string;
  // Problem Description
  issueCategory: string;              // quality_issue, attendance_issue, behavior_issue, training_issue, customer_complaint, process_failure, system_error, sales_error, operations_error, other
  problemDescription: string;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  impactDescription: string;
  // Root Cause Analysis
  rootCauseCategory: string;         // lack_of_training, human_error, poor_process, missing_procedure, communication_failure, system_limitation, workload, management_issue, other
  rootCauseDescription: string;
  rootCauseVerification: string;
  // Corrective Action
  correctiveAction: string;
  correctiveAssignedTo: string;
  correctiveAssignedToName?: string;
  correctiveDueDate: string;
  correctiveStatus: 'not_started' | 'in_progress' | 'completed';
  correctiveEvidence: string;
  // Preventive Action
  preventiveAction: string;
  preventiveAssignedTo: string;
  preventiveAssignedToName?: string;
  preventiveDueDate: string;
  preventiveStatus: 'not_started' | 'in_progress' | 'completed';
  preventiveVerificationMethod: string;
  // Effectiveness Verification
  verificationDate: string;
  verifiedBy: string;
  verifiedByName?: string;
  verificationResult: 'effective' | 'partially_effective' | 'not_effective' | '';
  verificationNotes: string;
  // Status & Priority
  status: 'open' | 'investigation' | 'root_cause_analysis' | 'corrective_action' | 'preventive_action' | 'verification' | 'closed' | 'rejected' | 'reopened';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo: string;
  assignedToName?: string;
  // Closure
  closureDate: string;
  closedBy: string;
  closedByName?: string;
  finalComments: string;
  // Metadata
  relatedEmployeeIds: string[];
  source: 'audit' | 'complaint' | 'mistake_pattern' | 'management_review' | 'employee_feedback' | 'automation' | 'manual';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  timeline: CAPATimelineEvent[];
  attachments: CAPAAttachment[];
  lessonsLearned: string;
  // SLA
  slaDays: number;
  overdueDays: number;
}

export interface CAPATimelineEvent {
  id: string;
  action: string;
  description: string;
  performedBy: string;
  performedByName?: string;
  timestamp: string;
}

export interface CAPAAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  uploadedAt: string;
}

export interface CustomerComplaint {
  id: string;
  customerName: string;
  customerContact: string;
  dealId: string | null;
  employeeId: string | null;
  employeeName?: string;
  complaintType: 'service_quality' | 'pricing_error' | 'communication' | 'delay' | 'product_issue' | 'other';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'under_investigation' | 'pending_resolution' | 'resolved' | 'closed';
  resolution: string | null;
  responsiblePerson: string;
  compensationProvided: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  relatedCapaIds: string[];
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  problem: string;
  rootCause: string;
  solution: string;
  preventionMethod: string;
  department: 'operations' | 'quality' | 'hr' | 'sales' | 'it' | 'finance';
  category: string;
  tags: string[];
  author: string;
  authorName?: string;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export type PageId = 'home' | 'employees' | 'biometric' | 'attendance' | 'requests' | 'rules' | 'quality' | 'hrDeductions' | 'travel' | 'reports' | 'followUps' | 'capa' | 'complaints' | 'knowledgeBase' | 'riskCenter' | 'operationsCenter' | 'employee360' | 'notifications' | 'rulesEngine' | 'controlPanel' | 'observations' | 'observationCategories' | 'observationTemplates' | 'kpiDashboard' | 'kpiReports' | 'monthClose' | 'kpiSettings' | 'qualityAuditLog' | 'qualityDeductionsReport' | 'smartQualityReport' | 'workflowDesigner' | 'organization';

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'unread' | 'read' | 'acknowledged' | 'resolved' | 'archived' | 'dismissed';
  category: 'attendance' | 'biometric' | 'requests' | 'quality' | 'hr' | 'risk' | 'followUp' | 'employee' | 'travel' | 'system' | 'automation' | 'complaint' | 'capa';
  sourceModule: string;
  sourceRecordId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  ruleId: string | null;
  ruleName: string | null;
  actionUrl: string | null;
  sourceType: string | null;
  targetPage: string | null;
  /**
   * Milestone 10 (notification routing): explicit recipient USER ids
   * resolved by the write-side router (src/lib/notifications/
   * routing.ts). Optional — legacy notifications carry null and use
   * the directed/broadcast rules only.
   */
  recipientUserIds?: string[] | null;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  module: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'inactive' | 'draft';
  triggerType: 'record_created' | 'record_updated' | 'record_deleted' | 'status_changed' | 'date_reached' | 'threshold_reached' | 'manual' | 'scheduled';
  schedule: string | null;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  escalationConfig: EscalationStep[] | null;
  throttleMinutes: number;
  lastRunAt: string | null;
  lastTriggeredBy: string | null;
  totalExecutions: number;
  successCount: number;
  failCount: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleCondition {
  id: string;
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in_list' | 'not_in_list' | 'empty' | 'not_empty';
  value: any;
  valueTo?: any;
}

export interface RuleConditionGroup {
  logic: 'and' | 'or';
  conditions: RuleCondition[];
  groups?: RuleConditionGroup[];
}

export interface RuleAction {
  id: string;
  type: 'create_notification' | 'create_follow_up' | 'update_risk_score' | 'assign_user' | 'create_hr_warning' | 'create_quality_review' | 'escalate_case' | 'update_employee_status' | 'add_timeline_event' | 'create_capa';
  config: Record<string, any>;
}

export interface EscalationStep {
  afterHours: number;
  action: string;
  config: Record<string, any>;
}

export interface RuleExecutionLog {
  id: string;
  ruleId: string;
  ruleName: string;
  executionDate: string;
  executionTime: string;
  triggeredBy: string;
  affectedEmployeeId: string | null;
  affectedEmployeeName: string | null;
  result: 'success' | 'failed' | 'skipped';
  status: string;
  executionDuration: number;
  errorMessage: string | null;
  actionsTaken: string[];
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;      // e.g., 'login', 'create_employee', 'update_request', 'delete_rule', etc.
  page: string;        // which page the action was on
  details: string;     // description in Arabic
  timestamp: string;   // ISO date string
  metadata?: Record<string, any>;  // optional extra data (record ID, etc.)
}
