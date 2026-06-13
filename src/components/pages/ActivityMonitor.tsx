'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Activity,
  Users,
  BarChart3,
  RefreshCw,
  ChevronDown,
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
} from 'lucide-react';

interface ActivityLogItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  page: string;
  details: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
  lastActivity: string;
}

function getActionIcon(action: string) {
  switch (action) {
    case 'login': return <LogIn className="size-4 text-emerald-400" />;
    case 'logout': return <LogOut className="size-4 text-slate-400" />;
    case 'create': return <Plus className="size-4 text-blue-400" />;
    case 'update': return <Pencil className="size-4 text-amber-400" />;
    case 'delete': return <Trash2 className="size-4 text-red-400" />;
    case 'approve': return <CheckCircle2 className="size-4 text-emerald-400" />;
    case 'page_visit': return <Eye className="size-4 text-slate-400" />;
    default: return <Activity className="size-4 text-slate-400" />;
  }
}

function getActionBadge(action: string) {
  switch (action) {
    case 'login': return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-xs">دخول</Badge>;
    case 'logout': return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/20 text-xs">خروج</Badge>;
    case 'create': return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-xs">إنشاء</Badge>;
    case 'update': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-xs">تعديل</Badge>;
    case 'delete': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-xs">حذف</Badge>;
    case 'approve': return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-xs">موافقة</Badge>;
    case 'page_visit': return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/20 text-xs">زيارة</Badge>;
    default: return <Badge variant="outline" className="text-xs">{action}</Badge>;
  }
}

function getRelativeTime(timestamp: string): string {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diffMs = now - time;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'الآن';
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  if (diffHour < 24) return `منذ ${diffHour} ساعة`;
  if (diffDay < 7) return `منذ ${diffDay} يوم`;
  return new Date(timestamp).toLocaleDateString('ar-EG');
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

export default function ActivityMonitor() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [displayCount, setDisplayCount] = useState(50);
  const [uniqueUsers, setUniqueUsers] = useState<{ userId: string; userName: string }[]>([]);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterUser !== 'all') params.set('userId', filterUser);
      const res = await fetch(`/api/activity-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        // Extract unique users
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

  // Compute stats as derived state
  const stats = useMemo(() => {
    if (logs.length === 0) {
      return { totalToday: 0, mostActiveUsers: [] as { userName: string; count: number }[], actionBreakdown: [] as { action: string; count: number }[] };
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayLogs = logs.filter((l) => l.timestamp >= todayStart);

    // Most active users today
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

    // Action breakdown today
    const actionCounts = new Map<string, number>();
    todayLogs.forEach((l) => {
      actionCounts.set(l.action, (actionCounts.get(l.action) || 0) + 1);
    });
    const actionBreakdown = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    return { totalToday: todayLogs.length, mostActiveUsers, actionBreakdown };
  }, [logs]);

  // Initial load + auto-refresh every 10 seconds
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
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [fetchLogs, fetchOnlineUsers]);

  const displayedLogs = logs.slice(0, displayCount);
  const hasMore = displayCount < logs.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="size-5 text-emerald-400" />
            مراقب النشاط
          </h2>
          <p className="text-slate-400 mt-1 text-sm">
            تتبع نشاط المستخدمين في الوقت الفعلي
          </p>
        </div>
        <Button
          onClick={refreshAll}
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300 hover:bg-slate-700"
        >
          <RefreshCw className="size-4" />
          تحديث
        </Button>
      </div>

      <Tabs defaultValue="feed" dir="rtl" className="space-y-4">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="feed" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Activity className="size-4 ml-1" />
            سجل النشاط
          </TabsTrigger>
          <TabsTrigger value="online" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Users className="size-4 ml-1" />
            المتصلون الآن
            {onlineUsers.length > 0 && (
              <span className="mr-1 bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {onlineUsers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stats" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <BarChart3 className="size-4 ml-1" />
            إحصائيات
          </TabsTrigger>
        </TabsList>

        {/* ─── Activity Feed Tab ─── */}
        <TabsContent value="feed" className="space-y-4">
          {/* Filter */}
          <div className="flex items-center gap-3">
            <Select value={filterUser} onValueChange={(v) => { setFilterUser(v); setDisplayCount(50); }}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-48">
                <SelectValue placeholder="تصفية حسب المستخدم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع المستخدمين</SelectItem>
                {uniqueUsers.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>{u.userName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-slate-400 border-slate-600">
              {logs.length} سجل
            </Badge>
          </div>

          {/* Activity List */}
          <Card className="border-slate-700/50 bg-slate-800/50">
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-14 rounded-lg bg-slate-700/50" />
                  ))}
                </div>
              ) : displayedLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Activity className="size-12 text-slate-600 mb-3" />
                  <p className="text-slate-400">لا توجد أنشطة حتى الآن</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <div className="divide-y divide-slate-700/50">
                    {displayedLogs.map((log) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-3 p-3 hover:bg-slate-700/20 transition-colors"
                      >
                        {/* Icon */}
                        <div className="mt-1 shrink-0 w-8 h-8 rounded-full bg-slate-700/50 flex items-center justify-center">
                          {getActionIcon(log.action)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-medium text-sm">{log.userName}</span>
                            {getActionBadge(log.action)}
                            <Badge variant="outline" className="text-slate-500 border-slate-600 text-xs">
                              {getPageLabel(log.page)}
                            </Badge>
                          </div>
                          <p className="text-slate-400 text-sm mt-0.5 truncate">{log.details}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className="size-3 text-slate-500" />
                            <span className="text-slate-500 text-xs" dir="ltr">
                              {getRelativeTime(log.timestamp)}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* Load More */}
              {hasMore && (
                <div className="p-3 border-t border-slate-700/50 flex justify-center">
                  <Button
                    variant="ghost"
                    onClick={() => setDisplayCount((p) => p + 50)}
                    disabled={loadingMore}
                    className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  >
                    <ChevronDown className="size-4 ml-1" />
                    تحميل المزيد
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Online Users Tab ─── */}
        <TabsContent value="online" className="space-y-4">
          <Card className="border-slate-700/50 bg-slate-800/50">
            <CardContent className="p-0">
              {onlineUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Users className="size-12 text-slate-600 mb-3" />
                  <p className="text-slate-400">لا يوجد مستخدمون متصلون الآن</p>
                  <p className="text-slate-500 text-sm mt-1">يعتبر المستخدم متصلاً إذا كان نشطاً خلال آخر 60 ثانية</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700/50">
                  {onlineUsers.map((user) => (
                    <div
                      key={user.userId}
                      className="flex items-center gap-3 p-4 hover:bg-slate-700/20 transition-colors"
                    >
                      {/* Green dot */}
                      <div className="relative shrink-0">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-75" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm">{user.userName}</p>
                        <p className="text-slate-500 text-xs" dir="ltr">{user.userEmail}</p>
                      </div>

                      <div className="flex items-center gap-1">
                        <Clock className="size-3 text-slate-500" />
                        <span className="text-slate-500 text-xs" dir="ltr">
                          {getRelativeTime(user.lastActivity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Stats Tab ─── */}
        <TabsContent value="stats" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Total Activities Today */}
            <Card className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <TrendingUp className="size-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">إجمالي الأنشطة اليوم</p>
                    <p className="text-white text-2xl font-bold">{stats.totalToday}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Online Now */}
            <Card className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Users className="size-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">متصلون الآن</p>
                    <p className="text-white text-2xl font-bold">{onlineUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Logs */}
            <Card className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-500/10 flex items-center justify-center">
                    <Activity className="size-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">إجمالي السجلات</p>
                    <p className="text-white text-2xl font-bold">{logs.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Most Active Users */}
            <Card className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <Users className="size-4 text-emerald-400" />
                  أكثر المستخدمين نشاطاً اليوم
                </h3>
                {stats.mostActiveUsers.length === 0 ? (
                  <p className="text-slate-500 text-sm">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-2">
                    {stats.mostActiveUsers.map((u, i) => (
                      <div key={u.userName} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-xs w-4">{i + 1}.</span>
                          <span className="text-white text-sm">{u.userName}</span>
                        </div>
                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 text-xs">
                          {u.count} نشاط
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Breakdown */}
            <Card className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <BarChart3 className="size-4 text-emerald-400" />
                  توزيع الأنشطة حسب النوع (اليوم)
                </h3>
                {stats.actionBreakdown.length === 0 ? (
                  <p className="text-slate-500 text-sm">لا توجد بيانات</p>
                ) : (
                  <div className="space-y-2">
                    {stats.actionBreakdown.map((item) => {
                      const maxCount = stats.actionBreakdown[0]?.count || 1;
                      const pct = Math.round((item.count / maxCount) * 100);
                      return (
                        <div key={item.action} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getActionIcon(item.action)}
                              <span className="text-white text-sm">{getActionBadge(item.action)}</span>
                            </div>
                            <span className="text-slate-400 text-xs">{item.count}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              className="h-full bg-emerald-500/50 rounded-full"
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
