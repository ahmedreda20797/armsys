// ══════════════════════════════════════════════════════════════
//  Evidence Preview — request parsing & scope doctrine (Phase 5.2)
//
//  Pure, server-safe helpers extracted from the route so they are
//  unit-testable without HTTP. The route file itself stays a thin
//  shell (Next.js route files may only export HTTP methods).
// ══════════════════════════════════════════════════════════════

import {
  isEvidenceCollection,
  type EvidenceCollection,
} from './evidence-collections';

export const MAX_IDS_PER_REQUEST = 50;
const MAX_ID_LENGTH = 128;

export interface EvidencePreviewRequest {
  collection: EvidenceCollection;
  recordIds: string[];
}

export function parseEvidencePreviewBody(
  body: unknown,
): { ok: true; value: EvidencePreviewRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'جسم الطلب مطلوب' };
  }
  const { collection, recordIds } = body as Record<string, unknown>;
  if (!isEvidenceCollection(collection)) {
    return { ok: false, error: 'مجموعة الأدلة غير معروفة' };
  }
  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return { ok: false, error: 'recordIds مطلوب' };
  }
  if (recordIds.length > MAX_IDS_PER_REQUEST) {
    return { ok: false, error: `الحد الأقصى ${MAX_IDS_PER_REQUEST} معرفاً لكل طلب` };
  }
  for (const id of recordIds) {
    if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_ID_LENGTH) {
      return { ok: false, error: 'معرفات السجلات غير صالحة' };
    }
  }
  return { ok: true, value: { collection, recordIds: recordIds.map((id) => id.trim()) } };
}

/** Scope doctrine per collection — mirrors each source's own detail route. */
export function scopeOptionsFor(collection: EvidenceCollection): {
  optionalLink: boolean;
  relatedEmployeeIdsField?: string;
} {
  switch (collection) {
    case 'complaints':
      return { optionalLink: true };
    case 'capaCases':
      return { optionalLink: true, relatedEmployeeIdsField: 'relatedEmployeeIds' };
    // Organizational / config records: gated by the source page
    // permission alone (no employee link to scope).
    case 'monthSnapshots':
    case 'kpiSchemes':
      return { optionalLink: true };
    default:
      return { optionalLink: false };
  }
}
