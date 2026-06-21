'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, Bell, PanelRightClose, PanelRightOpen, X, CheckCheck,
  ExternalLink, Eye, Trash2, Loader2, AlertCircle, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { useAppStore } from '@/lib/store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { AppNotification } from '@/types';

// ══════════════════════════════════════════════════════════════
//  Category → Emoji + Color + Label + Target Page
// ══════════════════════════════════════════════════════════════
const CATEGORY_CONFIG: Record<string, { emoji: string; color: string; label: string; targetPage: string }> = {
  attendance:    { emoji: '⏰', color: 'text-blue-400',    label: 'الحضور',        targetPage: 'attendance' },
  biometric:     { emoji: '👆', color: 'text-purple-400',  label: 'البصمة',        targetPage: 'biometric' },
  requests:      { emoji: '📋', color: 'text-cyan-400',    label: 'الطلبات',       targetPage: 'requests' },
  quality:       { emoji: '🏆', color: 'text-orange-400',  label: 'الجودة',        targetPage: 'quality' },
  hr:            { emoji: '💰', color: 'text-pink-400',    label: 'الموارد البشرية', targetPage: 'hrDeductions' },
  risk:          { emoji: '⚠️', color: 'text-red-400',     label: 'المخاطر',       targetPage: 'riskCenter' },
  followUp:      { emoji: '📝', color: 'text-violet-400',  label: 'المتابعة',      targetPage: 'followUps' },
  employee:      { emoji: '👤', color: 'text-emerald-400', label: 'الموظفين',      targetPage: '' },
  travel:        { emoji: '✈️', color: 'text-sky-400',     label: 'السفر',         targetPage: 'travel' },
  system:        { emoji: '⚙️', color: 'text-slate-400',   label: 'النظام',        targetPage: '' },
  automation:    { emoji: '🤖', color: 'text-amber-400',  label: 'الأتمتة',       targetPage: 'rulesEngine' },
  complaint:     { emoji: '💬', color: 'text-rose-400',    label: 'الشكاوى',       targetPage: 'complaints' },
  capa:          { emoji: '🛡️', color: 'text-indigo-400',  label: 'كابا',         targetPage: 'capa' },
};

const DEFAULT_CAT_CONFIG = { emoji: '🔔', color: 'text-slate-400', label: 'إشعار', targetPage: 'notifications' };

const PRIORITY_CONFIG: Record<string, { dot: string; label: string; badgeBg: string; badgeColor: string }> = {
  critical: { dot: 'bg-red-500',     label: 'حرج',    badgeBg: 'bg-red-500/20',    badgeColor: 'text-red-400' },
  high:    { dot: 'bg-orange-500',  label: 'مرتفع',   badgeBg: 'bg-orange-500/20', badgeColor: 'text-orange-400' },
  medium:  { dot: 'bg-amber-500',   label: 'متوسط',   badgeBg: 'bg-amber-500/20',  badgeColor: 'text-amber-400' },
  low:     { dot: 'bg-slate-500',   label: 'منخفض',   badgeBg: 'bg-slate-500/20',  badgeColor: 'text-slate-400' },
};

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

// ══════════════════════════════════════════════════════════════
//  Navigation helper — resolve target page from notification
//  Every notification MUST resolve to a destination (never null)
// ══════════════════════════════════════════════════════════════

const HEADER_CATEGORY_MAP: Record<string, string> = {
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

const HEADER_MODULE_MAP: Record<string, string> = {
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

function resolveNotificationPage(notif: AppNotification): string {
  // 1. employee360: prefix in actionUrl
  if (notif.actionUrl && notif.actionUrl.startsWith('employee360:')) return 'employee360';
  // 2. Explicit targetPage
  if (notif.targetPage) return notif.targetPage;
  // 3. actionUrl as page reference
  if (notif.actionUrl && !notif.actionUrl.startsWith('employee360:')) {
    return notif.actionUrl.startsWith('/') ? notif.actionUrl.slice(1) : notif.actionUrl;
  }
  // 4. Category-based mapping
  return HEADER_CATEGORY_MAP[notif.category] || HEADER_MODULE_MAP[notif.sourceModule] || 'notifications';
}

// ══════════════════════════════════════════════════════════════
//  Time formatting
// ══════════════════════════════════════════════════════════════
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

function formatFullDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ══════════════════════════════════════════════════════════════
//  Animation variants
// ══════════════════════════════════════════════════════════════
const panelVariants = {
  hidden: { opacity: 0, y: -10, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 28, mass: 0.8 },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.96,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as const },
  },
} as const;

const notifItemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.03, duration: 0.25, ease: 'easeOut' as const },
  }),
  exit: { opacity: 0, x: 30, transition: { duration: 0.15 } },
} as const;

// ══════════════════════════════════════════════════════════════
//  Header Component
// ══════════════════════════════════════════════════════════════
interface HeaderProps {
  title: string;
  onMenuToggle: () => void;
  onToggleSidebarCollapse: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ title, onMenuToggle, onToggleSidebarCollapse, sidebarCollapsed }: HeaderProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { navigateTo, openEmployee360 } = useAppStore();
  const {
    notifications,
    unreadCount,
    loading,
    error,
    markRead,
    markReadLocal,
    markAllRead,
    deleteNotification,
    latestNotification,
    refresh,
    removeLocal,
  } = useNotificationContext();

  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Sorted notifications: unread first, then by creation date ──
  const sortedNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => {
      // Unread always on top
      const aUnread = a.status === 'unread' ? 1 : 0;
      const bUnread = b.status === 'unread' ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      // Within same read status, newest first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [notifications]);

  // Show max 20 in dropdown
  const recentNotifications = sortedNotifications.slice(0, 20);

  // ── Close panel on click outside ──
  useEffect(() => {
    if (!showNotifPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifPanel]);

  // ── Handle notification click — mark read + navigate + remove from bell + close ──
  const handleNotifClick = (notif: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Mark as read
    if (notif.status === 'unread') {
      markRead(notif.id);
    } else {
      markReadLocal(notif.id);
    }

    // Remove from bell dropdown list
    removeLocal(notif.id);

    // Navigate to related record — ALWAYS navigates (never returns null)
    const page = resolveNotificationPage(notif);
    if (page === 'employee360') {
      if (notif.actionUrl && notif.actionUrl.startsWith('employee360:')) {
        openEmployee360(notif.actionUrl.replace('employee360:', ''));
      } else if (notif.employeeId) {
        openEmployee360(notif.employeeId);
      } else {
        navigateTo('employees');
      }
    } else {
      navigateTo(page, notif.sourceRecordId || undefined);
    }

    // Close panel after navigation
    setShowNotifPanel(false);
  };

  // ── Mark all read with toast ──
  const handleMarkAllRead = async () => {
    const count = unreadCount;
    await markAllRead();
    if (count > 0) {
      toast.success(`تم تعليم ${count} إشعار كمقروء`);
    }
  };

  // ── Mark as read from header panel ──
  const handleMarkRead = (notif: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoadingId(notif.id);
    markRead(notif.id).finally(() => setActionLoadingId(null));
  };

  // ── Delete notification from header panel ──
  const handleDelete = (notifId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(notifId);
    deleteNotification(notifId).finally(() => setDeletingId(null));
    toast.success('تم حذف الإشعار');
  };

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <motion.header
      className="glass-header sticky top-0 z-30 flex flex-col"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Gradient line under header */}
      <div className="header-gradient-line" />

      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        {/* ── Left: menu toggle + title ── */}
        <div className="flex items-center gap-3">
          {isMobile ? (
            <motion.button
              onClick={onMenuToggle}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              whileTap={{ scale: 0.9 }}
              aria-label="Toggle menu"
            >
              <Menu className="h-5 w-5" />
            </motion.button>
          ) : (
            <motion.button
              onClick={onToggleSidebarCollapse}
              className="p-2 rounded-lg text-slate-400 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelRightClose className="h-5 w-5" />}
            </motion.button>
          )}
          <h1 className="text-lg font-bold text-slate-800 dark:text-white truncate max-w-xs sm:max-w-md">
            {title}
          </h1>
        </div>

        {/* ── Right: notification bell + avatar ── */}
        <div className="flex items-center gap-2">
          {/* ═══════════════════════════════════════════════════════
              NOTIFICATION BELL — Real-time interactive system
              ═══════════════════════════════════════════════════════ */}
          <div className="relative" ref={panelRef}>
            {/* Bell button */}
            <motion.button
              className={`relative p-2 rounded-lg transition-colors ${
                showNotifPanel
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              aria-label="Notifications"
              onClick={() => setShowNotifPanel((p) => !p)}
            >
              <Bell className="h-5 w-5" />

              {/* Unread count badge */}
              {unreadCount > 0 && (
                <motion.span
                  key={unreadCount}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </motion.span>
              )}

              {/* Pulse ring on new notification */}
              <AnimatePresence>
                {latestNotification && (
                  <motion.span
                    initial={{ scale: 1, opacity: 1 }}
                    animate={{ scale: 2.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0 rounded-full bg-red-500/30"
                  />
                )}
              </AnimatePresence>
            </motion.button>

            {/* ═══════════════════════════════════════════════════
                NOTIFICATION DROPDOWN PANEL
                ═══════════════════════════════════════════════════ */}
            <AnimatePresence>
              {showNotifPanel && (
                <motion.div
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="absolute left-0 top-full mt-2 w-[440px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/50 z-50 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* ── Panel Header ── */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25">
                        <Bell className="size-4 text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">الإشعارات</h3>
                        <p className="text-[10px] text-slate-500 -mt-0.5">
                          {unreadCount > 0
                            ? `${unreadCount} إشعار غير مقروء من ${notifications.length}`
                            : `${notifications.length} إشعار`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {unreadCount > 0 && (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleMarkAllRead()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all"
                        >
                          <CheckCheck className="size-3.5" />
                          تعيين الكل كمقروء
                          <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                            {unreadCount}
                          </span>
                        </motion.button>
                      )}
                      <button
                        onClick={() => setShowNotifPanel(false)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  {/* ── Notifications List ── */}
                  <ScrollArea className="max-h-[460px]">
                    {/* Loading state */}
                    {loading && notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 px-4">
                        <Loader2 className="size-8 text-emerald-500 animate-spin mb-3" />
                        <p className="text-slate-400 text-sm font-medium">جاري تحميل الإشعارات...</p>
                        <p className="text-slate-600 text-xs mt-1">يتم جلب البيانات في الوقت الفعلي</p>
                      </div>
                    ) : error && notifications.length === 0 ? (
                      /* Error state */
                      <div className="flex flex-col items-center justify-center py-16 px-4">
                        <AlertCircle className="size-8 text-red-400 mb-3" />
                        <p className="text-slate-300 text-sm font-medium">تعذر تحميل الإشعارات</p>
                        <p className="text-slate-600 text-xs mt-1">حدث خطأ أثناء الاتصال بالخادم</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refresh()}
                          className="mt-3 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                        >
                          <Loader2 className="size-3.5 ml-1" />
                          إعادة المحاولة
                        </Button>
                      </div>
                    ) : recentNotifications.length === 0 ? (
                      /* Empty state */
                      <div className="flex flex-col items-center justify-center py-16 px-4">
                        <div className="flex items-center justify-center size-14 rounded-2xl bg-slate-800 border border-slate-700/50 mb-3">
                          <Bell className="size-7 text-slate-600" />
                        </div>
                        <p className="text-slate-400 text-sm font-medium">لا توجد إشعارات</p>
                        <p className="text-slate-600 text-xs mt-1">ستتلقى إشعارات فورية عند حدوث أحداث جديدة</p>
                      </div>
                    ) : (
                      /* ── Notification Items ── */
                      <div className="py-1">
                        <AnimatePresence mode="popLayout">
                          {recentNotifications.map((notif, index) => {
                            const catConfig = CATEGORY_CONFIG[notif.category] || DEFAULT_CAT_CONFIG;
                            const priConfig = PRIORITY_CONFIG[notif.priority] || PRIORITY_CONFIG.low;
                            const isUnread = notif.status === 'unread';
                            const isDeleting = deletingId === notif.id;
                            const isActing = actionLoadingId === notif.id;
                            const modLabel = MODULE_LABELS[notif.sourceModule] || notif.sourceModule;

                            return (
                              <motion.div
                                key={notif.id}
                                custom={index}
                                variants={notifItemVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                                className={`
                                  mx-2 mb-1 rounded-lg border transition-all duration-200 cursor-pointer
                                  ${isUnread
                                    ? 'bg-slate-800/80 border-emerald-500/20 hover:bg-slate-800 hover:border-emerald-500/30'
                                    : 'bg-slate-800/40 border-slate-700/30 hover:bg-slate-800/70 hover:border-slate-600/40'
                                  }
                                  ${isDeleting ? 'opacity-50 scale-[0.98]' : ''}
                                `}
                                onClick={() => handleNotifClick(notif)}
                              >
                                <div className="flex items-start gap-3 px-3 py-2.5">
                                  {/* ── Unread indicator bar ── */}
                                  <div className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${isUnread ? 'bg-emerald-500' : 'bg-transparent'}`} />

                                  {/* ── Category icon + priority dot ── */}
                                  <div className="relative shrink-0 mt-0.5">
                                    <div className={`flex items-center justify-center size-9 rounded-lg text-base ${isUnread ? 'bg-slate-700/60' : 'bg-slate-800'}`}>
                                      {catConfig.emoji}
                                    </div>
                                    <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 ${priConfig.dot}`} />
                                  </div>

                                  {/* ── Content ── */}
                                  <div className="flex-1 min-w-0">
                                    {/* Title row */}
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <p className={`text-[13px] font-semibold truncate leading-tight ${
                                        isUnread ? 'text-white' : 'text-slate-300'
                                      }`}>
                                        {notif.title}
                                      </p>
                                      {isUnread && (
                                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                          جديد
                                        </span>
                                      )}
                                    </div>

                                    {/* Description */}
                                    {notif.description && (
                                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-1.5">
                                        {notif.description}
                                      </p>
                                    )}

                                    {/* Metadata row */}
                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]">
                                      {/* Time */}
                                      <span className="text-slate-500 flex items-center gap-1" title={formatFullDateTime(notif.createdAt)}>
                                        <span dir="ltr">{timeAgo(notif.createdAt)}</span>
                                      </span>

                                      {/* Source module */}
                                      {modLabel && (
                                        <span className="text-slate-600">
                                          {catConfig.emoji} {modLabel}
                                        </span>
                                      )}

                                      {/* Employee name */}
                                      {notif.employeeName && (
                                        <span className="text-slate-600">
                                          👤 {notif.employeeName}
                                        </span>
                                      )}

                                      {/* Priority badge */}
                                      {notif.priority !== 'low' && (
                                        <span className={`px-1.5 py-0.5 rounded ${priConfig.badgeBg} ${priConfig.badgeColor} font-medium`}>
                                          {priConfig.label}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* ── Action Buttons ── */}
                                  <div className="flex flex-col items-center gap-1 shrink-0 -mt-0.5">
                                    {/* Open Record */}
                                    <motion.button
                                        whileHover={{ scale: 1.15 }}
                                        whileTap={{ scale: 0.9 }}
                                        onClick={(e) => handleNotifClick(notif, e)}
                                        disabled={isActing}
                                        className="flex items-center justify-center size-7 rounded-md text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300 transition-all disabled:opacity-50"
                                        title="فتح السجل"
                                      >
                                        {isActing ? (
                                          <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                          <ExternalLink className="size-3.5" />
                                        )}
                                      </motion.button>

                                    {/* Mark as Read */}
                                    {isUnread && (
                                      <motion.button
                                        whileHover={{ scale: 1.15 }}
                                        whileTap={{ scale: 0.9 }}
                                        onClick={(e) => handleMarkRead(notif, e)}
                                        disabled={isActing}
                                        className="flex items-center justify-center size-7 rounded-md text-blue-400 hover:bg-blue-500/15 hover:text-blue-300 transition-all disabled:opacity-50"
                                        title="تعليم كمقروء"
                                      >
                                        <Eye className="size-3.5" />
                                      </motion.button>
                                    )}

                                    {/* Delete */}
                                    <motion.button
                                      whileHover={{ scale: 1.15 }}
                                      whileTap={{ scale: 0.9 }}
                                      onClick={(e) => handleDelete(notif.id, e)}
                                      disabled={isDeleting}
                                      className="flex items-center justify-center size-7 rounded-md text-slate-600 hover:bg-red-500/15 hover:text-red-400 transition-all disabled:opacity-50"
                                      title="حذف"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="size-3.5" />
                                      )}
                                    </motion.button>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                    )}
                  </ScrollArea>

                  {/* ── Panel Footer ── */}
                  <div className="border-t border-slate-700/50 bg-slate-900 px-4 py-2.5">
                    <button
                      onClick={() => {
                        navigateTo('notifications');
                        setShowNotifPanel(false);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors font-medium py-1 rounded-lg hover:bg-emerald-500/5"
                    >
                      عرض جميع الإشعارات
                      <ChevronDown className="size-3 rotate-[-90deg]" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── User Avatar ── */}
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white ring-2 ring-slate-200 dark:ring-slate-700 cursor-pointer hover:ring-indigo-400 transition-all">
            {userInitials}
          </div>
        </div>
      </div>
    </motion.header>
  );
}
