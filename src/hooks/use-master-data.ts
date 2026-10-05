'use client';

// ══════════════════════════════════════════════════════════════
//  Master Data simple lists — client query hooks.
//
//  ONE cache family (['masterData', domain]) for the vocabulary
//  domains the Settings Center manages. Same conventions as the
//  reference useKpiQueries hooks: one canonical key per list, a
//  separate usage-cache entry, every mutation invalidates both.
// ══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { isListItemActive, listItemDisplayName, sortListItems } from '@/lib/master-data/simple-list-presentation';
import { useLanguage } from '@/lib/i18n/language-context';
import type { MasterDataSimpleDomain, MasterDataListItem } from '@/types/master-data';

export const masterDataQueryKeys = {
  list: (domain: MasterDataSimpleDomain) => ['masterData', domain] as const,
  usage: (domain: MasterDataSimpleDomain) => ['masterData', domain, 'usage'] as const,
};

/** The full vocabulary (active + inactive) in canonical order. */
export function useMasterDataList(domain: MasterDataSimpleDomain) {
  return useQuery({
    queryKey: masterDataQueryKeys.list(domain),
    queryFn: () => apiFetch<MasterDataListItem[]>(`/api/master-data/${domain}`),
    staleTime: 60_000,
  });
}

/** Management-UI variant — attaches usageCount (separate cache entry). */
export function useMasterDataListWithUsage(domain: MasterDataSimpleDomain) {
  return useQuery({
    queryKey: masterDataQueryKeys.usage(domain),
    queryFn: () => apiFetch<(MasterDataListItem & { usageCount?: number })[]>(`/api/master-data/${domain}?withUsage=1`),
    staleTime: 60_000,
  });
}

function useInvalidateMasterData(domain: MasterDataSimpleDomain) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: masterDataQueryKeys.list(domain) });
    void qc.invalidateQueries({ queryKey: masterDataQueryKeys.usage(domain) });
  };
}

export function useCreateMasterDataRecord(domain: MasterDataSimpleDomain) {
  const invalidate = useInvalidateMasterData(domain);
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch(`/api/master-data/${domain}`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });
}

export function useUpdateMasterDataRecord(domain: MasterDataSimpleDomain) {
  const invalidate = useInvalidateMasterData(domain);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/master-data/${domain}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });
}

export function useDeleteMasterDataRecord(domain: MasterDataSimpleDomain) {
  const invalidate = useInvalidateMasterData(domain);
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/master-data/${domain}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useReorderMasterDataRecords(domain: MasterDataSimpleDomain) {
  const invalidate = useInvalidateMasterData(domain);
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiFetch(`/api/master-data/${domain}`, { method: 'PUT', body: JSON.stringify({ reorder: orderedIds }) }),
    onSuccess: invalidate,
  });
}

// ══════════════════════════════════════════════════════════════
//  §MASTER-DATA-VOCABULARY — the consumer-facing selector.
//
//  ONE hook for every form/filter/badge that renders a simple-list
//  vocabulary. DB-driven when the list is loaded; the caller's
//  canonical static map is the FALLBACK (offline / first paint /
//  permission-less view) so a consumer can never render an empty
//  selector — identical behavior to the pre-master-data hardcoded
//  lists until (and only until) the DB list resolves.
// ══════════════════════════════════════════════════════════════

export interface MasterDataVocabularyOption {
  key: string;
  label: string;
}

export function useMasterDataVocabulary(
  domain: MasterDataSimpleDomain,
  /** The domain's historical static labels (Arabic) — the fallback source. */
  fallbackLabels: Record<string, string>,
) {
  const { locale } = useLanguage();
  const { data } = useMasterDataList(domain);
  const records = Array.isArray(data) ? (data as MasterDataListItem[]) : undefined;

  return useMemo(() => {
    const dbAvailable = records !== undefined && records.length > 0;

    // SELECTOR options (NEW records): active only, canonical order.
    const dbOptions = records
      ? sortListItems(records.filter(isListItemActive))
          .map((r) => ({ key: r.key, label: listItemDisplayName(r, locale) }))
      : undefined;
    const fallbackOptions = Object.entries(fallbackLabels)
      .map(([key, name]) => ({ key, label: name }));
    const options = dbOptions && dbOptions.length > 0 ? dbOptions : fallbackOptions;

    // FILTER options: every stored value stays reachable — active AND
    // inactive records (a deactivated type must remain filterable so
    // historical records stay navigable), plus any static key the DB
    // does not know (pre-master-data values).
    const dbFilterOptions = records
      ? sortListItems(records).map((r) => ({ key: r.key, label: listItemDisplayName(r, locale) }))
      : undefined;
    const knownKeys = new Set((dbFilterOptions ?? []).map((o) => o.key));
    const extraFallback = fallbackOptions.filter((o) => !knownKeys.has(o.key));
    const allOptions = dbFilterOptions
      ? [...dbFilterOptions, ...extraFallback]
      : fallbackOptions;

    // Label for a STORED value: DB record → static map → verbatim
    // (legacy free-text values keep rendering exactly what they carry).
    const label = (value: string | null | undefined): string => {
      if (!value) return '';
      const record = records?.find((r) => r.key === value);
      if (record) return listItemDisplayName(record, locale);
      return fallbackLabels[value] ?? value;
    };

    /** True when the key is a KNOWN record that is currently inactive. */
    const isInactiveKey = (value: string | null | undefined): boolean => {
      if (!value) return false;
      const record = records?.find((r) => r.key === value);
      return record !== undefined && !isListItemActive(record);
    };

    return { options, allOptions, label, isInactiveKey, dbAvailable };
  }, [records, locale, fallbackLabels]);
}
