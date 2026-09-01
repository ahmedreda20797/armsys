'use client';

// ══════════════════════════════════════════════════════════════
//  Global Search UI (Phase 6.1, spec §4/§5/§27/§28/§29)
//
//  Header trigger (visible field on desktop, icon on mobile) +
//  command-palette interface:
//    • debounced server-side search (POST /api/search) — the client
//      NEVER touches the database and never receives raw records;
//    • grouped results per domain, honest action labels
//      («فتح السجل» exact vs «الانتقال إلى الصفحة» generic);
//    • exact-record navigation via buildSearchNavigation →
//      navigateTo (reuses the evidence highlight machinery);
//    • privacy-safe recent searches (localStorage only, never sent);
//    • distinct empty/error/loading states, no raw server errors.
// ══════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award, Banknote, BookOpen, CalendarCog, ClipboardCheck, Clock, Eye, FileText,
  History, Loader2, MessageSquareWarning, Network, Plane, Search, Shield,
  ShieldCheck, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useAppStore } from '@/lib/store';
import { usePermissions } from '@/hooks/usePermissions';
import { authFetch } from '@/lib/api-fetch';
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
function honestActionLabel(result: SearchResult): string {
  return buildSearchNavigation(result).exact ? 'فتح السجل' : 'الانتقال إلى الصفحة';
}

// ══════════════════════════════════════════════════════════════
//  Palette
// ══════════════════════════════════════════════════════════════

interface GlobalSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearchPalette({ open, onOpenChange }: GlobalSearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [domainFilter, setDomainFilter] = useState<SearchDomain | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();
  const abortRef = useRef<AbortController | null>(null);

  // Reset transient state on every open — done in the change handler
  // (not an effect) so no setState fires synchronously inside an effect.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setQuery('');
        setGroups([]);
        setError(null);
        setLoading(false);
        setDomainFilter(null);
        setHasSearched(false);
        setRecents(loadRecentQueries());
      } else {
        abortRef.current?.abort();
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Debounced server search — ALL state updates happen inside the
  // timer callback (deferred), never synchronously in the effect body.
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
          setError('تعذر إتمام البحث. حاول مرة أخرى.');
          setGroups([]);
          setHasSearched(true);
          return;
        }
        const data = (await res.json()) as SearchApiResponse;
        if (abortRef.current !== controller) return;
        setGroups(Array.isArray(data.groups) ? data.groups : []);
        setError(null);
        setHasSearched(true);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (abortRef.current !== controller) return;
        setError('تعذر إتمام البحث. تحقق من الاتصال وحاول مرة أخرى.');
        setGroups([]);
        setHasSearched(true);
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, domainFilter, open]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const intent = buildSearchNavigation(result);
      // Defensive client gate — the server remains the source of truth.
      if (!canViewPage(intent.page)) return;
      saveRecentQuery(query.trim());
      setRecents(loadRecentQueries());
      handleOpenChange(false);
      navigateTo(intent.page, intent.highlightId ?? undefined, intent.navParams);
    },
    [canViewPage, navigateTo, handleOpenChange, query],
  );

  const handleClearRecents = useCallback(() => {
    clearRecentQueries();
    setRecents([]);
  }, []);

  const normalizedLength = query.trim().length;
  const showIdleState = !loading && !error && !domainFilter && normalizedLength < MIN_QUERY_LENGTH;
  const showNoResults = !loading && !error && hasSearched && normalizedLength >= MIN_QUERY_LENGTH && groups.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>البحث في ARM</DialogTitle>
          <DialogDescription>ابحث في سجلات النظام كافة ضمن صلاحياتك</DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="ابحث في ARM... موظف، عميل، رقم، ملاحظة، صفقة"
            className="h-12 text-base"
          />

          <CommandList className="max-h-[380px] min-h-[140px] px-1 py-1">
            {domainFilter && (
              <button
                type="button"
                onClick={() => setDomainFilter(null)}
                className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-emerald-400 hover:bg-slate-800/60"
              >
                <X className="h-3.5 w-3.5 rotate-45" />
                عرض النتائج في كل الأقسام
              </button>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ البحث...
              </div>
            )}

            {!loading && error && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">{error}</div>
            )}

            {showIdleState && (
              recents.length > 0 ? (
                <CommandGroup heading="أحدث عمليات البحث">
                  {recents.map((recent) => (
                    <CommandItem
                      key={recent}
                      value={recent}
                      onSelect={() => setQuery(recent)}
                      className="gap-2"
                    >
                      <History className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="truncate">{recent}</span>
                    </CommandItem>
                  ))}
                  <CommandItem onSelect={handleClearRecents} className="justify-center text-xs text-slate-500">
                    <X className="h-3.5 w-3.5" />
                    مسح سجل البحث
                  </CommandItem>
                </CommandGroup>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  اكتب {MIN_QUERY_LENGTH} أحرف على الأقل للبحث في النظام بالكامل
                </div>
              )
            )}

            {showNoResults && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                لا توجد نتائج مطابقة ضمن صلاحياتك
              </div>
            )}

            {!loading &&
              !error &&
              groups.map((group) => (
                <CommandGroup
                  key={group.domain}
                  heading={`${group.label} · ${group.results.length}`}
                >
                  {group.results.map((result) => {
                    const Icon = DOMAIN_ICONS[result.domain] ?? FileText;
                    const metaLine = [
                      result.subtitle,
                      ...(result.metadata ?? []),
                      result.date,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ');
                    return (
                      <CommandItem
                        key={`${group.domain}:${result.recordId}`}
                        value={`${group.domain}:${result.recordId}`}
                        onSelect={() => handleSelect(result)}
                        className="gap-2.5 py-2.5"
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
                          {honestActionLabel(result)}
                        </span>
                      </CommandItem>
                    );
                  })}
                  {group.truncated && (
                    <CommandItem
                      value={`${group.domain}:view-all`}
                      onSelect={() => setDomainFilter(group.domain)}
                      className="justify-center text-xs font-medium text-emerald-400"
                    >
                      عرض كل النتائج ({group.total})
                    </CommandItem>
                  )}
                </CommandGroup>
              ))}
          </CommandList>

          <div className="flex items-center justify-between border-t border-slate-800/80 px-3 py-2 text-[10px] text-slate-500">
            <span>↑↓ للتنقل · Enter للفتح · Esc للإغلاق</span>
            <kbd dir="ltr" className="rounded border border-slate-700/60 bg-slate-800/80 px-1.5 py-0.5 font-mono">
              Ctrl K
            </kbd>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
//  Header trigger + global shortcut
// ══════════════════════════════════════════════════════════════

export function GlobalSearch() {
  const [open, setOpen] = useState(false);

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

  return (
    <>
      {/* Desktop — visible search field (spec §27) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="البحث في ARM"
        aria-keyshortcuts="Control+K"
        className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 text-sm text-slate-400 transition-colors hover:border-slate-500/70 hover:text-slate-200 lg:w-72 md:flex"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-start">ابحث في ARM...</span>
        <kbd
          dir="ltr"
          className="pointer-events-none shrink-0 rounded border border-slate-700/60 bg-slate-900/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
        >
          Ctrl K
        </kbd>
      </button>

      {/* Mobile — compact icon (spec §4) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="البحث في ARM"
        className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      <GlobalSearchPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
