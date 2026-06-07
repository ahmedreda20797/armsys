'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { getDaysRemaining } from '@/lib/date-utils';
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
  UserCheck,
  AlertTriangle,
  ArrowUpDown,
  Zap,
} from 'lucide-react';
import type { TravelDeal, Employee } from '@/types';

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

const emptyForm: TravelFormData = {
  employeeId: '',
  destination: '',
  departureDate: '',
  returnDate: '',
  dealerName: '',
  customerNames: '',
  hasFlight: false,
  hasHotel: false,
  hasVisa: false,
  hasTours: false,
  hasTransportation: false,
  flightStatus: 'missing',
  hotelStatus: 'missing',
  visaStatus: 'missing',
  toursStatus: 'missing',
  transportationStatus: 'missing',
  notes: '',
  status: 'upcoming',
};

const arabicMonths: Record<string, string> = {
  '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل',
  '5': 'مايو', '6': 'يونيو', '7': 'يوليو', '8': 'أغسطس',
  '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};

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

function dateToSortNumber(dateStr: string): number {
  if (!dateStr) return 99999999;
  const p = dateStr.split('/');
  if (p.length !== 3) return 99999999;
  return (parseInt(p[2]) || 0) * 10000 + (parseInt(p[1]) || 0) * 100 + (parseInt(p[0]) || 0);
}

type UrgencyLevel = 'critical' | 'urgent' | 'soon' | 'normal';

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

function getTripCategory(trip: TravelWithEmployee): 'upcoming' | 'in_progress' | 'returned' {
  const depDays = getDaysRemaining(trip.departureDate);
  const retDays = trip.returnDate ? getDaysRemaining(trip.returnDate) : null;
  // 1. If return date has passed → returned (regardless of departure)
  if (retDays !== null && retDays < 0) return 'returned';
  // 2. If departure has passed (yesterday or before) but hasn't returned yet → in_progress
  if (depDays < 0) return 'in_progress';
  // 3. Departure is today or in the future → upcoming
  return 'upcoming';
}

type CategoryTab = 'all' | 'upcoming' | 'in_progress' | 'returned';

const categoryConfig: Record<CategoryTab, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  badgeClass: string;
  emptyTitle: string;
  emptySubtitle: string;
}> = {
  all: {
    label: 'الكل',
    icon: Layers,
    activeClass: 'border-violet-500/40 bg-gradient-to-br from-violet-500/15 to-violet-500/5 text-violet-400 shadow-lg shadow-violet-500/5',
    badgeClass: 'bg-violet-500/25 text-violet-300',
    emptyTitle: 'لا توجد رحلات',
    emptySubtitle: 'أضف رحلات السفر الجديدة أو ارفع شيت حجوزات',
  },
  upcoming: {
    label: 'قريب السفر',
    icon: Plane,
    activeClass: 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 text-emerald-400 shadow-lg shadow-emerald-500/5',
    badgeClass: 'bg-emerald-500/25 text-emerald-300',
    emptyTitle: 'لا توجد رحلات قريبة',
    emptySubtitle: 'لا توجد رحلات خلال الـ 14 يوم القادمة',
  },
  in_progress: {
    label: 'في الرحلة',
    icon: Globe,
    activeClass: 'border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-500/5 text-amber-400 shadow-lg shadow-amber-500/5',
    badgeClass: 'bg-amber-500/25 text-amber-300',
    emptyTitle: 'لا توجد رحلات جارية حالياً',
    emptySubtitle: 'الرحلات الحالية ستظهر هنا أثناء السفر',
  },
  returned: {
    label: 'رجعوا',
    icon: CheckCircle2,
    activeClass: 'border-slate-500/30 bg-gradient-to-br from-slate-500/10 to-slate-500/5 text-slate-300 shadow-lg shadow-slate-500/5',
    badgeClass: 'bg-slate-500/20 text-slate-400',
    emptyTitle: 'لا توجد رحلات عائدة',
    emptySubtitle: 'الرحلات التي مر تاريخ عودتها ستظهر هنا',
  },
};

export default function TravelPage() {
  const permissions = usePermissions('travel');
  const canEdit = permissions.canEdit();
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);
  const [trips, setTrips] = useState<TravelWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TravelWithEmployee | null>(null);
  const [form, setForm] = useState<TravelFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');

  // Collapsible card state
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // Proximity sort toggle (nearest travel first)
  const [sortByProximity, setSortByProximity] = useState(false);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ message: string; success: number; skipped: number; errors: string[] } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [alertOpen, setAlertOpen] = useState(true);

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setHighlightId(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightId, setHighlightId]);

  const fetchData = async () => {
    try {
      const [tRes, empRes] = await Promise.all([fetch('/api/travel'), fetch('/api/employees')]);
      if (tRes.ok) setTrips(await tRes.json());
      if (empRes.ok) setEmployees(await empRes.json());
    } catch {
      setTrips([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const quickChangeStatus = useCallback(async (tripId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/travel/${tripId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, status: newStatus as TravelDeal['status'] } : t)));
    } catch { /* silent */ }
  }, []);

  const quickToggleService = useCallback(async (tripId: string, service: string) => {
    try {
      const trip = trips.find((t) => t.id === tripId);
      if (!trip) return;
      const statusField = `${service}Status`;
      const hasField = `has${service.charAt(0).toUpperCase() + service.slice(1)}`;
      const newHas = !(trip[hasField as keyof TravelDeal] as boolean);
      const newStatus = newHas ? 'booked' : 'missing';
      const res = await fetch(`/api/travel/${tripId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [statusField]: newStatus, [hasField]: newHas }),
      });
      if (res.ok) setTrips((prev) => prev.map((t) => {
        if (t.id !== tripId) return t;
        const updated = { ...t };
        (updated as Record<string, unknown>)[statusField] = newStatus;
        (updated as Record<string, unknown>)[hasField] = newHas;
        return updated as TravelWithEmployee;
      }));
    } catch { /* silent */ }
  }, [trips]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await fetch('/api/travel/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) { setUploadResult(data); await fetchData(); }
      else setUploadResult({ message: data.error || 'فشل في الرفع', success: 0, skipped: 0, errors: [] });
    } catch {
      setUploadResult({ message: 'خطأ في الاتصال', success: 0, skipped: 0, errors: [] });
    } finally { setUploading(false); }
  };

  const closeUpload = () => {
    setIsUploadOpen(false);
    setUploadFile(null);
    setUploadResult(null);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = editingTrip ? `/api/travel/${editingTrip.id}` : '/api/travel';
      const res = await fetch(url, { method: editingTrip ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) await fetchData();
    } catch { /* silent */ } finally {
      setSaving(false);
      setEditingTrip(null);
      setIsAddOpen(false);
      setForm(emptyForm);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/travel/${id}`, { method: 'DELETE' });
      if (res.ok) { setTrips((prev) => prev.filter((t) => t.id !== id)); setDeletingId(null); }
    } catch { /* silent */ }
  };

  const openEdit = (trip: TravelWithEmployee) => {
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
  };

  const updateForm = (field: keyof TravelFormData, value: string | boolean) => setForm((prev) => ({ ...prev, [field]: value }));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'upcoming': return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">تعديل</Badge>;
      case 'in_progress': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">جاري</Badge>;
      case 'completed': return <Badge className="bg-green-500/15 text-green-400 border-green-500/20">مكتمل</Badge>;
      case 'canceled': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">ملغي</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    trips.forEach((t) => {
      const key = getMonthKey(t.departureDate);
      if (key !== 'غير محدد') monthSet.add(key);
    });
    return Array.from(monthSet).sort((a, b) => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const distA = Math.abs((parseInt(a.split('-')[0]) - currentYear) * 12 + parseInt(a.split('-')[1]) - currentMonth);
      const distB = Math.abs((parseInt(b.split('-')[0]) - currentYear) * 12 + parseInt(b.split('-')[1]) - currentMonth);
      return distA - distB;
    });
  }, [trips]);

  const { allCount, upcomingCount, inProgressCount, returnedCount } = useMemo(() => {
    let up = 0, inp = 0, ret = 0;
    trips.forEach((t) => {
      const cat = getTripCategory(t);
      if (cat === 'upcoming') up++;
      else if (cat === 'in_progress') inp++;
      else ret++;
    });
    return { allCount: trips.length, upcomingCount: up, inProgressCount: inp, returnedCount: ret };
  }, [trips]);

  const tabCounts: Record<CategoryTab, number> = {
    all: allCount,
    upcoming: upcomingCount,
    in_progress: inProgressCount,
    returned: returnedCount,
  };

  const processedTrips = useMemo(() => {
    let filtered = [...trips];
    if (filterEmployee !== 'all') filtered = filtered.filter((t) => t.employeeId === filterEmployee);
    if (filterMonth !== 'all') filtered = filtered.filter((t) => getMonthKey(t.departureDate) === filterMonth);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((trip) =>
        [trip.employeeName, trip.destination, trip.dealerName || '', trip.customerNames || '', trip.departureDate, trip.returnDate || '', trip.notes || '']
          .some((f) => f.toLowerCase().includes(q))
      );
    }
    if (activeTab === 'upcoming') {
      // Show only upcoming-category trips within 14 days, sorted by nearest departure
      filtered = filtered.filter((t) => {
        if (getTripCategory(t) !== 'upcoming') return false;
        return getDaysRemaining(t.departureDate) <= 14;
      });
      filtered.sort((a, b) => getDaysRemaining(a.departureDate) - getDaysRemaining(b.departureDate));
    } else if (activeTab === 'in_progress') {
      filtered = filtered.filter((t) => getTripCategory(t) === 'in_progress');
      // Sort by nearest return date (most urgent first)
      filtered.sort((a, b) => {
        const retA = getDaysRemaining(a.returnDate || a.departureDate);
        const retB = getDaysRemaining(b.returnDate || b.departureDate);
        return retA - retB;
      });
    } else if (activeTab === 'returned') {
      filtered = filtered.filter((t) => getTripCategory(t) === 'returned');
      filtered.sort((a, b) => getDaysRemaining(b.returnDate || b.departureDate) - getDaysRemaining(a.returnDate || a.departureDate));
    } else if (sortByProximity) {
      // Proximity mode: ALL trips sorted by nearest departure first (ascending)
      filtered.sort((a, b) => getDaysRemaining(a.departureDate) - getDaysRemaining(b.departureDate));
    } else {
      // Default "الكل" tab: sort by departure date ascending so nearest month shows first
      filtered.sort((a, b) => getDaysRemaining(a.departureDate) - getDaysRemaining(b.departureDate));
    }
    return filtered;
  }, [trips, activeTab, filterEmployee, filterMonth, searchQuery, sortByProximity]);

  const urgentTrips = useMemo(() => {
    return trips
      .filter((t) => { const cat = getTripCategory(t); if (cat !== 'upcoming') return false; const d = getDaysRemaining(t.departureDate); return d >= 0 && d <= 14; })
      .map((t) => ({ ...t, daysLeft: getDaysRemaining(t.departureDate) }))
      .filter((t) => t.daysLeft <= 14 && t.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [trips]);

  const groupedByMonth = useMemo(() => {
    // When proximity sort is on in "الكل" tab, put all trips in one group
    if (activeTab === 'all' && sortByProximity) {
      if (processedTrips.length === 0) return [];
      return [{ key: '__proximity__', label: 'الأقرب سفراً', trips: processedTrips }];
    }

    const map = new Map<string, TravelWithEmployee[]>();
    for (const trip of processedTrips) {
      const key = getMonthKey(trip.departureDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(trip);
    }
    // Sort trips within each month group by departure date ascending
    map.forEach((monthTrips) => {
      monthTrips.sort((a, b) => dateToSortNumber(a.departureDate) - dateToSortNumber(b.departureDate));
    });
    const groups = Array.from(map, ([key, monthTrips]) => ({
      key, label: getMonthLabel(monthTrips[0]?.departureDate || ''), trips: monthTrips,
    }));
    if (activeTab === 'returned') {
      groups.sort((a, b) => {
        if (a.key === 'غير محدد') return 1;
        if (b.key === 'غير محدد') return -1;
        return dateToSortNumber(b.trips[0]?.departureDate || '') - dateToSortNumber(a.trips[0]?.departureDate || '');
      });
    } else {
      groups.sort((a, b) => {
        if (a.key === 'غير محدد') return 1;
        if (b.key === 'غير محدد') return -1;
        const nearA = Math.min(...a.trips.map(t => Math.abs(getDaysRemaining(t.departureDate))));
        const nearB = Math.min(...b.trips.map(t => Math.abs(getDaysRemaining(t.departureDate))));
        return nearA - nearB;
      });
    }
    return groups;
  }, [processedTrips, activeTab, sortByProximity]);

  const activeFiltersCount = (filterEmployee !== 'all' ? 1 : 0) + (filterMonth !== 'all' ? 1 : 0);
  const clearFilters = () => { setFilterEmployee('all'); setSearchQuery(''); setFilterMonth('all'); };

  const scrollToTrip = useCallback((tripId: string) => {
    setActiveTab('all');
    setFilterEmployee('all');
    setFilterMonth('all');
    setSearchQuery('');
    // Reset first to ensure animation replays even if same trip clicked
    setHighlightId(null);
    requestAnimationFrame(() => {
      setTimeout(() => {
        setHighlightId(tripId);
        const el = document.getElementById(`trip-card-${tripId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    });
  }, [setHighlightId]);

  const getCategoryBadge = (trip: TravelWithEmployee) => {
    const cat = getTripCategory(trip);
    if (cat === 'in_progress') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">🌍 في الرحلة</span>;
    if (cat === 'returned') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 font-medium">✅ رجع</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">✈ قريب</span>;
  };

  /* ─── Service Toggle (used inside expanded dropdown) ─── */
  const ServiceToggle = ({ trip, service, label, Icon }: {
    trip: TravelWithEmployee; service: string; label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }) => {
    const hasField = `has${service.charAt(0).toUpperCase() + service.slice(1)}` as keyof TravelDeal;
    const statusField = `${service}Status` as keyof TravelDeal;
    const has = trip[hasField] as boolean;
    const svcStatus = (trip[statusField] as string) || (has ? 'booked' : 'missing');
    const isBooked = svcStatus === 'booked';
    const isPending = svcStatus === 'pending';

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
        onClick={() => quickToggleService(trip.id, service)}
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
  };

  const QuickStatusBtns = ({ trip }: { trip: TravelWithEmployee }) => {
    const statuses: { key: string; label: string; activeClass: string }[] = [
      { key: 'upcoming', label: 'تعديل', activeClass: 'bg-blue-500/20 text-blue-400 ring-blue-500/40' },
      { key: 'in_progress', label: 'جاري', activeClass: 'bg-amber-500/20 text-amber-400 ring-amber-500/40' },
      { key: 'completed', label: 'مكتمل', activeClass: 'bg-green-500/20 text-green-400 ring-green-500/40' },
      { key: 'canceled', label: 'ملغي', activeClass: 'bg-red-500/20 text-red-400 ring-red-500/40' },
    ];
    return (
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => {
          if (trip.status === s.key) {
            return <span key={s.key} className={`text-[10px] px-2 py-0.5 rounded-full ring-1 font-medium ${s.activeClass}`}>{s.label}</span>;
          }
          return (
            <button key={s.key} onClick={() => quickChangeStatus(trip.id, s.key)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/30 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer">
              {s.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderFormDialog = (title: string, open: boolean, onOpenChange: (v: boolean) => void) => (
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
          {(['flight', 'hotel', 'visa', 'tours', 'transportation'] as const).map((svc) => {
            const labels: Record<string, string> = { flight: 'الطيران', hotel: 'الفندق', visa: 'التأشيرة', tours: 'الجولات', transportation: 'المواصلات' };
            return (
              <div key={svc} className="space-y-2">
                <Label className="text-slate-300">حالة {labels[svc]}</Label>
                <Select value={form[`${svc}Status` as keyof TravelFormData] as string} onValueChange={(v) => { updateForm(`${svc}Status` as keyof TravelFormData, v); updateForm(`has${svc.charAt(0).toUpperCase() + svc.slice(1)}` as keyof TravelFormData, v === 'booked'); }}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="booked" className="text-white">محجوز</SelectItem>
                    <SelectItem value="pending" className="text-white">معلق</SelectItem>
                    <SelectItem value="missing" className="text-white">غير موجود</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="ملاحظات إضافية..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setForm(emptyForm); setEditingTrip(null); }} className="border-slate-600 text-slate-300">إلغاء</Button>
          <Button onClick={handleSave} disabled={saving || !form.employeeId || !form.destination || !form.departureDate} className="bg-emerald-600 hover:bg-emerald-700 text-white">{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /* ═══════════════════════════════════════════════════════════
     ── COLLAPSIBLE TRIP CARD ──
     Dealer name shown prominently, employee inside expanded
     ═══════════════════════════════════════════════════════════ */
  const renderTripCard = (trip: TravelWithEmployee, showCategoryBadge: boolean) => {
    const daysLeft = getDaysRemaining(trip.departureDate);
    const retDays = trip.returnDate ? getDaysRemaining(trip.returnDate) : null;
    const cat = getTripCategory(trip);
    const isHighlighted = highlightId === trip.id;
    const isExpanded = expandedCardId === trip.id;

    // Card border/bg based on category
    const cardBorderClass = cat === 'in_progress'
      ? 'border-amber-500/40'
      : cat === 'returned'
        ? 'border-slate-700/40'
        : (() => {
            const ul = getUrgencyLevel(daysLeft);
            return ul === 'critical' ? 'border-red-500/50'
              : ul === 'urgent' ? 'border-amber-500/40'
                : ul === 'soon' ? 'border-yellow-500/30'
                  : 'border-slate-700/50';
          })();

    // Countdown display
    const countdownInfo = (() => {
      if (cat === 'in_progress' && retDays !== null) {
        return { value: retDays, label: 'للعودة', color: retDays <= 2 ? 'text-red-400' : retDays <= 5 ? 'text-amber-400' : 'text-white' };
      }
      if (cat === 'returned') {
        return { value: Math.abs(retDays || daysLeft), label: 'منذ يوم', color: 'text-slate-400' };
      }
      const ul = getUrgencyLevel(daysLeft);
      return {
        value: daysLeft, label: 'يوم',
        color: ul === 'critical' ? 'text-red-400' : ul === 'urgent' ? 'text-amber-400' : ul === 'soon' ? 'text-yellow-400' : 'text-white',
      };
    })();

    // Avatar color
    const avatarClass = cat === 'in_progress'
      ? 'bg-amber-500/15 text-amber-400'
      : cat === 'returned'
        ? 'bg-slate-600/20 text-slate-400'
        : (() => {
            const ul = getUrgencyLevel(daysLeft);
            return ul === 'critical' ? 'bg-red-500/15 text-red-400'
              : ul === 'urgent' ? 'bg-amber-500/15 text-amber-400'
                : ul === 'soon' ? 'bg-yellow-500/15 text-yellow-400'
                  : 'bg-cyan-500/15 text-cyan-400';
          })();

    // Dealer name is always primary on card; employee only inside expanded
    const dealerName = trip.dealerName || '';
    const displayName = dealerName || trip.employeeName;
    const displayInitial = displayName.charAt(0);

    return (
      <Collapsible
        key={trip.id}
        open={isExpanded}
        onOpenChange={(open) => setExpandedCardId(open ? trip.id : null)}
        id={`trip-card-${trip.id}`}
        ref={isHighlighted ? highlightRef : undefined}
      >
        {/* ── UNIFIED BORDER WRAPPER: wraps header + expanded details ── */}
        <motion.div
          className={`relative rounded-xl border overflow-hidden transition-colors duration-300 ${cardBorderClass} bg-slate-800/30`}
          animate={isHighlighted ? {
            boxShadow: [
              '0 0 0 0 rgba(244, 63, 94, 0.5)',
              '0 0 24px 6px rgba(244, 63, 94, 0.3)',
              '0 0 0 0 rgba(244, 63, 94, 0)',
            ],
          } : { boxShadow: '0 0 0 0 rgba(244, 63, 94, 0)' }}
          transition={isHighlighted ? {
            duration: 1,
            repeat: 2,
            repeatType: 'loop',
            ease: 'easeInOut',
          } : { duration: 0.3 }}
        >
        {/* ── COMPACT CARD HEADER (always visible) ── */}
        <CollapsibleTrigger asChild>
          <div
            className={`flex items-center justify-between gap-3 p-3.5 cursor-pointer select-none transition-all duration-200 hover:bg-slate-800/40`}
          >
            {/* Left: Avatar + Name + Badges */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Avatar */}
              <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${avatarClass}`}>
                {displayInitial}
              </div>

              <div className="min-w-0 flex-1">
                {/* Row 1: Dealer name (primary) + badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  {dealerName ? (
                    <span className="text-cyan-400 text-[10px] shrink-0">👤</span>
                  ) : null}
                  <span className="text-white font-semibold text-sm truncate">{displayName}</span>
                  {getStatusBadge(trip.status)}
                  {showCategoryBadge && getCategoryBadge(trip)}
                  {/* Urgent pulse */}
                  {cat === 'in_progress' && (
                    <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 2, repeat: Infinity }}>
                      <span className="absolute inset-0 rounded-full bg-amber-500" />
                    </motion.span>
                  )}
                  {cat === 'upcoming' && getUrgencyLevel(daysLeft) === 'critical' && (
                    <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                      <span className="absolute inset-0 rounded-full bg-red-500" />
                    </motion.span>
                  )}
                </div>

                {/* Row 2: Responsible employee (small) + Destination + Urgency */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {dealerName && (
                    <span className="text-[11px] text-slate-500 truncate max-w-37.5">
                      <span className="text-emerald-500/70">المسئول:</span> {trip.employeeName}
                    </span>
                  )}
                  <span className="text-sm text-slate-300">🌍 {trip.destination}</span>
                  {cat === 'upcoming' && getUrgencyLevel(daysLeft) !== 'normal' && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      getUrgencyLevel(daysLeft) === 'critical' ? 'text-red-400 bg-red-500/15'
                        : getUrgencyLevel(daysLeft) === 'urgent' ? 'text-amber-400 bg-amber-500/15'
                          : 'text-yellow-400 bg-yellow-500/15'
                    }`}>
                      {getUrgencyLabel(daysLeft)}
                    </span>
                  )}
                  {cat === 'in_progress' && retDays !== null && retDays >= 0 && (
                    <span className="text-[10px] font-medium text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full">
                      العودة {trip.returnDate}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Countdown + Actions + Expand */}
            <div className="flex items-center gap-2.5 shrink-0">
              {/* Countdown */}
              <div className="text-center min-w-12.5">
                <div className={`text-xl font-bold tabular-nums ${countdownInfo.color}`}>
                  {countdownInfo.value}
                </div>
                <span className="text-slate-500 text-[10px]">{countdownInfo.label}</span>
              </div>

              {/* Edit/Delete */}
              {canEdit && (
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(trip)} className="text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 size-7"><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeletingId(trip.id)} className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 size-7"><Trash2 className="size-3.5" /></Button>
                </div>
              )}

              {/* Expand icon */}
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-slate-500"
              >
                <ChevronDown className="size-4" />
              </motion.div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* ── EXPANDED DETAILS (inside the same border wrapper) ── */}
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
                <ScrollArea className="max-h-[flexiblepx]">
                  <div className="p-4 space-y-4">
                    {/* ── Responsible Employee ── */}
                    

                    {/* ── Dates row ── */}
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

                    {/* ── Dealer & Customers ── */}
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
                            <span className="text-slate-500 shrink-0 ">المسافرين:</span>
                            <span className="text-white text-right ">{trip.customerNames}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Service Statuses ── */}
                    <div>
                      <p className="text-xs text-slate-500 mb-0 font-medium">حالة الخدمات</p>
                      <div className="flex flex-wrap gap-2">
                        <ServiceToggle trip={trip} service="flight" label="طيران" Icon={Plane} />
                        <ServiceToggle trip={trip} service="hotel" label="فندق" Icon={Hotel} />
                        <ServiceToggle trip={trip} service="visa" label="تأشيرة" Icon={CreditCard} />
                        <ServiceToggle trip={trip} service="tours" label="جولات" Icon={Palmtree} />
                        <ServiceToggle trip={trip} service="transportation" label="مواصلات" Icon={Car} />
                      </div>
                    </div>

                    {/* ── Missing items ── */}
                    {[
                      { label: 'رحلة طيران', missing: !trip.hasFlight, icon: <Plane className="size-3" /> },
                      { label: 'فندق', missing: !trip.hasHotel, icon: <Hotel className="size-3" /> },
                      { label: 'تأشيرة', missing: !trip.hasVisa, icon: <CreditCard className="size-3" /> },
                      { label: 'جولات', missing: !trip.hasTours, icon: <Palmtree className="size-3" /> },
                      { label: 'مواصلات', missing: !trip.hasTransportation, icon: <Car className="size-3" /> },
                    ].filter((i) => i.missing).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'رحلة طيران', missing: !trip.hasFlight, icon: <Plane className="size-3" /> },
                          { label: 'فندق', missing: !trip.hasHotel, icon: <Hotel className="size-3" /> },
                          { label: 'تأشيرة', missing: !trip.hasVisa, icon: <CreditCard className="size-3" /> },
                          { label: 'جولات', missing: !trip.hasTours, icon: <Palmtree className="size-3" /> },
                          { label: 'مواصلات', missing: !trip.hasTransportation, icon: <Car className="size-3" /> },
                        ]
                          .filter((i) => i.missing)
                          .map((item) => (
                            <Badge key={item.label} variant="outline" className="border-red-500/25 text-red-400/80 text-[11px] gap-1">
                              <AlertTriangle className="size-3" />
                              {item.label}
                            </Badge>
                          ))}
                      </div>
                    )}

                    {/* ── Notes ── */}
                    {trip.notes && (
                      <div className="text-sm bg-slate-800/30 rounded-lg p-flexible border border-slate-700/20">
                        <p className="text-slate-500 text-xs mb-2 px-2">📝 ملاحظات</p>
                        <p className="text-slate-300 text-xs mt-1 px-3" style={{ direction: 'rtl' }}>{trip.notes}</p>
                      </div>
                    )}

                    {/* ── Quick Status Buttons ── */}
                    {canEdit && (
                      <div>
                        <p className="text-xs text-slate-500 mb-2 font-medium">تغيير الحالة</p>
                        <QuickStatusBtns trip={trip} />
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </motion.div>
      </Collapsible>
    );
  };

  // ── Month group renderers ──
  const renderAllMonthGroup = (group: { key: string; label: string; trips: TravelWithEmployee[] }) => {
    const cardTrips = group.trips.filter((t) => getTripCategory(t) !== 'returned');
    const tableTrips = group.trips.filter((t) => getTripCategory(t) === 'returned');

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
            <AnimatePresence>{cardTrips.map((trip) => renderTripCard(trip, true))}</AnimatePresence>
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
                      <TableCell className="text-slate-400 text-xs hidden md:table-cell truncate max-w-37.5">{trip.customerNames || '—'}</TableCell>
                      <TableCell>{getStatusBadge(trip.status)}</TableCell>
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
          <AnimatePresence>{group.trips.map((trip) => renderTripCard(trip, false))}</AnimatePresence>
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
                  <TableCell>{getStatusBadge(trip.status)}</TableCell>
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

  // ── Chevron icon for alert banner ──
  const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg className={`size-4 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <div dir="rtl" className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Plane className="size-6 text-emerald-400" />
            إدارة السفر
          </h1>
          <p className="text-slate-400 mt-1 text-sm">{upcomingCount + inProgressCount} رحلة نشطة • {allCount} إجمالي</p>
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
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="rounded-xl border border-red-500/30 bg-linear-to-l from-red-500/10 via-slate-900 to-slate-900 overflow-hidden">
            <button
              onClick={() => setAlertOpen(!alertOpen)}
              className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-red-500/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                  <BellRing className="size-5 text-red-400" />
                </motion.div>
                <span className="text-red-400 font-semibold text-sm">تنبيهات: {urgentTrips.length} رحلة قريبة السفر</span>
                {urgentTrips.filter((t) => t.daysLeft <= 3 && t.daysLeft >= 0).length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/30 text-red-300 animate-pulse">
                    {urgentTrips.filter((t) => t.daysLeft <= 3 && t.daysLeft >= 0).length} حرجة
                  </span>
                )}
              </div>
              <ChevronIcon open={alertOpen} />
            </button>
            <AnimatePresence>
              {alertOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-3 space-y-1.5 max-h-50 overflow-y-auto">
                    {urgentTrips.map((trip) => {
                      const level = getUrgencyLevel(trip.daysLeft);
                      const levelStyles: Record<UrgencyLevel, string> = { critical: 'bg-red-500/15 border-red-500/30', urgent: 'bg-amber-500/10 border-amber-500/25', soon: 'bg-yellow-500/10 border-yellow-500/20', normal: 'bg-slate-800/50 border-slate-700/30' };
                      const textColor: Record<UrgencyLevel, string> = { critical: 'text-red-400', urgent: 'text-amber-400', soon: 'text-yellow-400', normal: 'text-slate-400' };
                      return (
                        <motion.div key={trip.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          onClick={() => scrollToTrip(trip.id)}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border ${levelStyles[level]} cursor-pointer hover:brightness-125 transition-all duration-150`}
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
                            <span className={`text-xs font-bold ${textColor[level]}`}>{getUrgencyLabel(trip.daysLeft)}</span>
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
                <span className={`text-[10px] sm:text-xs font-bold min-w-5.5 text-center px-1.5 py-0.5 rounded-full transition-colors duration-300 ${isActive ? config.badgeClass : 'bg-slate-700/50 text-slate-500'}`}>
                  {tabCounts[tabKey]}
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
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-35 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs">كل الموظفين</SelectItem>
              {employees.map((emp) => <SelectItem key={emp.id} value={emp.id} className="text-white text-xs">{emp.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-white h-8 w-35 text-xs">
              <CalendarDays className="size-3.5 ml-1 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white text-xs">كل الأشهر</SelectItem>
              {availableMonths.map((m) => <SelectItem key={m} value={m} className="text-white text-xs">{getMonthLabel(m.replace('-', '/'))}</SelectItem>)}
            </SelectContent>
          </Select>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" onClick={clearFilters} className="text-slate-500 hover:text-red-400 text-xs h-8 px-2">
              <XCircle className="size-3" /> مسح الفلاتر
            </Button>
          )}
          {/* Proximity sort toggle */}
          <button
            onClick={() => setSortByProximity((p) => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 cursor-pointer select-none ${
              sortByProximity
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 shadow-sm shadow-amber-500/5'
                : 'border-slate-700/40 bg-slate-800/30 text-slate-500 hover:text-slate-400 hover:border-slate-700/60'
            }`}
            title={sortByProximity ? 'ترتيب: الأقرب سفراً أولاً' : 'ترتيب: حسب الشهر'}
          >
            {sortByProximity ? <Zap className="size-3.5" /> : <ArrowUpDown className="size-3.5" />}
            {sortByProximity ? 'الأقرب أولاً' : 'ترتيب بالتقريب'}
          </button>
          <span className="text-slate-500 text-xs mr-auto">{processedTrips.length} نتيجة</span>
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl bg-slate-800" />)}</div>
      ) : trips.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Plane className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد رحلات</p>
            <p className="text-slate-500 text-sm mt-1">أضف رحلات السفر الجديدة أو ارفع شيت حجوزات</p>
          </CardContent>
        </Card>
      ) : processedTrips.length === 0 ? (
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
          </motion.div>
        </AnimatePresence>
      )}

      {/* Dialogs */}
      {renderFormDialog('إضافة رحلة سفر جديدة', isAddOpen, setIsAddOpen)}
      {renderFormDialog(`تعديل: ${editingTrip?.destination}`, !!editingTrip, (v) => { if (!v) setEditingTrip(null); })}

      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">هل أنت متأكد من حذف هذه الرحلة؟</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button variant="destructive" onClick={() => { if (deletingId) handleDelete(deletingId); }}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={isUploadOpen} onOpenChange={(v) => { if (!v) closeUpload(); }}>
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
    </div>
  );
}
