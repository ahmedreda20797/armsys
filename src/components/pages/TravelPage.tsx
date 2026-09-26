'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import { getDaysRemaining, todayDisplayDate } from '@/lib/date-utils';
import {
  getDepartureUrgency,
  getTravelPhase,
  isNearDeparture,
  type DepartureUrgency,
} from '@/lib/travel-status';
import { useTravel, useEmployees, useCreateTravel, useUpdateTravel, useDeleteTravel, useDashboardUsers } from '@/hooks/use-queries';
import { usePageState } from '@/hooks/use-page-state';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { AttentionPanel, type AttentionSeverity } from '@/components/shared/AttentionPanel';
import { ComplaintInlineForm } from '@/components/shared/inline-forms';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { SmartActionMenu, type SmartAction } from '@/components/shared/SmartActionMenu';
import type { OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  Plus,
  Pencil,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  X,
  Search,
  Upload,
  FileSpreadsheet,
  Check,
  Filter,
  Bell,
  BellRing,
  CalendarDays,
  Globe,
  Layers,
  ChevronDown,
  AlertTriangle,
  ArrowUpDown,
  Zap,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MessageSquareWarning,
} from 'lucide-react';
import type { TravelDeal, Employee, BookingItem, BookingServiceType } from '@/types';
// §BOOKING-ITEMS — canonical dynamic booking model + legacy normalization.
import {
  normalizeBookingItems,
  BOOKING_SERVICE_TYPES,
  BOOKING_TYPE_LABELS_AR,
  BOOKING_TYPE_ICONS,
  bookingItemNumber,
  newBookingItemId,
} from '@/lib/booking-items';
// §TRAVEL-FILTERS — the canonical trip-category rule (one implementation
// shared with the API route — never a page-private copy).
import { getTripCategory, resolveTravelNavLink, TRAVEL_STATUS_FILTERS, type TravelStatusFilter } from '@/lib/travel-filters';
// §DEAL-DATES — canonical date bases (أساس التاريخ) + basis month keys.
import {
  DEAL_DATE_BASES,
  DEAL_DATE_BASIS_LABELS_AR,
  getDealDateMonthKey,
  parseDealDateBasis,
  type DealDateBasis,
} from '@/lib/deal-dates';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { authFetch } from '@/lib/api-fetch';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatDateTime, formatInteger, formatMonthKey } from '@/lib/i18n/format';
// §DEAL-DATES — canonical deal date dimensions (closure display/filter).
import { getDealMonthKey } from '@/lib/deal-dates';

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface TravelWithEmployee extends TravelDeal {
  employeeName: string;
}

interface TravelFormData {
  employeeId: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  /** §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل (DD/MM/YYYY). */
  dealClosedAt: string;
  dealerName: string;
  customerNames: string;
  /** §BOOKING-ITEMS — canonical dynamic booking rows (replaces the six fixed selects). */
  bookingItems: BookingItem[];
  notes: string;
  status: string;
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const emptyForm: TravelFormData = {
  employeeId: '', destination: '', departureDate: '', returnDate: '',
  // §DEAL-DATES — the deal-closed date defaults to TODAY (the deal is
  // entered into Qnalys the day it is closed with the employee); the
  // user keeps full manual override for historical registration.
  dealClosedAt: todayDisplayDate(),
  dealerName: '', customerNames: '',
  bookingItems: [],
  notes: '', status: 'upcoming',
};

type CategoryTab = 'all' | 'upcoming' | 'in_progress' | 'returned' | 'canceled';
type UrgencyLevel = 'critical' | 'urgent' | 'soon' | 'normal';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const categoryConfig: Record<CategoryTab, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  badgeClass: string;
  emptyTitle: string;
  emptySubtitle: string;
}> = {
  all: {
    label: 'الكل', icon: Layers,
    activeClass: 'border-brand-500/40 bg-gradient-to-br from-brand-500/15 to-brand-500/5 text-brand-400 shadow-lg shadow-brand-500/5',
    badgeClass: 'bg-brand-500/25 text-brand-300',
    emptyTitle: 'لا توجد رحلات', emptySubtitle: 'أضف رحلات السفر الجديدة أو ارفع شيت حجوزات',
  },
  upcoming: {
    label: 'الرحلات القادمة', icon: Plane,
    activeClass: 'border-brand-500/30 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 text-brand-400 shadow-lg shadow-brand-500/20',
    badgeClass: 'bg-emerald-500/25 text-brand-300',
    emptyTitle: 'لا توجد رحلات قادمة', emptySubtitle: 'لا توجد رحلات مستقبلية مجدولة — الرحلات خلال 10 أيام تظهر بعلامة «قريب»',
  },
  in_progress: {
    label: 'في الرحلة', icon: Globe,
    activeClass: 'border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-500/5 text-amber-400 shadow-lg shadow-amber-500/5',
    badgeClass: 'bg-amber-500/25 text-amber-300',
    emptyTitle: 'لا توجد رحلات جارية حالياً', emptySubtitle: 'الرحلات الحالية ستظهر هنا أثناء السفر',
  },
  returned: {
    label: 'رجعوا', icon: CheckCircle2,
    activeClass: 'border-slate-500/30 bg-gradient-to-br from-slate-500/10 to-slate-500/5 text-slate-300 shadow-lg shadow-slate-500/5',
    badgeClass: 'bg-slate-500/20 text-slate-400',
    emptyTitle: 'لا توجد رحلات عائدة', emptySubtitle: 'الرحلات التي مر تاريخ عودتها ستظهر هنا',
  },
  canceled: {
    label: 'ملغاة', icon: XCircle,
    activeClass: 'border-red-500/40 bg-gradient-to-br from-red-500/15 to-red-500/5 text-red-400 shadow-lg shadow-red-500/5',
    badgeClass: 'bg-red-500/25 text-red-300',
    emptyTitle: 'لا توجد رحلات ملغاة', emptySubtitle: 'الرحلات الملغاة أو المتكنسلة ستظهر هنا',
  },
};

const statusConfig = [
  { key: 'upcoming', label: 'تعديل', activeClass: 'bg-blue-500/20 text-blue-400 ring-blue-500/40' },
  { key: 'in_progress', label: 'جاري', activeClass: 'bg-amber-500/20 text-amber-400 ring-amber-500/40' },
  { key: 'completed', label: 'مكتمل', activeClass: 'bg-green-500/20 text-green-400 ring-green-500/40' },
  { key: 'canceled', label: 'ملغي', activeClass: 'bg-red-500/20 text-red-400 ring-red-500/40' },
] as const;

// ═══════════════════════════════════════════════════════════════
//  PURE UTILITY FUNCTIONS (defined outside component — zero re-creation)
// ═══════════════════════════════════════════════════════════════

function getMonthLabelFromKey(key: string, locale?: Locale): string {
  // §I18N-BOUNDARY — month labels are app-generated display text, so the
  // canonical formatter renders them for the active locale; the «غير محدد»
  // sentinel is claimed UI (fallback alone passes through the claim).
  if (key === 'غير محدد') return translateUIText(key, locale);
  return formatMonthKey(key, locale);
}

// §TRAVEL-THRESHOLD — urgency derives from the ONE canonical rule
// (src/lib/travel-status.ts): عاجل ≤3, urgent ≤7, قريب window ≤10.
// The old local copy used a 14-day 'soon' window that overlapped the
// قريب label with trips 11-14 days out.
function getUrgencyLevel(daysLeft: number): UrgencyLevel {
  return getDepartureUrgency(daysLeft) as UrgencyLevel;
}

// Phase 6 §6 — return events get their own labels so the row
// does not mix "السفر اليوم" with "العودة اليوم" (the prior
// implementation derived urgency from departureDate only — return
// days never surfaced, so a trip returning in 2 days looked fine
// while the person had already left). The `urgentType` flag from
// /api/travel decides the wording.
function getUrgencyLabel(daysLeft: number, urgentType: 'departure' | 'return' = 'departure', locale?: Locale): string {
  const today = urgentType === 'return' ? 'العودة اليوم!' : 'السفر اليوم!';
  const tomorrow = urgentType === 'return' ? 'العودة غداً' : 'السفر غداً';
  if (daysLeft === 0) return translateUIText(today, locale);
  if (daysLeft === 1) return translateUIText(tomorrow, locale);
  if (daysLeft === 2) return locale === 'en' ? 'in 2 days' : `بعد يومين`;
  if (daysLeft > 2 && daysLeft <= 7) return locale === 'en' ? `in ${formatInteger(daysLeft, locale)} days` : `بعد ${daysLeft} أيام`;
  if (daysLeft > 7) return locale === 'en' ? `in ${formatInteger(daysLeft, locale)} days` : `بعد ${daysLeft} يوم`;
  if (daysLeft === -1) return locale === 'en' ? '1 day ago!' : `منذ يوم!`;
  if (daysLeft === -2) return locale === 'en' ? '2 days ago' : `منذ يومين`;
  if (daysLeft >= -7) return locale === 'en' ? `${formatInteger(Math.abs(daysLeft), locale)} days ago` : `منذ ${Math.abs(daysLeft)} أيام`;
  return locale === 'en' ? `${formatInteger(Math.abs(daysLeft), locale)} days ago` : `منذ ${Math.abs(daysLeft)} يوم`;
}

// getTripCategory lives in §TRAVEL-FILTERS (src/lib/travel-filters.ts) —
// the ONE canonical implementation shared with the API route.

// §TRAVEL-THRESHOLD — the per-trip STATUS LABEL rule: "قريب" ONLY when
// departure is within the 10-day window; anything further out is
// "مجدولة" (scheduled). Return state is untouched (separate concept).
function getProximityLabel(category: 'upcoming' | 'in_progress' | 'returned', daysLeft: number): 'near' | 'scheduled' | 'in_progress' | 'returned' {
  if (category === 'returned') return 'returned';
  if (category === 'in_progress') return 'in_progress';
  return isNearDeparture(daysLeft) ? 'near' : 'scheduled';
}

// ═══════════════════════════════════════════════════════════════
//  HOOKS
// ═══════════════════════════════════════════════════════════════

/** Simple debounce hook — avoids re-filtering on every keystroke */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════
//  MEMOIZED SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

/** Stable status badge — no re-render unless status changes */
const StatusBadge = memo(function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'upcoming': return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20"><T>قادمة</T></Badge>;
    case 'in_progress': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20"><T>جاري</T></Badge>;
    case 'completed': return <Badge className="bg-green-500/15 text-green-400 border-green-500/20"><T>مكتمل</T></Badge>;
    case 'canceled': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20"><T>ملغي</T></Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
});

/** Stable category badge — §TRAVEL-THRESHOLD: "قريب" ONLY inside the
    10-day window; a further-out future trip is "مجدولة" (scheduled). */
const CategoryBadge = memo(function CategoryBadge({ category, daysLeft }: { category: 'upcoming' | 'in_progress' | 'returned'; daysLeft?: number }) {
  if (category === 'in_progress') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">🌍 <T>في الرحلة</T></span>;
  if (category === 'returned') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 font-medium">✅ <T>رجع</T></span>;
  if (daysLeft !== undefined && !isNearDeparture(daysLeft)) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 font-medium">📅 <T>مجدولة</T></span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500/15 text-brand-400 font-medium">✈ <T>قريب</T></span>;
});

/** §BOOKING-ITEMS — the compact dynamic services/bookings section
    ("الخدمات والحجوزات"). Each booking is an INDEPENDENT row with its
    own id, type, per-type number and status — repeated types are
    first-class (طيران دولي 1 / طيران دولي 2 …). Legacy deals render
    through read-time normalization of the fixed fields (non-destructive).
    Clicking a row (authorized editors) cycles THAT item's status only —
    item #2 never touches item #1, and the deal-level status is a
    separate concept entirely. */
const BookingItemsSection = memo(function BookingItemsSection({
  trip, canEdit, onToggleItem,
}: {
  trip: TravelWithEmployee; canEdit: boolean;
  onToggleItem: (tripId: string, itemId: string) => void;
}) {
  const { locale } = useLanguage();
  const items = useMemo(() => normalizeBookingItems(trip), [trip]);
  if (items.length === 0) return null;

  const statusBadge = (status: string) => {    if (status === 'booked') return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300"><T>مكتمل</T></span>;
    if (status === 'pending') return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300"><T>معلق</T></span>;
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-300"><T>غير موجود</T></span>;
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2 font-medium"><T>الخدمات والحجوزات</T></p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const titleText = !canEdit ? undefined
            : item.status === 'booked' ? translateUIText('تحويل إلى معلق', locale) : translateUIText('تحويل إلى مكتمل', locale);
          const row = (
            <>
              <span aria-hidden="true">{BOOKING_TYPE_ICONS[item.type]}</span>
              <span>{translateUIText(BOOKING_TYPE_LABELS_AR[item.type], locale)} {formatInteger(bookingItemNumber(items, item.id), locale)}</span>
              {item.status === 'booked' ? <CheckCircle2 className="size-3.5" /> : item.status === 'pending' ? <Clock className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {statusBadge(item.status)}
            </>
          );
          const rowClass = item.status === 'booked'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            : item.status === 'pending'
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
          if (!canEdit) {
            return (
              <div key={item.id} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ${rowClass}`}>
                {row}
              </div>
            );
          }
          return (
            <button
              key={item.id}
              onClick={() => onToggleItem(trip.id, item.id)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer select-none hover:opacity-80 ${rowClass}`}
              title={titleText}
            >
              {row}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/** Quick status buttons */
const QuickStatusBtns = memo(function QuickStatusBtns({
  trip, onStatusChange,
}: {
  trip: TravelWithEmployee; onStatusChange: (tripId: string, status: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {statusConfig.map((s) => {
        if (trip.status === s.key) {
          return <span key={s.key} className={`text-[10px] px-2 py-0.5 rounded-full ring-1 font-medium ${s.activeClass}`}><T>{s.label}</T></span>;
        }
        return (
          <button key={s.key} onClick={() => onStatusChange(trip.id, s.key)}
            className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/30 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer">
            <T>{s.label}</T>
          </button>
        );
      })}
    </div>
  );
});

// ─── TripCard Props ───
interface TripCardProps {
  trip: TravelWithEmployee;
  showCategoryBadge: boolean;
  isHighlighted: boolean;
  isExpanded: boolean;
  canEdit: boolean;
  /** §PART 11 — complaints:create (the permission the complaints API enforces). */
  canComplaint: boolean;
  highlightRef: React.RefObject<HTMLDivElement | null>;
  onToggleExpand: (id: string | null) => void;
  onEdit: (trip: TravelWithEmployee) => void;
  onDelete: (id: string) => void;
  onQuickChangeStatus: (tripId: string, status: string) => void;
  /** §BOOKING-ITEMS — cycle ONE booking item's status (per-item independence). */
  onQuickToggleItem: (tripId: string, itemId: string) => void;
  /** Milestone 7 §7: report a complaint/problem from this deal. */
  onReportComplaint: (trip: TravelWithEmployee) => void;
}

/** THE KEY OPTIMIZATION: React.memo trip card — only re-renders when its own data changes */
const TripCard = memo(function TripCard({
  trip, showCategoryBadge, isHighlighted, isExpanded, canEdit, canComplaint, highlightRef,
  onToggleExpand, onEdit, onDelete, onQuickChangeStatus, onQuickToggleItem,
  onReportComplaint,
}: TripCardProps) {
  const { locale } = useLanguage();
  const daysLeft = useMemo(() => getDaysRemaining(trip.departureDate), [trip.departureDate]);
  const retDays = useMemo(() => trip.returnDate ? getDaysRemaining(trip.returnDate) : null, [trip.returnDate]);
  const category = useMemo(() => getTripCategory(trip.departureDate, trip.returnDate), [trip.departureDate, trip.returnDate]);
  const urgency = useMemo(() => getUrgencyLevel(daysLeft), [daysLeft]);

  const cardBorderClass = category === 'in_progress'
    ? 'border-amber-500/40'
    : category === 'returned'
      ? 'border-slate-700/40'
      : urgency === 'critical' ? 'border-red-500/50'
        : urgency === 'urgent' ? 'border-amber-500/40'
          : urgency === 'soon' ? 'border-yellow-500/30' : 'border-slate-700/50';

  const countdownInfo = (() => {
    if (category === 'in_progress' && retDays !== null) {
      return { value: retDays, label: 'للعودة', color: retDays <= 2 ? 'text-red-400' : retDays <= 5 ? 'text-amber-400' : 'text-white' };
    }
    if (category === 'returned') {
      return { value: Math.abs(retDays || daysLeft), label: 'منذ يوم', color: 'text-slate-400' };
    }
    return {
      value: daysLeft, label: 'يوم',
      color: urgency === 'critical' ? 'text-red-400' : urgency === 'urgent' ? 'text-amber-400' : urgency === 'soon' ? 'text-yellow-400' : 'text-white',
    };
  })();

  const avatarClass = category === 'in_progress'
    ? 'bg-amber-500/15 text-amber-400'
    : category === 'returned'
      ? 'bg-slate-600/20 text-slate-400'
      : urgency === 'critical' ? 'bg-red-500/15 text-red-400'
        : urgency === 'urgent' ? 'bg-amber-500/15 text-amber-400'
          : urgency === 'soon' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-cyan-500/15 text-cyan-400';

  const dealerName = trip.dealerName || '';
  const displayName = dealerName || trip.employeeName;
  const displayInitial = displayName.charAt(0);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(open) => onToggleExpand(open ? trip.id : null)}
      id={`trip-card-${trip.id}`}
      data-record-id={trip.id}
      ref={isHighlighted ? highlightRef : undefined}
    >
      <motion.div
        className={`relative rounded-xl border overflow-hidden transition-colors duration-300 ${cardBorderClass} bg-slate-800/30`}
        animate={isHighlighted ? {
          boxShadow: ['0 0 0 0 rgba(244, 63, 94, 0.5)', '0 0 24px 6px rgba(244, 63, 94, 0.3)', '0 0 0 0 rgba(244, 63, 94, 0)'],
        } : { boxShadow: '0 0 0 0 rgba(244, 63, 94, 0)' }}
        transition={isHighlighted ? { duration: 1, repeat: 2, repeatType: 'loop', ease: 'easeInOut' } : { duration: 0.3 }}
      >
        {/* ── COMPACT CARD HEADER ── */}
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between gap-3 p-3.5 cursor-pointer select-none transition-all duration-200 hover:bg-slate-800/40">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${avatarClass}`}>
                {displayInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {dealerName && <span className="text-cyan-400 text-[10px] shrink-0">👤</span>}
                  <span className="text-white font-semibold text-sm truncate">{displayName}</span>
                  <StatusBadge status={trip.status} />
                  {showCategoryBadge && <CategoryBadge category={category} daysLeft={daysLeft} />}
                  {category === 'in_progress' && (
                    <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 2, repeat: Infinity }}>
                      <span className="absolute inset-0 rounded-full bg-amber-500" />
                    </motion.span>
                  )}
                  {category === 'upcoming' && urgency === 'critical' && (
                    <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                      <span className="absolute inset-0 rounded-full bg-red-500" />
                    </motion.span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {dealerName && (
                    <span className="text-[11px] text-slate-500 truncate max-w-36">
                      <span className="text-emerald-500/70"><T>المسئول:</T></span> {trip.employeeName}
                    </span>
                  )}
                  <span className="text-sm text-slate-300">🌍 {trip.destination}</span>
                  {category === 'upcoming' && urgency !== 'normal' && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      urgency === 'critical' ? 'text-red-400 bg-red-500/15'
                        : urgency === 'urgent' ? 'text-amber-400 bg-amber-500/15' : 'text-yellow-400 bg-yellow-500/15'
                    }`}>
                      {getUrgencyLabel(daysLeft, 'departure', locale)}
                    </span>
                  )}
                  {category === 'in_progress' && retDays !== null && retDays >= 0 && (
                    <span className="text-[10px] font-medium text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full">
                      <T>العودة</T> {trip.returnDate}
                    </span>
                  )}
                  {!trip.returnDate && (
                    <span className="text-[10px] font-medium text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                      <AlertTriangle className="size-2.5" /> <T>بدون عودة</T>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="text-center min-w-12">
                <div className={`text-xl font-bold tabular-nums ${countdownInfo.color}`}>{formatInteger(countdownInfo.value, locale)}</div>
                <span className="text-slate-500 text-[10px]"><T>{countdownInfo.label}</T></span>
              </div>
              {/* §PART 11 — ONE ⋮ menu for the deal's secondary actions:
                  تعديل/حذف (travel:update) and تبليغ عن مشكلة/شكوى
                  (complaints:create). Actions the caller lacks are
                  hidden declaratively; the menu itself renders when at
                  least one action exists. Enforcement stays server-side. */}
              {(canEdit || canComplaint) && (
                <div onClick={(e) => e.stopPropagation()}>
                  <SmartActionMenu
                    actions={[
                      { key: 'complaint', label: translateUIText('تبليغ عن مشكلة / شكوى', locale), icon: <MessageSquareWarning className="size-3.5" />, hidden: !canComplaint, onSelect: () => onReportComplaint(trip) },
                      { key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, hidden: !canEdit, separatorBefore: !canComplaint, onSelect: () => onEdit(trip) },
                      { key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, hidden: !canEdit, destructive: true, separatorBefore: true, onSelect: () => onDelete(trip.id) },
                    ]}
                    label={translateUIText('إجراءات الرحلة', locale)}
                  />
                </div>
              )}
              <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-slate-500">
                <ChevronDown className="size-4" />
              </motion.div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* ── EXPANDED DETAILS ── */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-slate-700/20">
                <div className="p-4 space-y-4">
                  {/* Dates */}
                  <div className="flex flex-wrap gap-4 text-sm">
                    {/* §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل: the
                        business date the deal was closed with the employee
                        and entered into Qnalys. Distinct from the travel
                        date, the completion date and createdAt. */}
                    {trip.dealClosedAt ? (
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="text-xs">🤝</span>
                        <span className="text-slate-500"><T>تقفيل الديل:</T></span>
                        <span className="text-white font-medium" dir="ltr">{trip.dealClosedAt}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="text-xs">🤝</span>
                        <span className="text-slate-500"><T>تقفيل الديل:</T></span>
                        <span className="text-amber-400 text-xs font-medium"><T>غير مسجل (صفقة قديمة)</T></span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-slate-300">
                      <span className="text-xs">📅</span>
                      <span className="text-slate-500"><T>السفر:</T></span>
                      <span className="text-white font-medium" dir="ltr">{trip.departureDate}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 ${
                        daysLeft < 0 ? 'text-amber-400 border-amber-500/30' : 'text-cyan-400 border-cyan-500/30'
                      }`}>
                        {daysLeft < 0 ? <T>تم السفر</T> : <>{formatInteger(daysLeft, locale)} <T>يوم</T></>}
                      </Badge>
                    </div>
                    {trip.returnDate ? (
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="text-xs">↩️</span>
                        <span className="text-slate-500"><T>العودة:</T></span>
                        <span className="text-white font-medium" dir="ltr">{trip.returnDate}</span>
                        {retDays !== null && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${
                            retDays < 0 ? 'text-brand-400 border-brand-500/30' : 'text-cyan-400 border-cyan-500/30'
                          }`}>
                            {retDays < 0 ? <T>رجعوا</T> : <>{formatInteger(retDays, locale)} <T>يوم</T></>}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span className="text-xs font-medium"><T>تاريخ العودة غير محدد — يرجى إكمال البيانات</T></span>
                      </div>
                    )}
                    {/* §DEAL-DATES — the COMPLETION date is a SERVER-generated
                        ledger (closedAt = تاريخ اكتمال الديل/الرحلة, stamped by
                        the API on the completed transition). It is READ-ONLY
                        here: never a form field, never derived from other
                        dates, never confused with تاريخ تقفيل الديل.
                        Historical completed deals without closedAt remain
                        explicitly UNKNOWN — never assigned a fake month. */}
                    <div className="flex items-center gap-2 text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/20">
                      <span className="text-xs">🏁</span>
                      <span className="text-slate-500"><T>الاكتمال:</T></span>
                      {trip.status === 'completed' ? (
                        trip.closedAt ? (
                          <>
                            <span className="text-emerald-400 font-medium text-sm" dir="ltr">{formatDateTime(trip.closedAt, locale)}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 text-emerald-400 border-emerald-500/30">
                              {getMonthLabelFromKey(getDealMonthKey(trip, 'CLOSED') ?? '', locale)}
                            </Badge>
                          </>
                        ) : (
                          <span className="text-amber-400 text-xs font-medium">
                            <T>تاريخ الاكتمال غير معروف — سجل مكتمل أرشيفي (قبل التسجيل التلقائي)</T>
                          </span>
                        )
                      ) : (
                        <span className="text-slate-500 text-xs"><T>غير مكتمل — يُسجل تلقائياً من النظام عند الإكمال</T></span>
                      )}
                    </div>
                  </div>

                  {/* Dealer & Customers */}
                  {(trip.dealerName || trip.customerNames) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {trip.dealerName && (
                        <div className="flex items-center gap-2 text-sm bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/20">
                          <span className="text-cyan-400 text-xs">👤</span>
                          <span className="text-slate-500"><T>اسم الديل:</T></span>
                          <span className="text-white font-medium">{trip.dealerName}</span>
                        </div>
                      )}
                      {trip.customerNames && (
                        <div className="flex items-start gap-2 text-sm bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/20">
                          <span className="text-brand-400 text-xs shrink-0">👥</span>
                          <span className="text-slate-500 shrink-0"><T>المسافرين:</T></span>
                          <span className="text-white text-right">{trip.customerNames}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* §BOOKING-ITEMS — dynamic services/bookings (compact rows,
                      independent statuses, repeated types). Legacy deals render
                      through read-time normalization. */}
                  <BookingItemsSection trip={trip} canEdit={canEdit} onToggleItem={onQuickToggleItem} />

                  {/* Notes */}
                  {trip.notes && (
                    <div className="text-sm bg-slate-800/30 rounded-lg p-3 border border-slate-700/20">
                      <p className="text-slate-500 text-xs mb-2 px-1"><T>📝 ملاحظات</T></p>
                      <p className="text-slate-300 text-xs px-2" style={{ direction: 'rtl' }}>{trip.notes}</p>
                    </div>
                  )}

                  {/* Quick Status */}
                  {canEdit && (
                    <div>
                      <p className="text-xs text-slate-500 mb-2 font-medium"><T>تغيير الحالة</T></p>
                      <QuickStatusBtns trip={trip} onStatusChange={onQuickChangeStatus} />
                    </div>
                  )}
                  {/* §PART 11 — the complaint action moved into the card's
                      ⋮ menu (with complaints:create permission gating);
                      the standalone full-width button is gone. The menu
                      opens the SAME inline complaint panel below. */}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Collapsible>
  );
});

// ─── TripFormDialog ───
const TripFormDialog = memo(function TripFormDialog({
  title, open, onOpenChange, form, setForm, employees, saving, onSave, editingTrip,
}: {
  title: string; open: boolean; onOpenChange: (v: boolean) => void;
  form: TravelFormData; setForm: React.Dispatch<React.SetStateAction<TravelFormData>>;
  employees: Employee[]; saving: boolean; onSave: () => void;
  /** The stored deal when editing (drives the read-only completion info). */
  editingTrip: TravelWithEmployee | null;
}) {
  const { locale } = useLanguage();
  const updateForm = useCallback((field: keyof TravelFormData, value: string | boolean | BookingItem[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, [setForm]);

  const updateBookingItem = useCallback((itemId: string, patch: Partial<BookingItem>) => {
    setForm((prev) => ({
      ...prev,
      bookingItems: prev.bookingItems.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));
  }, [setForm]);

  const removeBookingItem = useCallback((itemId: string) => {
    setForm((prev) => ({
      ...prev,
      // re-sequence deterministically after removal (array order = display order)
      bookingItems: prev.bookingItems.filter((it) => it.id !== itemId).map((it, i) => ({ ...it, sequence: i + 1 })),
    }));
  }, [setForm]);

  const addBookingItem = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      bookingItems: [
        ...prev.bookingItems,
        { id: newBookingItemId(), type: 'international_flight' as BookingServiceType, sequence: prev.bookingItems.length + 1, label: null, status: 'pending' as const, details: null },
      ],
    }));
  }, [setForm]);

  const storedCompletion = editingTrip?.closedAt ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400"><T>أدخل تفاصيل رحلة السفر</T></DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <EmployeeSearchInput
              employees={employees}
              value={form.employeeId}
              onChange={(id) => updateForm('employeeId', id)}
              label={translateUIText('الموظف', locale)}
              placeholder={translateUIText('ابحث عن اسم الموظف...', locale)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>الوجهة</T></Label>
            <Input value={form.destination} onChange={(e) => updateForm('destination', e.target.value)} className="bg-slate-800 border-slate-600 text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>الحالة</T></Label>
            <Select value={form.status} onValueChange={(v) => updateForm('status', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming" className="text-white"><T>تعديل</T></SelectItem>
                <SelectItem value="in_progress" className="text-white"><T>جاري</T></SelectItem>
                <SelectItem value="completed" className="text-white"><T>مكتمل</T></SelectItem>
                <SelectItem value="canceled" className="text-white"><T>ملغي</T></SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل: the business
              date the deal was closed with the employee. Defaults to
              TODAY; editable (the business date of entry into Qnalys) —
              NOT تاريخ تسجيل الصفقة, NOT the travel/completion date. */}
          <div className="space-y-2">
            <Label className="text-slate-300"><T>تاريخ تقفيل الديل</T> <span className="text-red-400">*</span></Label>
            <Input
              value={form.dealClosedAt}
              onChange={(e) => updateForm('dealClosedAt', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="DD/MM/YYYY"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>تاريخ السفر</T></Label>
            <Input value={form.departureDate} onChange={(e) => updateForm('departureDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="DD/MM/YYYY" dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>تاريخ العودة</T></Label>
            <Input value={form.returnDate} onChange={(e) => updateForm('returnDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="DD/MM/YYYY" dir="ltr" />
          </div>
          {/* §DEAL-DATES — تاريخ الاكتمال is a SERVER-generated ledger
              (closedAt): READ-ONLY, never a form field, never trusted
              from the client. Historical unknown stays unknown. */}
          {editingTrip && (
            <div className="space-y-2">
              <Label className="text-slate-300"><T>تاريخ الاكتمال</T></Label>
              <div className="bg-slate-800/60 border border-slate-700/40 rounded-md px-3 py-2 text-sm text-slate-300" dir="ltr">
                {editingTrip.status === 'completed'
                  ? (storedCompletion
                    ? <span className="text-emerald-400">{formatDateTime(storedCompletion, locale)}</span>
                    : <span className="text-amber-400"><T>تاريخ الاكتمال غير معروف</T></span>)
                  : <span className="text-slate-500"><T>يُسجل تلقائياً من النظام عند الإكمال</T></span>}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-300"><T>اسم الديل</T></Label>
            <Input value={form.dealerName} onChange={(e) => updateForm('dealerName', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder={translateUIText('أدخل اسم الديل...', locale)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300"><T>أسماء العملاء المسافرين</T></Label>
            <Textarea value={form.customerNames} onChange={(e) => updateForm('customerNames', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder={translateUIText('أدخل أسماء العملاء...', locale)} rows={2} />
          </div>
          {/* §BOOKING-ITEMS — the dynamic services/bookings editor
              (replaces the six fixed service selects). Repeated types are
              supported: each row is an independent item with its own id
              and status; the deal-level status above stays separate. */}
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300"><T>الخدمات والحجوزات</T></Label>
              <Button type="button" variant="outline" size="sm" onClick={addBookingItem}
                className="border-brand-500/40 text-brand-400 hover:bg-brand-500/10 h-7 px-2 text-xs">
                + <T>إضافة حجز</T>
              </Button>
            </div>
            {form.bookingItems.length === 0 ? (
              <p className="text-xs text-slate-500"><T>لا حجوزات بعد — أضف أول حجز (نفس النوع يمكن تكراره)</T></p>
            ) : (
              <div className="space-y-1.5">
                {form.bookingItems.map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="shrink-0">{BOOKING_TYPE_ICONS[item.type]}</span>
                    <Select value={item.type} onValueChange={(v) => updateBookingItem(item.id, { type: v as BookingServiceType })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        {BOOKING_SERVICE_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="text-white text-xs">{translateUIText(BOOKING_TYPE_LABELS_AR[t], locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={item.status} onValueChange={(v) => updateBookingItem(item.id, { status: v as BookingItem['status'] })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs w-24 shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="booked" className="text-white text-xs"><T>محجوز</T></SelectItem>
                        <SelectItem value="pending" className="text-white text-xs"><T>معلق</T></SelectItem>
                        <SelectItem value="missing" className="text-white text-xs"><T>غير موجود</T></SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => removeBookingItem(item.id)}
                      className="shrink-0 text-red-400/70 hover:text-red-400 transition-colors cursor-pointer"
                      title={translateUIText('إزالة الحجز', locale)}
                      aria-label={translateUIText('إزالة الحجز', locale)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <span className="sr-only">{formatInteger(idx + 1, locale)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300"><T>ملاحظات</T></Label>
            <Textarea value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder={translateUIText('ملاحظات إضافية...', locale)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setForm(emptyForm); }} className="border-slate-600 text-slate-300"><T>إلغاء</T></Button>
          <Button onClick={onSave} disabled={saving || !form.employeeId || !form.destination || !form.departureDate} className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white">{saving ? <T>جاري الحفظ...</T> : <T>حفظ</T>}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ─── DeleteConfirmDialog — delegates to the global ConfirmDialog (§4) ───
const DeleteConfirmDialog = memo(function DeleteConfirmDialog({
  open, onOpenChange, onConfirm, itemName, loading,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void;
  itemName?: string; loading?: boolean;
}) {
  const { locale } = useLanguage();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      description={translateUIText('هل أنت متأكد من حذف هذه الرحلة؟ لا يمكن التراجع عن هذا الإجراء.', locale)}
      itemName={itemName}
      loading={loading}
      onConfirm={onConfirm}
    />
  );
});

// ─── UploadDialog ───
const UploadDialog = memo(function UploadDialog({
  open, onOpenChange,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ message: string; success: number; skipped: number; errors: string[] } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { locale } = useLanguage();

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await authFetch('/api/travel/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadResult(data);
        qc.invalidateQueries({ queryKey: ['travel'] });
      } else {
        setUploadResult({ message: data.error || translateUIText('فشل في الرفع', locale), success: 0, skipped: 0, errors: [] });
      }
    } catch {
      setUploadResult({ message: translateUIText('خطأ في الاتصال', locale), success: 0, skipped: 0, errors: [] });
    } finally { setUploading(false); }
  };

  const closeUpload = () => {
    onOpenChange(false);
    setUploadFile(null);
    setUploadResult(null);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeUpload(); }}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2"><FileSpreadsheet className="size-5 text-amber-400" /> <T>رفع شيت حجوزات</T></DialogTitle>
          <DialogDescription className="text-slate-400"><T>ارفع ملف Excel (.xlsx) وسيتم استخراج البيانات تلقائياً</T></DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-slate-300"><T>ملف الإكسل</T></Label>
            <div onClick={() => uploadInputRef.current?.click()} className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${uploadFile ? 'border-brand-500/30 bg-emerald-500/5' : 'border-slate-600 hover:border-amber-500/50 hover:bg-amber-500/5'}`}>
              <input ref={uploadInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadResult(null); }} />
              {uploadFile ? (
                <div className="flex items-center justify-center gap-2">
                  <Check className="size-5 text-brand-400" /><span className="text-brand-400 font-medium text-sm">{uploadFile.name}</span><span className="text-slate-500 text-xs">({(uploadFile.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div className="space-y-2"><Upload className="size-8 text-slate-500 mx-auto" /><p className="text-slate-400 text-sm"><T>اضغط لاختيار ملف</T></p><p className="text-slate-600 text-xs"><T>.xlsx أو .xls أو .csv</T></p></div>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <p className="text-slate-400 text-xs font-medium mb-1"><T>📋 شكل عمود DEAL:</T></p>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              <span className="text-brand-400"><T>اسم العميل</T></span> / <span className="text-cyan-400"><T>اسم الموظف</T></span> / <span className="text-brand-400"><T>الوجهة</T></span> / <span className="text-amber-400"><T>التاريخ</T></span>
            </p>
          </div>
          {uploadResult && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`rounded-lg border p-3 ${uploadResult.success > 0 ? 'border-brand-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <p className={`font-medium text-sm ${uploadResult.success > 0 ? 'text-brand-400' : 'text-red-400'}`}>{uploadResult.message}</p>
              {uploadResult.errors.length > 0 && (
                <div className="mt-2 max-h-24 overflow-y-auto">
                  {uploadResult.errors.slice(0, 5).map((err, i) => <p key={i} className="text-red-400/70 text-[11px]">• {err}</p>)}
                  {uploadResult.errors.length > 5 && <p className="text-slate-500 text-[11px]">+ {formatInteger(uploadResult.errors.length - 5, locale)} <T>أخطاء أخرى...</T></p>}
                </div>
              )}
            </motion.div>
          )}
          <Button onClick={handleUpload} disabled={uploading || !uploadFile} className="w-full bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
            {uploading ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="size-4 border-2 border-white/30 border-t-white rounded-full" /> <T>جاري الرفع...</T></>) : (<><Upload className="size-4" /> <T>رفع الشيت (</T>{uploadFile ? <T>1 ملف</T> : '0'}<T>)</T></>)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

// ─── UrgentAlertBanner — replaced with the system-wide AttentionPanel.
//     Same data shape (urgent trips) now flows through the unified
//     surface; severity buckets, compact rows and persistence are
//     inherited for free. Phase 6: each row also carries the event
//     type (departure vs return) so the label says "السفر اليوم"
//     vs "العودة اليوم" — never mixed. ───
type UrgentTripRow = {
  id: string;
  employeeName: string;
  dealerName: string | null;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  urgentType: 'departure' | 'return';
};

const UrgentAlertBanner = memo(function UrgentAlertBanner({
  urgentTrips, onScrollToTrip,
}: {
  urgentTrips: UrgentTripRow[];
  onScrollToTrip: (tripId: string) => void;
}) {
  const { locale } = useLanguage();
  if (urgentTrips.length === 0) return null;
  return (
    <AttentionPanel
      title={translateUIText('رحلات تحتاج متابعة', locale)}
      icon={<BellRing className="size-3.5 text-red-400" />}
      subtitle={`${formatInteger(urgentTrips.length, locale)} ${translateUIText('رحلة قريبة من السفر أو العودة', locale)}`}
      persistKey="travelUrgentAttention"
      groups={[
        { key: 'departure', label: translateUIText('سفر قادم', locale), count: urgentTrips.filter((t) => t.urgentType === 'departure').length },
        { key: 'return', label: translateUIText('عودة قادمة', locale), count: urgentTrips.filter((t) => t.urgentType === 'return').length },
      ]}
      items={urgentTrips.map((trip) => {
        const dateStr = trip.urgentType === 'return' ? trip.returnDate || trip.departureDate : trip.departureDate;
        const daysLeft = getDaysRemaining(dateStr);
        const level = getUrgencyLevel(daysLeft);
        const severity: AttentionSeverity =
          level === 'critical' ? 'critical' :
          level === 'urgent' ? 'urgent' :
          level === 'soon' ? 'warning' : 'info';
        return {
          id: `${trip.id}-${trip.urgentType}`,
          severity,
          groupKey: trip.urgentType,
          primary: trip.dealerName || trip.employeeName,
          secondary: `🌍 ${trip.destination}`,
          trailing: <span className="flex items-center gap-1.5"><span dir="ltr">{dateStr}</span><span className="font-bold">{getUrgencyLabel(daysLeft, trip.urgentType, locale)}</span></span>,
          onClick: () => onScrollToTrip(trip.id),
        };
      })}
    />
  );
});

// ─── PaginationBar ───
const PaginationBar = memo(function PaginationBar({
  page, totalPages, total, pageSize, onPageChange, onPageSizeChange,
}: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
  const { locale } = useLanguage();
  if (totalPages <= 1) return null;

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>{formatInteger(startItem, locale)}-{formatInteger(endItem, locale)} <T>من</T> {formatInteger(total, locale)}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-7 w-20 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)} className="text-white text-xs">{formatInteger(s, locale)} <T>/ صفحة</T></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={() => onPageChange(1)} disabled={page === 1} className="size-7 text-slate-500 hover:text-white">
          <ChevronsLeft className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onPageChange(page - 1)} disabled={page === 1} className="size-7 text-slate-500 hover:text-white">
          <ChevronRight className="size-3.5" />
        </Button>
        {pages.map((p, i) => p === 'ellipsis' ? (
          <span key={`e${i}`} className="text-slate-500 px-1">...</span>
        ) : (
          <Button
            key={p}
            variant={page === p ? 'default' : 'ghost'}
            size="icon"
            onClick={() => onPageChange(p)}
            className={`size-7 text-xs ${page === p ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-slate-500 hover:text-white'}`}
          >
            {formatInteger(p, locale)}
          </Button>
        ))}
        <Button variant="ghost" size="icon" onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="size-7 text-slate-500 hover:text-white">
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className="size-7 text-slate-500 hover:text-white">
          <ChevronsRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function TravelPage() {
  const { canEdit, canCreate, canUpdate, canDelete, canExport, canDoAction } = usePermissions('travel');
  // §UX-STRUCTURE PART 11 — the complaint action is gated by the
  // COMPLAINTS page permission (create), exactly what the POST
  // /api/complaints route enforces server-side. Frontend check only
  // hides the affordance; enforcement stays canonical + server-side.
  const canComplaint = canDoAction('complaints', 'create');
  const { locale } = useLanguage();
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);

  // ── Local UI state ──
  // Phase 6.3 (§8): filter context persists per user; an explicit
  // navigation seed (§27) wins for that mount.
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  // ── §7/§31 — Deep-link resolution (ONE pure canonical resolver) ──
  // Home "صفقات مغلقة" passes { dateBasis: 'dealClosedAt', month, status: 'all' };
  // Employee360 drills pass their own explicit bases; legacy links pass
  // closedMonth (completed-by-closedAt). ANY explicit navigation intent
  // wins over the persisted filter state for this mount — a stale
  // persisted departure-month filter can never silently intersect the
  // deep-linked dataset (the "7 vs 1" regression).
  const navParams = useAppStore((s) => s.navParams);
  const nav = resolveTravelNavLink(navParams);
  const navMonth = nav.month;
  const navEmployeeId = nav.employeeId;
  const effectiveNavBasis = nav.dateBasis;
  const effectiveNavStatus = nav.status;
  const [travelView, setTravelView, resetTravelView] = usePageState<{
    filterMonth: string;
    filterEmployee: string;
    searchQuery: string;
    dateBasis: string;
    statusFilter: string;
    tomorrowDeparture?: boolean;
    tomorrowReturn?: boolean;
  }>({
    page: 'travel',
    slot: 'filters',
    version: 2,
    // Phase 5.3 contract: the seed `filterMonth: navMonth ?? 'all'`
    // stays inside the initial state (deep-link month seeds the list).
    initial: () => ({ filterMonth: navMonth ?? 'all',
      filterEmployee: navEmployeeId ?? 'all',
      searchQuery: '',
      dateBasis: effectiveNavBasis ?? 'departureDate',
      statusFilter: effectiveNavStatus ?? 'all',
    }),
    // §31 — ANY explicit navigation intent wins over the persisted
    // filter state for this mount (a stale persisted departure-month
    // filter must never silently intersect a Home deep-link dataset).
    skipRestore: nav.hasNavIntent,
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { filterMonth?: unknown }).filterMonth === 'string'
        ? raw
        : null,
  });
  const filterMonth = travelView.filterMonth;
  const setFilterMonth = (value: string) => setTravelView((v) => ({ ...v, filterMonth: value }));
  const searchQuery = travelView.searchQuery;
  const setSearchQuery = (value: string) => setTravelView((v) => ({ ...v, searchQuery: value }));
  const filterEmployee = travelView.filterEmployee;
  const setFilterEmployee = (value: string) => setTravelView((v) => ({ ...v, filterEmployee: value }));
  // §DEAL-DATES — the selected date basis (always visible in the bar).
  const filterDateBasis: DealDateBasis = parseDealDateBasis(travelView.dateBasis) ?? 'departureDate';
  const setFilterDateBasis = (value: DealDateBasis) => setTravelView((v) => ({ ...v, dateBasis: value }));
  // §9 — independent status filter (الكل/تعديل/جاري/مكتمل/ملغي).
  const statusFilter: TravelStatusFilter = (TRAVEL_STATUS_FILTERS as readonly string[]).includes(travelView.statusFilter)
    ? (travelView.statusFilter as TravelStatusFilter)
    : 'all';
  const setStatusFilter = (value: TravelStatusFilter) => setTravelView((v) => ({ ...v, statusFilter: value }));
  // §TRAVEL-TOMORROW — real filters (server-side), persisted with the
  // rest of the filter context; active state is always visible.
  const tomorrowDeparture = travelView.tomorrowDeparture === true;
  const tomorrowReturn = travelView.tomorrowReturn === true;
  const setTomorrowDeparture = (value: boolean) => setTravelView((v) => ({ ...v, tomorrowDeparture: value }));
  const setTomorrowReturn = (value: boolean) => setTravelView((v) => ({ ...v, tomorrowReturn: value }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TravelWithEmployee | null>(null);
  const [form, setForm] = useState<TravelFormData>(emptyForm);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  // §MONTH-ISOLATION — expansion is PER MONTH GROUP (was a single
  // shared boolean, so opening the canceled accordion under one month
  // expanded the canceled tables of EVERY month at once). Each month
  // group owns its own toggle; the server-side month filter keeps the
  // LIST itself isolated to the selected month.
  const [cancelledExpanded, setCancelledExpanded] = useState<Record<string, boolean>>({});
  const toggleCancelledExpanded = useCallback((groupKey: string) => {
    setCancelledExpanded((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);

  // ── Debounced search (200ms) ──
  const debouncedSearch = useDebounce(searchQuery, 200);

  // ── useDeferredValue for non-blocking search (React 19) ──
  const deferredSearch = useDeferredValue(debouncedSearch);

  // ── Refs ──
  const highlightRef = useRef<HTMLDivElement>(null);

  // ── React Query: server-side filtered + paginated + sorted ──
  const { data, isLoading: loading, isFetching } = useTravel({
    tab: activeTab,
    employeeId: filterEmployee,
    month: filterMonth,
    search: deferredSearch,
    page,
    pageSize,
    tomorrowDeparture,
    tomorrowReturn,
    dateBasis: filterDateBasis,
    status: statusFilter,
  });
  const { data: employees = [] } = useEmployees();

  // §7 inline complaint form: system users for the "المسؤول" picker —
  // deduped through the canonical cache (same entry as the quick-action
  // host and every other consumer of the basic users payload).
  const { data: systemUsersData } = useDashboardUsers('basic');
  const systemUsers = (systemUsersData ?? []) as { id: string; name: string }[];

  // Extract data from server response
  const trips = (data?.data || []) as TravelWithEmployee[];
  const pagination = data?.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 1 };
  const tabCounts = data?.counts || { all: 0, upcoming: 0, in_progress: 0, returned: 0, canceled: 0 };
  const availableMonths = data?.availableMonths || [];
  const urgentTrips = data?.urgentTrips || [];

  // ── Mutations ──
  const createTravel = useCreateTravel();
  const updateTravel = useUpdateTravel();
  const deleteTravel = useDeleteTravel();
  const queryClient = useQueryClient();

  // ── Scroll to highlighted trip (Phase 5.3 unified) ──
  // The shared hook polls until the card is rendered (data loaded),
  // then scrolls + temporary highlight. Auto-EXPAND stays page-side:
  // the target card is expanded only once its data actually arrived.
  useRecordHighlight({ ready: !loading });

  useEffect(() => {
    if (!highlightId || loading) return;
    const exists = trips.some((t) => t.id === highlightId);
    if (!exists) return;
    // Deferred one frame (react-hooks/set-state-in-effect): expand is a
    // one-shot reaction to the deep-link, not a render-phase adjustment.
    const raf = requestAnimationFrame(() => setExpandedCardId(highlightId));
    return () => cancelAnimationFrame(raf);
  }, [highlightId, loading, trips]);

  // ── Reset page when filters change — compiler-endorsed "adjust state during render"
  // guard (no effect + setState cascade) ──
  const pageFilterTuple = [activeTab, filterEmployee, filterMonth, deferredSearch, tomorrowDeparture, tomorrowReturn, filterDateBasis, statusFilter] as const;
  const [lastPageFilterTuple, setLastPageFilterTuple] = useState<readonly unknown[]>(pageFilterTuple);
  if (pageFilterTuple.some((v, i) => v !== lastPageFilterTuple[i])) {
    setLastPageFilterTuple(pageFilterTuple);
    setPage(1);
  }

  // ── Stable callbacks (don't depend on trips array) ──
  const quickChangeStatus = useCallback((tripId: string, newStatus: string) => {
    updateTravel.mutate({ id: tripId, data: { status: newStatus } });
  }, [updateTravel]);

  // §BOOKING-ITEMS — cycle ONE booking item's status. The full item
  // list goes to the server with ONLY that item changed (item #2 never
  // touches item #1); the server re-projects the legacy fields. The
  // deal-level status is never touched here.
  const quickToggleItem = useCallback((tripId: string, itemId: string) => {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const items = normalizeBookingItems(trip);
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    // Cycle: booked → pending → booked (never to missing from the card)
    const nextStatus = item.status === 'booked' ? 'pending' : 'booked';
    const nextItems = items.map((i) => (i.id === itemId ? { ...i, status: nextStatus, updatedAt: new Date().toISOString() } : i));
    updateTravel.mutate({ id: tripId, data: { bookingItems: nextItems } });
  }, [updateTravel, trips]);

  const handleSave = useCallback(() => {
    // §DEAL-DATES — dealClosedAt goes through only when set; an empty
    // value on a legacy edit leaves the stored value untouched (the
    // server rejects invalid shapes and never fabricates the date).
    // closedAt is NEVER sent — it is a server-side ledger.
    const payload = {
      employeeId: form.employeeId,
      destination: form.destination,
      departureDate: form.departureDate,
      returnDate: form.returnDate,
      dealClosedAt: form.dealClosedAt || undefined,
      dealerName: form.dealerName,
      customerNames: form.customerNames,
      bookingItems: form.bookingItems,
      notes: form.notes,
      status: form.status,
    };
    if (editingTrip) {
      updateTravel.mutate({ id: editingTrip.id, data: payload }, {
        onSuccess: () => { logUpdate('travel', 'رحلة', form.destination); setEditingTrip(null); setIsAddOpen(false); setForm(emptyForm); },
      });
    } else {
      createTravel.mutate(payload, {
        onSuccess: () => { logCreate('travel', 'رحلة', form.destination); setIsAddOpen(false); setForm(emptyForm); },
      });
    }
  }, [editingTrip, form, updateTravel, createTravel]);

  const handleDelete = useCallback((id: string) => {
    deleteTravel.mutate(id, {
      onSuccess: () => {
        const trip = trips.find((t: any) => t.id === id);
        if (trip) logDelete('travel', 'رحلة', trip.destination);
        setDeletingId(null);
      },
    });
  }, [deleteTravel, trips]);
  const deletingTrip = deletingId ? trips.find((t: { id: string; destination?: string }) => t.id === deletingId) : null;

  const openEdit = useCallback((trip: TravelWithEmployee) => {
    setEditingTrip(trip);
    setForm({
      employeeId: trip.employeeId, destination: trip.destination,
      departureDate: trip.departureDate, returnDate: trip.returnDate || '',
      // §DEAL-DATES — legacy deals carry no dealClosedAt; the field is
      // left empty for the authorized editor to fill with the REAL
      // business date — never inferred from createdAt/departure/closure.
      dealClosedAt: trip.dealClosedAt || '',
      dealerName: trip.dealerName || '', customerNames: trip.customerNames || '',
      // §BOOKING-ITEMS — canonical items (legacy deals normalize at read time).
      bookingItems: normalizeBookingItems(trip),
      notes: trip.notes || '', status: trip.status,
    });
  }, []);

  const handleToggleExpand = useCallback((id: string | null) => {
    setExpandedCardId(id);
  }, []);

  // ── §7 Travel → Complaint (INLINE — global interaction contract):
  // instead of navigating to the complaints page, the REAL complaint
  // form opens inline in THIS page with the deal context prefilled.
  // Same fields, same API, same source-trace the ComplaintsPage writes
  // (sourcePage/sourceRecordId) — only the mounting context differs.
  const [complaintDeal, setComplaintDeal] = useState<TravelWithEmployee | null>(null);
  const reportComplaint = useCallback((trip: TravelWithEmployee) => {
    setComplaintDeal(trip);
    requestAnimationFrame(() => {
      document.getElementById('travel-inline-complaint')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const scrollToTrip = useCallback((tripId: string) => {
    setActiveTab('all');
    setFilterEmployee('all');
    setFilterMonth('all');
    setFilterDateBasis('departureDate');
    setStatusFilter('all');
    setSearchQuery('');
    setPage(1);
    requestAnimationFrame(() => {
      setTimeout(() => {
        setHighlightId(tripId);
        const el = document.getElementById(`trip-card-${tripId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    });
  }, [setHighlightId]);

  const clearFilters = useCallback(() => {
    // §9: clear = RESET TO PAGE DEFAULT + remove the persisted state.
    // §TRAVEL-TOMORROW: the tomorrow toggles clear with everything else.
    // §DEAL-DATES: the date basis returns to the operational TRAVEL
    // default and the status filter to الكل — true semantic reset.
    resetTravelView();
    setTravelView({ filterMonth: 'all', filterEmployee: 'all', searchQuery: '', dateBasis: 'departureDate', statusFilter: 'all', tomorrowDeparture: false, tomorrowReturn: false });
  }, [resetTravelView, setTravelView]);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  // ── Group current page trips by month (lightweight — only current page) ──
  // §DEAL-DATES — the grouping month key follows the SELECTED date
  // basis (the same semantics the server used to filter), so what the
  // group header says and what the period filter means always agree.
  const groupedByMonth = useMemo(() => {
    if (trips.length === 0) return [];
    if (activeTab !== 'all') {
      return [{ key: activeTab, label: translateUIText(categoryConfig[activeTab].label, locale), trips }];
    }
    const map = new Map<string, TravelWithEmployee[]>();
    for (const trip of trips) {
      const key = getDealDateMonthKey(trip, filterDateBasis) ?? 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(trip);
    }
    return Array.from(map, ([key, monthTrips]) => ({
      key,
      label: key === 'unknown' ? translateUIText('غير محدد', locale) : getMonthLabelFromKey(key, locale),
      trips: monthTrips,
    }));
  }, [trips, activeTab, locale, filterDateBasis]);

  // ── Derived ──
  const activeFiltersCount = (filterEmployee !== 'all' ? 1 : 0) + (filterMonth !== 'all' ? 1 : 0) + (tomorrowDeparture ? 1 : 0) + (tomorrowReturn ? 1 : 0) + (filterDateBasis !== 'departureDate' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  // ── Month group renderers ──
  const renderAllMonthGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => {
    const cardTrips = group.trips.filter((t) => getTripCategory(t.departureDate, t.returnDate) !== 'returned' && t.status !== 'canceled');
    const returnedTrips = group.trips.filter((t) => getTripCategory(t.departureDate, t.returnDate) === 'returned' && t.status !== 'canceled');
    const canceledTrips = group.trips.filter((t) => t.status === 'canceled');

    return (
      <motion.div key={group.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
            <CalendarDays className="size-4 text-brand-400" />
            <span className="text-white font-semibold text-sm">{group.label}</span>
          </div>
          <div className="flex gap-1.5">
            {cardTrips.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/30">{formatInteger(cardTrips.length, locale)} <T>نشط</T></span>}
            {returnedTrips.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">{formatInteger(returnedTrips.length, locale)} <T>رجع</T></span>}
            {canceledTrips.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">{formatInteger(canceledTrips.length, locale)} <T>ملغاة</T></span>}
          </div>
          <div className="flex-1 h-px bg-slate-700/50" />
          <span className="text-slate-500 text-xs">{formatInteger(group.trips.length, locale)} <T>رحلة</T></span>
        </div>

        {cardTrips.length > 0 && (
          <div className="space-y-2">
            <AnimatePresence>
              {cardTrips.map((trip) => (
                <TripCard
                  key={trip.id} trip={trip} showCategoryBadge={true}
                  isHighlighted={highlightId === trip.id} isExpanded={expandedCardId === trip.id}
                  canEdit={canUpdate} canComplaint={canComplaint} highlightRef={highlightRef}
                  onToggleExpand={handleToggleExpand} onEdit={openEdit} onDelete={setDeletingId}
                  onQuickChangeStatus={quickChangeStatus} onQuickToggleItem={quickToggleItem} onReportComplaint={reportComplaint}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {returnedTrips.length > 0 && (
          <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-500 text-xs font-medium"><T>الديل</T></TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium"><T>الوجهة</T></TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium hidden sm:table-cell"><T>التاريخ</T></TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium hidden md:table-cell"><T>العملاء</T></TableHead>
                    {/* §DEAL-DATES — server-generated closure ledger (closedAt);
                        historical completions without one stay explicitly unknown. */}
                    <TableHead className="text-slate-500 text-xs font-medium hidden lg:table-cell"><T>الإغلاق</T></TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium"><T>الحالة</T></TableHead>
                    {(canUpdate || canDelete) && <TableHead className="w-16" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnedTrips.map((trip) => (
                    <TableRow key={trip.id} className="border-slate-700/30 hover:bg-slate-700/20">
                      <TableCell className="text-white text-xs font-medium">{trip.dealerName || trip.employeeName}</TableCell>
                      <TableCell className="text-slate-300 text-xs">{trip.destination}</TableCell>
                      <TableCell className="text-slate-400 text-xs hidden sm:table-cell" dir="ltr">{trip.departureDate}</TableCell>
                      <TableCell className="text-slate-400 text-xs hidden md:table-cell truncate max-w-36">{trip.customerNames || '—'}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {trip.closedAt ? (
                          <span className="text-emerald-400 text-xs" dir="ltr">{formatDateTime(trip.closedAt, locale)}</span>
                        ) : (
                          <span className="text-amber-400/80 text-[11px]"><T>غير معروف</T></span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={trip.status} /></TableCell>
                      {(canUpdate || canDelete) && (
                        <TableCell>
                          <SmartActionMenu
  actions={[
    ...(canUpdate ? [{ key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(trip) }] : []),
    ...(canDelete ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, separatorBefore: true, onSelect: () => setDeletingId(trip.id) }] : []),
  ]}
  label={translateUIText('إجراءات الرحلة', locale)}
/>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Canceled trips collapsible in "all" tab */}
        {canceledTrips.length > 0 && (
          <div>
            <button
              onClick={() => toggleCancelledExpanded(group.key)}
              aria-expanded={!!cancelledExpanded[group.key]}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/15 transition-colors w-full cursor-pointer"
            >
              <XCircle className="size-3.5" />
              <span><T>الرحلات الملغاة (</T>{formatInteger(canceledTrips.length, locale)}<T>)</T></span>
              <svg className={`size-3.5 mr-auto transition-transform duration-200 ${cancelledExpanded[group.key] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <AnimatePresence>
              {!!cancelledExpanded[group.key] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden mt-2">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-red-500/20 hover:bg-transparent">
                            <TableHead className="text-red-400/60 text-xs font-medium"><T>الديل</T></TableHead>
                            <TableHead className="text-red-400/60 text-xs font-medium"><T>الوجهة</T></TableHead>
                            <TableHead className="text-red-400/60 text-xs font-medium hidden sm:table-cell"><T>السفر</T></TableHead>
                            <TableHead className="text-red-400/60 text-xs font-medium"><T>الحالة</T></TableHead>
                            {(canUpdate || canDelete) && <TableHead className="w-16" />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {canceledTrips.map((trip) => (
                            <TableRow key={trip.id} className="border-red-500/10 hover:bg-red-500/5">
                              <TableCell className="text-red-300/80 text-xs font-medium">{trip.dealerName || trip.employeeName}</TableCell>
                              <TableCell className="text-slate-400 text-xs">{trip.destination}</TableCell>
                              <TableCell className="text-slate-500 text-xs hidden sm:table-cell" dir="ltr">{trip.departureDate}</TableCell>
                              <TableCell><StatusBadge status={trip.status} /></TableCell>
                              {(canUpdate || canDelete) && (
                                <TableCell>
                                  <SmartActionMenu
                                        actions={[
                                          ...(canUpdate ? [{ key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(trip) }] : []),
                                          ...(canDelete ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, separatorBefore: true, onSelect: () => setDeletingId(trip.id) }] : []),
                                        ]}
                                        label={translateUIText('إجراءات الرحلة', locale)}
                                      />
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    );
  };

  const renderActiveGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => {
    const isInProgress = activeTab === 'in_progress';
    return (
      <motion.div key={group.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isInProgress ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/80 border-slate-700/50'}`}>
            <CalendarDays className={`size-4 ${isInProgress ? 'text-amber-400' : 'text-brand-400'}`} />
            <span className="text-white font-semibold text-sm">{group.label}</span>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${isInProgress ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-brand-500/10 text-brand-400 border-brand-500/30'}`}>{formatInteger(group.trips.length, locale)} {isInProgress ? <T>في الرحلة</T> : <T>رحلات مجدولة</T>}</span>
          <div className="flex-1 h-px bg-slate-700/50" />
          <span className="text-slate-500 text-xs">{formatInteger(group.trips.length, locale)} <T>رحلة</T></span>
        </div>
        <div className="space-y-2">
          <AnimatePresence>
            {group.trips.map((trip) => (
              <TripCard
                key={trip.id} trip={trip} showCategoryBadge={false}
                isHighlighted={highlightId === trip.id} isExpanded={expandedCardId === trip.id}
                canEdit={canUpdate} canComplaint={canComplaint} highlightRef={highlightRef}
                onToggleExpand={handleToggleExpand} onEdit={openEdit} onDelete={setDeletingId}
                onQuickChangeStatus={quickChangeStatus} onQuickToggleItem={quickToggleItem} onReportComplaint={reportComplaint}
              />
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  const renderReturnedGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => (
    <motion.div key={group.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
          <CalendarDays className="size-4 text-slate-400" />
          <span className="text-white font-semibold text-sm">{group.label}</span>
        </div>
        <div className="flex-1 h-px bg-slate-700/50" />
        <span className="text-slate-500 text-xs">{formatInteger(group.trips.length, locale)} <T>رحلة</T></span>
      </div>
      <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50 hover:bg-transparent">
                <TableHead className="text-slate-500 text-xs font-medium"><T>الديل</T></TableHead>
                <TableHead className="text-slate-500 text-xs font-medium"><T>الوجهة</T></TableHead>
                <TableHead className="text-slate-500 text-xs font-medium hidden sm:table-cell"><T>السفر</T></TableHead>
                <TableHead className="text-slate-500 text-xs font-medium"><T>العودة</T></TableHead>
                <TableHead className="text-slate-500 text-xs font-medium"><T>الحالة</T></TableHead>
                {(canUpdate || canDelete) && <TableHead className="w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.trips.map((trip) => (
                <TableRow key={trip.id} className="border-slate-700/30 hover:bg-slate-700/20">
                  <TableCell className="text-white text-xs font-medium">{trip.dealerName || trip.employeeName}</TableCell>
                  <TableCell className="text-slate-300 text-xs">{trip.destination}</TableCell>
                  <TableCell className="text-slate-400 text-xs hidden sm:table-cell" dir="ltr">{trip.departureDate}</TableCell>
                  <TableCell className="text-slate-400 text-xs" dir="ltr">{trip.returnDate || '—'}</TableCell>
                  <TableCell><StatusBadge status={trip.status} /></TableCell>
                  {(canUpdate || canDelete) && (
                    <TableCell>
                      <SmartActionMenu
  actions={[
    ...(canUpdate ? [{ key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(trip) }] : []),
    ...(canDelete ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, separatorBefore: true, onSelect: () => setDeletingId(trip.id) }] : []),
  ]}
  label={translateUIText('إجراءات الرحلة', locale)}
/>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </motion.div>
  );

  const renderGroups = () => {
    if (activeTab === 'returned') return groupedByMonth.map(renderReturnedGroup);
    if (activeTab === 'canceled') return groupedByMonth.map(renderCanceledGroup);
    if (activeTab === 'all') return groupedByMonth.map(renderAllMonthGroup);
    return groupedByMonth.map(renderActiveGroup);
  };

  // ── Canceled tab renderer (compact table with red tint) ──
  const renderCanceledGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => (
    <motion.div key={group.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <XCircle className="size-4 text-red-400" />
          <span className="text-red-300 font-semibold text-sm">{group.label}</span>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">{formatInteger(group.trips.length, locale)} <T>ملغاة</T></span>
        <div className="flex-1 h-px bg-red-500/20" />
        <span className="text-slate-500 text-xs">{formatInteger(group.trips.length, locale)} <T>رحلة</T></span>
      </div>
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-red-500/20 hover:bg-transparent">
                <TableHead className="text-red-400/60 text-xs font-medium"><T>الديل</T></TableHead>
                <TableHead className="text-red-400/60 text-xs font-medium"><T>الوجهة</T></TableHead>
                <TableHead className="text-red-400/60 text-xs font-medium hidden sm:table-cell"><T>السفر</T></TableHead>
                <TableHead className="text-red-400/60 text-xs font-medium"><T>العودة</T></TableHead>
                <TableHead className="text-red-400/60 text-xs font-medium"><T>الحالة</T></TableHead>
                <TableHead className="text-red-400/60 text-xs font-medium hidden sm:table-cell"><T>ملاحظات</T></TableHead>
                {(canUpdate || canDelete) && <TableHead className="w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.trips.map((trip) => (
                <TableRow key={trip.id} className="border-red-500/10 hover:bg-red-500/5">
                  <TableCell className="text-red-300/80 text-xs font-medium">{trip.dealerName || trip.employeeName}</TableCell>
                  <TableCell className="text-slate-400 text-xs">{trip.destination}</TableCell>
                  <TableCell className="text-slate-500 text-xs hidden sm:table-cell" dir="ltr">{trip.departureDate}</TableCell>
                  <TableCell className="text-slate-500 text-xs" dir="ltr">
                    {trip.returnDate ? (
                      trip.returnDate
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle className="size-3" /> <T>غير محدد</T></span>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge status={trip.status} /></TableCell>
                  <TableCell className="text-slate-500 text-xs hidden sm:table-cell truncate max-w-32">{trip.notes || '—'}</TableCell>
                  {(canUpdate || canDelete) && (
                    <TableCell>
                      <SmartActionMenu
  actions={[
    ...(canUpdate ? [{ key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(trip) }] : []),
    ...(canDelete ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, separatorBefore: true, onSelect: () => setDeletingId(trip.id) }] : []),
  ]}
  label={translateUIText('إجراءات الرحلة', locale)}
/>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </motion.div>
  );

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-5">
      {/* Header (§25/§26 — sticky) */}
      <PageHeaderBar
        icon={<Plane className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        title={translateUIText('إدارة السفر', locale)}
        description={
          <>
            {formatInteger(tabCounts.upcoming + tabCounts.in_progress, locale)} <T>رحلة نشطة</T> • {formatInteger(tabCounts.all, locale)} <T>إجمالي</T>
            {isFetching && <span className="inline-block size-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />}
          </>
        }
        primaryAction={canCreate ? {
          label: translateUIText('إضافة رحلة', locale),
          // §DEAL-DATES — dealClosedAt defaults to TODAY at open time
          // (not module load), per the DEFAULT DATE = TODAY doctrine.
          onClick: () => { setForm({ ...emptyForm, dealClosedAt: todayDisplayDate() }); setEditingTrip(null); setIsAddOpen(true); },
        } : undefined}
        actions={canCreate ? (
          <Button onClick={() => setIsUploadOpen(true)} variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
            <Upload className="size-4" /> <T>رفع شيت</T>
          </Button>
        ) : undefined}
      />

      {/* ━━━ URGENT ALERTS BANNER ━━━ */}
      {urgentTrips.length > 0 && (
        <UrgentAlertBanner urgentTrips={urgentTrips} onScrollToTrip={scrollToTrip} />
      )}

      {/* ━━━ §7 INLINE COMPLAINT FORM (global interaction contract) —
          opens below the alerts when the user reports a problem from a
          deal card; keeps the user inside the Travel workflow. ━━━ */}
      <AnimatePresence>
        {complaintDeal && (
          <InlineFormPanel
            id="travel-inline-complaint"
            tone="rose"
            icon={<MessageSquareWarning className="size-3.5 text-rose-400" />}
            title={`${translateUIText('شكوى من صفقة', locale)} — ${complaintDeal.dealerName || complaintDeal.employeeName}`}
            onClose={() => setComplaintDeal(null)}
          >
            <ComplaintInlineForm
              onClose={() => setComplaintDeal(null)}
              onCreated={() => { setComplaintDeal(null); queryClient.invalidateQueries({ queryKey: ['complaints'] }); }}
              employees={employees as never}
              systemUsers={systemUsers}
              sourceContext={{ page: 'travel', recordId: complaintDeal.id }}
              defaultValues={{
                dealId: complaintDeal.dealerName || '',
                employeeId: complaintDeal.employeeId || '',
                customerName: complaintDeal.dealerName || complaintDeal.customerNames || '',
                description: complaintDeal.destination
                  ? `مشكلة في رحلة إلى ${complaintDeal.destination} — تاريخ السفر ${complaintDeal.departureDate}${complaintDeal.customerNames ? ` — العملاء: ${complaintDeal.customerNames}` : ''}`
                  : '',
              }}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* ━━━ CATEGORY TABS ━━━ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          {(['all', 'upcoming', 'in_progress', 'returned', 'canceled'] as CategoryTab[]).map((tabKey) => {
            const config = categoryConfig[tabKey];
            const TabIcon = config.icon;
            const isActive = activeTab === tabKey;
            return (
              <button
                key={tabKey}
                onClick={() => setActiveTab(tabKey)}
                className={`relative flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-3 sm:py-3.5 rounded-xl border transition-all duration-300 cursor-pointer select-none ${
                  isActive ? config.activeClass : 'border-slate-700/40 bg-slate-800/20 text-slate-500 hover:bg-slate-800/40 hover:text-slate-400 hover:border-slate-700/60'
                }`}
              >
                <TabIcon className="size-4 sm:size-5 shrink-0" />
                <span className="text-xs sm:text-sm font-semibold"><T>{config.label}</T></span>
                <span className={`text-[10px] sm:text-xs font-bold min-w-[22px] text-center px-1.5 py-0.5 rounded-full transition-colors duration-300 ${isActive ? config.badgeClass : 'bg-slate-700/50 text-slate-500'}`}>
                  {formatInteger(tabCounts[tabKey as keyof typeof tabCounts], locale)}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Search + Filters */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={translateUIText('ابحث في الرحلات (اسم ديل، وجهة، موظف، عملاء...)', locale)} className="bg-slate-800/50 border-slate-700/50 text-white placeholder:text-slate-500 pr-10" />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5 text-slate-400 text-sm">
            <Filter className="size-3.5" /><span><T>فلتر:</T></span>
          </div>
          <EmployeeSearchInput
            employees={employees}
            value={filterEmployee}
            onChange={(id) => setFilterEmployee(id)}
            showAllOption
            allOptionValue="all"
            allOptionLabel={translateUIText('كل الموظفين', locale)}
            placeholder={translateUIText('فلتر حسب الموظف', locale)}
            variant="filter"
          />
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-36 text-xs">
              <CalendarDays className="size-3.5 ml-1 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs"><T>كل الأشهر</T></SelectItem>
              {availableMonths.map((m) => <SelectItem key={m} value={m} className="text-white text-xs">{getMonthLabelFromKey(m, locale)}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* §TRAVEL-TOMORROW — real, combinable, persisted filters with
              a visible active state */}
          <button
            type="button"
            onClick={() => setTomorrowDeparture(!tomorrowDeparture)}
            aria-pressed={tomorrowDeparture}
            title={translateUIText('رحلات يبدأ سفرها غدًا', locale)}
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
              tomorrowDeparture
                ? 'bg-brand-500/20 border-brand-500/50 text-brand-200'
                : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlaneTakeoff className="size-3.5" />
            <T>العملاء المسافرون غدًا</T>
          </button>
          <button
            type="button"
            onClick={() => setTomorrowReturn(!tomorrowReturn)}
            aria-pressed={tomorrowReturn}
            title={translateUIText('رحلات يعود عملاؤها غدًا', locale)}
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
              tomorrowReturn
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlaneLanding className="size-3.5" />
            <T>العملاء العائدون غدًا</T>
          </button>
          {/* §DEAL-DATES — أساس التاريخ: WHICH canonical date the period
              means (تقفيل الديل / السفر / التسجيل / الاكتمال). Always
              visible; never mixed with the status filter. */}
          <span className="text-xs text-slate-500"><T>أساس التاريخ:</T></span>
          <Select value={filterDateBasis} onValueChange={(v) => setFilterDateBasis(parseDealDateBasis(v) ?? 'departureDate')}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-40 text-xs">
              <CalendarDays className="size-3.5 ml-1 text-emerald-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_DATE_BASES.map((basis) => (
                <SelectItem key={basis} value={basis} className="text-white text-xs">
                  {translateUIText(DEAL_DATE_BASIS_LABELS_AR[basis], locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* §9 — الحالة: independent current-status filter (الكل /
              تعديل / جاري / مكتمل / ملغي). Orthogonal to the date basis:
              (تقفيل الديل + الكل + شهر) shows ALL deals closed with
              employees that month regardless of current status. */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TravelStatusFilter)}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-32 text-xs">
              <Filter className="size-3.5 ml-1 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs"><T>الحالة: الكل</T></SelectItem>
              {statusConfig.map((s) => (
                <SelectItem key={s.key} value={s.key} className="text-white text-xs"><T>{s.label}</T></SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" onClick={clearFilters} className="text-slate-500 hover:text-red-400 text-xs h-8 px-2">
              <XCircle className="size-3" /> <T>مسح الفلاتر</T>
            </Button>
          )}
          <span className="text-slate-500 text-xs mr-auto">{formatInteger(pagination.total, locale)} <T>نتيجة</T></span>
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl bg-slate-800" />)}</div>
      ) : tabCounts.all === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Plane className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium"><T>لا توجد رحلات</T></p>
            <p className="text-slate-500 text-sm mt-1"><T>أضف رحلات السفر الجديدة أو ارفع شيت حجوزات</T></p>
          </CardContent>
        </Card>
      ) : trips.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            {(() => { const EmptyIcon = categoryConfig[activeTab].icon; return <EmptyIcon className="size-10 text-slate-600 mb-3" />; })()}
            <p className="text-slate-400"><T>{categoryConfig[activeTab].emptyTitle}</T></p>
            <p className="text-slate-500 text-sm mt-1"><T>{categoryConfig[activeTab].emptySubtitle}</T></p>
            {activeFiltersCount > 0 && <Button variant="ghost" onClick={clearFilters} className="text-slate-500 mt-3 text-sm"><T>مسح الفلاتر</T></Button>}
          </CardContent>
        </Card>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-6">
            {renderGroups()}

            {/* Pagination */}
            <PaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Dialogs ── */}
      <TripFormDialog
        title={translateUIText('إضافة رحلة سفر جديدة', locale)}
        open={isAddOpen && !editingTrip}
        onOpenChange={setIsAddOpen}
        form={form} setForm={setForm}
        employees={employees} saving={createTravel.isPending}
        onSave={handleSave}
        editingTrip={null}
      />
      <TripFormDialog
        title={`${translateUIText('تعديل', locale)}: ${editingTrip?.destination ?? ''}`}
        open={!!editingTrip}
        onOpenChange={(v) => { if (!v) setEditingTrip(null); }}
        form={form} setForm={setForm}
        employees={employees} saving={updateTravel.isPending}
        onSave={handleSave}
        editingTrip={editingTrip}
      />
      <DeleteConfirmDialog
        open={!!deletingId}
        onOpenChange={(v) => { if (!v) setDeletingId(null); }}
        itemName={deletingTrip?.destination}
        loading={deleteTravel.isPending}
        onConfirm={() => { if (deletingId) handleDelete(deletingId); }}
      />
      <UploadDialog open={isUploadOpen} onOpenChange={setIsUploadOpen} />
    </div>
  );
}
