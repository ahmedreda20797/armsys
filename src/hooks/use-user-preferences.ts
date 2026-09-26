// src/hooks/use-user-preferences.ts
'use client';

// Personal workspace preferences — per-USER React Query hooks.
// The API keys everything to the authenticated caller, so these
// hooks can only ever touch the CURRENT user's workspace (no
// cross-user leakage by construction).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import type { UserPreferences } from '@/lib/personalization';
export const userPreferencesKeys = {
  all: ['userPreferences'] as const,
};

export function useUserPreferences() {
  return useQuery({
    queryKey: userPreferencesKeys.all,
    queryFn: () => apiFetch<UserPreferences & { userId?: string; updatedAt?: string | null }>('/api/user-preferences'),
    staleTime: 30_000,
  });
}

// ══════════════════════════════════════════════════════════════
//  §UX-STRUCTURE 12A — a save is only "done" when the SERVER
//  returns the persisted record. The API PUT answers with the
//  merged record it wrote (`{ success, preferences }`), so the
//  mutation adopts THAT response as the cache state — local UI
//  state is never allowed to drift from what actually persisted —
//  then invalidates for an authoritative refetch. The success
//  path of any consumer may therefore treat the response as
//  proof of persistence (12A.9: never toast before this).
// ══════════════════════════════════════════════════════════════
type SavePreferencesResponse = { success: boolean; preferences?: UserPreferences };

export function useSaveUserPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: UserPreferences) =>
      apiFetch<SavePreferencesResponse>('/api/user-preferences', {
        method: 'PUT',
        body: JSON.stringify(preferences),
      }),
    onSuccess: (response) => {
      if (response?.preferences) {
        // Server-confirmed state — cache it directly (12A.7/8).
        qc.setQueryData(userPreferencesKeys.all, response.preferences);
      }
      // Refetch anyway so other fields (favorites, sidebar, ui) are
      // reconciled from the authoritative record.
      qc.invalidateQueries({ queryKey: userPreferencesKeys.all });
    },
  });
}

/** Personal Workspace Recovery — reset ALL personal UI preferences. */
export function useResetUserPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>('/api/user-preferences', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userPreferencesKeys.all });
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  Favorites ⭐ / Pins 📌 — Milestone 7 (§22/§23)
//
//  Built ON the existing user-preferences hooks (same query, same
//  identity, same persistence): a toggle is a read-modify-write of
//  the CURRENT user's record. The server re-validates the shape and
//  re-scopes to the authenticated caller — no cross-user path exists.
//  Permission-safety at read happens through reconcileNavigationEntries
//  (an entry whose route the user can no longer see never renders).
// ══════════════════════════════════════════════════════════════

import { createId } from '@paralleldrive/cuid2';
import {
  navigationEntriesEqual,
  toggleNavigationEntry,
  type FavoriteEntry,
  type NavigationDescriptor,
  type PinEntry,
} from '@/lib/personalization';

function nowIso(): string {
  return new Date().toISOString();
}

function readCurrentFavorites(qc: ReturnType<typeof useQueryClient>): FavoriteEntry[] {
  const current = qc.getQueryData<UserPreferences & { favorites?: FavoriteEntry[] }>(userPreferencesKeys.all);
  return Array.isArray(current?.favorites) ? current!.favorites! : [];
}

function readCurrentPins(qc: ReturnType<typeof useQueryClient>): PinEntry[] {
  const current = qc.getQueryData<UserPreferences & { pins?: PinEntry[] }>(userPreferencesKeys.all);
  return Array.isArray(current?.pins) ? current!.pins! : [];
}

/** Toggle a favorite (⭐) for the CURRENT user; returns the new array. */
export function useToggleFavoriteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (descriptor: NavigationDescriptor): Promise<boolean> => {
      const current = readCurrentFavorites(qc);
      const next = toggleNavigationEntry<FavoriteEntry>(
        current,
        descriptor,
        createId,
        nowIso(),
        navigationEntriesEqual,
      );
      await apiFetch<{ success: boolean }>('/api/user-preferences', {
        method: 'PUT',
        body: JSON.stringify({ favorites: next }),
      });
      // Added when the array GREW, removed when it shrank.
      return next.length > current.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userPreferencesKeys.all });
    },
  });
}

/** Toggle a pin (📌) for the CURRENT user; returns whether it was added. */
export function useTogglePinEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (descriptor: NavigationDescriptor): Promise<boolean> => {
      const current = readCurrentPins(qc);
      const next = toggleNavigationEntry<PinEntry>(
        current,
        descriptor,
        createId,
        nowIso(),
        navigationEntriesEqual,
      );
      await apiFetch<{ success: boolean }>('/api/user-preferences', {
        method: 'PUT',
        body: JSON.stringify({ pins: next }),
      });
      return next.length > current.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userPreferencesKeys.all });
    },
  });
}
