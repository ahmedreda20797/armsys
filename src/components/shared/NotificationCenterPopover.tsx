'use client';

// ══════════════════════════════════════════════════════════════
//  NotificationCenterPopover — the GLOBAL notification center
//  (§UX-STRUCTURE PART 9).
//
//  A control-center surface, NOT a page: bounded height, internal
//  scroll (the shared thin-scrollbar system), compact rows.
//
//  Architecture (data layer UNCHANGED — §PART 15):
//    • Same `/api/notifications?limit=` query (the bounded,
//      visibility-filtered list) — no new polling, no extra
//      listeners, no duplicate unread counters.
//    • The badge count is the SERVER unreadCount — the canonical
//      backend state (§9E). Mark read/unread PATCHes the record;
//      mark-all uses the single POST round-trip.
//    • Deep navigation reuses navigateTo + sourceRecordId — the
//      destination page locates + highlights the record via the
//      existing useRecordHighlight machinery (§9F). Authorization
//      is revalidated server-side on the destination data fetch.
//
//  UX (§9A/§9B/§9C/§9D/§9H/§9I):
//    • Tabs: الكل · غير مقروء (n) · هام (high+critical).
//    • Repeated same-event items collapse into one group row
//      (expandable) via lib/notifications/presentation.
//    • Five-step severity model derived from existing fields.
//    • Row click = primary action (open). Secondary actions live
//      in the row ⋮ menu: open · mark read/unread · delete.
//    • Skeleton loading, compact empty states, compact error retry.
// ══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Bell, BellOff, CheckCheck, Check, ExternalLink, Eye,
  Loader2, RotateCcw, Trash2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { OverflowMenu, type OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { ScrollableSurface } from '@/components/shared/ScrollableSurface';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/query-provider';
import { toast } from 'sonner';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { useNotificationContext } from '@/contexts/NotificationContext';
import type { AppNotification } from '@/types';
import { buildNotificationNavParams } from '@/lib/notifications/navigation';
import {
  deriveNotificationSeverity,
  groupNotifications,
  SEVERITY_DOT,
  timeAgo,
  type NotificationRowModel,
} from '@/lib/notifications/presentation';

const PAGE_MAP: Record<string, string> = {
  attendance: 'attendance', biometric: 'biometric', requests: 'requests',
  quality: 'quality', hr: 'hrDeductions', risk: 'riskCenter', followUp: 'followUps',
  employee: 'employees', travel: 'travel', system: 'home',
  automation: 'rulesEngine', complaint: 'complaints', capa: 'capa',
};
const MODULE_PAGE_MAP: Record<string, string> = {
  attendance: 'attendance', biometric: 'biometric', requests: 'requests',
  quality: 'quality', hrDeductions: 'hrDeductions', travel: 'travel',
  followUps: 'followUps', capa: 'capa', complaints: 'complaints',
  employees: 'employees', rulesEngine: 'rulesEngine', riskCenter: 'riskCenter',
  system: 'home', automation: 'rulesEngine', manual: 'home',
};

function resolveTargetPage(notif: AppNotification): string {
  // §NOTIFICATIONS-V2 — the standalone Notification Center page no
  // longer exists; anything that pointed there lands on Home instead.
  if (notif.targetPage === 'notifications') return 'home';
  if (notif.targetPage) return notif.targetPage;
  if (notif.actionUrl?.startsWith('employee360:')) return 'employee360';
  if (notif.actionUrl) return notif.actionUrl.startsWith('/') ? notif.actionUrl.slice(1) : notif.actionUrl;
  return PAGE_MAP[notif.category] || MODULE_PAGE_MAP[notif.sourceModule] || 'home';
}

const PAGE_SIZE = 30;

type TabKey = 'all' | 'unread' | 'important';

export function NotificationCenterPopover({ children }: { children: React.ReactNode }) {
  const { locale } = useLanguage();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const { markAllReadLocal, refresh: refreshNotificationFeed } = useNotificationContext();
  // §NOTIFICATIONS-V2 — cross-cutting "open the bell panel" requests
  // (legacy navigateTo('notifications') callers, AOCC bell, etc.)
  // arrive through the store flag; it is consumed and cleared here.
  const panelOpenRequest = useAppStore((s) => s.notificationPanelOpen);
  const setPanelOpenRequest = useAppStore((s) => s.setNotificationPanelOpen);
  const qc = useQueryClient();
  // `open` DERIVES from the store request so an external open request
  // needs no setState-in-effect mirror. Clearing the request IS the
  // effect's external-system update (zustand).
  const [openLocal, setOpenLocal] = useState(false);
  const open = openLocal || panelOpenRequest;
  const [tab, setTab] = useState<TabKey>('unread');
  const [deleting, setDeleting] = useState<AppNotification | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // §NOTIFICATIONS-UX — one mark-all in flight at a time (duplicate
  // concurrent operations are no-ops, never double-persisted).
  const markAllInFlightRef = useRef(false);

  useEffect(() => {
    if (panelOpenRequest) setPanelOpenRequest(false);
  }, [panelOpenRequest, setPanelOpenRequest]);

  const handleOpenChange = (next: boolean) => {
    setOpenLocal(next);
    if (!next) setPanelOpenRequest(false);
  };

  // The panel owns its data: the LATEST notifications (any status, so
  // items stay visible after being marked read) — the server applies
  // recipient visibility + returns the canonical unreadCount.
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['notification-popover'],
    queryFn: () => apiFetch<{ data: AppNotification[]; unreadCount?: number }>('/api/notifications?limit=30'),
    staleTime: 30_000,
    enabled: open,
  });
  const serverUnreadCount = typeof data?.unreadCount === 'number' ? data.unreadCount : null;
  const unreadCount = serverUnreadCount ?? (data?.data ?? []).filter((n) => n.status === 'unread').length;

  const rows = useMemo<NotificationRowModel[]>(() => {
    const list = [...(data?.data ?? [])]
      .filter((n) => (tab === 'unread' ? n.status === 'unread' : true))
      .filter((n) => (tab === 'important' ? n.priority === 'high' || n.priority === 'critical' : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, PAGE_SIZE);
    return groupNotifications(list);
  }, [data, tab]);

  const invalidateFeeds = () => {
    qc.invalidateQueries({ queryKey: ['notification-popover'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const setStatus = (notif: AppNotification, status: 'read' | 'unread', onError: string) => {
    return apiFetch(`/api/notifications/${notif.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
      .then(invalidateFeeds)
      .catch(() => toast.error(onError));
  };

  const handleOpen = (notif: AppNotification) => {
    if (notif.status === 'unread') void setStatus(notif, 'read', 'تعذر تعليم الإشعار');
    const page = resolveTargetPage(notif);
    if (page === 'employee360') {
      const id = notif.actionUrl?.startsWith('employee360:')
        ? notif.actionUrl.replace('employee360:', '')
        : notif.employeeId;
      if (id) openEmployee360(id); else navigateTo('employees');
    } else {
      // §NOTIFICATIONS-DEEPLINK — the notification's structured context
      // (WHAT/WHO/WHERE + stored navParams) flows through the canonical
      // navigateTo(page, highlightId, navParams) channel. The destination
      // page (e.g. Risk Center: employeeId + month + level) owns how it
      // consumes each param — no second deep-link system.
      navigateTo(page, notif.sourceRecordId || undefined, buildNotificationNavParams(notif));
    }
    setOpenLocal(false);
  };

  // ═══ §NOTIFICATIONS-UX — Mark All as Read ═══
  // ONE authoritative server operation (POST /api/notifications/
  // mark-all-read — itself a single RTDB multi-path write), wrapped in
  // an OPTIMISTIC client update so the panel, the unread counter and
  // the header badge respond instantly. Server correctness is never
  // sacrificed: the snapshot is restored on failure, the error is
  // surfaced honestly, and the feeds are re-validated afterwards to
  // reconcile with the server result.
  const markAllMutation = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>('/api/notifications/mark-all-read', { method: 'POST' }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notification-popover'] });
      const previous = qc.getQueryData<{ data: AppNotification[]; unreadCount?: number }>(['notification-popover']);
      const readAt = new Date().toISOString();
      qc.setQueryData<{ data: AppNotification[]; unreadCount?: number }>(
        ['notification-popover'],
        (old) => old
          ? {
              ...old,
              unreadCount: 0,
              data: old.data.map((n) => (n.status === 'unread' ? { ...n, status: 'read' as const, readAt } : n)),
            }
          : old,
      );
      // The header badge lives in NotificationContext — zero it now too.
      markAllReadLocal();
      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Persistence failed → restore the exact pre-operation snapshot
      // and re-sync the badge from the server; never report success.
      if (context?.previous) {
        qc.setQueryData(['notification-popover'], context.previous);
      }
      void refreshNotificationFeed();
      toast.error(translateUIText('تعذر تعليم الإشعارات', locale));
    },
    onSuccess: (res) => {
      toast.success(
        locale === 'en'
          ? `Marked ${res.updated} notification(s) as read`
          : `تم تعليم ${res.updated} إشعار كمقروء`,
      );
    },
    onSettled: () => {
      // Reconcile with the server result (marks the queries stale;
      // mounted ones refetch, the rest refresh on next mount).
      invalidateFeeds();
    },
  });

  const handleMarkAllRead = () => {
    if (markAllInFlightRef.current) return; // duplicate concurrent op → no-op
    markAllInFlightRef.current = true;
    markAllMutation.mutate(undefined, {
      onSettled: () => { markAllInFlightRef.current = false; },
    });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await apiFetch(`/api/notifications/${deleting.id}`, { method: 'DELETE' });
      toast.success(translateUIText('تم حذف الإشعار', locale));
      setDeleting(null);
      invalidateFeeds();
    } catch {
      toast.error(translateUIText('تعذر حذف الإشعار', locale));
    } finally {
      setDeletingNow(false);
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const rowMenuItems = (notif: AppNotification): OverflowMenuItem[] => {
    const isUnread = notif.status === 'unread';
    return [
      {
        key: 'open',
        label: translateUIText('فتح السجل', locale),
        icon: <ExternalLink className="size-3.5" />,
        onSelect: () => handleOpen(notif),
      },
      {
        key: 'read',
        label: isUnread ? translateUIText('تعليم كمقروء', locale) : translateUIText('تعليم كغير مقروء', locale),
        icon: isUnread ? <Eye className="size-3.5" /> : <Check className="size-3.5" />,
        onSelect: () => void setStatus(notif, isUnread ? 'read' : 'unread', isUnread ? 'تعذر تعليم الإشعار' : 'تعذر التراجع عن القراءة'),
      },
      {
        key: 'delete',
        label: translateUIText('حذف', locale),
        icon: <Trash2 className="size-3.5" />,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setDeleting(notif),
      },
    ];
  };

  const renderRow = (notif: AppNotification, indented = false) => {
    const isUnread = notif.status === 'unread';
    const severity = deriveNotificationSeverity(notif);
    return (
      <div
        key={notif.id}
        role="button"
        tabIndex={0}
        onClick={() => handleOpen(notif)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(notif); } }}
        aria-label={notif.title}
        className={`group relative flex items-start gap-2 py-2 cursor-pointer transition-colors hover:bg-surface-hover ${indented ? 'ps-8 pe-2.5' : 'px-3'}`}
      >
        {/* §9E unread accent — inline-START (RTL-safe), brand-tinted row */}
        {isUnread && <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-500" />}
        {/* severity dot — the small consistent severity model (§9C) */}
        <span aria-hidden="true" className={`mt-1.5 size-1.5 rounded-full shrink-0 ${SEVERITY_DOT[severity]}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-xs truncate leading-tight flex-1 ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/75'}`}>
              {notif.title}
            </p>
            <span className="text-[10px] text-text-muted shrink-0" dir="ltr">{timeAgo(notif.createdAt, locale)}</span>
          </div>
          {notif.description && (
            <p className="text-[11px] text-text-muted line-clamp-1 leading-relaxed mt-0.5">{notif.description}</p>
          )}
          {isUnread && <span className="sr-only">{locale === 'en' ? 'unread' : 'غير مقروء'}</span>}
        </div>

        {/* §9D — secondary actions in the row ⋮ menu, never a button fan */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <OverflowMenu items={rowMenuItems(notif)} label={`إجراءات: ${notif.title}`} />
        </div>
      </div>
    );
  };

  const renderGroupRow = (group: Extract<NotificationRowModel, { kind: 'group' }>) => {
    const expanded = expandedGroups.has(group.key);
    return (
      <div key={group.key} className="border-b border-border/40 last:border-b-0">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={expanded}
          className="relative w-full flex items-start gap-2 px-3 py-2 text-start cursor-pointer transition-colors hover:bg-surface-hover"
        >
          {group.unreadCount > 0 && (
            <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-500" />
          )}
          <span aria-hidden="true" className={`mt-1.5 size-1.5 rounded-full shrink-0 ${SEVERITY_DOT[group.severity]}`} />
          <span className="flex-1 min-w-0 text-xs font-semibold text-foreground truncate">
            {group.title}
            <span className="text-text-muted font-normal"> — {group.count} {locale === 'en' ? 'notifications' : 'إشعارات'}</span>
          </span>
          {group.unreadCount > 0 && (
            <span className="shrink-0 text-[9px] font-bold text-brand-300 bg-brand-500/15 rounded-full px-1.5 py-0.5" aria-label={`${group.unreadCount} ${locale === 'en' ? 'unread' : 'غير مقروء'}`}>
              {group.unreadCount}
            </span>
          )}
          <span className="text-[10px] text-text-muted shrink-0" dir="ltr">{timeAgo(group.newestAt, locale)}</span>
          <span className={`text-text-muted text-[10px] shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
        </button>
        {expanded && (
          <div role="list" aria-label={group.title}>
            {group.items.map((n) => renderRow(n, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild aria-label="الإشعارات">
          {children}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[400px] max-w-[calc(100vw-2rem)] p-0 rounded-xl border-border bg-popover text-popover-foreground shadow-xl shadow-black/20 overflow-hidden"
        >
          {/* ── FIXED header: title · unread count · mark-all ── */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="size-4 text-brand-400 shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-bold leading-tight"><T>الإشعارات</T></h3>
              {unreadCount > 0 ? (
                <span
                  className="text-[10px] font-bold text-brand-300 bg-brand-500/15 border border-brand-500/25 rounded-full px-1.5 py-0.5 leading-none"
                  aria-label={`${unreadCount} غير مقروء`}
                >
                  {unreadCount > 99 ? '+99' : unreadCount}
                </span>
              ) : (
                <span className="text-[10px] text-text-muted"><T>كلها مقروءة</T></span>
              )}
            </div>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markAllMutation.isPending || unreadCount === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title={translateUIText('تعليم الكل كمقروء', locale)}
            >
              {markAllMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
              <T>تعليم الكل</T>
            </button>
          </div>

          {/* ── tabs: الكل · غير مقروء · هام (§9A) ── */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 shrink-0" role="tablist" aria-label={translateUIText('تصفية الإشعارات', locale)}>
            {([
              { key: 'unread' as const, label: `${translateUIText('غير مقروء', locale)}${serverUnreadCount ? ` (${serverUnreadCount})` : ''}` },
              { key: 'all' as const, label: translateUIText('الكل', locale) },
              { key: 'important' as const, label: translateUIText('هام', locale) },
            ]).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  tab === t.key
                    ? 'bg-brand-500/15 text-brand-300'
                    : 'text-text-muted hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── LIST — the ONLY scrollable region (§9G): bounded height,
              shared thin scrollbar, contained overscroll. ── */}
          <ScrollableSurface maxHeight="min(60vh, 480px)" label={translateUIText('قائمة الإشعارات', locale)} className="border-0">
            {isLoading ? (
              /* §9H loading — quiet skeleton, same row rhythm */
              <div className="py-1 divide-y divide-border/40" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5">
                    <Skeleton className="size-1.5 rounded-full mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              /* §9H error — compact retry, no giant box */
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-xs text-text-muted mb-2"><T>تعذر تحميل الإشعارات</T></p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-[11px] border-border"
                  onClick={() => void refetch()}
                  disabled={isRefetching}
                >
                  {isRefetching ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                  <T>إعادة المحاولة</T>
                </Button>
              </div>
            ) : rows.length === 0 ? (
              /* §9H empty — small icon + concise message per tab */
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <BellOff className="size-5 text-text-muted/60 mb-2" aria-hidden="true" />
                <p className="text-xs font-medium text-foreground/80">
                  {tab === 'unread' ? translateUIText('لا توجد إشعارات جديدة', locale) : tab === 'important' ? translateUIText('لا توجد إشعارات هامة', locale) : translateUIText('لا توجد إشعارات', locale)}
                </p>
                {tab !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setTab('all')}
                    className="text-[11px] text-brand-400 hover:text-brand-300 mt-1"
                  >
                    <T>عرض الكل</T>
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {rows.map((row) =>
                  row.kind === 'group' ? renderGroupRow(row) : renderRow(row.item),
                )}
              </div>
            )}
          </ScrollableSurface>
        </PopoverContent>
      </Popover>

      {/* §4: unified delete confirmation — same component as every page */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        description={translateUIText('سيتم حذف هذا الإشعار نهائياً.', locale)}
        itemName={deleting?.title}
        loading={deletingNow}
        onConfirm={confirmDelete}
      />
    </>
  );
}
