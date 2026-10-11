// ══════════════════════════════════════════════════════════════
//  Navigation helper — the ONE navigation mechanism (store action)
//
//  Event handlers outside React hooks call the store's navigateTo
//  directly (same pattern as RiskCenterPage). No second navigation
//  mechanism is introduced — deep links, highlight and history all
//  flow through the canonical store + history bridge.
// ══════════════════════════════════════════════════════════════

import { useAppStore } from '@/lib/store';

export function navigateToStore(
  page: string,
  highlightId?: string,
  params?: Record<string, string>,
): void {
  useAppStore.getState().navigateTo(page, highlightId, params);
}
