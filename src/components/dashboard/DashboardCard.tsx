'use client';

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

export type DashboardCardSize = 'small' | 'medium' | 'large';

export interface DashboardCardProps {
  /** Widget title */
  title: string;
  /** Header icon */
  icon: ReactNode;
  /** Icon background class */
  iconBg: string;
  /** Icon color class */
  iconColor: string;
  /** Border color class */
  borderClr: string;
  /** Card content — becomes scrollable body */
  children: ReactNode;
  /** Optional header actions (badge, nav button, etc.) */
  actions?: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Loading state */
  loading?: boolean;
  /** Enable independent scrolling */
  scrollable?: boolean;
  /** Max height preset or custom string */
  size?: DashboardCardSize;
  /** Custom max-height override */
  maxHeight?: string;
  /** Custom min-height override */
  minHeight?: string;
  /** Badge text/count shown in header */
  badge?: string | number;
  /** Show refresh button in header */
  onRefresh?: () => void;
  /** Show "open full page" button */
  onOpenFull?: () => void;
  /** Error state */
  error?: boolean;
  /** Error message */
  errorMessage?: string;
  /** Retry callback */
  onRetry?: () => void;
  /** Collapse state (controlled) */
  collapsed?: boolean;
  /** Collapse toggle callback */
  onCollapseToggle?: () => void;
  /** Last updated timestamp text */
  lastUpdated?: string;
  /** Accessible label */
  'aria-label'?: string;
  /** Span 2 columns on desktop grid */
  colSpan2?: boolean;
}

/* ═══════════════════════════════════════════════════════════
   SIZE → MAX-HEIGHT MAPPING
   ═══════════════════════════════════════════════════════════ */

const SIZE_MAX_HEIGHTS: Record<DashboardCardSize, string> = {
  small: '320px',
  medium: '420px',
  large: '520px',
};

const SIZE_MIN_HEIGHTS: Record<DashboardCardSize, string> = {
  small: '180px',
  medium: '240px',
  large: '300px',
};

/* ═══════════════════════════════════════════════════════════
   SCROLL CAPTURE ENGINE
   When mouse wheel reaches top/bottom of scrollable body,
   naturally returns scroll control to parent page.
   ═══════════════════════════════════════════════════════════ */

function useScrollCapture(containerRef: React.RefObject<HTMLDivElement | null>) {
  const isCapturing = useRef(false);

  const handleWheel = useCallback((e: globalThis.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

    // If at scroll boundary, let parent handle it
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
      if (isCapturing.current) {
        e.stopPropagation();
        isCapturing.current = false;
      }
      return;
    }

    // Content is scrollable and we have room — capture scroll
    if (scrollHeight > clientHeight) {
      e.stopPropagation();
      isCapturing.current = true;
    }
  }, [containerRef]);

  const handleMouseEnter = useCallback(() => {
    isCapturing.current = false;
  }, []);

  // Attach native event listeners for reliable scroll capture
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel as EventListener, { passive: false });
    el.addEventListener('mouseenter', handleMouseEnter);
    return () => {
      el.removeEventListener('wheel', handleWheel as EventListener);
      el.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, [containerRef, handleWheel, handleMouseEnter]);

  return null;
}

/* ═══════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════ */

export function DashboardCard({
  title,
  icon,
  iconBg,
  iconColor,
  borderClr,
  children,
  actions,
  footer,
  loading = false,
  scrollable = true,
  size = 'medium',
  maxHeight,
  minHeight,
  badge,
  onRefresh,
  onOpenFull,
  error = false,
  errorMessage,
  onRetry,
  collapsed = false,
  onCollapseToggle,
  lastUpdated,
  'aria-label': ariaLabel,
  colSpan2 = false,
}: DashboardCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollCapture(scrollRef);

  const resolvedMaxH = maxHeight || (scrollable ? SIZE_MAX_HEIGHTS[size] : undefined);
  const resolvedMinH = minHeight || SIZE_MIN_HEIGHTS[size];

  const isCollapsed = collapsed && !loading;

  return (
    <div
      role="region"
      aria-label={ariaLabel || title}
      className={`${borderClr} bg-slate-800/40 backdrop-blur-md flex flex-col overflow-hidden rounded-2xl border shadow-lg shadow-black/10 transition-all duration-200 ${colSpan2 ? 'lg:col-span-2' : ''} ${isCollapsed ? '' : 'min-h-0'}`}
      style={{
        maxHeight: isCollapsed ? undefined : resolvedMaxH ? `${resolvedMaxH}` : undefined,
        minHeight: isCollapsed ? undefined : resolvedMinH ? `${resolvedMinH}` : undefined,
      }}
    >
      {/* ═══ HEADER — Always visible ═══ */}
      <div className="shrink-0 pb-3 pt-5 px-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`p-2 rounded-xl ${iconBg} shadow-sm transition-transform hover:scale-110 shrink-0 ${iconColor}`}>
            {icon}
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <h3 className={`text-[15px] font-semibold ${iconColor} truncate`}>{title}</h3>
            {badge !== undefined && (
              <span className="shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-600/20 text-slate-300 tabular-nums">
                {badge}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {loading && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <RefreshCw className="size-3 animate-spin" />
            </span>
          )}
          {lastUpdated && !loading && (
            <span className="text-[10px] text-slate-600 hidden sm:inline" dir="ltr">
              {lastUpdated}
            </span>
          )}
          {onRefresh && !loading && (
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors"
              aria-label="تحديث"
              title="تحديث"
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
          {onOpenFull && (
            <button
              onClick={onOpenFull}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors"
              aria-label="فتح الصفحة الكاملة"
              title="فتح الصفحة الكاملة"
            >
              <ExternalLink className="size-3.5" />
            </button>
          )}
          {onCollapseToggle && (
            <button
              onClick={onCollapseToggle}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors"
              aria-label={isCollapsed ? 'توسيع' : 'طي'}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </button>
          )}
          {actions}
        </div>
      </div>

      {/* ═══ BODY — Scrollable or static ═══ */}
      {isCollapsed ? null : (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden dashboard-scroll"
          style={{ paddingBottom: '4px', paddingRight: '4px' }}
        >
          {loading ? (
            <div className="px-1 pb-2 space-y-3">
              <Skeleton className="h-12 w-full rounded-xl bg-slate-700/30" />
              <Skeleton className="h-12 w-full rounded-xl bg-slate-700/30" />
              <Skeleton className="h-12 w-3/4 rounded-xl bg-slate-700/30" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <AlertCircle className="size-8 text-red-400/50 mb-3" />
              <p className="text-slate-400 text-sm mb-3 text-center">{errorMessage || 'حدث خطأ في تحميل البيانات'}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-700/30 text-slate-300 hover:bg-slate-700/50 hover:text-white border border-slate-600/20 transition-colors"
                >
                  إعادة المحاولة
                </button>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}

      {/* ═══ FOOTER — Always visible when present ═══ */}
      {!isCollapsed && footer && (
        <div className="shrink-0 pt-2 pb-4 px-6 border-t border-slate-700/15 mt-auto">
          {footer}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD GRID — Responsive layout engine
   ═══════════════════════════════════════════════════════════ */

export interface DashboardGridProps {
  children: ReactNode;
  /** Number of columns on desktop (default 2) */
  columns?: 1 | 2 | 3;
  /** Gap between cards */
  gap?: string;
}

export function DashboardGrid({ children, columns = 2, gap = 'gap-6' }: DashboardGridProps) {
  const colClass = columns === 3 ? 'lg:grid-cols-3' : columns === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2';

  return (
    <div className={`grid ${colClass} ${gap}`}>
      {children}
    </div>
  );
}