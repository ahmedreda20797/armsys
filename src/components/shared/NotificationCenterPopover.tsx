'use client';

// ══════════════════════════════════════════════════════════════
//  NotificationCenterPopover — the redesigned notification window (§5)
//
//  ROOT CAUSES FIXED vs the old hand-rolled Header panel:
//   • It was an absolutely-positioned div INSIDE the header (no
//     portal): z-order fights with dialogs and it clipped at the
//     viewport edge in RTL. → Now a Radix POPOVER (portal +
//     collision detection + aria wiring + Escape to close).
//   • Clicking a notification REMOVED it from the panel — read items
//     vanished instead of showing as read. → The panel reads its own
//     recent-notifications query; items STAY and flip to read.
//   • Delete had no confirmation (unlike the page). → Uses the ONE
//     unified ConfirmDialog (§4).
//   • "تعليم الكل كمقروء" fanned out one PATCH per notification. →
//     One POST /api/notifications/mark-all-read round-trip.
//
//  Density contract (§5): compact rows — type icon · title ·
//  priority badge · line-clamped description · time · employee —
//  with the LIST as the only scrollable region
//  (max-h min(70vh,600px) + overscroll-contain: no background scroll).
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, CheckCheck, ExternalLink, Eye, Loader2, Trash2, ChevronDown,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/query-provider';
import { toast } from 'sonner';
import type { AppNotification } from '@/types';

// ── Category → icon/color (single compact map for the popover) ──
const CATEGORY_ICONS: Record<string, { emoji: string; tint: string }> = {
  attendance: { emoji: '⏰', tint: 'bg-blue-500/10' },
  biometric: { emoji: '👆', tint: 'bg-purple-500/10' },
  requests: { emoji: '📋', tint: 'bg-cyan-500/10' },
  quality: { emoji: '🏆', tint: 'bg-orange-500/10' },
  hr: { emoji: '💰', tint: 'bg-pink-500/10' },
  risk: { emoji: '⚠️', tint: 'bg-red-500/10' },
  followUp: { emoji: '📝', tint: 'bg-violet-500/10' },
  employee: { emoji: '👤', tint: 'bg-emerald-500/10' },
  travel: { emoji: '✈️', tint: 'bg-sky-500/10' },
  system: { emoji: '⚙️', tint: 'bg-slate-500/10' },
  automation: { emoji: '🤖', tint: 'bg-amber-500/10' },
  complaint: { emoji: '💬', tint: 'bg-rose-500/10' },
  capa: { emoji: '🛡️', tint: 'bg-indigo-500/10' },
};
const DEFAULT_ICON = { emoji: '🔔', tint: 'bg-slate-500/10' };

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: { label: 'حرج', className: 'bg-red-500/15 text-red-400' },
  high: { label: 'مرتفع', className: 'bg-orange-500/15 text-orange-400' },
  medium: { label: 'متوسط', className: 'bg-amber-500/15 text-amber-400' },
  low: { label: 'منخفض', className: 'bg-slate-500/15 text-slate-400' },
};

const PAGE_MAP: Record<string, string> = {
  attendance: 'attendance', biometric: 'biometric', requests: 'requests',
  quality: 'quality', hr: 'hrDeductions', risk: 'riskCenter', followUp: 'followUps',
  employee: 'employees', travel: 'travel', system: 'notifications',
  automation: 'rulesEngine', complaint: 'complaints', capa: 'capa',
};
const MODULE_PAGE_MAP: Record<string, string> = {
  attendance: 'attendance', biometric: 'biometric', requests: 'requests',
  quality: 'quality', hrDeductions: 'hrDeductions', travel: 'travel',
  followUps: 'followUps', capa: 'capa', complaints: 'complaints',
  employees: 'employees', rulesEngine: 'rulesEngine', riskCenter: 'riskCenter',
  system: 'notifications', automation: 'rulesEngine', manual: 'notifications',
};

function resolveTargetPage(notif: AppNotification): string {
  if (notif.targetPage) return notif.targetPage;
  if (notif.actionUrl?.startsWith('employee360:')) return 'employee360';
  if (notif.actionUrl) return notif.actionUrl.startsWith('/') ? notif.actionUrl.slice(1) : notif.actionUrl;
  return PAGE_MAP[notif.category] || MODULE_PAGE_MAP[notif.sourceModule] || 'notifications';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

const PAGE_SIZE = 25;

export function NotificationCenterPopover({ children }: { children: React.ReactNode }) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<AppNotification | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);

  // The panel owns its data: the LATEST notifications (any status, so
  // items stay visible after being marked read) — NOT the unread-only
  // context feed whose items vanish on read.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['notification-popover'],
    queryFn: () => apiFetch<{ data: AppNotification[] }>('/api/notifications?limit=25'),
    staleTime: 30_000,
    enabled: open,
  });
  const items = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => {
      const aU = a.status === 'unread' ? 1 : 0;
      const bU = b.status === 'unread' ? 1 : 0;
      if (aU !== bU) return bU - aU;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }).slice(0, PAGE_SIZE),
    [data],
  );
  const unreadCount = items.filter((n) => n.status === 'unread').length;

  const invalidateFeeds = () => {
    qc.invalidateQueries({ queryKey: ['notification-popover'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handleOpen = (notif: AppNotification) => {
    if (notif.status === 'unread') {
      void apiFetch(`/api/notifications/${notif.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'read' }),
      }).then(invalidateFeeds).catch(() => { /* non-fatal */ });
    }
    const page = resolveTargetPage(notif);
    if (page === 'employee360') {
      const id = notif.actionUrl?.startsWith('employee360:')
        ? notif.actionUrl.replace('employee360:', '')
        : notif.employeeId;
      if (id) openEmployee360(id); else navigateTo('employees');
    } else {
      navigateTo(page, notif.sourceRecordId || undefined);
    }
    setOpen(false);
  };

  const handleMarkRead = (notif: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    void apiFetch(`/api/notifications/${notif.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'read' }),
    }).then(invalidateFeeds).catch(() => toast.error('تعذر تعليم الإشعار'));
  };

  const handleMarkAllRead = async () => {
    setMarkAllPending(true);
    try {
      const res = await apiFetch<{ updated: number }>('/api/notifications/mark-all-read', { method: 'POST' });
      toast.success(`تم تعليم ${res.updated} إشعار كمقروء`);
      invalidateFeeds();
    } catch {
      toast.error('تعذر تعليم الإشعارات');
    } finally {
      setMarkAllPending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await apiFetch(`/api/notifications/${deleting.id}`, { method: 'DELETE' });
      toast.success('تم حذف الإشعار');
      setDeleting(null);
      invalidateFeeds();
    } catch {
      toast.error('تعذر حذف الإشعار');
    } finally {
      setDeletingNow(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild aria-label="الإشعارات">
          {children}
        </PopoverTrigger>
        <PopoverContent
          dir="rtl"
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[420px] max-w-[calc(100vw-2rem)] p-0 rounded-2xl border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden"
        >
          {/* ── FIXED header (§5.1): title · unread count · mark-all ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 shrink-0">
                <Bell className="size-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white leading-tight">الإشعارات</h3>
                <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                  {unreadCount > 0 ? `${unreadCount} غير مقروء` : 'كل الإشعارات مقروءة'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markAllPending || unreadCount === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title="تعليم الكل كمقروء"
            >
              {markAllPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
              تعليم الكل كمقروء
            </button>
          </div>

          {/* ── LIST — the ONLY scrollable region (§5.2) ── */}
          <ScrollArea className="h-[min(70vh,600px)] [&>[data-radix-scroll-area-viewport]]:overscroll-contain">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <Loader2 className="size-7 text-emerald-500 animate-spin mb-3" />
                <p className="text-slate-400 text-sm">جاري تحميل الإشعارات...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="flex items-center justify-center size-14 rounded-2xl bg-slate-800 border border-slate-700/50 mb-3">
                  <Bell className="size-7 text-slate-600" />
                </div>
                <p className="text-slate-400 text-sm font-medium">لا توجد إشعارات</p>
                <p className="text-slate-600 text-xs mt-1">ستتلقى إشعارات فورية عند حدوث أحداث جديدة</p>
              </div>
            ) : (
              <div className="py-1 divide-y divide-slate-800/60">
                <AnimatePresence initial={false}>
                  {items.map((notif) => {
                    const cat = CATEGORY_ICONS[notif.category] ?? DEFAULT_ICON;
                    const pri = PRIORITY_BADGE[notif.priority] ?? PRIORITY_BADGE.low;
                    const isUnread = notif.status === 'unread';
                    return (
                      <motion.div
                        key={notif.id}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpen(notif)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(notif); }}
                        className={`group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${isUnread ? 'bg-slate-800/60 hover:bg-slate-800' : 'hover:bg-slate-800/50'}`}
                      >
                        {/* unread accent */}
                        {isUnread && <span className="absolute inset-y-1 right-0 w-0.5 rounded-full bg-emerald-500" />}

                        {/* type icon */}
                        <span className={`flex items-center justify-center size-8 rounded-lg text-sm shrink-0 ${cat.tint}`}>{cat.emoji}</span>

                        {/* body */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-xs font-semibold truncate leading-tight ${isUnread ? 'text-white' : 'text-slate-300'}`}>
                              {notif.title}
                            </p>
                            {notif.priority !== 'low' && (
                              <span className={`shrink-0 px-1.5 py-0 rounded text-[9px] font-bold rounded-full ${pri.className}`}>
                                {pri.label}
                              </span>
                            )}
                          </div>
                          {notif.description && (
                            <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mt-0.5">{notif.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                            <span dir="ltr">{timeAgo(notif.createdAt)}</span>
                            {notif.employeeName && (
                              <span className="truncate max-w-28">👤 {notif.employeeName}</span>
                            )}
                            {notif.status === 'resolved' && <span className="text-emerald-500">✔ تمت المعالجة</span>}
                            {notif.status === 'acknowledged' && <span className="text-cyan-500">✔ تم الإقرار</span>}
                          </div>
                        </div>

                        {/* hover actions — compact, don't crowd the row */}
                        <div className="hidden group-hover:flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleOpen(notif); }}
                            className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                            title="فتح السجل"
                          >
                            <ExternalLink className="size-3.5" />
                          </button>
                          {isUnread && (
                            <button
                              type="button"
                              onClick={(e) => handleMarkRead(notif, e)}
                              className="p-1.5 rounded-md text-blue-400 hover:bg-blue-500/15 transition-colors"
                              title="تعليم كمقروء"
                            >
                              <Eye className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeleting(notif); }}
                            className="p-1.5 rounded-md text-slate-500 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </ScrollArea>

          {/* ── FIXED footer ── */}
          <div className="border-t border-slate-700/50 px-4 py-2 shrink-0">
            <button
              type="button"
              onClick={() => { navigateTo('notifications'); setOpen(false); }}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors font-medium py-1 rounded-lg hover:bg-emerald-500/5"
            >
              عرض جميع الإشعارات
              <ChevronDown className="size-3 -rotate-90" />
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* §4: unified delete confirmation — same component as every page */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        description="سيتم حذف هذا الإشعار نهائياً."
        itemName={deleting?.title}
        loading={deletingNow}
        onConfirm={confirmDelete}
      />
    </>
  );
}
