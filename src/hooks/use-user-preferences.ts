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

export function useSaveUserPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: UserPreferences) =>
      apiFetch<{ success: boolean }>('/api/user-preferences', {
        method: 'PUT',
        body: JSON.stringify(preferences),
      }),
    onSuccess: () => {
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
