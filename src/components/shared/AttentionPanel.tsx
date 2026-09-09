'use client';

// ══════════════════════════════════════════════════════════════
//  AttentionPanel — the ONE system-wide attention surface
//
//  Replaces every per-page "alerts / overdue / due today" block
//  (FollowUps · Travel · Risk · Quality · KPI · Capa · Complaints …).
//  A single component with a strict prop contract: every consumer
//  (FollowUpsPage, TravelPage, RiskCenterPage, …) renders the same
//  header · severity counts · compact rows · collapse affordance.
//
//  Contract:
//   • title + icon + counts (broken down by severity).
//   • groups? (optional) — lets the consumer cluster rows
//     ("متأخرة" / "مستحقة اليوم") with thin group headers, NO cards.
//   • items: AttentionItem[] — id, severity, leadingBadge, primary,
//     secondary, trailing, onClick, overflowItems (⋮).
//   • collapsible: §10 GLOBAL ALERT CONTRACT — COLLAPSED BY DEFAULT,
//     expand on demand, never a permanent hide (the header count +
//     glow indicator stay visible while collapsed).
//   • Persistence: when persistKey is supplied, the collapsed state
//     is saved under userPreferences.ui (string) and restored across
//     navigation — the existing personalization architecture is
//     reused (no parallel state system).
//   • Renders the same Row across all pages — no second design.
// ══════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, ChevronDown, ChevronLeft, Clock, Bell, AlertOctagon,
  CheckCircle2, Info, Plane, ShieldAlert, Eye, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OverflowMenu, type OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { useUserPreferences, useSaveUserPreferences } from '@/hooks/use-user-preferences';

/* ── Severity levels (§5 — Arabic labels, never color-only) ── */
export type AttentionSeverity = 'critical' | 'urgent' | 'warning' | 'info';

interface SeverityMeta {
  /** short label — appears in the row's leading badge */
  short: string;
  /** heading — appears in the header summary when at least 1 row uses it */
  heading: string;
  /** one-word label, used in ARIA + responsive mode */
  aria: string;
  /** icon rendered to the LEFT of the badge label */
  icon: typeof AlertOctagon;
  /** the leading row indicator color */
  rowClass: string;
  badgeClass: string;
  iconClass: string;
}

const SEVERITY_META: Record<AttentionSeverity, SeverityMeta> = {
  critical: {
    short: 'حرج',
    heading: 'حالات حرجة',
    aria: 'critical',
    icon: AlertOctagon,
    rowClass: 'border-red-500/25 bg-red-500/5',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
    iconClass: 'text-red-400',
  },
  urgent: {
    short: 'عاجل',
    heading: 'عاجل',
    aria: 'urgent',
    icon: AlertTriangle,
    rowClass: 'border-orange-500/25 bg-orange-500/5',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    iconClass: 'text-orange-400',
  },
  warning: {
    short: 'اليوم',
    heading: 'مستحقة اليوم',
    aria: 'warning',
    icon: Clock,
    rowClass: 'border-amber-500/25 bg-amber-500/5',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    iconClass: 'text-amber-400',
  },
  info: {
    short: 'معلومة',
    heading: 'للمتابعة',
    aria: 'info',
    icon: Info,
    rowClass: 'border-cyan-500/25 bg-cyan-500/5',
    badgeClass: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    iconClass: 'text-cyan-400',
  },
};

export function getSeverityMeta(s: AttentionSeverity): SeverityMeta {
  return SEVERITY_META[s];
}

/* ── Item contract ── */

export interface AttentionItem {
  /** stable id used for keys + persist state */
  id: string;
  /** severity bucket — controls color, badge, header summary */
  severity: AttentionSeverity;
  /** PRIMARY cell — the most important info (employee, record, …) */
  primary: React.ReactNode;
  /** SECONDARY cell — supporting info (subject, reason, …) */
  secondary?: React.ReactNode;
  /** trailing meta — date, days-remaining, count, … */
  trailing?: React.ReactNode;
  /** optional group label — used by the groupHeader rendering */
  groupKey?: string;
  /** whole row click — open the record, navigate, … */
  onClick?: () => void;
  /** optional ⋮ OverflowMenu items for secondary actions */
  overflowItems?: OverflowMenuItem[];
  /** skip this row in the persisted collapsed-state (never show at all) */
  hidden?: boolean;
}

export interface AttentionGroup {
  /** group label, e.g. "متأخرة", "مستحقة اليوم" — rendered as a thin inline header */
  key: string;
  label: string;
  count?: number;
}

export interface AttentionPanelProps {
  /** header title — required */
  title: string;
  /** header icon — required */
  icon: React.ReactNode;
  /** compact subtitle under the title (optional) */
  subtitle?: string;
  /** the rows — already in display order */
  items: AttentionItem[];
  /** optional groups, in display order — matches item.groupKey */
  groups?: AttentionGroup[];
  /** optional override for the badge that appears in the header (single count) */
  count?: number;
  /** persisted state key — when provided, collapse/expand survives navigation */
  persistKey?: string;
  /** initial collapsed override (default: §X collapsed — surface only
   *  becomes prominent on user demand; the header summary always shows
   *  the severity counts so the "needs attention" signal is loud
   *  even with the body closed) */
  defaultCollapsed?: boolean;
  /** empty-state copy + icon */
  emptyState?: { icon?: React.ReactNode; title?: string; description?: string };
  /** limit rows shown when expanded (default: unlimited) */
  maxRows?: number;
  /** max height (px) of the expanded body — longer lists scroll instead
   *  of stretching the page. Default 420; pass 0 to disable. */
  bodyMaxHeight?: number;
  /** when the consumer wants to render its own row content for absolute parity */
  customRowRenderer?: (item: AttentionItem, idx: number) => React.ReactNode;
  /** accessibility label for the panel region */
  ariaLabel?: string;
}

interface UiPrefs {
  /** arbitrary user-scope UI flags (string → boolean). Stores collapsed
   *  state without needing a new key in the preferences schema. */
  [key: string]: boolean;
}

/* ══════════════════════════════════════════════════════════════ */

export function AttentionPanel({
  title,
  icon,
  subtitle,
  items,
  groups,
  count,
  persistKey,
  defaultCollapsed,
  emptyState,
  maxRows,
  bodyMaxHeight = 420,
  customRowRenderer,
  ariaLabel,
}: AttentionPanelProps) {
  const visibleItems = useMemo(() => items.filter((i) => !i.hidden), [items]);
  const totalCount = count ?? visibleItems.length;

  // ── Collapse state — persisted through the existing user-prefs ──
  const { data: prefs } = useUserPreferences();
  const savePrefs = useSaveUserPreferences();
  const collapsedPref = persistKey ? (prefs as unknown as { ui?: UiPrefs } | null)?.ui?.[persistKey] : undefined;
  // §10 GLOBAL ALERT CONTRACT — CLOSED BY DEFAULT:
  //   • No stored preference yet → collapsed (the header summary shows
  //     the severity counts, so the signal stays loud either way).
  //   • Stored preference (true/false) → the user's choice wins and
  //     survives navigation + reloads via userPreferences.ui.
  //   • defaultCollapsed only seeds the LOCAL (no-persistKey) state.
  const [localCollapsed, setLocalCollapsed] = useState<boolean>(defaultCollapsed ?? true);

  // Collapsed state:
  //   • With persistKey — stored pref if the user ever toggled,
  //     otherwise DEFAULT COLLAPSED (undefined → collapsed).
  //   • Otherwise — localCollapsed is the user-toggled value, but it
  //     is ignored when there are no items (so the empty state shows
  //     instead of a collapsed header that hides the "no items" message).
  const collapsed = persistKey
    ? collapsedPref === undefined
      ? true
      : Boolean(collapsedPref)
    : visibleItems.length === 0
      ? false
      : localCollapsed;

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    if (persistKey) {
      const prev = (prefs as unknown as { ui?: UiPrefs } | null)?.ui ?? {};
      savePrefs.mutate({ ui: { ...prev, [persistKey]: next } } as never, {
        onError: () => { /* swallow — UI persistence is best-effort */ },
      });
    } else {
      setLocalCollapsed(next);
    }
  }, [collapsed, persistKey, prefs, savePrefs]);

  // ── Severity roll-up for the header summary ──
  const severityCounts = useMemo(() => {
    const acc: Record<AttentionSeverity, number> = { critical: 0, urgent: 0, warning: 0, info: 0 };
    for (const it of visibleItems) acc[it.severity] += 1;
    return acc;
  }, [visibleItems]);

  // §X — top severity used for the panel's attention accent (left
  // border color when collapsed). critical > urgent > warning > info.
  const topSeverity: AttentionSeverity | null = useMemo(() => {
    if (visibleItems.length === 0) return null;
    if (severityCounts.critical > 0) return 'critical';
    if (severityCounts.urgent > 0) return 'urgent';
    if (severityCounts.warning > 0) return 'warning';
    return 'info';
  }, [visibleItems.length, severityCounts]);
  const hasCritical = topSeverity === 'critical';

  const displayItems = useMemo(() => {
    if (!collapsed && typeof maxRows === 'number' && visibleItems.length > maxRows) {
      return visibleItems.slice(0, maxRows);
    }
    return visibleItems;
  }, [collapsed, maxRows, visibleItems]);

  // ── Grouping: collect indices per groupKey while preserving order ──
  const renderedGroups = useMemo(() => {
    if (!groups || groups.length === 0) return null;
    const byGroup = new Map<string, number[]>();
    const orphanIndices: number[] = [];
    displayItems.forEach((item, idx) => {
      if (item.groupKey) {
        const arr = byGroup.get(item.groupKey) ?? [];
        arr.push(idx);
        byGroup.set(item.groupKey, arr);
      } else {
        orphanIndices.push(idx);
      }
    });
    return { groups, byGroup, orphanIndices };
  }, [groups, displayItems]);

  return (
    <section
      dir="rtl"
      role="region"
      aria-label={ariaLabel ?? title}
      className={cn(
        'rounded-xl border overflow-hidden transition-shadow',
        // §10 — external glow indicator while COLLAPSED with active
        // items: the card visibly "lit" from the outside so active
        // alerts/risks are impossible to miss, scaled by the top
        // severity (rose > orange > amber > cyan). §ALERT-FLASH —
        // critical & urgent additionally FLASH (breathing box-shadow
        // pulse, reduced-motion aware via the CSS classes); expanded
        // = neutral — the details take over once opened.
        visibleItems.length === 0
          ? 'border-slate-700/40 bg-slate-800/30 opacity-90'
          : collapsed
            ? hasCritical
              ? 'border-rose-500/40 bg-slate-800/30 alert-flash-critical'
              : topSeverity === 'urgent'
                ? 'border-orange-500/35 bg-slate-800/30 alert-flash-urgent'
                : topSeverity === 'warning'
                  ? 'border-amber-500/30 bg-slate-800/30 shadow-[0_0_0_1px_rgba(245,158,11,0.16),0_0_14px_rgba(245,158,11,0.09)]'
                  : 'border-cyan-500/25 bg-slate-800/30 shadow-[0_0_0_1px_rgba(34,211,238,0.12),0_0_12px_rgba(34,211,238,0.07)]'
            : hasCritical
              ? 'border-rose-500/30 bg-slate-800/30 shadow-[0_0_0_1px_rgba(244,63,94,0.16),0_0_12px_rgba(244,63,94,0.08)]'
              : topSeverity === 'urgent'
                ? 'border-orange-500/25 bg-slate-800/30 shadow-[0_0_0_1px_rgba(249,115,22,0.12),0_0_10px_rgba(249,115,22,0.06)]'
                : 'border-slate-700/40 bg-slate-800/30',
      )}
    >
      {/* ═══ HEADER (§10) ═══ */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls={`attention-panel-${persistKey ?? 'local'}`}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-right hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
          // Subtle attention pulse on the icon container when the
          // panel is closed AND items need attention. The pulse is a
          // 2.4s opacity flicker, not a scale/translation spring —
          // no layout shift, no perpetual motion beyond visibility.
          visibleItems.length > 0 && collapsed && 'bg-[length:100%_100%]',
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              'flex items-center justify-center size-7 rounded-lg border shrink-0 transition-colors',
              // §X — the icon container takes the panel's accent when
              // closed, so a critical panel is visually impossible to
              // miss without a perpetual motion animation.
              visibleItems.length === 0
                ? 'bg-slate-700/40 border-slate-600/30'
                : collapsed
                  ? topSeverity === 'critical'
                    ? 'bg-rose-500/20 border-rose-500/45 text-rose-300'
                    : topSeverity === 'urgent'
                      ? 'bg-orange-500/15 border-orange-500/35 text-orange-300'
                      : topSeverity === 'warning'
                        ? 'bg-amber-500/12 border-amber-500/30 text-amber-300'
                        : 'bg-cyan-500/12 border-cyan-500/25 text-cyan-300'
                  : 'bg-slate-700/40 border-slate-600/30',
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0 text-right">
            <p className="text-sm font-semibold text-slate-100 truncate">{title}</p>
            {subtitle && !collapsed && (
              <p className="text-[10px] text-slate-500 truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {totalCount > 0 && (
            <>
              {(Object.keys(severityCounts) as AttentionSeverity[]).map((sev) => {
                if (severityCounts[sev] === 0) return null;
                const meta = SEVERITY_META[sev];
                return (
                  <span
                    key={sev}
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold tabular-nums',
                      meta.badgeClass,
                    )}
                    title={meta.heading}
                  >
                    <span aria-hidden="true" className={cn('inline-block size-1.5 rounded-full', meta.iconClass.replace('text-', 'bg-'))} />
                    {meta.short} {severityCounts[sev]}
                  </span>
                );
              })}
            </>
          )}
          <span className="text-[10px] text-slate-500 tabular-nums px-1.5">
            {totalCount} {totalCount === 1 ? 'عنصر' : 'عناصر'}
          </span>
          <motion.span
            animate={{ rotate: collapsed ? 90 : 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="inline-flex items-center justify-center size-6 rounded-md text-slate-400"
            aria-hidden="true"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </div>
      </button>

      {/* ═══ BODY — collapsed = single summary line, expanded = rows ═══ */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            id={`attention-panel-${persistKey ?? 'local'}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-slate-700/40">
              {/* bodyMaxHeight: long lists scroll inside the panel instead
                  of stretching the whole page (CAPA/Risk can have dozens). */}
              <div
                className={cn('arm-scroll', bodyMaxHeight > 0 && 'overflow-y-auto')}
                style={bodyMaxHeight > 0 ? { maxHeight: bodyMaxHeight } : undefined}
              >
                {displayItems.length === 0 ? (
                  <EmptyAttention emptyState={emptyState} />
                ) : (
                  <ul className="divide-y divide-slate-800/60">
                    {renderedGroups
                      ? renderGroupedRows(displayItems, renderedGroups, customRowRenderer)
                      : displayItems.map((item, idx) => renderRow(item, idx, customRowRenderer))}
                  </ul>
                )}
              </div>
              {typeof maxRows === 'number' && visibleItems.length > maxRows && (
                <div className="px-3.5 py-2 text-[10px] text-slate-500 text-center border-t border-slate-800/40 bg-slate-900/20">
                  يعرض أول {maxRows} من {visibleItems.length} — اضغط على أي عنصر لفتح التفاصيل
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ═══ Internal render helpers ═══ */

function renderRow(
  item: AttentionItem,
  idx: number,
  customRowRenderer?: AttentionPanelProps['customRowRenderer'],
) {
  if (customRowRenderer) return <li key={item.id}>{customRowRenderer(item, idx)}</li>;
  return <li key={item.id}><DefaultAttentionRow item={item} /></li>;
}

function renderGroupedRows(
  items: AttentionItem[],
  layout: { groups: AttentionGroup[]; byGroup: Map<string, number[]>; orphanIndices: number[] },
  customRowRenderer?: AttentionPanelProps['customRowRenderer'],
) {
  const elements: React.ReactNode[] = [];
  const allPositions: { type: 'group'; group: AttentionGroup; indices: number[] } | { type: 'orphan'; idx: number }[] = [];

  // ── Build a single ordered list of {group, itemIdx} to preserve item order ──
  const ordered: { kind: 'group' | 'item'; groupKey?: string; itemIdx?: number; group?: AttentionGroup }[] = [];
  const consumedIndices = new Set<number>();
  items.forEach((item, idx) => {
    if (item.groupKey) {
      const g = layout.groups.find((g) => g.key === item.groupKey);
      if (g && !ordered.some((o) => o.kind === 'group' && o.groupKey === g.key)) {
        ordered.push({ kind: 'group', groupKey: g.key, group: g });
      }
      ordered.push({ kind: 'item', itemIdx: idx });
      consumedIndices.add(idx);
    } else {
      ordered.push({ kind: 'item', itemIdx: idx });
    }
  });

  ordered.forEach((entry) => {
    if (entry.kind === 'group' && entry.group) {
      const indices = layout.byGroup.get(entry.group.key) ?? [];
      const g = entry.group;
      elements.push(
        <li key={`grp-${g.key}`} className="px-3.5 py-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-900/40 border-b border-slate-800/40">
          <span className="inline-block size-1.5 rounded-full bg-slate-600" aria-hidden="true" />
          {g.label}
          <span className="text-slate-600 normal-case font-medium">({indices.length})</span>
        </li>
      );
    } else if (entry.kind === 'item' && entry.itemIdx !== undefined) {
      const item = items[entry.itemIdx];
      elements.push(renderRow(item, entry.itemIdx, customRowRenderer));
    }
  });
  return elements;
}

function DefaultAttentionRow({ item }: { item: AttentionItem }) {
  const meta = SEVERITY_META[item.severity];
  const SevIcon = meta.icon;
  const interactive = typeof item.onClick === 'function';

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={item.onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        'group flex items-center gap-2.5 px-3.5 py-2 transition-colors',
        interactive && 'hover:bg-slate-800/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
      )}
    >
      {/* leading severity badge (§5 — label + dot, not color only) */}
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold shrink-0 w-16 justify-center',
          meta.badgeClass,
        )}
        aria-label={`severity: ${meta.aria}`}
      >
        <SevIcon className="size-3" aria-hidden="true" />
        {meta.short}
      </span>

      {/* primary + secondary */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-100 truncate">{item.primary}</div>
        {item.secondary && (
          <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.secondary}</div>
        )}
      </div>

      {/* trailing meta */}
      {item.trailing && (
        <div className="text-[10px] text-slate-500 tabular-nums shrink-0 hidden sm:block">
          {item.trailing}
        </div>
      )}

      {/* overflow menu (§11) */}
      {item.overflowItems && item.overflowItems.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
        >
          <OverflowMenu items={item.overflowItems} label="إجراءات إضافية" />
        </div>
      )}

      {/* chevron for interactive rows */}
      {interactive && (
        <ChevronLeft className="size-3.5 text-slate-600 shrink-0 -rotate-180" aria-hidden="true" />
      )}
    </div>
  );
}

function EmptyAttention({ emptyState }: { emptyState?: AttentionPanelProps['emptyState'] }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      {emptyState?.icon ?? <CheckCircle2 className="size-7 text-emerald-500/50 mb-2" />}
      <p className="text-xs font-semibold text-slate-300">
        {emptyState?.title ?? 'لا توجد عناصر تحتاج انتباه'}
      </p>
      {emptyState?.description && (
        <p className="text-[10px] text-slate-500 mt-0.5 max-w-md">{emptyState.description}</p>
      )}
    </div>
  );
}

/* ── Re-exports of common severity icons so consumers can use them
 *    in their groups / item.primary without importing lucide. ── */
export { AlertTriangle, Bell, AlertOctagon, Clock, Eye, X, Plane, ShieldAlert };
