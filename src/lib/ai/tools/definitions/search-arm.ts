// ══════════════════════════════════════════════════════════════
//  Tool: searchARM (Phase 6.4, spec §12/§34)
//
//  Reuses the EXISTING global search service (runGlobalSearch) with
//  the caller's own permissions + resolved scope — the AI can never
//  search wider than the user could (§11). NO second search engine
//  is created (§34). Results come back as the standard search
//  groups (already minimal + permission-filtered).
// ══════════════════════════════════════════════════════════════

import { runGlobalSearch, defaultSearchDeps } from '@/lib/search/search-service';
import type { SearchApiResponse } from '@/lib/search/types';
import type { AIToolCaller, AIToolDefinition } from '../types';

interface SearchArmArgs {
  query: string;
  domain?: string;
  limit?: number;
}

function validateArgs(args: unknown): { ok: true; value: SearchArmArgs } | { ok: false; error: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'معاملات البحث غير صالحة' };
  }
  const { query, domain, limit } = args as Record<string, unknown>;
  if (typeof query !== 'string' || query.trim().length < 2) {
    return { ok: false, error: 'نص البحث مطلوب (حرفان على الأقل)' };
  }
  if (query.length > 200) return { ok: false, error: 'نص البحث طويل جدًا' };
  if (domain !== undefined && typeof domain !== 'string') {
    return { ok: false, error: 'النطاق غير صالح' };
  }
  let safeLimit: number | undefined;
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
      return { ok: false, error: 'الحد غير صالح' };
    }
    safeLimit = Math.min(Math.floor(limit), 10); // server-capped, minimal data (§9)
  }
  return { ok: true, value: { query: query.trim(), domain, limit: safeLimit } };
}

export const searchARMTool: AIToolDefinition<SearchArmArgs, SearchApiResponse> = {
  name: 'searchARM',
  category: 'READ_ONLY',
  description: 'بحث في بيانات ARM ضمن صلاحيات المستخدم الحالي (يعيد استخدام البحث الموحد)',
  requiredPermission: null, // domain permissions enforced INSIDE runGlobalSearch per domain
  validateArgs,
  execute: async (args, caller: AIToolCaller) => {
    // The search service enforces per-domain permissions and resolves
    // employee scope itself; we hand it the ALREADY-resolved scope to
    // avoid a second resolution and keep one scope per request (§11).
    const deps = {
      ...defaultSearchDeps({
        userId: caller.userId,
        role: caller.role,
        permissions: caller.permissions,
        linkedEmployeeId: caller.linkedEmployeeId ?? null,
      }),
      resolveScope: async () => caller.scope,
    };
    return runGlobalSearch(
      {
        userId: caller.userId,
        role: caller.role,
        permissions: caller.permissions,
        linkedEmployeeId: caller.linkedEmployeeId ?? null,
      },
      {
        query: args.query,
        domain: args.domain as Parameters<typeof runGlobalSearch>[1]['domain'],
        limit: args.limit,
      },
      deps,
    );
  },
};
