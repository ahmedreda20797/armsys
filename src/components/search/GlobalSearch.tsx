'use client';

// ══════════════════════════════════════════════════════════════
//  Global Search UI (Phase 6.1 + §HEADER-SEARCH + §SEARCH-SINGLE-INPUT)
//
//  ONE search implementation, ONE surface, ONE input:
//    • Collapsed header state = a single magnifying-glass icon
//      (positioned naturally in the header flow — never pinned to
//      the screen edge).
//    • Click (or Ctrl+K) → the field expands ON the header line and
//      THE HEADER INPUT becomes the only search input; the results
//      panel below it contains results ONLY (no second search box —
//      the legacy duplicate panel input is gone).
//    • Keyboard behavior is preserved on the single input:
//      ↑/↓ move the selection, Home/End jump, Enter opens, Esc
//      closes — a plain listbox pattern (ARIA combobox +
//      aria-activedescendant), no DOM/state hacks.
//    • Radix Popover provides the anchor, outside-click collapse and
//      viewport collision — no manual positioning.
//    • Debounced server-side search (POST /api/search) — the client
//      NEVER touches the database and never receives raw records;
//    • grouped results per domain, honest action labels
//      («فتح السجل» exact vs «الانتقال إلى الصفحة» generic);
//    • exact-record navigation via buildSearchNavigation →
//      navigateTo (reuses the evidence highlight machinery);
//    • privacy-safe recent searches (localStorage only, never sent);
//    • distinct empty/error/loading states, no raw server errors.
// ══════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Award, Banknote, BookOpen, CalendarCog, ClipboardCheck, Clock, Eye, FileText,
  History, Loader2, MessageSquareWarning, Network, Plane, Search, Shield,
  ShieldCheck, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePermissions } from '@/hooks/usePermissions';
import { authFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import {
  MIN_QUERY_LENGTH,
  buildSearchNavigation,
  type SearchApiResponse,
  type SearchDomain,
  type SearchResult,
  type SearchResultGroup,
} from '@/lib/search';

// ── domain icons ────────────────────────────────────────────────

const DOMAIN_ICONS: Record<SearchDomain, LucideIcon> = {
  employees: Users,
  qualityObservations: Eye,
  qualityDeductions: Award,
  hrDeductions: Banknote,
  complaints: MessageSquareWarning,
  capaCases: ShieldCheck,
  followUps: ClipboardCheck,
  travelDeals: Plane,
  attendance: Clock,
  requests: FileText,
  knowledgeBase: BookOpen,
  monthSnapshots: CalendarCog,
  orgNodes: Network,
  users: Shield,
};

// ── recent searches (privacy-safe: localStorage only) ───────────

const RECENT_KEY = 'arm_global_search_recent';
const MAX_RECENT = 5;
const SEARCH_DEBOUNCE_MS = 250;
const DOMAIN_VIEW_ALL_LIMIT = 50;

function loadRecentQueries(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentQuery(query: string): void {
  try {
    if (!query) return;
    const next = [query, ...loadRecentQueries().filter((q) => q !== query)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — recents are optional
  }
}

function clearRecentQueries(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}

/** Local (NOT server) results for the exact honest action label. */
function honestActionKey(result: SearchResult): 'search.openRecord' | 'search.goToPage' {
  return buildSearchNavigation(result).exact ? 'search.openRecord' : 'search.goToPage';
}

// ── flat result rows (single-input keyboard model) ──────────────
// The results panel renders grouped rows; the keyboard layer walks
// ONE flat selectable list in exact DOM order. Headings/state blocks
// are non-selectable and simply skipped.

type SearchRow =
  | { kind: 'heading'; label: string }
  | { kind: 'recent'; value: string }
  | { kind: 'clear-recents' }
  | { kind: 'result'; result: SearchResult }
  | { kind: 'view-all'; domain: SearchDomain; total: number };

interface FlatRow {
  row: SearchRow;
  /** Index within the SELECTABLE rows (the keyboard position). */
  index: number;
}

// ══════════════════════════════════════════════════════════════
//  GlobalSearch — §HEADER-SEARCH + §SEARCH-SINGLE-INPUT
//
//  COLLAPSED: one magnifying-glass icon in the header flow.
//  OPEN: the field expands on the header line; the input inside it
//  is THE single search input (autofocused). The results panel
//  anchors below the field (Radix Popover; collision detection keeps
//  it inside the viewport); outside click / ESC collapse it.
//  Ctrl+K toggles.
// ══════════════════════════════════════════════════════════════

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [domainFilter, setDomainFilter] = useState<SearchDomain | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Selectable row elements by keyboard index — for scroll-into-view. */
  const rowElsRef = useRef(new Map<number, HTMLElement>());
  const listId = useId();

  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();
  const { t } = useLanguage();

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    setActiveIndex(-1);
    if (next) {
      // The panel mounts fresh on every open — recents load once here.
      setRecents(loadRecentQueries());
    } else {
      setQuery('');
      abortRef.current?.abort();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      // The workflow designer owns its own local Ctrl+K surface.
      if (useAppStore.getState().currentPage === 'workflowDesigner') return;
      event.preventDefault();
      setOpen((previous) => !previous);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus the header input as the panel starts opening (Radix would
  // hand focus to its content by default — prevent that; the input is
  // the only focusable entry point).
  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    inputRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // ── server search (debounced, abortable) — unchanged contract ──
  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    const timer = setTimeout(async () => {
      if (normalized.length < MIN_QUERY_LENGTH) {
        setGroups([]);
        setError(null);
        setLoading(false);
        setHasSearched(false);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await authFetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: normalized,
            ...(domainFilter ? { domain: domainFilter, limit: DOMAIN_VIEW_ALL_LIMIT } : {}),
          }),
          signal: controller.signal,
        });
        if (abortRef.current !== controller) return;
        if (!res.ok) {
          // No raw server errors reach the user (spec §29).
          setError(t('search.error'));
          setGroups([]);
          setHasSearched(true);
          setActiveIndex(-1);
          return;
        }
        const data = (await res.json()) as SearchApiResponse;
        if (abortRef.current !== controller) return;
        setGroups(Array.isArray(data.groups) ? data.groups : []);
        setError(null);
        setHasSearched(true);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (abortRef.current !== controller) return;
        setError(t('search.errorOffline'));
        setGroups([]);
        setHasSearched(true);
        setActiveIndex(-1);
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [open, query, domainFilter]);

  // ── flat row model in exact DOM order ─────────────────────────
  const { rows, selectable } = useMemo<{
    rows: FlatRow[];
    selectable: FlatRow[];
  }>(() => {
    const all: FlatRow[] = [];
    const sel: FlatRow[] = [];
    const push = (row: SearchRow) => {
      const entry: FlatRow = { row, index: selectable.length };
      if (row.kind !== 'heading') {
        entry.index = sel.length;
        sel.push(entry);
      }
      all.push(entry);
    };

    const showIdleState =
      !loading && !error && !domainFilter && query.trim().length < MIN_QUERY_LENGTH;

    if (showIdleState && recents.length > 0) {
      push({ kind: 'heading', label: '__recents__' });
      recents.forEach((recent) => push({ kind: 'recent', value: recent }));
      push({ kind: 'clear-recents' });
    } else if (!loading && !error && groups.length > 0) {
      groups.forEach((group) => {
        push({ kind: 'heading', label: `${group.label} · ${group.results.length}` });
        group.results.forEach((result) => push({ kind: 'result', result }));
        if (group.truncated) {
          push({ kind: 'view-all', domain: group.domain, total: group.total });
        }
      });
    }
    return { rows: all, selectable: sel };
  }, [loading, error, domainFilter, query, recents, groups]);

  // Results/rows changed → the keyboard selection resets at each state
  // change that rebuilds the row list (query typing, domain switch,
  // fetch completion, open/close) — no effect needed.

  const activateRow = useCallback(
    (entry: FlatRow) => {
      const row = entry.row;
      switch (row.kind) {
        case 'recent':
          setQuery(row.value);
          setActiveIndex(-1);
          inputRef.current?.focus();
          break;
        case 'clear-recents':
          clearRecentQueries();
          setRecents([]);
          break;
        case 'view-all':
          setDomainFilter(row.domain);
          setActiveIndex(-1);
          break;
        case 'result': {
          const intent = buildSearchNavigation(row.result);
          // Defensive client gate — the server remains the source of truth.
          if (!canViewPage(intent.page)) return;
          saveRecentQuery(query.trim());
          handleClose();
          navigateTo(intent.page, intent.highlightId ?? undefined, intent.navParams);
          break;
        }
        default:
          break;
      }
    },
    [canViewPage, handleClose, navigateTo, query],
  );

  // ── keyboard on THE single input (↑↓ Home End Enter Esc) ──────
  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const count = selectable.length;
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (count === 0) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const current = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
        const next = Math.min(count - 1, Math.max(0, current + delta));
        setActiveIndex(next);
        rowElsRef.current.get(next)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
        rowElsRef.current.get(0)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(count - 1);
        rowElsRef.current.get(count - 1)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const entry = selectable[activeIndex];
        if (entry) activateRow(entry);
      }
    },
    [activeIndex, activateRow, handleClose, selectable],
  );

  const setRowRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) rowElsRef.current.set(index, el);
    else rowElsRef.current.delete(index);
  }, []);

  const normalizedLength = query.trim().length;
  const showIdleState =
    !loading && !error && !domainFilter && normalizedLength < MIN_QUERY_LENGTH;
  const showNoResults =
    !loading && !error && hasSearched && normalizedLength >= MIN_QUERY_LENGTH && groups.length === 0;

  // Shared row base — mirrors the previous command-item look exactly
  // (selected = accent surface, same paddings/radius/typography).
  const rowBaseClass =
    'relative flex cursor-default select-none items-center rounded-sm px-2 text-sm outline-none data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* §SEARCH-SINGLE-INPUT — the field expands ON THE HEADER LINE and
          hosts the ONLY search input; the results panel anchors to the
          expanded field and contains results only. */}
      <PopoverAnchor asChild>
        <div
          className={cn(
            'flex items-center h-9 rounded-lg border transition-all duration-200 ease-out',
            open
              ? 'border-slate-600/60 bg-slate-800/70 pl-1 pr-2 w-[min(58vw,320px)]'
              : 'border-transparent bg-transparent w-9',
          )}
        >
          <button
            type="button"
            onClick={() => handleOpenChange(!open)}
            aria-label={t('search.label')}
            aria-keyshortcuts="Control+K"
            aria-expanded={open}
            aria-haspopup="dialog"
            title={t('search.label')}
            className="group flex items-center justify-center size-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 shrink-0"
          >
            <Search className="h-[18px] w-[18px] shrink-0" />
          </button>
          {open && (
            <input
              ref={inputRef}
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                activeIndex >= 0 ? `${listId}-row-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-label={t('search.label')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={t('search.expandedPlaceholder')}
              className="flex-1 min-w-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
            />
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent
        /* The results panel anchors to the expanded field and shares its
           right edge (align="start" = the field's start side in RTL);
           the zoom origin is the field's icon corner. Results ONLY —
           no second search input (§SEARCH-SINGLE-INPUT). */
        align="start"
        sideOffset={8}
        onOpenAutoFocus={handleOpenAutoFocus}
       
        className="w-[min(92vw,400px)] p-0 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/97 backdrop-blur-xl shadow-2xl shadow-black/50
          data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
          data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150"
        style={{ transformOrigin: 'top right' }}
      >
        <div
          id={listId}
          role="listbox"
          aria-label="نتائج البحث"
          className="max-h-[360px] min-h-[120px] px-1 py-1 overflow-x-hidden overflow-y-auto arm-scroll"
        >
          {domainFilter && (
            <button
              type="button"
              onClick={() => {
                setDomainFilter(null);
                setActiveIndex(-1);
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-emerald-400 hover:bg-slate-800/60"
            >
              <X className="h-3.5 w-3.5 rotate-45" />
              {t('search.showAllDomains')}
            </button>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('search.searching')}
            </div>
          )}

          {!loading && error && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">{error}</div>
          )}

          {showIdleState && recents.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {t('search.idle')}
            </div>
          )}

          {showNoResults && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {t('search.noResults')}
            </div>
          )}

          {rows.map(({ row, index }) => {
            switch (row.kind) {
              case 'heading':
                return (
                  <div
                    key={`heading:${row.label}`}
                    className="px-2 py-1.5 text-xs font-medium text-slate-400"
                  >
    {t('search.recents')}
                  </div>
                );
              case 'recent':
                return (
                  <div
                    key={`recent:${row.value}`}
                    id={`${listId}-row-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    ref={(el) => setRowRef(index, el)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateRow({ row, index })}
                    className={cn(rowBaseClass, 'gap-2 py-1.5')}
                  >
                    <History className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate">{row.value}</span>
                  </div>
                );
              case 'clear-recents':
                return (
                  <div
                    key="clear-recents"
                    id={`${listId}-row-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    ref={(el) => setRowRef(index, el)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateRow({ row, index })}
                    className={cn(rowBaseClass, 'justify-center gap-1.5 py-1.5 text-xs text-slate-500')}
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('search.clearRecents')}
                  </div>
                );
              case 'view-all':
                return (
                  <div
                    key={`view-all:${row.domain}`}
                    id={`${listId}-row-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    ref={(el) => setRowRef(index, el)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateRow({ row, index })}
                    className={cn(rowBaseClass, 'justify-center py-1.5 text-xs font-medium text-emerald-400')}
                  >
                    {t('search.viewAll')} ({row.total})
                  </div>
                );
              case 'result': {
                const result = row.result;
                const Icon = DOMAIN_ICONS[result.domain] ?? FileText;
                const metaLine = [
                  result.subtitle,
                  ...(result.metadata ?? []),
                  result.date,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(' · ');
                return (
                  <div
                    key={`${result.domain}:${result.recordId}`}
                    id={`${listId}-row-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    ref={(el) => setRowRef(index, el)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateRow({ row, index })}
                    className={cn(rowBaseClass, 'gap-2.5 py-2.5')}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {result.title}
                        </span>
                        {result.status && (
                          <span className="shrink-0 rounded-full border border-slate-700/60 bg-slate-800/80 px-1.5 py-px text-[10px] text-slate-300">
                            {result.status}
                          </span>
                        )}
                      </div>
                      {metaLine && (
                        <div className="truncate text-xs text-slate-400">{metaLine}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {t(honestActionKey(result))}
                    </span>
                  </div>
                );
              }
              default:
                return null;
            }
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800/80 px-3 py-2 text-[10px] text-slate-500">
          <span>{t('search.hintsBar')}</span>
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-slate-700/60 bg-slate-800/80 px-1.5 py-0.5 font-mono hover:text-slate-300 transition-colors"
          >
            {t('search.close')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
