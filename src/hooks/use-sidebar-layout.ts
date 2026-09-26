// src/hooks/use-sidebar-layout.ts
'use client';

// ══════════════════════════════════════════════════════════════
//  useSidebarLayout — the Personalizable Navigation Workspace hook
//
//  Resolves the EFFECTIVE layout for the CURRENT user, in the
//  canonical order of responsibility (§30):
//
//    Navigation registry (APP_PAGES — labels/icons/routes)
//      → Authorization (usePermissions.visiblePages — what EXISTS)
//        → User layout (sidebarLayout preference — order/grouping)
//
//  Read path (every render where inputs settle):
//    stored sidebarLayout  → normalizeSidebarLayout (validate + repair
//                            + permission reconciliation)
//    no/invalid stored     → migrateLegacySidebarLayout (the §21
//                            order/groupOrder/itemGroups era) — the
//                            migrated layout persists ONCE, server-
//                            confirmed, so the migration is durable
//    nothing at all        → createDefaultLayout (ONE main group,
//                            registry order)
//
//  The layout can NEVER grant or resurrect access: every path
//  reconciles against the permission-filtered visible set, so an
//  unauthorized item is invisible and unreachable through any layout
//  edit (fail closed, same doctrine as reconcileSidebarOrder).
// ══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useUserPreferences,
  useSaveUserPreferences,
  userPreferencesKeys,
} from '@/hooks/use-user-preferences';
import { APP_PAGES, SIDEBAR_GROUPS, localizedGroupLabel } from '@/config/permissions';
import { useLanguage } from '@/lib/i18n/language-context';
import {
  createDefaultLayout,
  migrateLegacySidebarLayout,
  normalizeSidebarLayout,
  setGroupCollapsed,
  type CanonicalSidebarGroup,
  type SidebarLayout,
} from '@/lib/personalization/sidebar-layout';

export type SidebarLayoutSource = 'stored' | 'migrated' | 'default';

export interface EffectiveSidebarLayout {
  layout: SidebarLayout;
  source: SidebarLayoutSource;
}

export function useSidebarLayout() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const qc = useQueryClient();
  const { data: preferences, isSuccess: prefsLoaded } = useUserPreferences();
  const { visiblePages } = usePermissions();
  const savePrefs = useSaveUserPreferences();

  // Registry (canonical) order — the order NEW items and DEFAULT
  // layouts use. Personalization never changes this set, only its
  // arrangement.
  const visibleIds = useMemo(() => visiblePages.map((p) => p.id), [visiblePages]);

  // Migration input: canonical group names localized in the CURRENT
  // locale at migration time (they freeze as user content afterwards),
  // plus the registry's pageId → canonical groupId map.
  const canonicalGroups = useMemo<CanonicalSidebarGroup[]>(
    () => SIDEBAR_GROUPS.map((g) => ({ id: g.id, name: localizedGroupLabel(g.id, locale) })),
    [locale],
  );
  const pageGroups = useMemo(
    () => new Map(APP_PAGES.map((p) => [p.id, p.groupId] as const)),
    [],
  );

  const effective = useMemo<EffectiveSidebarLayout | null>(() => {
    if (!user) return null;
    const stored = preferences?.sidebarLayout;
    if (stored) {
      const normalized = normalizeSidebarLayout(stored, visibleIds);
      if (normalized) return { layout: normalized.layout, source: 'stored' };
    }
    const migrated = migrateLegacySidebarLayout(preferences?.sidebar, visibleIds, canonicalGroups, pageGroups);
    if (migrated) return { layout: migrated, source: 'migrated' };
    return { layout: createDefaultLayout(visibleIds), source: 'default' };
  }, [user, preferences, visibleIds, canonicalGroups, pageGroups]);

  // §MIGRATION — persist the migrated layout ONCE, only after the
  // preferences record has actually loaded (a cold render with an
  // empty visible set must never write an empty layout). A failed
  // write re-arms the guard so the next settle retries.
  const migrationPersistedRef = useRef(false);
  const migratedLayoutRef = useRef<SidebarLayout | null>(null);
  useEffect(() => {
    if (migrationPersistedRef.current) return;
    if (!user || !prefsLoaded || !effective || effective.source !== 'migrated') return;
    migrationPersistedRef.current = true;
    migratedLayoutRef.current = effective.layout;
    savePrefs.mutate(
      { sidebarLayout: effective.layout },
      {
        onError: () => {
          migrationPersistedRef.current = false;
          migratedLayoutRef.current = null;
        },
      },
    );
  }, [user, prefsLoaded, effective, savePrefs]);

  /**
   * Persist a NEW layout (the confirmed edit draft). Optimistically
   * seeds the cache so the sidebar reflects the committed draft
   * instantly; the mutation's onSuccess then adopts the SERVER's
   * merged record as the authoritative cache state.
   */
  const saveLayout = (layout: SidebarLayout) => {
    qc.setQueryData(userPreferencesKeys.all, (prev: typeof preferences) =>
      prev ? { ...prev, sidebarLayout: layout } : prev,
    );
    return savePrefs.mutateAsync({ sidebarLayout: layout });
  };

  /**
   * §22 GROUP STATE — the ONE group open/close mutation (both sidebar
   * surfaces call this). The flag lives INSIDE the persisted layout:
   * one optimistic cache seed → the toggle is visible instantly; one
   * server write per committed click (never during drag); on failure
   * the query is invalidated so the server truth restores the flags.
   */
  const toggleGroupCollapsed = (groupId: string) => {
    if (!effective) return;
    const next = setGroupCollapsed(effective.layout, groupId, effective.layout.groups.find((g) => g.id === groupId)?.collapsed !== true);
    if (next === effective.layout) return;
    qc.setQueryData(userPreferencesKeys.all, (prev: typeof preferences) =>
      prev ? { ...prev, sidebarLayout: next } : prev,
    );
    savePrefs.mutate({ sidebarLayout: next }, {
      onError: () => {
        void qc.invalidateQueries({ queryKey: userPreferencesKeys.all });
      },
    });
  };

  return {
    /** The effective layout (null while the auth session is not ready). */
    layout: effective?.layout ?? null,
    /** Where the effective layout came from (telemetry/tests/diagnostics). */
    source: effective?.source ?? null,
    /** Registry-ordered, permission-filtered pages (the layout's universe). */
    visiblePages,
    visibleIds,
    saveLayout,
    toggleGroupCollapsed,
    saving: savePrefs.isPending,
  };
}
