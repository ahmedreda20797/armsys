'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { getDaysRemaining } from '@/lib/date-utils';
import { useTravel, useEmployees, useCreateTravel, useUpdateTravel, useDeleteTravel } from '@/hooks/use-queries';
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
  Plus,
  Pencil,
  Trash2,
  Clock,
  Hotel,
  CreditCard,
  CheckCircle2,
  XCircle,
  Car,
  Palmtree,
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
} from 'lucide-react';
import type { TravelDeal, Employee } from '@/types';

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
  dealerName: string;
  customerNames: string;
  hasFlight: boolean;
  hasHotel: boolean;
  hasVisa: boolean;
  hasTours: boolean;
  hasTransportation: boolean;
  flightStatus: string;
  hotelStatus: string;
  visaStatus: string;
  toursStatus: string;
  transportationStatus: string;
  notes: string;
  status: string;
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const emptyForm: TravelFormData = {
  employeeId: '', destination: '', departureDate: '', returnDate: '',
  dealerName: '', customerNames: '',
  hasFlight: false, hasHotel: false, hasVisa: false,
  hasTours: false, hasTransportation: false,
  flightStatus: 'missing', hotelStatus: 'missing', visaStatus: 'missing',
  toursStatus: 'missing', transportationStatus: 'missing',
  notes: '', status: 'upcoming',
};

const arabicMonths: Record<string, string> = {
  '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل',
  '5': 'مايو', '6': 'يونيو', '7': 'يوليو', '8': 'أغسطس',
  '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};

type CategoryTab = 'all' | 'upcoming' | 'in_progress' | 'returned';
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
    activeClass: 'border-violet-500/40 bg-gradient-to-br from-violet-500/15 to-violet-500/5 text-violet-400 shadow-lg shadow-violet-500/5',
    badgeClass: 'bg-violet-500/25 text-violet-300',
    emptyTitle: 'لا توجد رحلات', emptySubtitle: 'أضف رحلات السفر الجديدة أو ارفع شيت حجوزات',
  },
  upcoming: {
    label: 'قريب السفر', icon: Plane,
    activeClass: 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 text-emerald-400 shadow-lg shadow-emerald-500/5',
    badgeClass: 'bg-emerald-500/25 text-emerald-300',
    emptyTitle: 'لا توجد رحلات قريبة', emptySubtitle: 'لا توجد رحلات خلال الـ 14 يوم القادمة',
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
};

const statusConfig = [
  { key: 'upcoming', label: 'تعديل', activeClass: 'bg-blue-500/20 text-blue-400 ring-blue-500/40' },
  { key: 'in_progress', label: 'جاري', activeClass: 'bg-amber-500/20 text-amber-400 ring-amber-500/40' },
  { key: 'completed', label: 'مكتمل', activeClass: 'bg-green-500/20 text-green-400 ring-green-500/40' },
  { key: 'canceled', label: 'ملغي', activeClass: 'bg-red-500/20 text-red-400 ring-red-500/40' },
] as const;

const serviceLabels: Record<string, string> = {
  flight: 'الطيران', hotel: 'الفندق', visa: 'التأشيرة',
  tours: 'الجولات', transportation: 'المواصلات',
};

const missingItemsConfig = [
  { key: 'hasFlight' as const, label: 'رحلة طيران' },
  { key: 'hasHotel' as const, label: 'فندق' },
  { key: 'hasVisa' as const, label: 'تأشيرة' },
  { key: 'hasTours' as const, label: 'جولات' },
  { key: 'hasTransportation' as const, label: 'مواصلات' },
];

// ═══════════════════════════════════════════════════════════════
//  PURE UTILITY FUNCTIONS (defined outside component — zero re-creation)
// ═══════════════════════════════════════════════════════════════

function getMonthKey(dateStr: string): string {
  if (!dateStr) return 'غير محدد';
  const p = dateStr.split('/');
  if (p.length !== 3) return 'غير محدد';
  return `${p[2]}-${p[1]}`;
}

function getMonthLabel(dateStr: string): string {
  if (!dateStr) return 'غير محدد';
  const p = dateStr.split('/');
  if (p.length !== 3) return 'غير محدد';
  return `${arabicMonths[p[1]] || p[1]} ${p[2]}`;
}

function getMonthLabelFromKey(key: string): string {
  if (key === 'غير محدد') return key;
  const parts = key.split('-');
  if (parts.length !== 2) return key;
  return `${arabicMonths[parts[1]] || parts[1]} ${parts[0]}`;
}

function getUrgencyLevel(daysLeft: number): UrgencyLevel {
  if (daysLeft === 0) return 'critical';
  if (daysLeft > 0 && daysLeft <= 3) return 'critical';
  if (daysLeft > 0 && daysLeft <= 7) return 'urgent';
  if (daysLeft > 0 && daysLeft <= 14) return 'soon';
  return 'normal';
}

function getUrgencyLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'السفر اليوم!';
  if (daysLeft === 1) return 'السفر بكره!';
  if (daysLeft === 2) return 'بعد يومين';
  if (daysLeft > 2 && daysLeft <= 7) return `بعد ${daysLeft} أيام`;
  if (daysLeft > 7) return `بعد ${daysLeft} يوم`;
  if (daysLeft === -1) return 'منذ يوم!';
  if (daysLeft === -2) return 'منذ يومين';
  if (daysLeft >= -7) return `منذ ${Math.abs(daysLeft)} أيام`;
  return `منذ ${Math.abs(daysLeft)} يوم`;
}

function getTripCategory(depDate: string, retDate: string | null): 'upcoming' | 'in_progress' | 'returned' {
  const retDays = retDate ? getDaysRemaining(retDate) : null;
  if (retDays !== null && retDays < 0) return 'returned';
  if (getDaysRemaining(depDate) < 0) return 'in_progress';
  return 'upcoming';
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
    case 'upcoming': return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">تعديل</Badge>;
    case 'in_progress': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">جاري</Badge>;
    case 'completed': return <Badge className="bg-green-500/15 text-green-400 border-green-500/20">مكتمل</Badge>;
    case 'canceled': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">ملغي</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
});

/** Stable category badge */
const CategoryBadge = memo(function CategoryBadge({ category }: { category: 'upcoming' | 'in_progress' | 'returned' }) {
  if (category === 'in_progress') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">🌍 في الرحلة</span>;
  if (category === 'returned') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 font-medium">✅ رجع</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">✈ قريب</span>;
});

/** Service toggle button inside expanded card */
const ServiceToggle = memo(function ServiceToggle({
  trip, service, label, canEdit, onToggle,
}: {
  trip: TravelWithEmployee; service: string; label: string;
  canEdit: boolean; onToggle: (tripId: string, service: string) => void;
}) {
  const hasField = `has${service.charAt(0).toUpperCase() + service.slice(1)}` as keyof TravelDeal;
  const statusField = `${service}Status` as keyof TravelDeal;
  const has = trip[hasField] as boolean;
  const svcStatus = (trip[statusField] as string) || (has ? 'booked' : 'missing');
  const isBooked = svcStatus === 'booked';
  const isPending = svcStatus === 'pending';
  const Icon = service === 'flight' ? Plane : service === 'hotel' ? Hotel : service === 'visa' ? CreditCard : service === 'tours' ? Palmtree : Car;

  if (!canEdit) {
    return (
      <div className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg ${
        isBooked ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : isPending ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            : 'bg-slate-700/30 text-slate-500 border border-slate-700/20'
      }`}>
        <Icon className="size-3.5" /> {isBooked ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />} <span>{label}</span>
      </div>
    );
  }
  return (
    <button
      onClick={() => onToggle(trip.id, service)}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer select-none ${
        isBooked ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 ring-1 ring-emerald-500/30'
          : isPending ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 ring-1 ring-amber-500/30'
            : 'bg-slate-700/30 text-slate-500 hover:bg-slate-700/50 ring-1 ring-slate-700/30'
      }`}
      title={isBooked ? `إلغاء ${label}` : `حجز ${label}`}
    >
      <Icon className="size-3.5" /> {isBooked ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />} <span>{label}</span>
    </button>
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
          return <span key={s.key} className={`text-[10px] px-2 py-0.5 rounded-full ring-1 font-medium ${s.activeClass}`}>{s.label}</span>;
        }
        return (
          <button key={s.key} onClick={() => onStatusChange(trip.id, s.key)}
            className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/30 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer">
            {s.label}
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
  highlightRef: React.RefObject<HTMLDivElement | null>;
  onToggleExpand: (id: string | null) => void;
  onEdit: (trip: TravelWithEmployee) => void;
  onDelete: (id: string) => void;
  onQuickChangeStatus: (tripId: string, status: string) => void;
  onQuickToggleService: (tripId: string, service: string) => void;
}

/** THE KEY OPTIMIZATION: React.memo trip card — only re-renders when its own data changes */
const TripCard = memo(function TripCard({
  trip, showCategoryBadge, isHighlighted, isExpanded, canEdit, highlightRef,
  onToggleExpand, onEdit, onDelete, onQuickChangeStatus, onQuickToggleService,
}: TripCardProps) {
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
  const missingItems = missingItemsConfig.filter(i => !trip[i.key]);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(open) => onToggleExpand(open ? trip.id : null)}
      id={`trip-card-${trip.id}`}
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
                  {showCategoryBadge && <CategoryBadge category={category} />}
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
                      <span className="text-emerald-500/70">المسئول:</span> {trip.employeeName}
                    </span>
                  )}
                  <span className="text-sm text-slate-300">🌍 {trip.destination}</span>
                  {category === 'upcoming' && urgency !== 'normal' && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      urgency === 'critical' ? 'text-red-400 bg-red-500/15'
                        : urgency === 'urgent' ? 'text-amber-400 bg-amber-500/15' : 'text-yellow-400 bg-yellow-500/15'
                    }`}>
                      {getUrgencyLabel(daysLeft)}
                    </span>
                  )}
                  {category === 'in_progress' && retDays !== null && retDays >= 0 && (
                    <span className="text-[10px] font-medium text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full">
                      العودة {trip.returnDate}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="text-center min-w-12">
                <div className={`text-xl font-bold tabular-nums ${countdownInfo.color}`}>{countdownInfo.value}</div>
                <span className="text-slate-500 text-[10px]">{countdownInfo.label}</span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(trip)} className="text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 size-7"><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(trip.id)} className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 size-7"><Trash2 className="size-3.5" /></Button>
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
                    <div className="flex items-center gap-2 text-slate-300">
                      <span className="text-xs">📅</span>
                      <span className="text-slate-500">السفر:</span>
                      <span className="text-white font-medium" dir="ltr">{trip.departureDate}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 ${
                        daysLeft < 0 ? 'text-amber-400 border-amber-500/30' : 'text-cyan-400 border-cyan-500/30'
                      }`}>
                        {daysLeft < 0 ? 'تم السفر' : `${daysLeft} يوم`}
                      </Badge>
                    </div>
                    {trip.returnDate && (
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="text-xs">↩️</span>
                        <span className="text-slate-500">العودة:</span>
                        <span className="text-white font-medium" dir="ltr">{trip.returnDate}</span>
                        {retDays !== null && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${
                            retDays < 0 ? 'text-emerald-400 border-emerald-500/30' : 'text-cyan-400 border-cyan-500/30'
                          }`}>
                            {retDays < 0 ? 'رجعوا' : `${retDays} يوم`}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Dealer & Customers */}
                  {(trip.dealerName || trip.customerNames) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {trip.dealerName && (
                        <div className="flex items-center gap-2 text-sm bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/20">
                          <span className="text-cyan-400 text-xs">👤</span>
                          <span className="text-slate-500">اسم الديل:</span>
                          <span className="text-white font-medium">{trip.dealerName}</span>
                        </div>
                      )}
                      {trip.customerNames && (
                        <div className="flex items-start gap-2 text-sm bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/20">
                          <span className="text-violet-400 text-xs shrink-0">👥</span>
                          <span className="text-slate-500 shrink-0">المسافرين:</span>
                          <span className="text-white text-right">{trip.customerNames}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Service Statuses */}
                  <div>
                    <p className="text-xs text-slate-500 mb-2 font-medium">حالة الخدمات</p>
                    <div className="flex flex-wrap gap-2">
                      <ServiceToggle trip={trip} service="flight" label="طيران" canEdit={canEdit} onToggle={onQuickToggleService} />
                      <ServiceToggle trip={trip} service="hotel" label="فندق" canEdit={canEdit} onToggle={onQuickToggleService} />
                      <ServiceToggle trip={trip} service="visa" label="تأشيرة" canEdit={canEdit} onToggle={onQuickToggleService} />
                      <ServiceToggle trip={trip} service="tours" label="جولات" canEdit={canEdit} onToggle={onQuickToggleService} />
                      <ServiceToggle trip={trip} service="transportation" label="مواصلات" canEdit={canEdit} onToggle={onQuickToggleService} />
                    </div>
                  </div>

                  {/* Missing items */}
                  {missingItems.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {missingItems.map((item) => (
                        <Badge key={item.label} variant="outline" className="border-red-500/25 text-red-400/80 text-[11px] gap-1">
                          <AlertTriangle className="size-3" />{item.label}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {trip.notes && (
                    <div className="text-sm bg-slate-800/30 rounded-lg p-3 border border-slate-700/20">
                      <p className="text-slate-500 text-xs mb-2 px-1">📝 ملاحظات</p>
                      <p className="text-slate-300 text-xs px-2" style={{ direction: 'rtl' }}>{trip.notes}</p>
                    </div>
                  )}

                  {/* Quick Status */}
                  {canEdit && (
                    <div>
                      <p className="text-xs text-slate-500 mb-2 font-medium">تغيير الحالة</p>
                      <QuickStatusBtns trip={trip} onStatusChange={onQuickChangeStatus} />
                    </div>
                  )}
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
  title, open, onOpenChange, form, setForm, employees, saving, onSave,
}: {
  title: string; open: boolean; onOpenChange: (v: boolean) => void;
  form: TravelFormData; setForm: React.Dispatch<React.SetStateAction<TravelFormData>>;
  employees: Employee[]; saving: boolean; onSave: () => void;
}) {
  const updateForm = useCallback((field: keyof TravelFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, [setForm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">أدخل تفاصيل رحلة السفر</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">الموظف</Label>
            <Select value={form.employeeId} onValueChange={(v) => updateForm('employeeId', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
              <SelectContent>{employees.map((emp) => <SelectItem key={emp.id} value={emp.id} className="text-white">{emp.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">الوجهة</Label>
            <Input value={form.destination} onChange={(e) => updateForm('destination', e.target.value)} className="bg-slate-800 border-slate-600 text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">الحالة</Label>
            <Select value={form.status} onValueChange={(v) => updateForm('status', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming" className="text-white">تعديل</SelectItem>
                <SelectItem value="in_progress" className="text-white">جاري</SelectItem>
                <SelectItem value="completed" className="text-white">مكتمل</SelectItem>
                <SelectItem value="canceled" className="text-white">ملغي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">تاريخ السفر</Label>
            <Input value={form.departureDate} onChange={(e) => updateForm('departureDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="DD/MM/YYYY" dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">تاريخ العودة</Label>
            <Input value={form.returnDate} onChange={(e) => updateForm('returnDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="DD/MM/YYYY" dir="ltr" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">اسم الديل</Label>
            <Input value={form.dealerName} onChange={(e) => updateForm('dealerName', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="أدخل اسم الديل..." />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">أسماء العملاء المسافرين</Label>
            <Textarea value={form.customerNames} onChange={(e) => updateForm('customerNames', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="أدخل أسماء العملاء..." rows={2} />
          </div>
          {(['flight', 'hotel', 'visa', 'tours', 'transportation'] as const).map((svc) => (
            <div key={svc} className="space-y-2">
              <Label className="text-slate-300">حالة {serviceLabels[svc]}</Label>
              <Select value={form[`${svc}Status` as keyof TravelFormData] as string} onValueChange={(v) => { updateForm(`${svc}Status` as keyof TravelFormData, v); updateForm(`has${svc.charAt(0).toUpperCase() + svc.slice(1)}` as keyof TravelFormData, v === 'booked'); }}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked" className="text-white">محجوز</SelectItem>
                  <SelectItem value="pending" className="text-white">معلق</SelectItem>
                  <SelectItem value="missing" className="text-white">غير موجود</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="ملاحظات إضافية..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setForm(emptyForm); }} className="border-slate-600 text-slate-300">إلغاء</Button>
          <Button onClick={onSave} disabled={saving || !form.employeeId || !form.destination || !form.departureDate} className="bg-emerald-600 hover:bg-emerald-700 text-white">{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ─── DeleteConfirmDialog ───
const DeleteConfirmDialog = memo(function DeleteConfirmDialog({
  open, onOpenChange, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
          <DialogDescription className="text-slate-400">هل أنت متأكد من حذف هذه الرحلة؟</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
          <Button variant="destructive" onClick={onConfirm}>حذف</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await fetch('/api/travel/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadResult(data);
        qc.invalidateQueries({ queryKey: ['travel'] });
      } else {
        setUploadResult({ message: data.error || 'فشل في الرفع', success: 0, skipped: 0, errors: [] });
      }
    } catch {
      setUploadResult({ message: 'خطأ في الاتصال', success: 0, skipped: 0, errors: [] });
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
          <DialogTitle className="text-white flex items-center gap-2"><FileSpreadsheet className="size-5 text-amber-400" /> رفع شيت حجوزات</DialogTitle>
          <DialogDescription className="text-slate-400">ارفع ملف Excel (.xlsx) وسيتم استخراج البيانات تلقائياً</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-slate-300">ملف الإكسل</Label>
            <div onClick={() => uploadInputRef.current?.click()} className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${uploadFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-600 hover:border-amber-500/50 hover:bg-amber-500/5'}`}>
              <input ref={uploadInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadResult(null); }} />
              {uploadFile ? (
                <div className="flex items-center justify-center gap-2">
                  <Check className="size-5 text-emerald-400" /><span className="text-emerald-400 font-medium text-sm">{uploadFile.name}</span><span className="text-slate-500 text-xs">({(uploadFile.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div className="space-y-2"><Upload className="size-8 text-slate-500 mx-auto" /><p className="text-slate-400 text-sm">اضغط لاختيار ملف</p><p className="text-slate-600 text-xs">.xlsx أو .xls أو .csv</p></div>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <p className="text-slate-400 text-xs font-medium mb-1">📋 شكل عمود DEAL:</p>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              <span className="text-emerald-400">اسم العميل</span> / <span className="text-cyan-400">اسم الموظف</span> / <span className="text-violet-400">الوجهة</span> / <span className="text-amber-400">التاريخ</span>
            </p>
          </div>
          {uploadResult && (
            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`rounded-lg border p-3 ${uploadResult.success > 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <p className={`font-medium text-sm ${uploadResult.success > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{uploadResult.message}</p>
              {uploadResult.errors.length > 0 && (
                <div className="mt-2 max-h-24 overflow-y-auto">
                  {uploadResult.errors.slice(0, 5).map((err, i) => <p key={i} className="text-red-400/70 text-[11px]">• {err}</p>)}
                  {uploadResult.errors.length > 5 && <p className="text-slate-500 text-[11px]">+ {uploadResult.errors.length - 5} أخطاء أخرى...</p>}
                </div>
              )}
            </motion.div>
          )}
          <Button onClick={handleUpload} disabled={uploading || !uploadFile} className="w-full bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
            {uploading ? (<><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="size-4 border-2 border-white/30 border-t-white rounded-full" /> جاري الرفع...</>) : (<><Upload className="size-4" /> رفع الشيت ({uploadFile ? '1 ملف' : '0'})</>)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

// ─── UrgentAlertBanner ───
const UrgentAlertBanner = memo(function UrgentAlertBanner({
  urgentTrips, onScrollToTrip,
}: {
  urgentTrips: Array<{ id: string; employeeName: string; dealerName: string | null; destination: string; departureDate: string }>;
  onScrollToTrip: (tripId: string) => void;
}) {
  const [alertOpen, setAlertOpen] = useState(true);

  if (urgentTrips.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <div className="rounded-xl border border-red-500/30 bg-gradient-to-l from-red-500/10 via-slate-900 to-slate-900 overflow-hidden">
        <button
          onClick={() => setAlertOpen(!alertOpen)}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-red-500/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
              <BellRing className="size-5 text-red-400" />
            </motion.div>
            <span className="text-red-400 font-semibold text-sm">تنبيهات: {urgentTrips.length} رحلة قريبة السفر</span>
          </div>
          <svg className={`size-4 text-slate-500 transition-transform duration-200 ${alertOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <AnimatePresence>
          {alertOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="border-t border-red-500/15 max-h-40 overflow-y-auto">
                {urgentTrips.map((trip) => {
                  const daysLeft = getDaysRemaining(trip.departureDate);
                  const level = getUrgencyLevel(daysLeft);
                  const levelStyles: Record<UrgencyLevel, string> = { critical: 'bg-red-500/15 border-red-500/30', urgent: 'bg-amber-500/10 border-amber-500/25', soon: 'bg-yellow-500/10 border-yellow-500/20', normal: 'bg-slate-800/50 border-slate-700/30' };
                  const textColor: Record<UrgencyLevel, string> = { critical: 'text-red-400', urgent: 'text-amber-400', soon: 'text-yellow-400', normal: 'text-slate-400' };
                  return (
                    <motion.div key={trip.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      onClick={() => onScrollToTrip(trip.id)}
                      className={`flex items-center justify-between px-3 py-2 mx-1 mb-1.5 rounded-lg border ${levelStyles[level]} cursor-pointer hover:brightness-125 transition-all duration-150`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {level === 'critical' && (
                          <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                            <span className="absolute inset-0 rounded-full bg-red-500" />
                          </motion.span>
                        )}
                        <span className="text-white text-xs font-medium truncate">{trip.dealerName || trip.employeeName}</span>
                        <span className="text-slate-500 text-[10px]">🌍 {trip.destination}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-slate-500 text-[10px]" dir="ltr">{trip.departureDate}</span>
                        <span className={`text-xs font-bold ${textColor[level]}`}>{getUrgencyLabel(daysLeft)}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

// ─── PaginationBar ───
const PaginationBar = memo(function PaginationBar({
  page, totalPages, total, pageSize, onPageChange, onPageSizeChange,
}: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
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
        <span>{startItem}-{endItem} من {total}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-7 w-20 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)} className="text-white text-xs">{s} / صفحة</SelectItem>
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
            className={`size-7 text-xs ${page === p ? 'bg-violet-600 text-white hover:bg-violet-700' : 'text-slate-500 hover:text-white'}`}
          >
            {p}
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
  const { canEdit } = usePermissions('travel');
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);

  // ── Local UI state ──
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TravelWithEmployee | null>(null);
  const [form, setForm] = useState<TravelFormData>(emptyForm);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

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
  });
  const { data: employees = [] } = useEmployees();

  // Extract data from server response
  const trips = (data?.data || []) as TravelWithEmployee[];
  const pagination = data?.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 1 };
  const tabCounts = data?.counts || { all: 0, upcoming: 0, in_progress: 0, returned: 0 };
  const availableMonths = data?.availableMonths || [];
  const urgentTrips = data?.urgentTrips || [];

  // ── Mutations ──
  const createTravel = useCreateTravel();
  const updateTravel = useUpdateTravel();
  const deleteTravel = useDeleteTravel();
  const queryClient = useQueryClient();

  // ── Scroll to highlighted trip ──
  useEffect(() => {
    if (highlightId) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.getElementById(`trip-card-${highlightId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const timer = setTimeout(() => setHighlightId(null), 2500);
          return () => clearTimeout(timer);
        }, 100);
      });
    }
  }, [highlightId, setHighlightId]);

  // ── Reset page when filters change ──
  useEffect(() => { setPage(1); }, [activeTab, filterEmployee, filterMonth, deferredSearch]);

  // ── Stable callbacks (don't depend on trips array) ──
  const quickChangeStatus = useCallback((tripId: string, newStatus: string) => {
    updateTravel.mutate({ id: tripId, data: { status: newStatus } });
  }, [updateTravel]);

  const quickToggleService = useCallback((tripId: string, service: string) => {
    const current = queryClient.getQueryData<any>(['travel', activeTab, filterEmployee, filterMonth, deferredSearch, page, pageSize]);
    const trip = current?.data?.find((t: any) => t.id === tripId);
    if (!trip) return;
    const statusField = `${service}Status`;
    const hasField = `has${service.charAt(0).toUpperCase() + service.slice(1)}`;
    const newHas = !(trip[hasField] as boolean);
    const newStatus = newHas ? 'booked' : 'missing';
    updateTravel.mutate({ id: tripId, data: { [statusField]: newStatus, [hasField]: newHas } });
  }, [updateTravel, queryClient, activeTab, filterEmployee, filterMonth, deferredSearch, page, pageSize]);

  const handleSave = useCallback(() => {
    if (editingTrip) {
      updateTravel.mutate({ id: editingTrip.id, data: form }, {
        onSuccess: () => { setEditingTrip(null); setIsAddOpen(false); setForm(emptyForm); },
      });
    } else {
      createTravel.mutate(form, {
        onSuccess: () => { setIsAddOpen(false); setForm(emptyForm); },
      });
    }
  }, [editingTrip, form, updateTravel, createTravel]);

  const handleDelete = useCallback((id: string) => {
    deleteTravel.mutate(id, {
      onSuccess: () => setDeletingId(null),
    });
  }, [deleteTravel]);

  const openEdit = useCallback((trip: TravelWithEmployee) => {
    setEditingTrip(trip);
    setForm({
      employeeId: trip.employeeId, destination: trip.destination,
      departureDate: trip.departureDate, returnDate: trip.returnDate || '',
      dealerName: trip.dealerName || '', customerNames: trip.customerNames || '',
      hasFlight: trip.hasFlight, hasHotel: trip.hasHotel, hasVisa: trip.hasVisa,
      hasTours: trip.hasTours, hasTransportation: trip.hasTransportation,
      flightStatus: trip.flightStatus || 'missing', hotelStatus: trip.hotelStatus || 'missing',
      visaStatus: trip.visaStatus || 'missing', toursStatus: trip.toursStatus || 'missing',
      transportationStatus: trip.transportationStatus || 'missing',
      notes: trip.notes || '', status: trip.status,
    });
  }, []);

  const handleToggleExpand = useCallback((id: string | null) => {
    setExpandedCardId(id);
  }, []);

  const scrollToTrip = useCallback((tripId: string) => {
    setActiveTab('all');
    setFilterEmployee('all');
    setFilterMonth('all');
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
    setFilterEmployee('all');
    setSearchQuery('');
    setFilterMonth('all');
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  // ── Group current page trips by month (lightweight — only current page) ──
  const groupedByMonth = useMemo(() => {
    if (trips.length === 0) return [];
    if (activeTab !== 'all') {
      return [{ key: activeTab, label: categoryConfig[activeTab].label, trips }];
    }
    const map = new Map<string, TravelWithEmployee[]>();
    for (const trip of trips) {
      const key = getMonthKey(trip.departureDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(trip);
    }
    return Array.from(map, ([key, monthTrips]) => ({
      key,
      label: getMonthLabelFromKey(key),
      trips: monthTrips,
    }));
  }, [trips, activeTab]);

  // ── Derived ──
  const activeFiltersCount = (filterEmployee !== 'all' ? 1 : 0) + (filterMonth !== 'all' ? 1 : 0);

  // ── Month group renderers ──
  const renderAllMonthGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => {
    const cardTrips = group.trips.filter((t) => getTripCategory(t.departureDate, t.returnDate) !== 'returned');
    const tableTrips = group.trips.filter((t) => getTripCategory(t.departureDate, t.returnDate) === 'returned');

    return (
      <motion.div key={group.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
            <CalendarDays className="size-4 text-violet-400" />
            <span className="text-white font-semibold text-sm">{group.label}</span>
          </div>
          <div className="flex gap-1.5">
            {cardTrips.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{cardTrips.length} نشط</span>}
            {tableTrips.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">{tableTrips.length} رجع</span>}
          </div>
          <div className="flex-1 h-px bg-slate-700/50" />
          <span className="text-slate-500 text-xs">{group.trips.length} رحلة</span>
        </div>

        {cardTrips.length > 0 && (
          <div className="space-y-2">
            <AnimatePresence>
              {cardTrips.map((trip) => (
                <TripCard
                  key={trip.id} trip={trip} showCategoryBadge={true}
                  isHighlighted={highlightId === trip.id} isExpanded={expandedCardId === trip.id}
                  canEdit={canEdit} highlightRef={highlightRef}
                  onToggleExpand={handleToggleExpand} onEdit={openEdit} onDelete={setDeletingId}
                  onQuickChangeStatus={quickChangeStatus} onQuickToggleService={quickToggleService}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {tableTrips.length > 0 && (
          <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-500 text-xs font-medium">الديل</TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium">الوجهة</TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium hidden sm:table-cell">التاريخ</TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium hidden md:table-cell">العملاء</TableHead>
                    <TableHead className="text-slate-500 text-xs font-medium">الحالة</TableHead>
                    {canEdit && <TableHead className="w-16" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableTrips.map((trip) => (
                    <TableRow key={trip.id} className="border-slate-700/30 hover:bg-slate-700/20">
                      <TableCell className="text-white text-xs font-medium">{trip.dealerName || trip.employeeName}</TableCell>
                      <TableCell className="text-slate-300 text-xs">{trip.destination}</TableCell>
                      <TableCell className="text-slate-400 text-xs hidden sm:table-cell" dir="ltr">{trip.departureDate}</TableCell>
                      <TableCell className="text-slate-400 text-xs hidden md:table-cell truncate max-w-36">{trip.customerNames || '—'}</TableCell>
                      <TableCell><StatusBadge status={trip.status} /></TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(trip)} className="text-slate-500 hover:text-emerald-400 size-6"><Pencil className="size-2.5" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeletingId(trip.id)} className="text-slate-500 hover:text-red-400 size-6"><Trash2 className="size-2.5" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
            <CalendarDays className={`size-4 ${isInProgress ? 'text-amber-400' : 'text-emerald-400'}`} />
            <span className="text-white font-semibold text-sm">{group.label}</span>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${isInProgress ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>{group.trips.length} {isInProgress ? 'في الرحلة' : 'قريب السفر'}</span>
          <div className="flex-1 h-px bg-slate-700/50" />
          <span className="text-slate-500 text-xs">{group.trips.length} رحلة</span>
        </div>
        <div className="space-y-2">
          <AnimatePresence>
            {group.trips.map((trip) => (
              <TripCard
                key={trip.id} trip={trip} showCategoryBadge={false}
                isHighlighted={highlightId === trip.id} isExpanded={expandedCardId === trip.id}
                canEdit={canEdit} highlightRef={highlightRef}
                onToggleExpand={handleToggleExpand} onEdit={openEdit} onDelete={setDeletingId}
                onQuickChangeStatus={quickChangeStatus} onQuickToggleService={quickToggleService}
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
        <span className="text-slate-500 text-xs">{group.trips.length} رحلة</span>
      </div>
      <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50 hover:bg-transparent">
                <TableHead className="text-slate-500 text-xs font-medium">الديل</TableHead>
                <TableHead className="text-slate-500 text-xs font-medium">الوجهة</TableHead>
                <TableHead className="text-slate-500 text-xs font-medium hidden sm:table-cell">السفر</TableHead>
                <TableHead className="text-slate-500 text-xs font-medium">العودة</TableHead>
                <TableHead className="text-slate-500 text-xs font-medium">الحالة</TableHead>
                {canEdit && <TableHead className="w-16" />}
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
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(trip)} className="text-slate-500 hover:text-emerald-400 size-6"><Pencil className="size-2.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeletingId(trip.id)} className="text-slate-500 hover:text-red-400 size-6"><Trash2 className="size-2.5" /></Button>
                      </div>
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
    if (activeTab === 'all') return groupedByMonth.map(renderAllMonthGroup);
    return groupedByMonth.map(renderActiveGroup);
  };

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div dir="rtl" className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Plane className="size-6 text-emerald-400" />
            إدارة السفر
            {isFetching && <span className="size-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">{tabCounts.upcoming + tabCounts.in_progress} رحلة نشطة • {tabCounts.all} إجمالي</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={() => { setForm(emptyForm); setEditingTrip(null); setIsAddOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="size-4" /> إضافة رحلة
            </Button>
            <Button onClick={() => setIsUploadOpen(true)} variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
              <Upload className="size-4" /> رفع شيت
            </Button>
          </div>
        )}
      </motion.div>

      {/* ━━━ URGENT ALERTS BANNER ━━━ */}
      {urgentTrips.length > 0 && (
        <UrgentAlertBanner urgentTrips={urgentTrips} onScrollToTrip={scrollToTrip} />
      )}

      {/* ━━━ CATEGORY TABS ━━━ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {(['all', 'upcoming', 'in_progress', 'returned'] as CategoryTab[]).map((tabKey) => {
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
                <span className="text-xs sm:text-sm font-semibold">{config.label}</span>
                <span className={`text-[10px] sm:text-xs font-bold min-w-[22px] text-center px-1.5 py-0.5 rounded-full transition-colors duration-300 ${isActive ? config.badgeClass : 'bg-slate-700/50 text-slate-500'}`}>
                  {tabCounts[tabKey as keyof typeof tabCounts]}
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
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="ابحث في الرحلات (اسم ديل، وجهة، موظف، عملاء...)" className="bg-slate-800/50 border-slate-700/50 text-white placeholder:text-slate-500 pr-10" />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5 text-slate-400 text-sm">
            <Filter className="size-3.5" /><span>فلتر:</span>
          </div>
          <Select value={filterEmployee} onValueChange={setFilterEmployee}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs">كل الموظفين</SelectItem>
              {employees.map((emp) => <SelectItem key={emp.id} value={emp.id} className="text-white text-xs">{emp.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-36 text-xs">
              <CalendarDays className="size-3.5 ml-1 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs">كل الأشهر</SelectItem>
              {availableMonths.map((m) => <SelectItem key={m} value={m} className="text-white text-xs">{getMonthLabelFromKey(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" onClick={clearFilters} className="text-slate-500 hover:text-red-400 text-xs h-8 px-2">
              <XCircle className="size-3" /> مسح الفلاتر
            </Button>
          )}
          <span className="text-slate-500 text-xs mr-auto">{pagination.total} نتيجة</span>
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl bg-slate-800" />)}</div>
      ) : tabCounts.all === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Plane className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد رحلات</p>
            <p className="text-slate-500 text-sm mt-1">أضف رحلات السفر الجديدة أو ارفع شيت حجوزات</p>
          </CardContent>
        </Card>
      ) : trips.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            {(() => { const EmptyIcon = categoryConfig[activeTab].icon; return <EmptyIcon className="size-10 text-slate-600 mb-3" />; })()}
            <p className="text-slate-400">{categoryConfig[activeTab].emptyTitle}</p>
            <p className="text-slate-500 text-sm mt-1">{categoryConfig[activeTab].emptySubtitle}</p>
            {activeFiltersCount > 0 && <Button variant="ghost" onClick={clearFilters} className="text-slate-500 mt-3 text-sm">مسح الفلاتر</Button>}
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
        title="إضافة رحلة سفر جديدة"
        open={isAddOpen && !editingTrip}
        onOpenChange={setIsAddOpen}
        form={form} setForm={setForm}
        employees={employees} saving={createTravel.isPending}
        onSave={handleSave}
      />
      <TripFormDialog
        title={`تعديل: ${editingTrip?.destination}`}
        open={!!editingTrip}
        onOpenChange={(v) => { if (!v) setEditingTrip(null); }}
        form={form} setForm={setForm}
        employees={employees} saving={updateTravel.isPending}
        onSave={handleSave}
      />
      <DeleteConfirmDialog
        open={!!deletingId}
        onOpenChange={() => setDeletingId(null)}
        onConfirm={() => { if (deletingId) handleDelete(deletingId); }}
      />
      <UploadDialog open={isUploadOpen} onOpenChange={setIsUploadOpen} />
    </div>
  );
}
