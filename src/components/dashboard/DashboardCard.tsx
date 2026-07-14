'use client';

import { useCallback, useRef, useEffect, type ReactNode, memo } from 'react';
import { useScrollShadows } from '@/hooks/use-scroll-shadows';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, RefreshCw, ExternalLink, AlertCircle, Inbox } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

export type DashboardCardSize = 'small' | 'medium' | 'large';

export interface DashboardCardProps {
  title: string;
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  borderClr: string;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  scrollable?: boolean;
  size?: DashboardCardSize;
  maxHeight?: string;
  minHeight?: string;
  badge?: string | number;
  onRefresh?: () => void;
  onOpenFull?: () => void;
  error?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  lastUpdated?: string;
  'aria-label'?: string;
  colSpan2?: boolean;
  empty?: boolean;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}

/* ═══════════════════════════════════════════════════════════
   SIZE → HEIGHT MAPPING
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
   ═══════════════════════════════════════════════════════════ */

function useScrollCapture(containerRef: React.RefObject<HTMLDivElement | null>) {
  const isCapturing = useRef(false);

  const handleWheel = useCallback((e: globalThis.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
      if (isCapturing.current) { e.stopPropagation(); isCapturing.current = false; }
      return;
    }
    if (scrollHeight > clientHeight) { e.stopPropagation(); isCapturing.current = true; }
  }, [containerRef]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const el = containerRef.current;
    if (!el) return;
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const scrollAmount = clientHeight * 0.85;
      if (e.key === 'PageDown' && scrollTop + clientHeight < scrollHeight) {
        e.preventDefault(); el.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      } else if (e.key === 'PageUp' && scrollTop > 0) {
        e.preventDefault(); el.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
      }
    }
  }, [containerRef]);

  const handleMouseEnter = useCallback(() => { isCapturing.current = false; }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel as EventListener, { passive: false });
    el.addEventListener('keydown', handleKeyDown as EventListener);
    el.addEventListener('mouseenter', handleMouseEnter);
    return () => {
      el.removeEventListener('wheel', handleWheel as EventListener);
      el.removeEventListener('keydown', handleKeyDown as EventListener);
      el.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, [containerRef, handleWheel, handleKeyDown, handleMouseEnter]);
}

/* ═══════════════════════════════════════════════════════════
   SCROLL BODY — wires shadow state to data attributes
   Separated so useScrollShadows has a stable ref to observe.
   ═══════════════════════════════════════════════════════════ */

interface ScrollBodyProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  scrollable: boolean;
  children: ReactNode;
}

const ScrollBody = memo(function ScrollBody({ scrollRef, scrollable, children }: ScrollBodyProps) {
  const { hasTopShadow, hasBottomShadow } = useScrollShadows(scrollRef);

  return (
    <div
      ref={scrollRef}
      className={`flex-1 min-h-0 overflow-x-hidden ${scrollable ? 'arm-scroll arm-scroll-shadow' : 'overflow-hidden'}`}
      style={{ paddingBottom: '4px', paddingRight: '4px' }}
      tabIndex={0}
      data-shadow-top={scrollable && hasTopShadow ? 'true' : 'false'}
      data-shadow-bottom={scrollable && hasBottomShadow ? 'true' : 'false'}
    >
      {children}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   BUILT-IN EMPTY STATE
   ═══════════════════════════════════════════════════════════ */

const BuiltInEmptyState = memo(function BuiltInEmptyState({
  icon, message, description, action,
}: { icon?: ReactNode; message: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div className="mb-3 text-slate-600" style={{ animation: 'float-sm 2.5s ease-in-out infinite' }}>
        {icon || <Inbox className="size-10" />}
      </div>
      <p className="text-slate-400 text-sm font-medium">{message}</p>
      {description && <p className="text-slate-500 text-xs mt-1 text-center max-w-[240px]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   DASHBOARD CARD
   ═══════════════════════════════════════════════════════════ */

export const DashboardCard = memo(function DashboardCard({
  title, icon, iconBg, iconColor, borderClr, children, actions, footer,
  loading = false, scrollable = true, size = 'medium', maxHeight, minHeight,
  badge, onRefresh, onOpenFull, error = false, errorMessage, onRetry,
  collapsed = false, onCollapseToggle, lastUpdated, 'aria-label': ariaLabel,
  colSpan2 = false, empty = false, emptyIcon, emptyMessage, emptyDescription, emptyAction,
}: DashboardCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollCapture(scrollRef);

  const resolvedMaxH = maxHeight || (scrollable ? SIZE_MAX_HEIGHTS[size] : undefined);
  const resolvedMinH = minHeight || SIZE_MIN_HEIGHTS[size];

  const maxHIsTw = !!resolvedMaxH && /^\w+-\w+/.test(resolvedMaxH);
  const minHIsTw = !!resolvedMinH && /^\w+-\w+/.test(resolvedMinH);
  const isCollapsed = collapsed && !loading;

  const heightClasses = [
    !isCollapsed && maxHIsTw ? resolvedMaxH : '',
    !isCollapsed && minHIsTw ? resolvedMinH : '',
  ].filter(Boolean).join(' ');

  const heightStyle: React.CSSProperties = {
    ...(!isCollapsed && resolvedMaxH && !maxHIsTw ? { maxHeight: resolvedMaxH } : {}),
    ...(!isCollapsed && resolvedMinH && !minHIsTw ? { minHeight: resolvedMinH } : {}),
  };

  return (
    <div
      role="region"
      aria-label={ariaLabel || title}
      aria-busy={loading}
      className={`${borderClr} bg-slate-800/40 backdrop-blur-md flex flex-col overflow-hidden rounded-2xl border shadow-lg shadow-black/10 transition-all duration-200 ${colSpan2 ? 'lg:col-span-2' : ''} ${isCollapsed ? '' : 'min-h-0'} ${heightClasses}`}
      style={heightStyle}
    >
      {/* ═══ HEADER ═══ */}
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
          {loading && <span className="flex items-center gap-1 text-[10px] text-slate-500"><RefreshCw className="size-3 animate-spin" /></span>}
          {lastUpdated && !loading && <span className="text-[10px] text-slate-600 hidden sm:inline" dir="ltr">{lastUpdated}</span>}
          {onRefresh && !loading && (
            <button onClick={onRefresh} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors" aria-label="تحديث" title="تحديث">
              <RefreshCw className="size-3.5" />
            </button>
          )}
          {onOpenFull && (
            <button onClick={onOpenFull} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors" aria-label="فتح الصفحة الكاملة" title="فتح الصفحة الكاملة">
              <ExternalLink className="size-3.5" />
            </button>
          )}
          {onCollapseToggle && (
            <button onClick={onCollapseToggle} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors" aria-label={isCollapsed ? 'توسيع' : 'طي'} aria-expanded={!isCollapsed}>
              {isCollapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </button>
          )}
          {actions}
        </div>
      </div>

      {/* ═══ BODY ═══ */}
      {!isCollapsed && (
        <ScrollBody scrollRef={scrollRef} scrollable={scrollable}>
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
                <button onClick={onRetry} className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-700/30 text-slate-300 hover:bg-slate-700/50 hover:text-white border border-slate-600/20 transition-colors">
                  إعادة المحاولة
                </button>
              )}
            </div>
          ) : empty ? (
            <BuiltInEmptyState icon={emptyIcon} message={emptyMessage || 'لا توجد بيانات'} description={emptyDescription} action={emptyAction} />
          ) : (
            children
          )}
        </ScrollBody>
      )}

      {/* ═══ FOOTER ═══ */}
      {!isCollapsed && footer && (
        <div className="shrink-0 pt-2 pb-4 px-6 border-t border-slate-700/15 mt-auto">
          {footer}
        </div>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   DASHBOARD GRID
   ═══════════════════════════════════════════════════════════ */

export interface DashboardGridProps {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  gap?: string;
}

export const DashboardGrid = memo(function DashboardGrid({ children, columns = 2, gap = 'gap-6' }: DashboardGridProps) {
  const colClass = columns === 3
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    : columns === 1
      ? 'grid-cols-1'
      : 'grid-cols-1 md:grid-cols-2';
  return <div className={`grid ${colClass} ${gap}`}>{children}</div>;
});
