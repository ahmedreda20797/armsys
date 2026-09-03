// ══════════════════════════════════════════════════════════════
//  Tool: getCurrentPeriod (Phase 6.4, spec §12)
//
//  The current period + closure state — the anchor every period-bound
//  question needs. Reuses the EXISTING period helpers (monthKeyOf +
//  month snapshot closure) — no second period implementation (§2).
//  No employee data at all → no scope requirements.
// ══════════════════════════════════════════════════════════════

import { monthKeyOf } from '@/lib/kpi-reporting/period-basis';
import { isMonthClosed } from '@/lib/month-lock';
import type { AIToolDefinition } from '../types';

function validateArgs(args: unknown): { ok: true; value: Record<string, never> } | { ok: false; error: string } {
  // No arguments accepted — anything provided is invalid (strict).
  if (args === undefined || args === null) return { ok: true, value: {} };
  if (typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0) {
    return { ok: true, value: {} };
  }
  return { ok: false, error: 'هذه الأداة لا تقبل معاملات' };
}

export interface CurrentPeriodResult {
  monthKey: string;
  isClosed: boolean;
  generatedAt: string;
}

export const getCurrentPeriodTool: AIToolDefinition<Record<string, never>, CurrentPeriodResult> = {
  name: 'getCurrentPeriod',
  category: 'READ_ONLY',
  description: 'الفترة الشهرية الحالية وحالة إقفالها',
  requiredPermission: null, // any authenticated user may know the current period
  validateArgs,
  execute: async () => {
    const monthKey = monthKeyOf(new Date());
    return {
      monthKey,
      isClosed: await isMonthClosed(monthKey),
      generatedAt: new Date().toISOString(),
    };
  },
};
