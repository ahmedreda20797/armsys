'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Bell, CheckCircle2, AlertTriangle, Clock, Trash2, Eye, EyeOff, Archive,
  Filter, Search, X, ChevronDown, ChevronUp, Zap, ShieldAlert, Check,
  Inbox, BarChart3, Activity, AlertOctagon, MessageSquareWarning, Award,
  Users, Plane, FileText, Fingerprint, ClipboardList, Settings,
  ExternalLink, Loader2, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppNotification } from '@/types';

// ═══════════════════════════════════════════════════
//  CONSTANTS & MAPS
// ═══════════════════════════════════════════════════

const CATEGORY_ICONS: Record<string, string> = {
  attendance: '⏰',
  biometric: '👆',
  requests: '📋',
  quality: '🏆',
  hr: '💰',
  risk: '⚠️',
  followUp: '📝',
  employee: '👤',
  travel: '✈️',
  system: '⚙️',
  automation: '🤖',
  complaint: '💬',
  capa: '🛡️',
};

const CATEGORY_LABELS: Record<string, string> = {
  attendance: 'الحضور',
  biometric: 'البصمة',
  requests: 'الطلبات',
  quality: 'الجودة',
  hr: 'الموارد البشرية',
  risk: 'المخاطر',
  followUp: 'المتابعة',
  employee: 'الموظفين',
  travel: 'السفر',
  system: 'النظام',
  automation: 'الأتمتة',
  complaint: 'الشكاوى',
  capa: 'كابا',
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; border: string; bg: string }> = {
  critical: { label: 'حرج', color: 'text-red-400', border: 'border-red-500', bg: 'bg-red-500/15' },
  high:    { label: 'مرتفع', color: 'text-orange-400', border: 'border-orange-500', bg: 'bg-orange-500/15' },
  medium:  { label: 'متوسط', color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500/15' },
  low:     { label: 'منخفض', color: 'text-slate-400', border: 'border-slate-500', bg: 'bg-slate-500/15' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  unread:       { label: 'غير مقروء', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  read:         { label: 'مقروء', color: 'text-slate-400', bg: 'bg-slate-500/15' },
  acknowledged: { label: 'مُعترف به', color: 'text-cyan-400', bg: 'bg-cyan-500/15' },
  resolved:     { label: 'تم الحل', color: 'text-green-400', bg: 'bg-green-500/15' },
  archived:     { label: 'مؤرشف', color: 'text-slate-500', bg: 'bg-slate-700/50' },
  dismissed:    { label: 'مستبعد', color: 'text-slate-500', bg: 'bg-slate-700/50' },
};

const MODULE_LIST = [
  'attendance', 'biometric', 'requests', 'quality', 'hrDeductions',
  'travel', 'followUps', 'capa', 'complaints', 'employees',
  'rulesEngine', 'riskCenter', 'system', 'automation',
];

const MODULE_LABELS: Record<string, string> = {
  attendance: 'الحضور والانصراف',
  biometric: 'البصمة',
  requests: 'الطلبات',
  quality: 'الجودة',
  hrDeductions: 'خصوم الموارد البشرية',
  travel: 'السفر',
  followUps: 'المتابعات',
  capa: 'كابا',
  complaints: 'الشكاوى',
  employees: 'الموظفين',
  rulesEngine: 'محرك القواعد',
  riskCenter: 'مركز المخاطر',
  system: 'النظام',
  automation: 'الأتمتة',
};

const PAGE_SIZE = 20;

// ═══════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
} as const;

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string) {
  return `${formatDate(iso)} — ${formatTime(iso)}`;
}

function isOverdue(notification: AppNotification): boolean {
  if (notification.status === 'resolved' || notification.status === 'archived' || notification.status === 'dismissed') return false;
  const created = new Date(notification.createdAt).getTime();
  const now = Date.now();
  return (now - created) > 24 * 60 * 60 * 1000; // 24h+
}

// ═══════════════════════════════════════════════════
//  Navigation helper — resolve target page from notification
//  Every notification MUST resolve to a destination (never null)
// ═══════════════════════════════════════════════════

const CATEGORY_TARGET_MAP: Record<string, string> = {
  attendance: 'attendance',
  biometric: 'biometric',
  requests: 'requests',
  quality: 'quality',
  hr: 'hrDeductions',
  risk: 'riskCenter',
  followUp: 'followUps',
  employee: 'employees',
  travel: 'travel',
  system: 'notifications',
  automation: 'rulesEngine',
  complaint: 'complaints',
  capa: 'capa',
};

const MODULE_PAGE_MAP: Record<string, string> = {
  attendance: 'attendance',
  biometric: 'biometric',
  requests: 'requests',
  quality: 'quality',
  hrDeductions: 'hrDeductions',
  travel: 'travel',
  followUps: 'followUps',
  capa: 'capa',
  complaints: 'complaints',
  employees: 'employees',
  rulesEngine: 'rulesEngine',
  riskCenter: 'riskCenter',
  system: 'notifications',
  automation: 'rulesEngine',
  manual: 'notifications',
};

// ═══════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════

export default function NotificationCenterPage() {
  const { canView } = usePermissions('notifications');
  const { refresh: refreshRealtime, markRead: markReadContext } = useNotificationContext();
  const { navigateTo, openEmployee360 } = useAppStore();

  // ── State: notifications ──
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // ── State: stats ──
  const [stats, setStats] = useState<{
    total: number; unread: number; critical: number; today: number;
    overdue: number; escalated: number; generatedToday: number; rulesTriggeredToday: number;
  } | null>(null);

  // ── State: filters ──
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ── State: selection & actions ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refreshingBg, setRefreshingBg] = useState(false);
  const lastFetchTimeRef = useRef<number>(0);

  // ── Fetch notifications (initial or manual: shows loading; background: silent merge) ──
  const fetchNotifications = async (offset = 0, silent = false) => {
    if (!silent) {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      const res = await fetch(`/api/notifications?${params}`);
      if (res.ok) {
        const data = await res.json();
        const items: AppNotification[] = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
        lastFetchTimeRef.current = Date.now();

        if (silent && offset === 0) {
          // Silent background refresh: merge new items into existing list
          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const newItems = items.filter(n => !existingIds.has(n.id));
            if (newItems.length === 0) return prev;
            // Merge: new items at top, keep existing, maintain sorted order
            const merged = [...items, ...prev];
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return merged;
          });
        } else if (offset === 0) {
          setNotifications(items);
        } else {
          setNotifications(prev => [...prev, ...items]);
        }
        setHasMore(items.length === PAGE_SIZE);
        setTotalCount(data.total || items.length);
      }
    } catch {
      if (!silent) toast.error('حدث خطأ أثناء تحميل الإشعارات');
    } finally {
      if (!silent) {
        setLoading(false);
        setLoadingMore(false);
      } else {
        setRefreshingBg(false);
      }
    }
  };

  // ── Fetch stats ──
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/notification-stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // stats are non-critical, silent fail
    }
  };

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    fetchNotifications(0);
    fetchStats();
  }, []);

  // ── Silent background refresh every 15 seconds (no UI flash) ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (!canView || loading) return;
      setRefreshingBg(true);
      fetchNotifications(0, true);
      fetchStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [canView, loading]);

  // ── Client-side filtered list ──
  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      if (priorityFilter !== 'all' && n.priority !== priorityFilter) return false;
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
      if (moduleFilter !== 'all' && n.sourceModule !== moduleFilter) return false;
      if (dateFrom) {
        const d = new Date(n.createdAt);
        if (d < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const d = new Date(n.createdAt);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (d > to) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const haystack = `${n.title} ${n.description} ${n.employeeName || ''}`.toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    });
  }, [notifications, priorityFilter, statusFilter, categoryFilter, moduleFilter, dateFrom, dateTo, search]);

  // ── Paginated display ──
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const displayedNotifications = useMemo(() => {
    return filteredNotifications.slice(0, displayCount);
  }, [filteredNotifications, displayCount]);

  const canLoadMore = displayCount < filteredNotifications.length;

  const loadMore = () => {
    setDisplayCount(prev => prev + PAGE_SIZE);
  };

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
    setSelectedIds(new Set());
  }, [priorityFilter, statusFilter, categoryFilter, moduleFilter, search, dateFrom, dateTo]);

  // ── Selection helpers ──
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedNotifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedNotifications.map(n => n.id)));
    }
  };

  const hasSelection = selectedIds.size > 0;

  // ── Action helpers ──
  const handleMarkRead = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'read' as const, readAt: new Date().toISOString() } : n));
        toast.success('تم تعليم الإشعار كمقروء');
        fetchStats();
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkUnread = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unread' }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'unread' as const, readAt: null } : n));
        toast.success('تم تعليم الإشعار كغير مقروء');
        fetchStats();
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'resolved' as const, resolvedAt: new Date().toISOString() } : n));
        toast.success('تم حل الإشعار');
        fetchStats();
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'archived' as const } : n));
        toast.success('تم أرشفة الإشعار');
        fetchStats();
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setNotifications(prev => prev.filter(n => n.id !== id));
        setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        toast.success('تم حذف الإشعار');
        fetchStats();
        setDeletingId(null);
      }
    } catch {
      toast.error('حدث خطأ أثناء الحذف');
    }
  };

  // ── Bulk actions ──
  const handleBulkRead = async () => {
    const ids = Array.from(selectedIds);
    setActionLoading('bulk');
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/notifications/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'read' }),
        })
      ));
      setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, status: 'read' as const, readAt: new Date().toISOString() } : n));
      toast.success(`تم تعليم ${ids.length} إشعار كمقروء`);
      setSelectedIds(new Set());
      fetchStats();
    } catch {
      toast.error('حدث خطأ أثناء التحديث');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkResolve = async () => {
    const ids = Array.from(selectedIds);
    setActionLoading('bulk');
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/notifications/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'resolved' }),
        })
      ));
      setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, status: 'resolved' as const, resolvedAt: new Date().toISOString() } : n));
      toast.success(`تم حل ${ids.length} إشعار`);
      setSelectedIds(new Set());
      fetchStats();
    } catch {
      toast.error('حدث خطأ أثناء التحديث');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setActionLoading('bulk');
    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/notifications/${id}`, { method: 'DELETE' })
      ));
      setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
      toast.success(`تم حذف ${ids.length} إشعار`);
      setSelectedIds(new Set());
      fetchStats();
    } catch {
      toast.error('حدث خطأ أثناء الحذف');
    } finally {
      setActionLoading(null);
    }
  };

  const clearFilters = () => {
    setPriorityFilter('all');
    setStatusFilter('all');
    setCategoryFilter('all');
    setModuleFilter('all');
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = priorityFilter !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all' || moduleFilter !== 'all' || search || dateFrom || dateTo;

  // ── Permission guard ──
  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <Bell className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">غير مصرح بالوصول</p>
        <p className="text-slate-600 text-xs mt-1">ليس لديك صلاحية لعرض مركز الإشعارات</p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════

  return (
    <div dir="rtl" className="space-y-5">

      {/* ═══ Header ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-blue-500/15 border border-blue-500/30">
            <Bell className="size-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">مركز الإشعارات</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              إدارة وتتبع جميع التنبيهات والإشعارات
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { fetchNotifications(0, true); fetchStats(); }}
            disabled={refreshingBg}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw className={`size-4 ml-1 ${refreshingBg ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
        </div>
      </motion.div>

      {/* ═══ Dashboard Stats Cards ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5"
      >
        {/* Total Notifications */}
        <div className="rounded-lg border border-slate-700/25 bg-slate-800/40 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">إجمالي الإشعارات</p>
          <p className="text-white font-bold text-lg leading-tight">{stats?.total ?? notifications.length}</p>
        </div>
        {/* Unread */}
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">غير مقروء</p>
          <p className="text-blue-400 font-bold text-lg leading-tight">{stats?.unread ?? 0}</p>
        </div>
        {/* Critical */}
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">حرج</p>
          <p className="text-red-400 font-bold text-lg leading-tight">{stats?.critical ?? 0}</p>
        </div>
        {/* Today */}
        <div className="rounded-lg border border-green-500/25 bg-green-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">إشعارات اليوم</p>
          <p className="text-green-400 font-bold text-lg leading-tight">{stats?.today ?? 0}</p>
        </div>
        {/* Overdue 24h+ */}
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">متأخر (24ساعة+)</p>
          <p className="text-amber-400 font-bold text-lg leading-tight">{stats?.overdue ?? notifications.filter(isOverdue).length}</p>
        </div>
        {/* Escalated */}
        <div className="rounded-lg border border-purple-500/25 bg-purple-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">تم التصعيد</p>
          <p className="text-purple-400 font-bold text-lg leading-tight">{stats?.escalated ?? 0}</p>
        </div>
        {/* Generated Today */}
        <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">تم الإنشاء اليوم</p>
          <p className="text-cyan-400 font-bold text-lg leading-tight">{stats?.generatedToday ?? 0}</p>
        </div>
        {/* Rules Triggered Today */}
        <div className="rounded-lg border border-orange-500/25 bg-orange-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">قواعد مُفعّلة اليوم</p>
          <p className="text-orange-400 font-bold text-lg leading-tight">{stats?.rulesTriggeredToday ?? 0}</p>
        </div>
      </motion.div>

      {/* ═══ Filters Bar ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-2 items-center">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  placeholder="بحث بالعنوان أو الوصف أو اسم الموظف..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Priority */}
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                  <AlertOctagon className="size-3.5 ml-1.5 text-slate-500" />
                  <SelectValue placeholder="الأولوية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-white">كل الأولويات</SelectItem>
                  <SelectItem value="low" className="text-white">منخفض</SelectItem>
                  <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                  <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                  <SelectItem value="critical" className="text-white">حرج</SelectItem>
                </SelectContent>
              </Select>

              {/* Status */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                  <CheckCircle2 className="size-3.5 ml-1.5 text-slate-500" />
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-white">كل الحالات</SelectItem>
                  <SelectItem value="unread" className="text-white">غير مقروء</SelectItem>
                  <SelectItem value="read" className="text-white">مقروء</SelectItem>
                  <SelectItem value="acknowledged" className="text-white">مُعترف به</SelectItem>
                  <SelectItem value="resolved" className="text-white">تم الحل</SelectItem>
                  <SelectItem value="archived" className="text-white">مؤرشف</SelectItem>
                  <SelectItem value="dismissed" className="text-white">مستبعد</SelectItem>
                </SelectContent>
              </Select>

              {/* Category */}
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                  <ClipboardList className="size-3.5 ml-1.5 text-slate-500" />
                  <SelectValue placeholder="الفئة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-white">كل الفئات</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key} className="text-white">
                      {CATEGORY_ICONS[key]} {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Module */}
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-40 h-9 text-sm">
                  <Settings className="size-3.5 ml-1.5 text-slate-500" />
                  <SelectValue placeholder="الوحدة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-white">كل الوحدات</SelectItem>
                  {MODULE_LIST.map(m => (
                    <SelectItem key={m} value={m} className="text-white">
                      {MODULE_LABELS[m] || m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date From */}
              <div className="relative">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm"
                  placeholder="من تاريخ"
                />
              </div>

              {/* Date To */}
              <div className="relative">
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm"
                  placeholder="إلى تاريخ"
                />
              </div>

              {/* Clear filters */}
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-slate-400 hover:text-white h-9 px-3"
                >
                  <X className="size-3.5 ml-1" />
                  مسح
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ Bulk Actions Bar ═══ */}
      <AnimatePresence>
        {hasSelection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-blue-400" />
                    <span className="text-blue-300 text-sm font-medium">
                      تم تحديد {selectedIds.size} إشعار
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mr-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkRead}
                      disabled={actionLoading === 'bulk'}
                      className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200 h-8 text-xs"
                    >
                      <Eye className="size-3.5 ml-1" />
                      تعيين كمقروء
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkResolve}
                      disabled={actionLoading === 'bulk'}
                      className="border-green-500/30 text-green-300 hover:bg-green-500/10 hover:text-green-200 h-8 text-xs"
                    >
                      <CheckCircle2 className="size-3.5 ml-1" />
                      تعيين كمحلول
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkDelete}
                      disabled={actionLoading === 'bulk'}
                      className="border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200 h-8 text-xs"
                    >
                      <Trash2 className="size-3.5 ml-1" />
                      حذف المحدد
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      className="text-slate-400 hover:text-white h-8 text-xs"
                    >
                      <X className="size-3.5 ml-1" />
                      إلغاء التحديد
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Results count + select all ═══ */}
      {!loading && filteredNotifications.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedIds.size === displayedNotifications.length && displayedNotifications.length > 0}
                onChange={toggleSelectAll}
                className="size-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30 accent-blue-500"
              />
              <span className="text-slate-400 text-xs">تحديد الكل</span>
            </label>
            <span className="text-slate-500 text-xs">
              عرض {displayedNotifications.length} من {filteredNotifications.length} إشعار
              {hasFilters && ` (من أصل ${notifications.length})`}
            </span>
          </div>
        </div>
      )}

      {/* ═══ Loading Skeleton ═══ */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        /* ═══ Empty State ═══ */
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="size-14 rounded-full bg-slate-800 flex items-center justify-center mb-4">
              <Inbox className="size-7 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد إشعارات</p>
            <p className="text-slate-600 text-xs mt-1">
              {hasFilters
                ? 'لا توجد نتائج تطابق الفلاتر المحددة'
                : 'لا توجد إشعارات حالياً'}
            </p>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="mt-3 text-slate-400 hover:text-white text-xs"
              >
                <Filter className="size-3.5 ml-1" />
                مسح الفلاتر
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ═══ Notification Feed ═══ */
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-2"
        >
          <AnimatePresence mode="popLayout">
            {displayedNotifications.map((notification) => {
              const priConf = PRIORITY_CONFIG[notification.priority] || PRIORITY_CONFIG.low;
              const statConf = STATUS_CONFIG[notification.status] || STATUS_CONFIG.read;
              const catIcon = CATEGORY_ICONS[notification.category] || '🔔';
              const catLabel = CATEGORY_LABELS[notification.category] || notification.category;
              const modLabel = MODULE_LABELS[notification.sourceModule] || notification.sourceModule;
              const isSelected = selectedIds.has(notification.id);
              const isUnread = notification.status === 'unread';
              const overdue = isOverdue(notification);
              const isActing = actionLoading === notification.id;

              return (
                <motion.div
                  key={notification.id}
                  variants={itemVariants}
                  layout
                  exit={{ opacity: 0, x: 50, transition: { duration: 0.2 } }}
                >
                  <Card
                    className={`
                      border-slate-700/40 bg-slate-800/30
                      transition-all duration-200
                      ${isSelected ? 'ring-1 ring-blue-500/40 border-blue-500/30' : ''}
                      ${isUnread ? 'border-r-2 border-r-blue-500/60' : ''}
                    `}
                  >
                    <CardContent className="p-0!">
                      <div
                        onClick={() => {
                          // Mark as read
                          if (notification.status === 'unread') markReadContext(notification.id);
                          // Navigate: employee360 override
                          if (notification.actionUrl && notification.actionUrl.startsWith('employee360:')) {
                            openEmployee360(notification.actionUrl.replace('employee360:', ''));
                          } else if (notification.category === 'employee' && notification.employeeId) {
                            openEmployee360(notification.employeeId);
                          } else {
                            const page = notification.targetPage
                              || (notification.actionUrl && !notification.actionUrl.startsWith('employee360:') ? (notification.actionUrl.startsWith('/') ? notification.actionUrl.slice(1) : notification.actionUrl) : null)
                              || CATEGORY_TARGET_MAP[notification.category]
                              || MODULE_PAGE_MAP[notification.sourceModule]
                              || 'notifications';
                            navigateTo(page, notification.sourceRecordId || undefined);
                          }
                        }}
                        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-800/60 rounded-xl transition-colors"
                      >
                        {/* Checkbox */}
                        <div className="flex items-center pt-0.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => { e.stopPropagation(); toggleSelect(notification.id); }}
                            className="size-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30 accent-blue-500 cursor-pointer"
                          />
                        </div>

                        {/* Priority color indicator */}
                        <div className={`w-1 self-stretch rounded-full shrink-0 ${priConf.border.replace('border-', 'bg-')}`} />

                        {/* Category icon */}
                        <div className={`flex items-center justify-center size-9 rounded-lg shrink-0 text-base ${priConf.bg}`}>
                          {catIcon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Title + Badges */}
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h3 className={`text-sm font-semibold truncate ${isUnread ? 'text-white' : 'text-slate-200'}`}>
                              {notification.title}
                            </h3>
                            <Badge className={`text-[10px] px-1.5 py-0 border-0 ${priConf.bg} ${priConf.color}`}>
                              {priConf.label}
                            </Badge>
                            <Badge className={`text-[10px] px-1.5 py-0 border-0 ${statConf.bg} ${statConf.color}`}>
                              {statConf.label}
                            </Badge>
                            {overdue && (
                              <Badge className="text-[10px] px-1.5 py-0 border-0 bg-amber-500/15 text-amber-400">
                                <Clock className="size-2.5 ml-0.5" />
                                متأخر
                              </Badge>
                            )}
                          </div>

                          {/* Row 2: Description */}
                          {notification.description && (
                            <p className="text-slate-400 text-xs leading-relaxed line-clamp-2 mb-1.5">
                              {notification.description}
                            </p>
                          )}

                          {/* Row 3: Metadata */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            {/* Module */}
                            <span className="flex items-center gap-1 text-slate-500">
                              <FileText className="size-3" />
                              {modLabel}
                            </span>

                            {/* Category */}
                            <span className="text-slate-500">
                              {catIcon} {catLabel}
                            </span>

                            {/* Employee */}
                            {notification.employeeId && notification.employeeName && (
                              <EmployeeLink
                                employeeId={notification.employeeId}
                                name={notification.employeeName}
                                compact
                                textClassName="text-[11px]"
                              />
                            )}

                            {/* Assigned to */}
                            {notification.assignedToName && (
                              <span className="flex items-center gap-1 text-slate-500">
                                <Users className="size-3" />
                                {notification.assignedToName}
                              </span>
                            )}

                            {/* Date/Time */}
                            <span className="flex items-center gap-1 text-slate-500 mr-auto">
                              <Clock className="size-3" />
                              {formatDateTime(notification.createdAt)}
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Toggle Read/Unread */}
                          {isUnread ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleMarkRead(notification.id); }}
                              disabled={isActing}
                              title="تعليم كمقروء"
                              className="text-slate-400 hover:text-blue-400 h-8 w-8 p-0"
                            >
                              <Eye className="size-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleMarkUnread(notification.id); }}
                              disabled={isActing}
                              title="تعليم كغير مقروء"
                              className="text-slate-500 hover:text-amber-400 h-8 w-8 p-0"
                            >
                              <EyeOff className="size-4" />
                            </Button>
                          )}

                          {/* Open Record — navigate to related page */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (notification.status === 'unread') markReadContext(notification.id);
                              if (notification.actionUrl && notification.actionUrl.startsWith('employee360:')) {
                                openEmployee360(notification.actionUrl.replace('employee360:', ''));
                              } else if (notification.category === 'employee' && notification.employeeId) {
                                openEmployee360(notification.employeeId);
                              } else {
                                const page = notification.targetPage
                                  || (notification.actionUrl && !notification.actionUrl.startsWith('employee360:') ? (notification.actionUrl.startsWith('/') ? notification.actionUrl.slice(1) : notification.actionUrl) : null)
                                  || CATEGORY_TARGET_MAP[notification.category]
                                  || MODULE_PAGE_MAP[notification.sourceModule]
                                  || 'notifications';
                                navigateTo(page, notification.sourceRecordId || undefined);
                              }
                            }}
                            title="فتح السجل"
                            className="text-slate-400 hover:text-emerald-400 h-8 w-8 p-0"
                          >
                            <ExternalLink className="size-4" />
                          </Button>

                          {/* Resolve */}
                          {notification.status !== 'resolved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleResolve(notification.id); }}
                              disabled={isActing}
                              title="تعيين كمحلول"
                              className="text-slate-400 hover:text-green-400 h-8 w-8 p-0"
                            >
                              <CheckCircle2 className="size-4" />
                            </Button>
                          )}

                          {/* Archive */}
                          {notification.status !== 'archived' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleArchive(notification.id); }}
                              disabled={isActing}
                              title="أرشفة"
                              className="text-slate-400 hover:text-slate-300 h-8 w-8 p-0"
                            >
                              <Archive className="size-4" />
                            </Button>
                          )}

                          {/* Delete */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setDeletingId(notification.id); }}
                            title="حذف"
                            className="text-slate-500 hover:text-red-400 h-8 w-8 p-0"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ═══ Load More ═══ */}
      {canLoadMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
          >
            <ChevronDown className="size-4 ml-1" />
            {loadingMore ? 'جاري التحميل...' : 'تحميل المزيد'}
          </Button>
        </div>
      )}

      {/* ═══ Load more from server ═══ */}
      {!loading && hasMore && !hasFilters && filteredNotifications.length >= totalCount - 5 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNotifications(notifications.length)}
            disabled={loadingMore}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
          >
            <ChevronDown className="size-4 ml-1" />
            {loadingMore ? 'جاري التحميل...' : 'تحميل المزيد من الخادم'}
          </Button>
        </div>
      )}

      {/* ═══ Delete Confirmation Dialog ═══ */}
      <Dialog open={!!deletingId} onOpenChange={open => { if (!open) setDeletingId(null); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">
              هل أنت متأكد من حذف هذا الإشعار؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-3">
            <Button
              variant="ghost"
              onClick={() => setDeletingId(null)}
              className="text-slate-400 hover:text-white"
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && handleDelete(deletingId)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}