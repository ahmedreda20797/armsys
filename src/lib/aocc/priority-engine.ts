// ═══════════════════════════════════════════════════════════════
//  AOCC Unified Priority Engine
//  Pure functions — no React, no API calls, no side effects.
//  Scores every operational event on a 0-100 scale and assigns
//  a priority level + visual configuration.
// ═══════════════════════════════════════════════════════════════

import { isOverdue, getSLAInfo } from '@/lib/capa-helpers';
import { SLA_DAYS } from '@/lib/capa-constants';
import type {
  OperationalEvent,
  PriorityScore,
  PriorityFactor,
  PriorityLevel,
  PriorityVisual,
  ActionItem,
  EventType,
} from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  Scoring Configuration
// ═══════════════════════════════════════════════════════════════

interface FactorConfig {
  multiplier: number;
  maxPoints: number;
}

const FACTOR_CONFIGS: Record<string, FactorConfig> = {
  critical_risk:       { multiplier: 1.5, maxPoints: 15 },
  capa_overdue:        { multiplier: 1.4, maxPoints: 14 },
  capa_priority_crit:  { multiplier: 1.3, maxPoints: 13 },
  complaint_critical:  { multiplier: 1.3, maxPoints: 13 },
  repeated_issues:     { multiplier: 1.2, maxPoints: 12 },
  followup_overdue:    { multiplier: 1.1, maxPoints: 11 },
  sla_breach:          { multiplier: 1.2, maxPoints: 12 },
  pending_approval:    { multiplier: 0.8, maxPoints: 8  },
  risk_score_high:     { multiplier: 1.0, maxPoints: 10 },
};

const PRIORITY_THRESHOLDS = {
  critical: 70,
  high: 40,
  medium: 20,
} as const;

// ═══════════════════════════════════════════════════════════════
//  Priority Level Determination
// ═══════════════════════════════════════════════════════════════

/** Convert a numeric score to a priority level */
export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= PRIORITY_THRESHOLDS.critical) return 'critical';
  if (score >= PRIORITY_THRESHOLDS.high) return 'high';
  if (score >= PRIORITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

// ═══════════════════════════════════════════════════════════════
//  Factor Extraction — analyzes an event and returns contributing factors
// ═══════════════════════════════════════════════════════════════

/**
 * Extract priority factors from an operational event.
 * Each factor contributes points based on the event's type and metadata.
 */
function extractFactors(event: OperationalEvent): PriorityFactor[] {
  const factors: PriorityFactor[] = [];
  const meta = event.metadata || {};

  // ── Critical Risk Level ──
  const riskLevel = meta.riskLevel as string | undefined;
  if (riskLevel === 'critical' || riskLevel === 'high') {
    const cfg = FACTOR_CONFIGS.critical_risk;
    const points = Math.min(riskLevel === 'critical' ? cfg.maxPoints : Math.round(cfg.maxPoints * 0.6), cfg.maxPoints);
    factors.push({ key: 'critical_risk', label: 'مستوى مخاطر حرج', points, maxPoints: cfg.maxPoints });
  }

  // ── CAPA Overdue ──
  if (event.type === 'capa_overdue') {
    const cfg = FACTOR_CONFIGS.capa_overdue;
    const overdueDays = (meta.overdueDays as number) || 1;
    const points = Math.min(Math.round(cfg.multiplier * Math.min(overdueDays, 10) * 1.4), cfg.maxPoints);
    factors.push({ key: 'capa_overdue', label: 'كابا متأخرة', points, maxPoints: cfg.maxPoints });
  }

  // ── CAPA Priority Critical ──
  if (event.type === 'capa_critical') {
    const cfg = FACTOR_CONFIGS.capa_priority_crit;
    factors.push({ key: 'capa_priority_crit', label: 'كابا بأولوية حرجة', points: cfg.maxPoints, maxPoints: cfg.maxPoints });
  }

  // ── Complaint Severity Critical ──
  if (event.type === 'complaint_critical') {
    const cfg = FACTOR_CONFIGS.complaint_critical;
    factors.push({ key: 'complaint_critical', label: 'شكوى حرجة', points: cfg.maxPoints, maxPoints: cfg.maxPoints });
  }

  // ── Repeated Issues (employee has 3+ issues in 30 days) ──
  const issueCount = (meta.employeeIssueCount as number) || 0;
  if (issueCount >= 3) {
    const cfg = FACTOR_CONFIGS.repeated_issues;
    const points = Math.min(Math.round(cfg.multiplier * Math.min(issueCount, 6) * 1.7), cfg.maxPoints);
    factors.push({ key: 'repeated_issues', label: `مشاكل متكررة (${issueCount})`, points, maxPoints: cfg.maxPoints });
  }

  // ── Follow-Up Overdue ──
  if (event.type === 'followup_overdue') {
    const cfg = FACTOR_CONFIGS.followup_overdue;
    factors.push({ key: 'followup_overdue', label: 'متابعة مستحقة', points: cfg.maxPoints, maxPoints: cfg.maxPoints });
  }

  // ── SLA Breach (within 1 day of deadline) ──
  if (event.type === 'sla_breach') {
    const cfg = FACTOR_CONFIGS.sla_breach;
    const daysRemaining = (meta.daysRemaining as number) ?? 0;
    const points = Math.min(Math.round(cfg.multiplier * (daysRemaining <= 0 ? 10 : 6)), cfg.maxPoints);
    factors.push({ key: 'sla_breach', label: 'تجاوز SLA', points, maxPoints: cfg.maxPoints });
  }

  // ── Pending Approval (>24h) ──
  if (event.type === 'request_pending') {
    const cfg = FACTOR_CONFIGS.pending_approval;
    const hoursPending = (meta.hoursPending as number) || 0;
    if (hoursPending > 24) {
      const points = Math.min(Math.round(cfg.multiplier * Math.min(hoursPending / 12, 10)), cfg.maxPoints);
      factors.push({ key: 'pending_approval', label: 'موافقة معلقة', points, maxPoints: cfg.maxPoints });
    }
  }

  // ── Risk Score High (≥36 = critical threshold from Risk Center API) ──
  const riskScore = (meta.riskScore as number) || 0;
  if (riskScore >= 36) {
    const cfg = FACTOR_CONFIGS.risk_score_high;
    const points = Math.min(Math.round(cfg.multiplier * Math.min(riskScore / 5, 10)), cfg.maxPoints);
    factors.push({ key: 'risk_score_high', label: `درجة مخاطر عالية (${riskScore})`, points, maxPoints: cfg.maxPoints });
  }

  // ── Notification Critical/High ──
  if (event.type === 'notification_critical' || event.type === 'notification_high') {
    const basePoints = event.type === 'notification_critical' ? 12 : 7;
    factors.push({ key: event.type, label: 'إشعار عالي الأولوية', points: basePoints, maxPoints: 15 });
  }

  return factors;
}

// ═══════════════════════════════════════════════════════════════
//  Priority Score Calculation
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate the priority score for a single operational event.
 * Returns the event with its score, priority level, and contributing factors.
 */
export function calculatePriorityScore(event: OperationalEvent): PriorityScore {
  const factors = extractFactors(event);

  // Sum all factor points (each already capped at its max)
  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0)
  );

  // Base score from event severity if no factors were extracted
  const finalScore = score === 0 ? getBaseScoreForType(event.type) : score;

  return {
    event,
    score: finalScore,
    priorityLevel: getPriorityLevel(finalScore),
    factors,
  };
}

/** Fallback base scores by event type when no specific factors match */
function getBaseScoreForType(type: EventType): number {
  const baseScores: Partial<Record<EventType, number>> = {
    capa_overdue: 55,
    capa_critical: 50,
    complaint_critical: 48,
    complaint_high: 30,
    followup_overdue: 35,
    risk_critical: 60,
    risk_high: 38,
    travel_urgent: 32,
    sla_breach: 42,
    request_pending: 18,
    capa_high: 28,
    notification_critical: 22,
    notification_high: 15,
    attendance_absent: 20,
    attendance_late: 12,
    quality_violation: 16,
    hr_deduction: 14,
    followup_due: 10,
  };
  return baseScores[type] ?? 5;
}

// ═══════════════════════════════════════════════════════════════
//  Priority Comparator — for sorting
// ═══════════════════════════════════════════════════════════════

const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Sort comparator: higher priority first, then by score, then by due date */
export function comparePriority(a: { priority: PriorityLevel; score: number; dueDate?: string | null }, b: { priority: PriorityLevel; score: number; dueDate?: string | null }): number {
  // Priority level first
  const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (pDiff !== 0) return pDiff;

  // Then by score (higher = more urgent)
  if (b.score !== a.score) return b.score - a.score;

  // Then by due date (earlier = more urgent)
  const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return aTime - bTime;
}

/** Sort an array of scored items by priority */
export function sortByPriority<T extends { priority: PriorityLevel; score: number; dueDate?: string | null }>(items: T[]): T[] {
  return [...items].sort(comparePriority);
}

// ═══════════════════════════════════════════════════════════════
//  Visual Priority System
// ═══════════════════════════════════════════════════════════════

const PRIORITY_VISUALS: Record<PriorityLevel, PriorityVisual> = {
  critical: {
    level: 'critical',
    label: 'حرج',
    border: 'border-red-500/50',
    accent: 'text-red-400',
    bgTint: 'bg-red-500/5',
    glow: 'shadow-[0_0_12px_rgba(239,68,68,0.25)]',
    badge: 'bg-red-500/20 text-red-400 border-red-500/30',
    iconColor: 'text-red-400',
    dotColor: 'bg-red-500',
  },
  high: {
    level: 'high',
    label: 'عالي',
    border: 'border-amber-500/40',
    accent: 'text-amber-400',
    bgTint: 'bg-amber-500/5',
    glow: 'shadow-[0_0_8px_rgba(245,158,11,0.15)]',
    badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    iconColor: 'text-amber-400',
    dotColor: 'bg-amber-500',
  },
  medium: {
    level: 'medium',
    label: 'متوسط',
    border: 'border-blue-500/30',
    accent: 'text-blue-400',
    bgTint: 'bg-blue-500/5',
    glow: '',
    badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    iconColor: 'text-blue-400',
    dotColor: 'bg-blue-500',
  },
  low: {
    level: 'low',
    label: 'منخفض',
    border: 'border-slate-600/30',
    accent: 'text-slate-400',
    bgTint: 'bg-slate-600/5',
    glow: '',
    badge: 'bg-slate-600/20 text-slate-400 border-slate-500/30',
    iconColor: 'text-slate-400',
    dotColor: 'bg-slate-500',
  },
};

/** Get the visual configuration for a priority level */
export function getPriorityVisual(level: PriorityLevel): PriorityVisual {
  return PRIORITY_VISUALS[level] || PRIORITY_VISUALS.low;
}

/** Get Arabic label for a priority level */
export function getPriorityLabel(level: PriorityLevel): string {
  return PRIORITY_VISUALS[level]?.label || level;
}

// ═══════════════════════════════════════════════════════════════
//  Batch Scoring — score multiple events at once
// ═══════════════════════════════════════════════════════════════

/** Score and sort a batch of events by priority */
export function scoreAndSortEvents(events: OperationalEvent[]): PriorityScore[] {
  return events
    .map(calculatePriorityScore)
    .sort((a, b) => comparePriority(
      { priority: a.priorityLevel, score: a.score, dueDate: a.event.metadata.dueDate as string },
      { priority: b.priorityLevel, score: b.score, dueDate: b.event.metadata.dueDate as string }
    ));
}

/** Count items by priority level */
export function countByPriority<T extends { priority: PriorityLevel }>(items: T[]): Record<PriorityLevel, number> {
  const counts: Record<PriorityLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  items.forEach((item) => {
    counts[item.priority] = (counts[item.priority] || 0) + 1;
  });
  return counts;
}
