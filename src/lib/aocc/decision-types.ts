// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — Decision Intelligence Layer
//  Type Definitions for the Decision Support System.
//
//  Pure type definitions — no React, no API calls, no side effects.
//  These types describe the decisions the system generates from
//  existing operational data. Decisions are DERIVED artifacts:
//  they consume the existing ActionItem / EmployeeCorrelation /
//  DepartmentHealth pipeline and never re-fetch raw data.
// ═══════════════════════════════════════════════════════════════

import type {
  PriorityLevel,
  SourceModule,
  TrendDirection,
  OperationalStatus,
} from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  PART 2: Decision Types (17 categories)
// ═══════════════════════════════════════════════════════════════

/**
 * The 17 decision categories. Each maps to a deterministic detector
 * in the decision engine and a family of next-best-actions.
 */
export type DecisionType =
  | 'immediate_intervention'   // critical risk + multiple open actions
  | 'manager_review'           // declining employee needing manager attention
  | 'quality_investigation'    // quality violation requiring root-cause work
  | 'attendance_review'        // repeated attendance issues
  | 'capa_required'            // quality issue with no open CAPA yet
  | 'complaint_escalation'     // critical complaint unresolved past SLA
  | 'hr_action_required'       // deductions / violations needing HR
  | 'risk_escalation'          // risk score crossed a threshold
  | 'customer_follow_up'       // open complaint needing customer response
  | 'executive_attention'      // department-wide decline or systemic issue
  | 'policy_violation'         // repeated rule breach
  | 'training_required'        // skill-gap / repeated errors suggesting training
  | 'repeated_behavior'        // same issue type recurring for one entity
  | 'system_health'            // biometric / integration health degradation
  | 'approval_required'        // pending request past expected turnaround
  | 'deadline_risk'            // SLA warning — within 1 day
  | 'sla_breach';              // SLA already breached

/** The lifecycle states a decision may pass through (Part 9). */
export type DecisionStatus =
  | 'new'
  | 'acknowledged'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'escalated'
  | 'resolved'
  | 'dismissed'
  | 'archived';

/**
 * The 9 smart bulk actions supported by the inbox (Part 8).
 * Each has a distinct effect documented in the store.
 */
export type BulkActionType =
  | 'assign'
  | 'review'
  | 'close'
  | 'notify'
  | 'escalate'
  | 'open_capa'
  | 'create_followup'
  | 'export'
  | 'archive';

/** Urgency bands — drives the urgency ring visual. */
export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

/** Business impact magnitude — drives the impact meter. */
export type BusinessImpact = 'severe' | 'high' | 'moderate' | 'low' | 'minimal';

// ═══════════════════════════════════════════════════════════════
//  PART 3: Decision Score (9 components + overall)
// ═══════════════════════════════════════════════════════════════

/**
 * The multi-dimensional score for a decision. Each component is
 * normalized to 0-100. `overall` is the weighted composite computed
 * by decision-score.ts. All components are surfaced in the UI so the
 * user understands WHY a decision ranks where it does.
 */
export interface DecisionScore {
  /** Priority contribution (from the existing priority engine). */
  priority: number;
  /** Business / financial / customer impact. */
  businessImpact: number;
  /** Time-criticality — how soon action is needed. */
  urgency: number;
  /** Confidence in the decision (evidence corroboration, 0-100). */
  confidence: number;
  /** Underlying risk exposure. */
  risk: number;
  /** Blast radius on the affected employee. */
  employeeImpact: number;
  /** Blast radius on the affected department. */
  departmentImpact: number;
  /** SLA / deadline exposure. */
  slaImpact: number;
  /** Weighted composite of all components. */
  overall: number;
}

// ═══════════════════════════════════════════════════════════════
//  PART 4: Next Best Action
// ═══════════════════════════════════════════════════════════════

/**
 * The kind of effect a next-best-action performs in the UI.
 * - `navigate`   → call navigateTo(page, id) in the store
 * - `employee`   → open the Employee360 overlay
 * - `create_capa`→ open the CAPA quick-create dialog
 * - `create_fu`  → open the follow-up quick-create dialog
 * - `notify`     → toast confirmation of a manager notification
 * - `dialog`     → open a custom dialog (e.g. coaching scheduler)
 */
export type NextBestActionKind =
  | 'navigate'
  | 'employee'
  | 'create_capa'
  | 'create_fu'
  | 'notify'
  | 'dialog';

/** A single recommended action attached to a decision. */
export interface NextBestAction {
  id: string;
  /** Short Arabic label shown on the button. */
  label: string;
  /** What this action does, in one sentence. */
  description: string;
  kind: NextBestActionKind;
  /** Target page for `navigate` actions. */
  targetPage?: string;
  /** Record id to highlight after navigation. */
  targetRecordId?: string;
  /** Whether the user needs elevated permission to run this action. */
  requiresPermission?: SourceModule;
  /** Icon key resolved by the shared icon map. */
  iconKey: string;
  /** Ordering hint — lower runs first in suggestions. */
  order: number;
}

// ═══════════════════════════════════════════════════════════════
//  PART 5: Decision Explanation
// ═══════════════════════════════════════════════════════════════

/**
 * A single piece of evidence that supports a decision. Each is a
 * human-readable statement that references a concrete data point so
 * the user can audit the reasoning. Every decision MUST explain itself.
 */
export interface DecisionEvidence {
  /** The module this evidence came from. */
  module: SourceModule;
  /** Short statement, e.g. "Risk score increased from 61 to 78". */
  statement: string;
  /** Optional raw metric for display. */
  metric?: string;
}

/**
 * The full explanation block for a decision. Answers:
 *   Why was this decision created?
 *   How confident is the system?
 *   What is the business impact?
 *   What happens if nothing is done?
 */
export interface DecisionExplanation {
  /** One-line headline reason (the "why"). */
  reason: string;
  /** Structured evidence list (the proof). */
  evidence: DecisionEvidence[];
  /** What will happen if no action is taken (the "so what"). */
  consequence: string;
  /** Confidence percentage 0-100. */
  confidence: number;
  /** Business impact band. */
  businessImpact: BusinessImpact;
}

// ═══════════════════════════════════════════════════════════════
//  PART 6 + 1: The Decision object
// ═══════════════════════════════════════════════════════════════

/**
 * A single operational decision. This is the central artifact of the
 * Decision Intelligence Layer. One decision aggregates multiple
 * related events/actions into a single actionable conclusion so the
 * user never sees duplicate issues for the same root cause.
 */
export interface Decision {
  // ── Identity ──
  id: string;
  type: DecisionType;
  /** Arabic display title. */
  title: string;

  // ── Scoring ──
  priority: PriorityLevel;
  score: DecisionScore;

  // ── Affected entities (Part 6 — cross-module correlation) ──
  affectedEmployeeId: string | null;
  affectedEmployeeName: string | null;
  affectedDepartment: string | null;
  /** Every module that contributed evidence to this decision. */
  affectedModules: SourceModule[];
  /** Ids of the underlying ActionItems / events this decision groups. */
  sourceActionIds: string[];

  // ── Operational metadata ──
  urgency: UrgencyLevel;
  businessImpact: BusinessImpact;
  /** ISO date by which action should be taken (deadline / SLA). */
  dueDate: string | null;
  /** Human-readable estimate, e.g. "~2 hours". */
  estimatedResolutionTime: string;
  /** Suggested owner (employee id or role label). */
  suggestedOwner: string | null;
  suggestedOwnerType: 'employee' | 'manager' | 'department' | 'executive' | 'unassigned';

  // ── Explanation (Part 5) ──
  explanation: DecisionExplanation;

  // ── Actions (Part 4) ──
  actions: NextBestAction[];

  // ── Navigation ──
  /** Primary deep-link target for the "Open" button. */
  primaryTargetPage: SourceModule | 'employee360';
  primaryTargetRecordId: string | null;

  // ── Lifecycle ──
  /** Creation timestamp of the underlying events (earliest). */
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  PART 9: Lifecycle state entry
// ═══════════════════════════════════════════════════════════════

/** A single transition in the decision's lifecycle history. */
export interface DecisionStateTransition {
  from: DecisionStatus;
  to: DecisionStatus;
  at: string;
  by: string;
  note?: string;
}

/**
 * Persisted per-decision state. Stored in localStorage keyed by user.
 * Decisions themselves are recomputed each load (they are derived),
 * but their lifecycle state survives across sessions.
 */
export interface DecisionStateEntry {
  decisionId: string;
  status: DecisionStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  history: DecisionStateTransition[];
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  PART 12: Predictive Alerts (no AI — pure trajectory math)
// ═══════════════════════════════════════════════════════════════

/** The six predictive alert categories. */
export type PredictiveAlertType =
  | 'likely_sla_breach'
  | 'likely_complaint_escalation'
  | 'likely_capa_overdue'
  | 'likely_attendance_issue'
  | 'likely_burnout'
  | 'likely_department_decline';

/** A single predictive alert. */
export interface PredictiveAlert {
  id: string;
  type: PredictiveAlertType;
  /** Arabic headline. */
  title: string;
  /** Probability 0-100 (heuristic, NOT a real ML score). */
  probability: number;
  /** The entity at risk (employee or department). */
  affectedName: string | null;
  affectedEmployeeId: string | null;
  affectedDepartment: string | null;
  /** Short Arabic justification citing the trend/data used. */
  reasoning: string;
  /** When the predicted event is expected to materialize. */
  etaLabel: string;
  /** Severity band driving the visual. */
  severity: PriorityLevel;
  /** Suggested mitigation action label. */
  suggestedAction: string;
  targetPage: string;
  sourceRecordId: string | null;
}

// ═══════════════════════════════════════════════════════════════
//  PART 11: Manager Coaching Opportunities
// ═══════════════════════════════════════════════════════════════

/** Coaching opportunity categories. */
export type CoachingCategory =
  | 'attendance'
  | 'quality_decline'
  | 'complaint_increase'
  | 'performance_drop'
  | 'training_recommendation';

/** A single coaching opportunity for a manager. */
export interface CoachingOpportunity {
  id: string;
  category: CoachingCategory;
  /** Arabic headline. */
  title: string;
  affectedEmployeeId: string;
  affectedEmployeeName: string;
  affectedDepartment: string | null;
  /** The supporting data points. */
  evidence: string;
  /** Suggested coaching action label. */
  suggestedAction: string;
  priority: PriorityLevel;
  /** Linked decision id if this coaching derives from a decision. */
  decisionId: string | null;
}

// ═══════════════════════════════════════════════════════════════
//  PART 10: Executive Priorities
// ═══════════════════════════════════════════════════════════════

/** A top priority surfaced to executives. */
export interface ExecutivePriorityItem {
  id: string;
  rank: number;
  title: string;
  /** The decision this priority comes from (if any). */
  decisionId: string | null;
  priority: PriorityLevel;
  score: number;
  affectedName: string | null;
  targetPage: string;
  sourceRecordId: string | null;
}

/** A systemic bottleneck detected across the operation. */
export interface BusinessBottleneck {
  id: string;
  title: string;
  /** Which module/process is the bottleneck. */
  module: SourceModule;
  /** How many decisions are blocked by this bottleneck. */
  affectedDecisionCount: number;
  /** Short Arabic explanation. */
  description: string;
  recommendedAction: string;
}

/** An aggregated executive alert (department decline, SLA cluster, etc.). */
export interface ExecutiveAlert {
  id: string;
  title: string;
  severity: PriorityLevel;
  scope: 'operation' | 'department' | 'employee';
  affectedName: string | null;
  description: string;
  targetPage: string;
}

/**
 * The full executive priorities bundle (Part 10).
 * Answers: today's top priorities, top risks, who needs attention,
 * which departments declined, and where the bottlenecks are.
 */
export interface ExecutivePriorities {
  topPriorities: ExecutivePriorityItem[];
  topRisks: ExecutivePriorityItem[];
  topEmployeesNeedingAttention: ExecutivePriorityItem[];
  topDepartments: ExecutivePriorityItem[];
  alerts: ExecutiveAlert[];
  bottlenecks: BusinessBottleneck[];
}

// ═══════════════════════════════════════════════════════════════
//  PART 7: Inbox view model
// ═══════════════════════════════════════════════════════════════

/** How the inbox groups decisions. */
export type DecisionGroupKey =
  | 'priority'
  | 'department'
  | 'employee'
  | 'manager'
  | 'module'
  | 'status'
  | 'none';

/** How the inbox sorts decisions. */
export type DecisionSortKey =
  | 'score'
  | 'priority'
  | 'dueDate'
  | 'created'
  | 'confidence'
  | 'impact';

/** The complete inbox filter state. */
export interface DecisionFilters {
  search: string;
  priorities: PriorityLevel[];
  types: DecisionType[];
  departments: string[];
  modules: SourceModule[];
  statuses: DecisionStatus[];
  assignees: string[]; // 'unassigned' | employee ids
  /** "today" | "week" | "all" */
  timeWindow: 'today' | 'week' | 'all';
}

/** A grouped decision view (one group → list of decisions). */
export interface DecisionGroup {
  key: string;
  label: string;
  decisions: Decision[];
  priority: PriorityLevel; // worst priority in group, for visual
}

// ═══════════════════════════════════════════════════════════════
//  Visual configuration (extends the existing PriorityVisual system)
// ═══════════════════════════════════════════════════════════════

/** Visual config for a decision type — icon, color, accent. */
export interface DecisionTypeVisual {
  type: DecisionType;
  label: string;
  iconKey: string;
  /** Accent text color class. */
  accentClass: string;
  /** Background tint class. */
  bgTintClass: string;
}

/** Visual config for business impact. */
export interface ImpactVisual {
  level: BusinessImpact;
  label: string;
  /** 0-100 meter fill. */
  fill: number;
  /** Color class. */
  colorClass: string;
}

/** Re-export the shared unions so consumers import from one place. */
export type {
  PriorityLevel,
  SourceModule,
  TrendDirection,
  OperationalStatus,
};
