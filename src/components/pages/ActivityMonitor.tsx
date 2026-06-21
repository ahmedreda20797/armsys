'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Activity,
  Users,
  BarChart3,
  RefreshCw,
  Search,
  LogIn,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Eye,
  Clock,
  TrendingUp,
  Calendar,
  Filter,
  ChevronDown,
} from 'lucide-react';

interface ActivityLogItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  page: string;
  details: string;
  timestamp?: string;
  createdAt?: string;
  metadata?: Record<string, any>;
}

interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
  lastActivity: string;
}

// Helper to get timestamp from activity log (uses createdAt or timestamp)
function getLogTimestamp(log: ActivityLogItem): string {
  return log.createdAt || log.timestamp || '';
}

// ═══ Action Helpers ═══

function getActionIcon(action: string) {
  switch (action) {
    case 'login': return <LogIn className="size-4 text-violet-400" />;
    case 'logout': return <LogOut className="size-4 text-slate-400" />;
    case 'create': return <Plus className="size-4 text-blue-400" />;
    case 'update': return <Pencil className="size-4 text-amber-400" />;
    case 'delete': return <Trash2 className="size-4 text-red-400" />;
    case 'approve': return <CheckCircle2 className="size-4 text-violet-400" />;
    case 'page_visit': return <Eye className="size-4 text-slate-400" />;
    default: return <Activity className="size-4 text-slate-400" />;
  }
}

function getActionBadge(action: string) {
  switch (action) {
    case 'login': return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[11px] px-2">دخول</Badge>;
    case 'logout': return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/20 text-[11px] px-2">خروج</Badge>;
    case 'create': return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[11px] px-2">إنشاء</Badge>;
    case 'update': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[11px] px-2">تعديل</Badge>;
    case 'delete': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[11px] px-2">حذف</Badge>;
    case 'approve': return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[11px] px-2">موافقة</Badge>;
    case 'page_visit': return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/20 text-[11px] px-2">زيارة</Badge>;
    default: return <Badge variant="outline" className="text-[11px] px-2">{action}</Badge>;
  }
}

function getPageLabel(page: string): string {
  const labels: Record<string, string> = {
    home: 'الرئيسية',
    employees: 'الموظفين',
    biometric: 'البصمة',
    attendance: 'الحضور',
    requests: 'الطلبات',
    rules: 'القواعد',
    quality: 'الجودة',
    travel: 'السفر',
    reports: 'التقارير',
    dashboard: 'لوحة التحكم',
    firebase: 'الإعدادات',
  };
  return labels[page] || page;
}

function getPageBadge(page: string) {
  const colors: Record<string, string> = {
    home: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    employees: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    biometric: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    attendance: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    requests: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    rules: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    quality: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    travel: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    reports: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
    dashboard: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
    firebase: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  };
  const color = colors[page] || 'bg-slate-500/15 text-slate-400 border-slate-500/20';
  return <Badge className={`${color} text-[10px] px-1.5 py-0`}>{getPageLabel(page)}</Badge>;
}

// ═══ Date/Time Helpers ═══

function parseTimestamp(ts: string): Date | null {
  if (!ts) return null;
  try {
    // Try ISO format first
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    // Try DD/MM/YYYY HH:MM:SS
    const parts = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?$/);
    if (parts) {
      const [, day, month, year, hour, min, sec] = parts;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(min),
        parseInt(sec || '0')
      );
    }
    // Try DD/MM/YYYY
    const dateParts = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dateParts) {
      return new Date(parseInt(dateParts[3]), parseInt(dateParts[2]) - 1, parseInt(dateParts[1]));
    }
    return null;
  } catch {
    return null;
  }
}

function formatDateTime(ts: string): string {
  const d = parseTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatTimeOnly(ts: string): string {
  const d = parseTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateOnly(ts: string): string {
  const d = parseTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getRelativeTime(ts: string): string {
  const d = parseTimestamp(ts);
  if (!d) return '—';
  const now = Date.now();
  const time = d.getTime();
  const diffMs = now - time;
  if (diffMs < 0) return 'الآن';
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'الآن';
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  if (diffHour < 24) return `منذ ${diffHour} ساعة`;
  if (diffDay < 7) return `منذ ${diffDay} يوم`;
  return formatDateOnly(ts);
}

// ═══ Component ═══

export default function ActivityMonitor() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [displayCount, setDisplayCount] = useState(50);
  const [uniqueUsers, setUniqueUsers] = useState<{ userId: string; userName: string }[]>([]);
  const [search, setSearch] = useState('');
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterUser !== 'all') params.set('userId', filterUser);
      const res = await fetch(`/api/activity-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        const userMap = new Map<string, string>();
        data.forEach((log: ActivityLogItem) => {
          if (!userMap.has(log.userId)) {
            userMap.set(log.userId, log.userName);
          }
        });
        setUniqueUsers(
          Array.from(userMap.entries()).map(([userId, userName]) => ({ userId, userName }))
        );
      }
    } catch {
      // Silent fail
    }
  }, [filterUser]);

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/activity-logs/online');
      if (res.ok) {
        const data = await res.json();
        setOnlineUsers(data);
      }
    } catch {
      // Silent fail
    }
  }, []);

  // Compute stats
  const stats = useMemo(() => {
    if (logs.length === 0) {
      return { totalToday: 0, mostActiveUsers: [] as { userName: string; count: number }[], actionBreakdown: [] as { action: string; count: number }[] };
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayLogs = logs.filter((l) => (l.createdAt || l.timestamp || '') >= todayStart);

    const userCounts = new Map<string, number>();
    const userNames = new Map<string, string>();
    todayLogs.forEach((l) => {
      userCounts.set(l.userId, (userCounts.get(l.userId) || 0) + 1);
      userNames.set(l.userId, l.userName);
    });
    const mostActiveUsers = Array.from(userCounts.entries())
      .map(([userId, count]) => ({ userName: userNames.get(userId) || 'غير معروف', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const actionCounts = new Map<string, number>();
    todayLogs.forEach((l) => {
      actionCounts.set(l.action, (actionCounts.get(l.action) || 0) + 1);
    });
    const actionBreakdown = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    return { totalToday: todayLogs.length, mostActiveUsers, actionBreakdown };
  }, [logs]);

  // Initial load + auto-refresh every 10s
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchLogs(), fetchOnlineUsers()]);
      setLoading(false);
    };
    load();
    refreshTimerRef.current = setInterval(() => {
      fetchLogs();
      fetchOnlineUsers();
    }, 10000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchLogs, fetchOnlineUsers]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    let result = logs;
    if (filterAction !== 'all') {
      result = result.filter((l) => l.action === filterAction);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((l) =>
        l.userName.toLowerCase().includes(s) ||
        l.details.toLowerCase().includes(s) ||
        l.page.toLowerCase().includes(s)
      );
    }
    return result;
  }, [logs, filterAction, search]);

  const displayedLogs = filteredLogs.slice(0, displayCount);
  const hasMore = displayCount < filteredLogs.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* ═══ Header ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-violet-500/15 border border-violet-500/30">
            <Activity className="size-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">مراقب النشاط</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              تتبع نشاط المستخدمين في الوقت الفعلي
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">
            {filteredLogs.length} سجل
          </Badge>
          <Button
            onClick={async () => { await Promise.all([fetchLogs(), fetchOnlineUsers()]); }}
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8 px-3"
          >
            <RefreshCw className="size-3.5 ml-1" />
            تحديث
          </Button>
        </div>
      </div>

      <Tabs defaultValue="feed" dir="rtl" className="space-y-4">
        <TabsList className="bg-slate-800/80 border border-slate-700/50">
          <TabsTrigger value="feed" className="data-[state=active]:bg-linear-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white text-xs px-3">
            <Activity className="size-3.5 ml-1" />
            سجل النشاط
          </TabsTrigger>
          <TabsTrigger value="online" className="data-[state=active]:bg-linear-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white text-xs px-3">
            <Users className="size-3.5 ml-1" />
            المتصلون الآن
            {onlineUsers.length > 0 && (
              <span className="mr-1 bg-emerald-500 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {onlineUsers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stats" className="data-[state=active]:bg-linear-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white text-xs px-3">
            <BarChart3 className="size-3.5 ml-1" />
            إحصائيات
          </TabsTrigger>
        </TabsList>

        {/* ═══ Activity Feed Tab ═══ */}
        <TabsContent value="feed" className="space-y-4">
          {/* Filters Row */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
              <Input
                placeholder="بحث في السجلات..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-8 text-xs"
              />
            </div>
            <Select value={filterUser} onValueChange={(v) => { setFilterUser(v); setDisplayCount(50); }}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-8 text-xs">
                <Users className="size-3 ml-1 text-slate-500" />
                <SelectValue placeholder="المستخدم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white text-xs">جميع المستخدمين</SelectItem>
                {uniqueUsers.map((u) => (
                  <SelectItem key={u.userId} value={u.userId} className="text-white text-xs">{u.userName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterAction} onValueChange={(v) => { setFilterAction(v); setDisplayCount(50); }}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-8 text-xs">
                <Filter className="size-3 ml-1 text-slate-500" />
                <SelectValue placeholder="العملية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white text-xs">جميع العمليات</SelectItem>
                <SelectItem value="login" className="text-white text-xs">دخول</SelectItem>
                <SelectItem value="logout" className="text-white text-xs">خروج</SelectItem>
                <SelectItem value="create" className="text-white text-xs">إنشاء</SelectItem>
                <SelectItem value="update" className="text-white text-xs">تعديل</SelectItem>
                <SelectItem value="delete" className="text-white text-xs">حذف</SelectItem>
                <SelectItem value="approve" className="text-white text-xs">موافقة</SelectItem>
                <SelectItem value="page_visit" className="text-white text-xs">زيارة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Activity Table */}
          <Card className="border-slate-700/40 bg-slate-800/50 overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-lg bg-slate-700/30" />
                  ))}
                </div>
              ) : displayedLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14">
                  <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                    <Activity className="size-6 text-slate-600" />
                  </div>
                  <p className="text-slate-400 text-sm font-medium">لا توجد أنشطة</p>
                  <p className="text-slate-600 text-xs mt-1">
                    {search || filterUser !== 'all' || filterAction !== 'all'
                      ? 'لم يتم العثور على نتائج'
                      : 'لم يتم تسجيل أي أنشطة بعد'}
                  </p>
                </div>
              ) : (
                <>
                  <ScrollArea className="max-h-[520px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/40 hover:bg-transparent">
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3 w-10">#</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">المستخدم</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">العملية</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">القسم</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">التفاصيل</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3 text-center">التاريخ</TableHead>
                          <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3 text-center">الوقت</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedLogs.map((log, idx) => (
                          <motion.tr
                            key={log.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: idx * 0.02 }}
                            className={`border-slate-700/20 hover:bg-slate-700/15 transition-colors ${
                              idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-800/20'
                            }`}
                          >
                            {/* # */}
                            <TableCell className="py-2.5 px-3 text-slate-600 text-[10px]" dir="ltr">
                              {idx + 1}
                            </TableCell>
                            {/* User */}
                            <TableCell className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-shrink-0 size-7 rounded-full bg-gradient-to-br from-slate-600/60 to-slate-700/30 flex items-center justify-center border border-slate-600/30">
                                  <span className="text-slate-300 text-[10px] font-bold">
                                    {log.userName?.charAt(0) || '?'}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-white font-medium text-xs leading-tight">{log.userName}</p>
                                  <p className="text-slate-600 text-[9px] truncate leading-tight" dir="ltr">{log.userEmail}</p>
                                </div>
                              </div>
                            </TableCell>
                            {/* Action */}
                            <TableCell className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                {getActionIcon(log.action)}
                                {getActionBadge(log.action)}
                              </div>
                            </TableCell>
                            {/* Page */}
                            <TableCell className="py-2.5 px-3">
                              {getPageBadge(log.page)}
                            </TableCell>
                            {/* Details */}
                            <TableCell className="py-2.5 px-3">
                              <p className="text-slate-400 text-[11px] max-w-[180px] truncate" title={log.details}>
                                {log.details || '—'}
                              </p>
                            </TableCell>
                            {/* Date */}
                            <TableCell className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Calendar className="size-3 text-slate-600" />
                                <span className="text-slate-400 text-[11px]" dir="ltr">
                                  {formatDateOnly(getLogTimestamp(log))}
                                </span>
                              </div>
                            </TableCell>
                            {/* Time */}
                            <TableCell className="py-2.5 px-3 text-center">
                              <div className="flex flex-col items-center">
                                <span className="text-slate-300 text-[11px] font-medium" dir="ltr">
                                  {formatTimeOnly(getLogTimestamp(log))}
                                </span>
                                <span className="text-slate-600 text-[9px]" dir="ltr">
                                  {getRelativeTime(getLogTimestamp(log))}
                                </span>
                              </div>
                            </TableCell>
                          </motion.tr>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>

                  {/* Load More */}
                  {hasMore && (
                    <div className="p-2.5 border-t border-slate-700/30 flex justify-center">
                      <Button
                        variant="ghost"
                        onClick={() => setDisplayCount((p) => p + 50)}
                        className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 text-xs h-7"
                      >
                        <ChevronDown className="size-3 ml-1" />
                        عرض المزيد ({filteredLogs.length - displayCount} سجل متبقي)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Online Users Tab ═══ */}
        <TabsContent value="online" className="space-y-4">
          <Card className="border-slate-700/40 bg-slate-800/50 overflow-hidden">
            <CardContent className="p-0">
              {onlineUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14">
                  <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                    <Users className="size-6 text-slate-600" />
                  </div>
                  <p className="text-slate-400 text-sm font-medium">لا يوجد مستخدمون متصلون</p>
                  <p className="text-slate-600 text-xs mt-1">يعتبر المستخدم متصلاً إذا كان نشطاً خلال آخر 60 ثانية</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700/40 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-4">الحالة</TableHead>
                      <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">المستخدم</TableHead>
                      <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3">البريد</TableHead>
                      <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3 text-center">آخر نشاط</TableHead>
                      <TableHead className="text-slate-400 text-[11px] font-semibold py-2.5 px-3 text-center">منذ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {onlineUsers.map((user) => (
                      <TableRow key={user.userId} className="border-slate-700/20 hover:bg-slate-700/15 transition-colors">
                        <TableCell className="py-3 px-4">
                          <div className="relative flex items-center justify-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                            <div className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 size-7 rounded-full bg-violet-500/10 flex items-center justify-center border border-violet-500/30">
                              <span className="text-violet-400 text-[10px] font-bold">
                                {user.userName?.charAt(0) || '?'}
                              </span>
                            </div>
                            <span className="text-white font-medium text-xs">{user.userName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-slate-500 text-[11px]" dir="ltr">
                          {user.userEmail}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center">
                          <span className="text-slate-400 text-[11px]" dir="ltr">
                            {formatTimeOnly(user.lastActivity)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center">
                          <span className="text-violet-400/70 text-[10px]" dir="ltr">
                            {getRelativeTime(user.lastActivity)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Stats Tab ═══ */}
        <TabsContent value="stats" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-violet-500/30 bg-emerald-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5">أنشطة اليوم</p>
              <p className="text-violet-400 font-bold text-lg leading-tight">{stats.totalToday}</p>
              <p className="text-slate-500 text-[10px]">نشاط</p>
            </div>
            <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5">متصلون الآن</p>
              <p className="text-cyan-400 font-bold text-lg leading-tight">{onlineUsers.length}</p>
              <p className="text-slate-500 text-[10px]">مستخدم</p>
            </div>
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5">إجمالي السجلات</p>
              <p className="text-violet-400 font-bold text-lg leading-tight">{logs.length}</p>
              <p className="text-slate-500 text-[10px]">سجل</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Most Active Users */}
            <Card className="border-slate-700/40 bg-slate-800/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/30">
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <Users className="size-4 text-violet-400" />
                  أكثر المستخدمين نشاطاً اليوم
                </h3>
              </div>
              <CardContent className="p-0">
                {stats.mostActiveUsers.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-slate-500 text-sm">لا توجد بيانات</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700/30 hover:bg-transparent">
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3 w-8">#</TableHead>
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3">المستخدم</TableHead>
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3 text-center">الأنشطة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.mostActiveUsers.map((u, i) => (
                        <TableRow key={u.userName} className="border-slate-700/20 hover:bg-slate-700/10">
                          <TableCell className="py-2 px-3 text-slate-500 text-[10px]">{i + 1}</TableCell>
                          <TableCell className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <div className="size-5 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-violet-500/30">
                                <span className="text-violet-400 text-[8px] font-bold">{u.userName.charAt(0)}</span>
                              </div>
                              <span className="text-white text-xs">{u.userName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 px-3 text-center">
                            <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[10px] px-2">
                              {u.count} نشاط
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Action Breakdown */}
            <Card className="border-slate-700/40 bg-slate-800/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/30">
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <BarChart3 className="size-4 text-violet-400" />
                  توزيع الأنشطة حسب النوع
                </h3>
              </div>
              <CardContent className="p-0">
                {stats.actionBreakdown.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-slate-500 text-sm">لا توجد بيانات</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700/30 hover:bg-transparent">
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3">العملية</TableHead>
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3 text-center">العدد</TableHead>
                        <TableHead className="text-slate-400 text-[10px] font-semibold py-2 px-3">النسبة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.actionBreakdown.map((item) => {
                        const maxCount = stats.actionBreakdown[0]?.count || 1;
                        const pct = Math.round((item.count / maxCount) * 100);
                        const totalPct = Math.round((item.count / stats.totalToday) * 100);
                        return (
                          <TableRow key={item.action} className="border-slate-700/20 hover:bg-slate-700/10">
                            <TableCell className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                {getActionIcon(item.action)}
                                {getActionBadge(item.action)}
                              </div>
                            </TableCell>
                            <TableCell className="py-2 px-3 text-center">
                              <span className="text-white text-xs font-medium">{item.count}</span>
                            </TableCell>
                            <TableCell className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden max-w-[80px]">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    className="h-full bg-emerald-500/50 rounded-full"
                                    transition={{ duration: 0.5 }}
                                  />
                                </div>
                                <span className="text-slate-500 text-[10px] w-8 text-left" dir="ltr">{totalPct}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
