// ══════════════════════════════════════════════════════════════
//  Management Reporting — DB-bound service (Milestone 7, Phase A)
//
//  Default loader set over the existing cached db readers. Scope
//  filtering is NOT done here — the API route resolves the viewer's
//  employee scope through the canonical scope engine and passes
//  ALREADY-SCOPED rows into the pure builder (same doctrine as the
//  kpi-reports routes, M0.5).
//
//  READS: one cached read per table per request (lib/db TTL cache)
//  — no N+1, no full-database scans beyond the existing list routes'
//  own pattern.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { ORG_NODES_TABLE } from '@/lib/organization';
import { buildKpiManagementSummary } from '@/lib/kpi-reporting';
import type { ManagementReportLoaders } from './types';

type Row = Record<string, unknown>;

export const defaultManagementReportLoaders: ManagementReportLoaders = {
  loadEmployees: async () => {
    const all = await getAll<Row>('employees', TTL.MEDIUM);
    return all
      .filter((e) => e && typeof e.id === 'string')
      .map((e) => ({
        id: String(e.id),
        name: typeof e.name === 'string' ? e.name : '',
        department: typeof e.department === 'string' ? e.department : null,
        orgNodeId: typeof e.orgNodeId === 'string' ? e.orgNodeId : null,
      }));
  },

  loadComplaints: () => getAll<Row>('complaints', TTL.MEDIUM),
  loadCapaCases: () => getAll<Row>('capaCases', TTL.MEDIUM),
  loadFollowUps: () => getAll<Row>('followUps', TTL.MEDIUM),
  loadHrDeductions: () => getAll<Row>('hrDeductions', TTL.MEDIUM),

  loadOrgNodes: async () => {
    const all = await getAll<Row>(ORG_NODES_TABLE, TTL.MEDIUM);
    return all
      .filter((n) => n && typeof n.id === 'string')
      .map((n) => ({
        id: String(n.id),
        name: typeof n.name === 'string' ? n.name : '',
        type: typeof n.type === 'string' ? n.type : '',
      }));
  },

  // THE authoritative source — the existing engine summary, verbatim,
  // built with the CALLER'S scope (route resolves it and passes it in).
  loadQualitySummary: (monthKey, scopeLimit) =>
    buildKpiManagementSummary({ monthKey, filters: { scopeLimit } }),
};
