// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — Decision Intelligence Layer
//  Shared Visual Primitives
//
//  Reusable UI components, color maps, and icon resolution for
//  the Decision Intelligence Layer. All widgets import from here —
//  never duplicate color/icon logic across components.
//
//  Design principles:
//  - Match the existing AOCC visual language (Badge pattern,
//    priority colors, icon sizes from AoccWidgets)
//  - All Arabic labels, RTL layout, dark theme consistent
//  - Every component is memoized for performance
//  - No business logic — pure presentation only
// ═══════════════════════════════════════════════════════════════

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type {
  DecisionType,
  DecisionStatus,
  DecisionScore,
  UrgencyLevel,
  BusinessImpact,
  DecisionEvidence,
  NextBestAction,
  DecisionGroupKey,
  SourceModule,
} from '@/lib/aocc/decision-types';
import type { PriorityLevel } from '@/lib/aocc/types';
import type { CoachingCategory, PredictiveAlertType } from '@/lib/aocc/decision-types';
import type { FC } from 'react';

// ── Lucide icons ───────────────────────────────────────────────
import {
  AlertTriangle,       // immediate_intervention / risk_escalation
  UserCheck,            // manager_review
  Search,               // quality_investigation
  Clock,                // attendance_review / deadline_risk
  ShieldAlert,          // capa_required
  MessageSquareWarning, // complaint_escalation  (renamed alias below)
  Banknote,             // hr_action_required
  Shield,               // risk_escalation alt
  User,                 // customer_follow_up
  Crown,                // executive_attention
  Gavel,                // policy_violation
  GraduationCap,         // training_required
  Repeat,               // repeated_behavior
  Server,               // system_health
  Stamp,                // approval_required
  Hourglass,            // deadline_risk
  Timer,                // sla_breach
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Bell,
  Plus,
  FileText,
  Clock3,
  ShieldCheck,
  Users,
  BarChart3,
  Lightbulb,
  Target,
  Zap,
  ChevronDown,
  ChevronUp,
  Siren,
  UserCog,
  Building,
  Briefcase,
  FileWarning,
  Check,
  ArrowRight,
  Loader2,
  Pause,
  Archive,
  Send,
  Download,
  ExternalLink,
  Inbox,
  Star,
  StarHalf,
  CircleDot,
  CircleDotDashed,
  AlertOctagon,
  SignalLow,
  SignalMedium,
  SignalHigh,
  Plane,
  Fingerprint,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  PART 1: Static visual config maps (pure data — no functions)
// ═══════════════════════════════════════════════════════════════

/** Per-decision-type visual config: label, icon key, colors. */
interface TypeVisual {
  label: string;
  iconKey: string;
  accentClass: string;
  bgTintClass: string;
  borderClass: string;
}

export const DECISION_TYPE_VISUALS: Record<DecisionType, TypeVisual> = {
  immediate_intervention: {
    label: 'تدخل فوري',
    iconKey: 'siren',
    accentClass: 'text-red-400',
    bgTintClass: 'bg-red-500/5',
    borderClass: 'border-red-500/30',
  },
  manager_review: {
    label: 'مراجعة المدير',
    iconKey: 'user-check',
    accentClass: 'text-amber-400',
    bgTintClass: 'bg-amber-500/5',
    borderClass: 'border-amber-500/25',
  },
  quality_investigation: {
    label: 'تحقيق جودة',
    iconKey: 'search',
    accentClass: 'text-emerald-400',
    bgTintClass: 'bg-emerald-500/5',
    borderClass: 'border-emerald-500/25',
  },
  attendance_review: {
    label: 'مراجعة حضور',
    iconKey: 'clock',
    accentClass: 'text-amber-400',
    bgTintClass: 'bg-amber-500/5',
    borderClass: 'border-amber-500/25',
  },
  capa_required: {
    label: 'كابا مطلوبة',
    iconKey: 'shield-alert',
    accentClass: 'text-purple-400',
    bgTintClass: 'bg-purple-500/5',
    borderClass: 'border-purple-500/25',
  },
  complaint_escalation: {
    label: 'تصعيد شكوى',
    iconKey: 'message-warning',
    accentClass: 'text-orange-400',
    bgTintClass: 'bg-orange-500/5',
    borderClass: 'border-orange-500/25',
  },
  hr_action_required: {
    label: 'إجراء موارد بشرية',
    iconKey: 'banknote',
    accentClass: 'text-rose-400',
    bgTintClass: 'bg-rose-500/5',
    borderClass: 'border-rose-500/25',
  },
  risk_escalation: {
    label: 'تصعيد مخاطر',
    iconKey: 'shield',
    accentClass: 'text-red-400',
    bgTintClass: 'bg-red-500/5',
    borderClass: 'border-red-500/30',
  },
  customer_follow_up: {
    label: 'متابعة عميل',
    iconKey: 'user',
    accentClass: 'text-sky-400',
    bgTintClass: 'bg-sky-500/5',
    borderClass: 'border-sky-500/25',
  },
  executive_attention: {
    label: 'انتباه تنفيذي',
    iconKey: 'crown',
    accentClass: 'text-indigo-400',
    bgTintClass: 'bg-indigo-500/5',
    borderClass: 'border-indigo-500/25',
  },
  policy_violation: {
    label: 'مخالفة سياسة',
    iconKey: 'gavel',
    accentClass: 'text-red-400',
    bgTintClass: 'bg-red-500/5',
    borderClass: 'border-red-500/30',
  },
  training_required: {
    label: 'تدريب مطلوب',
    iconKey: 'graduation',
    accentClass: 'text-cyan-400',
    bgTintClass: 'bg-cyan-500/5',
    borderClass: 'border-cyan-500/25',
  },
  repeated_behavior: {
    label: 'سلوك متكرر',
    iconKey: 'repeat',
    accentClass: 'text-amber-400',
    bgTintClass: 'bg-amber-500/5',
    borderClass: 'border-amber-500/25',
  },
  system_health: {
    label: 'صحة النظام',
    iconKey: 'server',
    accentClass: 'text-teal-400',
    bgTintClass: 'bg-teal-500/5',
    borderClass: 'border-teal-500/25',
  },
  approval_required: {
    label: 'اعتماد مطلوب',
    iconKey: 'stamp',
    accentClass: 'text-sky-400',
    bgTintClass: 'bg-sky-500/5',
    borderClass: 'border-sky-500/25',
  },
  deadline_risk: {
    label: 'خطر موعد نهائي',
    iconKey: 'hourglass',
    accentClass: 'text-amber-400',
    bgTintClass: 'bg-amber-500/5',
    borderClass: 'border-amber-500/25',
  },
  sla_breach: {
    label: 'تجاوز SLA',
    iconKey: 'timer',
    accentClass: 'text-red-400',
    bgTintClass: 'bg-red-500/5',
    borderClass: 'border-red-500/30',
  },
} as const;

/** Icon lookup for decision types — resolves iconKey to a Lucide component. */
const TYPE_ICON_MAP: Record<string, FC<{ className?: string }>> = {
  siren: Siren,
  'user-check': UserCheck,
  search: Search,
  clock: Clock,
  'shield-alert': ShieldAlert,
  'message-warning': MessageSquareWarning,
  banknote: Banknote,
  shield: Shield,
  user: User,
  crown: Crown,
  gavel: Gavel,
  graduation: GraduationCap,
  repeat: Repeat,
  server: Server,
  stamp: Stamp,
  hourglass: Hourglass,
  timer: Timer,
};

/** Module icon map — shared across all decision components. */
export const MODULE_ICON_MAP: Record<SourceModule, FC<{ className?: string }>> = {
  attendance: Clock,
  biometric: Fingerprint,
  capa: ShieldAlert,
  complaints: AlertTriangle,
  quality: Search,
  hrDeductions: Banknote,
  travel: Plane,
  followUps: Bell,
  notifications: Bell,
  riskCenter: ShieldAlert,
  employee360: User,
  requests: FileText,
  rulesEngine: Zap,
} as const;

/** Module Arabic labels for display. */
export const MODULE_LABEL_MAP: Record<SourceModule, string> = {
  attendance: 'الحضور',
  biometric: 'البصمة',
  capa: 'كابا',
  complaints: 'الشكاوى',
  quality: 'الجودة',
  hrDeductions: 'الخصومات',
  travel: 'السفر',
  followUps: 'المتابعات',
  notifications: 'الإشعارات',
  riskCenter: 'المخاطر',
  employee360: 'الموظف 360',
  requests: 'الطلبات',
  rulesEngine: 'الأتمتة',
} as const;

/** Status lifecycle visual config. */
interface StatusVisual {
  label: string;
  colorClass: string;
  bgClass: string;
}

export const STATUS_VISUAL: Record<DecisionStatus, StatusVisual> = {
  new: {
    label: 'جديد',
    colorClass: 'text-blue-400',
    bgClass: 'bg-blue-500/20 border-blue-500/30',
  },
  acknowledged: {
    label: 'تمت المراجعة',
    colorClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/20 border-cyan-500/30',
  },
  assigned: {
    label: 'معيّن',
    colorClass: 'text-violet-400',
    bgClass: 'bg-violet-500/20 border-violet-500/30',
  },
  in_progress: {
    label: 'قيد التنفيذ',
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/20 border-amber-500/30',
  },
  waiting: {
    label: 'بانتظار',
    colorClass: 'text-orange-400',
    bgClass: 'bg-orange-500/20 border-orange-500/30',
  },
  escalated: {
    label: 'مصعّد',
    colorClass: 'text-red-400',
    bgClass: 'bg-red-500/20 border-red-500/30',
  },
  resolved: {
    label: 'محلول',
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/20 border-emerald-500/30',
  },
  dismissed: {
    label: 'مستبعد',
    colorClass: 'text-slate-400',
    bgClass: 'bg-slate-600/20 border-slate-600/30',
  },
  archived: {
    label: 'مؤرشف',
    colorClass: 'text-slate-500',
    bgClass: 'bg-slate-700/20 border-slate-600/30',
  },
} as const;

/** Group key labels and icon keys. */
interface GroupKeyVisual {
  label: string;
  iconKey: string;
}

export const GROUP_KEY_VISUAL: Record<DecisionGroupKey, GroupKeyVisual> = {
  priority: { label: 'الأولوية', iconKey: 'target' },
  department: { label: 'القسم', iconKey: 'building' },
  employee: { label: 'الموظف', iconKey: 'user' },
  manager: { label: 'المدير', iconKey: 'user-cog' },
  module: { label: 'الوحدة', iconKey: 'grid' },
  status: { label: 'الحالة', iconKey: 'flag' },
  none: { label: 'الكل', iconKey: 'inbox' },
} as const;

/** Urgency level color config. */
interface UrgencyVisual {
  label: string;
  colorClass: string;
  bgClass: string;
  ringClass: string;
}

const URGENCY_VISUAL: Record<UrgencyLevel, UrgencyVisual> = {
  critical: {
    label: 'حرج',
    colorClass: 'text-red-400',
    bgClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    ringClass: '#ef4444',
  },
  high: {
    label: 'عالي',
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    ringClass: '#f59e0b',
  },
  medium: {
    label: 'متوسط',
    colorClass: 'text-blue-400',
    bgClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    ringClass: '#3b82f6',
  },
  low: {
    label: 'منخفض',
    colorClass: 'text-slate-400',
    bgClass: 'bg-slate-600/20 text-slate-400 border-slate-500/30',
    ringClass: '#64748b',
  },
} as const;

/** Business impact color config. */
interface ImpactVisual {
  label: string;
  colorClass: string;
  fill: number; // 0-100 meter fill
}

const IMPACT_VISUAL: Record<BusinessImpact, ImpactVisual> = {
  severe: { label: 'حرج', colorClass: 'text-red-400', fill: 100 },
  high: { label: 'عالي', colorClass: 'text-orange-400', fill: 78 },
  moderate: { label: 'متوسط', colorClass: 'text-amber-400', fill: 52 },
  low: { label: 'منخفض', colorClass: 'text-slate-400', fill: 28 },
  minimal: { label: 'ضئيل', colorClass: 'text-slate-500', fill: 10 },
} as const;

/** Confidence grade thresholds. */
const CONFIDENCE_GRADES: Record<string, { label: string; colorClass: string }> = {
  high: { label: 'ثقة عالية', colorClass: 'text-emerald-400' },
  medium: { label: 'ثقة متوسطة', colorClass: 'text-amber-400' },
  low: { label: 'ثقة منخفضة', colorClass: 'text-red-400' },
};

/** Coaching category visual config. */
export const COACHING_CATEGORY_VISUAL: Record<CoachingCategory, { label: string; colorClass: string; iconKey: string }> = {
  attendance: { label: 'توجيه حضور', colorClass: 'text-amber-400', iconKey: 'clock' },
  quality_decline: { label: 'تدهور جودة', colorClass: 'text-emerald-400', iconKey: 'search' },
  complaint_increase: { label: 'زيادة شكاوى', colorClass: 'text-orange-400', iconKey: 'message-warning' },
  performance_drop: { label: 'انخفاض أداء', colorClass: 'text-red-400', iconKey: 'trending-down' },
  training_recommendation: { label: 'توصية تدريب', colorClass: 'text-cyan-400', iconKey: 'graduation' },
} as const;

/** Predictive alert type visual config. */
export const PREDICTIVE_TYPE_VISUAL: Record<PredictiveAlertType, { label: string; colorClass: string; iconKey: string }> = {
  likely_sla_breach: { label: 'تجاوز SLA محتمل', colorClass: 'text-red-400', iconKey: 'timer' },
  likely_complaint_escalation: { label: 'تصعيد شكوى محتمل', colorClass: 'text-orange-400', iconKey: 'message-warning' },
  likely_capa_overdue: { label: 'كابا متأخرة محتملة', colorClass: 'text-purple-400', iconKey: 'shield-alert' },
  likely_attendance_issue: { label: 'مشكلة حضور محتملة', colorClass: 'text-amber-400', iconKey: 'clock' },
  likely_burnout: { label: 'احتراق وظيفي محتمل', colorClass: 'text-red-400', iconKey: 'flame' },
  likely_department_decline: { label: 'تدهور قسم محتمل', colorClass: 'text-indigo-400', iconKey: 'building' },
} as const;

// ═══════════════════════════════════════════════════════════════
//  PART 2: Pure helper functions
// ═══════════════════════════════════════════════════════════════

/** Get Arabic label for a decision type. */
export function getDecisionTypeLabel(type: DecisionType): string {
  return DECISION_TYPE_VISUALS[type]?.label ?? type;
}

/** Get the Lucide icon component for a decision type's iconKey. */
export function getDecisionTypeIcon(type: DecisionType): FC<{ className?: string }> {
  const iconKey = DECISION_TYPE_VISUALS[type]?.iconKey ?? 'alert-circle';
  return TYPE_ICON_MAP[iconKey] ?? AlertCircle;
}

/** Get color classes for a decision type. */
export function getDecisionTypeVisual(type: DecisionType): TypeVisual {
  return DECISION_TYPE_VISUALS[type] ?? DECISION_TYPE_VISUALS.manager_review;
}

/** Get Arabic label for a source module. */
export function getModuleLabel(module: SourceModule): string {
  return MODULE_LABEL_MAP[module] ?? module;
}

/** Get the Lucide icon component for a source module. */
export function getModuleIcon(module: SourceModule): FC<{ className?: string }> {
  return MODULE_ICON_MAP[module] ?? Activity;
}

/** Get Arabic label for a status. */
export function getStatusLabel(status: DecisionStatus): string {
  return STATUS_VISUAL[status]?.label ?? status;
}

/** Get color classes for an urgency level. */
export function getUrgencyVisual(level: UrgencyLevel): UrgencyVisual {
  return URGENCY_VISUAL[level] ?? URGENCY_VISUAL.low;
}

/** Get visual config for a business impact. */
export function getImpactVisual(level: BusinessImpact): ImpactVisual {
  return IMPACT_VISUAL[level] ?? IMPACT_VISUAL.low;
}

/** Get confidence grade from 0-100 score. */
export function getConfidenceGrade(score: number): { label: string; colorClass: string } {
  if (score >= 75) return CONFIDENCE_GRADES.high;
  if (score >= 45) return CONFIDENCE_GRADES.medium;
  return CONFIDENCE_GRADES.low;
}

/** Map a PriorityLevel to an icon component. */
const PRIORITY_ICON_MAP: Record<PriorityLevel, FC<{ className?: string }>> = {
  critical: AlertOctagon,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Activity,
};

export function getPriorityIcon(level: PriorityLevel): FC<{ className?: string }> {
  return PRIORITY_ICON_MAP[level] ?? Activity;
}

/** Format a score (0-100) for display — whole number. */
export function formatScore(score: number): string {
  return `${Math.round(score)}`;
}

/** Get signal icon based on probability. */
export function getSignalIcon(probability: number): FC<{ className?: string }> {
  if (probability >= 75) return SignalHigh;
  if (probability >= 50) return SignalMedium;
  return SignalLow;
}

// ═══════════════════════════════════════════════════════════════
//  PART 3: Shared UI Components (all memoized)
// ═══════════════════════════════════════════════════════════════

/* ────────────────────────────────────────────────────────────────
   PriorityBadge
   Mirrors the AOCC pattern: small Badge using getPriorityVisual.
   Re-exported here so all decision widgets use the same component.
   ──────────────────────────────────────────────────────────────── */

export const PriorityBadge = memo(function PriorityBadge({ level }: { level: PriorityLevel }) {
  const visual = getPriorityVisual(level);
  return (
    <Badge className={cn('text-[10px] px-2 py-0.5 border shrink-0', visual.badge)}>
      {visual.label}
    </Badge>
  );
});

/* ────────────────────────────────────────────────────────────────
   UrgencyBadge
   Small colored Badge for urgency level.
   ──────────────────────────────────────────────────────────────── */

export const UrgencyBadge = memo(function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  const v = URGENCY_VISUAL[level] ?? URGENCY_VISUAL.low;
  return (
    <Badge className={cn('text-[9px] px-1.5 py-0 border', v.bgClass)}>
      {v.label}
    </Badge>
  );
});

/* ────────────────────────────────────────────────────────────────
   StatusBadge
   Lifecycle state badge — shows Arabic label with lifecycle color.
   ──────────────────────────────────────────────────────────────── */

export const StatusBadge = memo(function StatusBadge({ status }: { status: DecisionStatus }) {
  const v = STATUS_VISUAL[status] ?? STATUS_VISUAL.new;
  return (
    <Badge className={cn('text-[9px] px-1.5 py-0 border', v.bgClass)}>
      {v.label}
    </Badge>
  );
});

/* ────────────────────────────────────────────────────────────────
   DecisionTypeBadge
   Shows icon + Arabic label for the decision type.
   ──────────────────────────────────────────────────────────────── */

export const DecisionTypeBadge = memo(function DecisionTypeBadge({
  type,
  size = 'sm',
}: {
  type: DecisionType;
  size?: 'xs' | 'sm';
}) {
  const visual = DECISION_TYPE_VISUALS[type] ?? DECISION_TYPE_VISUALS.manager_review;
  const Icon = TYPE_ICON_MAP[visual.iconKey] ?? AlertCircle;
  const sizeClass = size === 'xs' ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5';

  return (
    <Badge
      className={cn(
        'border gap-1 shrink-0',
        sizeClass,
        visual.bgTintClass,
        visual.borderClass,
        visual.accentClass
      )}
    >
      <Icon className={cn('shrink-0', size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
      {visual.label}
    </Badge>
  );
});

/* ────────────────────────────────────────────────────────────────
   ModuleBadge
   Small pill showing a source module icon + Arabic label.
   ──────────────────────────────────────────────────────────────── */

export const ModuleBadge = memo(function ModuleBadge({
  module,
  size = 'sm',
}: {
  module: SourceModule;
  size?: 'xs' | 'sm';
}) {
  const Icon = MODULE_ICON_MAP[module] ?? Activity;
  const sizeClass = size === 'xs' ? 'text-[9px] px-1 py-0 gap-0.5' : 'text-[10px] px-1.5 py-0 gap-1';
  return (
    <Badge className={cn('border border-slate-600/30 bg-slate-700/30 text-slate-300', sizeClass)}>
      <Icon className={cn('shrink-0', size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
      {MODULE_LABEL_MAP[module] ?? module}
    </Badge>
  );
});

/* ────────────────────────────────────────────────────────────────
   UrgencyRing
   Animated SVG circular progress ring showing urgency level.
   Size variants: sm (24px), md (32px), lg (48px).
   Fills clockwise from the top. Ring color matches urgency level.
   ──────────────────────────────────────────────────────────────── */

export const UrgencyRing = memo(function UrgencyRing({
  level,
  size = 'md',
  showLabel = true,
  className,
}: {
  level: UrgencyLevel;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}) {
  const v = URGENCY_VISUAL[level] ?? URGENCY_VISUAL.low;

  const sizeMap = { sm: 24, md: 32, lg: 48 };
  const dim = sizeMap[size];
  const r = (dim - 4) / 2;
  const cx = dim / 2;
  const cy = dim / 2;
  const circumference = 2 * Math.PI * r;

  // Urgency level maps to fill percentage
  const fillPercent: Record<UrgencyLevel, number> = {
    critical: 100,
    high: 72,
    medium: 45,
    low: 18,
  };
  const pct = fillPercent[level] ?? 18;
  const dashOffset = circumference - (pct / 100) * circumference;

  // Pulsing animation class for critical
  const pulseClass = level === 'critical' ? 'animate-pulse' : '';

  const labelSizes: Record<string, string> = { sm: 'text-[7px]', md: 'text-[9px]', lg: 'text-[11px]' };
  const iconSizes: Record<string, string> = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-3 h-3' };

  return (
    <div className={cn('relative inline-flex items-center justify-center shrink-0', className)}>
      <svg
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        className={cn('transform -rotate-90', pulseClass)}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-slate-700"
        />
        {/* Fill */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={v.ringClass}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      {showLabel && (
        <div className={cn('absolute inset-0 flex flex-col items-center justify-center', pulseClass)}>
          <div className={cn(v.colorClass, iconSizes[size])}>
            <UrgencyLevelDot level={level} />
          </div>
          <span className={cn('font-medium leading-none', v.colorClass, labelSizes[size])}>
            {v.label}
          </span>
        </div>
      )}
    </div>
  );
});

/** Small dot indicator used inside UrgencyRing center. */
function UrgencyLevelDot({ level }: { level: UrgencyLevel }) {
  const v = URGENCY_VISUAL[level] ?? URGENCY_VISUAL.low;
  return <span className={cn('block w-1.5 h-1.5 rounded-full', v.ringClass.replace('#', 'bg-'))} />;
}

/* ────────────────────────────────────────────────────────────────
   ConfidenceMeter
   Compact horizontal bar showing confidence 0-100 with grade label.
   Color shifts: green (≥75), amber (45-74), red (<45).
   ──────────────────────────────────────────────────────────────── */

export const ConfidenceMeter = memo(function ConfidenceMeter({
  score,
  showLabel = true,
  className,
}: {
  score: number;
  showLabel?: boolean;
  className?: string;
}) {
  const grade = getConfidenceGrade(score);
  const colorClass = score >= 75
    ? 'bg-emerald-500'
    : score >= 45
    ? 'bg-amber-500'
    : 'bg-red-500';

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {showLabel && (
        <span className={cn('text-[9px] font-medium shrink-0', grade.colorClass)}>
          {Math.round(score)}%
        </span>
      )}
      <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colorClass)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn('text-[8px] shrink-0', grade.colorClass)}>
        {grade.label}
      </span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ImpactMeter
   Full-width progress bar showing business impact fill (0-100).
   Label shows the Arabic impact level.
   ──────────────────────────────────────────────────────────────── */

export const ImpactMeter = memo(function ImpactMeter({
  impact,
  className,
}: {
  impact: BusinessImpact;
  className?: string;
}) {
  const v = IMPACT_VISUAL[impact] ?? IMPACT_VISUAL.low;

  const colorClass =
    impact === 'severe'
      ? 'bg-red-500'
      : impact === 'high'
      ? 'bg-orange-500'
      : impact === 'moderate'
      ? 'bg-amber-500'
      : 'bg-slate-500';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className={cn('text-[9px] font-medium', v.colorClass)}>
          {v.label}
        </span>
        <span className={cn('text-[9px] text-slate-400')}>
          {v.fill}%
        </span>
      </div>
      <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colorClass)}
          style={{ width: `${v.fill}%` }}
        />
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ScoreBadge
   Large composite score display (0-100) in a colored pill.
   Shows score number + overall label.
   ──────────────────────────────────────────────────────────────── */

export const ScoreBadge = memo(function ScoreBadge({
  score,
  size = 'md',
  className,
}: {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const level: PriorityLevel =
    score >= 70 ? 'critical' :
    score >= 40 ? 'high' :
    score >= 20 ? 'medium' : 'low';

  const visual = getPriorityVisual(level);

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-[11px] px-2 py-0.5 gap-1.5',
    lg: 'text-sm px-3 py-1 gap-2',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  const Icon = PRIORITY_ICON_MAP[level] ?? Activity;

  return (
    <div className={cn('flex items-center rounded-md font-medium border', sizeClasses[size], visual.bgTint, visual.border, visual.accent, className)}>
      <Icon className={iconSizes[size]} />
      <span>{Math.round(score)}</span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   EvidenceItem
   A single evidence line: module icon + statement + optional metric.
   Used inside DecisionDetailDialog and DecisionCard explanation.
   ──────────────────────────────────────────────────────────────── */

export const EvidenceItem = memo(function EvidenceItem({
  evidence,
  className,
}: {
  evidence: DecisionEvidence;
  className?: string;
}) {
  const Icon = MODULE_ICON_MAP[evidence.module] ?? Activity;

  return (
    <div className={cn('flex items-start gap-2 py-1', className)}>
      <div className="mt-0.5 shrink-0 text-slate-400">
        <Icon className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] text-slate-300 leading-relaxed">
          {evidence.statement}
        </span>
        {evidence.metric && (
          <span className="mr-1 text-[10px] text-slate-500 font-mono">
            ({evidence.metric})
          </span>
        )}
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ActionButton
   A single next-best-action button. Each action kind maps to icon
   and behavior hints. The parent is responsible for the onClick handler.
   ──────────────────────────────────────────────────────────────── */

export const ActionButton = memo(function ActionButton({
  action,
  compact = false,
  className,
  onClick,
}: {
  action: NextBestAction;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  const actionIconMap: Record<NextBestAction['kind'], FC<{ className?: string }>> = {
    navigate: ExternalLink,
    employee: User,
    create_capa: ShieldAlert,
    create_fu: Plus,
    notify: Bell,
    dialog: FileText,
  };

  const actionColorMap: Record<NextBestAction['kind'], string> = {
    navigate: 'text-sky-400 hover:text-sky-300',
    employee: 'text-violet-400 hover:text-violet-300',
    create_capa: 'text-purple-400 hover:text-purple-300',
    create_fu: 'text-emerald-400 hover:text-emerald-300',
    notify: 'text-amber-400 hover:text-amber-300',
    dialog: 'text-cyan-400 hover:text-cyan-300',
  };

  const Icon = actionIconMap[action.kind] ?? FileText;
  const colorClass = actionColorMap[action.kind] ?? 'text-slate-400';

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md border border-slate-700/50 bg-slate-800/40',
        'hover:bg-slate-700/50 hover:border-slate-600 cursor-pointer',
        'transition-all duration-150 group',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
        className
      )}
    >
      <div className={cn('shrink-0 transition-colors', colorClass)}>
        <Icon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn('font-medium truncate', compact ? 'text-[11px]' : 'text-xs')}>
          {action.label}
        </div>
        {!compact && (
          <div className="text-[9px] text-slate-500 leading-tight mt-0.5">
            {action.description}
          </div>
        )}
      </div>
      <div className="text-slate-600 group-hover:text-slate-400 transition-colors">
        <ArrowRight className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ScoreBreakdown
   Expandable 9-component score display showing the individual
   scoring dimensions. Used inside DecisionDetailDialog.
   ──────────────────────────────────────────────────────────────── */

export const ScoreBreakdown = memo(function ScoreBreakdown({
  score,
  className,
}: {
  score: DecisionScore;
  className?: string;
}) {
  const components = [
    { key: 'priority', label: 'الأولوية', value: score.priority },
    { key: 'businessImpact', label: 'التأثير', value: score.businessImpact },
    { key: 'urgency', label: 'الإلحاح', value: score.urgency },
    { key: 'confidence', label: 'الثقة', value: score.confidence },
    { key: 'risk', label: 'المخاطر', value: score.risk },
    { key: 'employeeImpact', label: 'تأثير الموظف', value: score.employeeImpact },
    { key: 'departmentImpact', label: 'تأثير القسم', value: score.departmentImpact },
    { key: 'slaImpact', label: 'تأثير SLA', value: score.slaImpact },
  ];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* Overall score */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-300 font-medium">النتيجة الإجمالية</span>
        <ScoreBadge score={score.overall} size="md" />
      </div>
      <Separator className="bg-slate-700/50" />
      {/* Component bars */}
      {components.map(({ key, label, value }) => {
        const colorClass =
          value >= 75 ? 'bg-emerald-500' :
          value >= 45 ? 'bg-amber-500' :
          'bg-slate-500';
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-20 text-[9px] text-slate-400 shrink-0 text-left">
              {label}
            </span>
            <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', colorClass)}
                style={{ width: `${value}%` }}
              />
            </div>
            <span className="w-7 text-[9px] text-slate-400 text-left font-mono">
              {Math.round(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ModuleBadgeList
   Renders a row of ModuleBadge for the affected modules array.
   Wraps on overflow. Used inside DecisionCard and DecisionDetailDialog.
   ──────────────────────────────────────────────────────────────── */

export const ModuleBadgeList = memo(function ModuleBadgeList({
  modules,
  className,
}: {
  modules: SourceModule[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {modules.map((module) => (
        <ModuleBadge key={module} module={module} size="xs" />
      ))}
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   SignalIndicator
   Small signal bars icon for predictive alerts — shows probability
   level visually (1-3 bars).
   ──────────────────────────────────────────────────────────────── */

export const SignalIndicator = memo(function SignalIndicator({
  probability,
  className,
}: {
  probability: number;
  className?: string;
}) {
  const bars = probability >= 75 ? 3 : probability >= 50 ? 2 : 1;
  const colorClass =
    bars === 3 ? 'text-red-400' :
    bars === 2 ? 'text-amber-400' :
    'text-slate-400';

  return (
    <div className={cn('flex items-end gap-0.5 shrink-0', colorClass, className)}>
      <span className={cn('block w-1 rounded-sm', bars >= 1 ? 'h-2 bg-current' : 'h-1 bg-slate-700')} />
      <span className={cn('block w-1 rounded-sm', bars >= 2 ? 'h-3 bg-current' : 'h-2 bg-slate-700')} />
      <span className={cn('block w-1 rounded-sm', bars >= 3 ? 'h-4 bg-current' : 'h-3 bg-slate-700')} />
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   DueDateLabel
   Renders due date with color coding for overdue/soon/today.
   Shows "today", "overdue", or formatted date.
   ──────────────────────────────────────────────────────────────── */

export const DueDateLabel = memo(function DueDateLabel({
  dueDate,
  className,
}: {
  dueDate: string | null;
  className?: string;
}) {
  if (!dueDate) return null;

  const now = new Date();
  const due = new Date(dueDate);
  const isToday = due.toDateString() === now.toDateString();
  const isOverdue = due < now;

  const colorClass = isOverdue
    ? 'text-red-400'
    : isToday
    ? 'text-amber-400'
    : 'text-slate-400';

  const label = isOverdue
    ? 'متأخر'
    : isToday
    ? 'اليوم'
    : due.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });

  return (
    <div className={cn('flex items-center gap-1', colorClass, className)}>
      <Hourglass className="w-3 h-3 shrink-0" />
      <span className="text-[10px]">{label}</span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   OwnerLabel
   Shows suggested owner with role icon.
   ──────────────────────────────────────────────────────────────── */

export const OwnerLabel = memo(function OwnerLabel({
  owner,
  ownerType,
  className,
}: {
  owner: string | null;
  ownerType: DecisionStatus extends never ? never : 'employee' | 'manager' | 'department' | 'executive' | 'unassigned';
  className?: string;
}) {
  if (!owner) return null;

  const iconMap: Record<string, FC<{ className?: string }>> = {
    employee: User,
    manager: UserCheck,
    department: Users,
    executive: Crown,
    unassigned: UserCog,
  };

  const Icon = iconMap[ownerType] ?? UserCog;

  return (
    <div className={cn('flex items-center gap-1 text-slate-400', className)}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="text-[10px] truncate">{owner}</span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   ResolutionEstimate
   Small chip showing estimated resolution time.
   ──────────────────────────────────────────────────────────────── */

export const ResolutionEstimate = memo(function ResolutionEstimate({
  estimate,
  className,
}: {
  estimate: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded',
        'bg-slate-700/50 text-slate-400 border border-slate-600/30',
        className
      )}
    >
      <Clock3 className="w-2.5 h-2.5 shrink-0" />
      {estimate}
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   EmptyDecisionsState
   Illustrated empty state for the inbox when no decisions match filters.
   ──────────────────────────────────────────────────────────────── */

export const EmptyDecisionsState = memo(function EmptyDecisionsState({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 gap-3', className)}>
      <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700/50 flex items-center justify-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
      </div>
      <div className="text-center">
        <p className="text-sm text-slate-400 font-medium">لا توجد قرارات</p>
        <p className="text-[11px] text-slate-500 mt-1">
          جميع القرارات تمت معالجتها أو لا توجد تطابقات مع الفلاتر
        </p>
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────
   DecisionCountSummary
   Compact row showing total/critical/high counts — for the inbox header.
   ──────────────────────────────────────────────────────────────── */

export const DecisionCountSummary = memo(function DecisionCountSummary({
  total,
  critical,
  high,
  className,
}: {
  total: number;
  critical: number;
  high: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 text-[11px]', className)}>
      <span className="text-slate-400">
        <span className="text-slate-200 font-medium">{total}</span>{' '}
        قرار
      </span>
      {critical > 0 && (
        <span className="text-red-400">
          <span className="font-medium">{critical}</span> حرج
        </span>
      )}
      {high > 0 && (
        <span className="text-amber-400">
          <span className="font-medium">{high}</span> عالي
        </span>
      )}
    </div>
  );
});