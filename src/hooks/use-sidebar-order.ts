// src/hooks/use-sidebar-order.ts
'use client';

// Sidebar pages in the USER'S preferred order, permission-first.
// reconcileSidebarOrder guarantees a saved order can never surface a
// page the user is no longer authorized to see, and new pages append
// in registry order until the user reorders again.

import { useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { reconcileSidebarOrder } from '@/lib/personalization';
import type { PageConfig } from '@/config/permissions';

export function useSidebarPages(): PageConfig[] {
  const { visiblePages } = usePermissions();
  const { data: preferences } = useUserPreferences();

  return useMemo(() => {
    const ids = reconcileSidebarOrder(
      visiblePages.map((p) => p.id),
      preferences?.sidebar?.order,
    );
    const byId = new Map(visiblePages.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is PageConfig => Boolean(p));
  }, [visiblePages, preferences]);
}
