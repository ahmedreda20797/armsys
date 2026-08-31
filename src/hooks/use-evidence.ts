'use client';

// ══════════════════════════════════════════════════════════════
//  Evidence Preview — client data hooks (Phase 5.2, spec §38)
//
//  ON-DEMAND loading only: nothing is fetched while the report
//  renders. The batched summaries query is enabled when a group is
//  EXPANDED (one POST per expansion — never one request per record,
//  §38 "avoid N+1"), and the preview modal reuses the same endpoint
//  for a single record.
// ══════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import type { EvidenceCollection } from '@/lib/evidence/evidence-collections';
import type { ProjectedRecord } from '@/lib/evidence/record-projection';
import type { EvidenceAccess } from '@/lib/evidence/evidence-summaries';

export interface EvidencePreviewResponse {
  collection: string;
  message?: string;
  records: Array<{
    recordId: string;
    access: EvidenceAccess;
    record?: ProjectedRecord;
  }>;
}

export async function fetchEvidencePreview(
  collection: EvidenceCollection,
  recordIds: string[],
): Promise<EvidencePreviewResponse> {
  return apiFetch<EvidencePreviewResponse>('/api/evidence/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, recordIds }),
  });
}

/**
 * Batched evidence summaries for ONE evidence group. Enabled only
 * while the group is expanded (on-demand, spec §38) — `recordIds`
 * come verbatim from the Performance Intelligence evidence graph.
 */
export function useEvidenceSummaries(
  collection: EvidenceCollection,
  recordIds: string[],
  enabled: boolean,
) {
  const ids = recordIds.join('\n');
  return useQuery({
    queryKey: ['evidence-preview', collection, ids],
    queryFn: () => fetchEvidencePreview(collection, ids.split('\n')),
    enabled: enabled && recordIds.length > 0,
    staleTime: 60_000,
    retry: 1,
  });
}
