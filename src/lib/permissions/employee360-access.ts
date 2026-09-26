// ══════════════════════════════════════════════════════════════
//  EMPLOYEE 360 — SECTION-LEVEL ACCESS (server enforcement)
//
//  Page access is not section access: a viewer with employee360
//  'read' may still be restricted from the HR or CAPA sections via
//  PagePermission.sections overrides. The API route MUST enforce
//  this — hiding sections in React is UX, never authorization, so a
//  denied section's data is withheld server-side (zeroed blocks,
//  filtered timeline) before serialization.
//
//  Resolution goes through the SINGLE section rule
//  (resolveSectionAccess in config/permissions): page 'none' hides
//  every section, an explicit override replaces inheritance, and a
//  section without an override inherits the page level — so legacy
//  maps (no sections configured) behave exactly as before.
// ══════════════════════════════════════════════════════════════

import {
  resolveSectionAccess,
  type PermissionsMap,
} from '@/config/permissions';

/** The data blocks the Employee 360 profile API can withhold. */
export interface Employee360SectionGate {
  basicInfo: boolean;
  /** Executive KPI evaluation + trend (canonical KPI engine). */
  performance: boolean;
  /** Deal performance (CREATED/CLOSED/TRAVEL dimensions). */
  deals: boolean;
  attendance: boolean;
  quality: boolean;
  observations: boolean;
  hrDeductions: boolean;
  requests: boolean;
  followUps: boolean;
  travel: boolean;
  complaints: boolean;
  capa: boolean;
  risk: boolean;
  /** HR decision-support projection (deterministic, HR-safe). */
  decisionSupport: boolean;
  /** Organization-tree context (chain, manager). */
  organization: boolean;
  /** The generic event journal (events of visible sections only). */
  timeline: boolean;
}

const SECTION_IDS = [
  'basicInfo', 'performance', 'deals', 'attendance', 'quality', 'observations',
  'hrDeductions', 'requests', 'followUps', 'travel', 'complaints', 'capa',
  'risk', 'decisionSupport', 'organization', 'timeline',
] as const;

/**
 * Resolve the section gate from an EFFECTIVE permission map. Pure —
 * no reads; runs on the map the route already loaded.
 */
export function resolveEmployee360SectionGate(
  permissions: PermissionsMap | null | undefined,
): Employee360SectionGate {
  const gate = {} as Employee360SectionGate;
  for (const id of SECTION_IDS) {
    gate[id] = resolveSectionAccess(permissions, 'employee360', id) !== 'none';
  }
  return gate;
}

/** Timeline event type → the section that owns it. */
const TIMELINE_SECTION_BY_TYPE: Readonly<Record<string, string>> = {
  attendance: 'attendance',
  quality: 'quality',
  hrDeduction: 'hrDeductions',
  request: 'requests',
  followUp: 'followUps',
  complaint: 'complaints',
  travel: 'travel',
  capa: 'capa',
};

/**
 * Keep only timeline events whose owning section is visible.
 * Unknown event types follow the 'timeline' section override
 * (registered in PAGE_SECTIONS) — the generic journal gate.
 */
export function filterTimelineByGate<T extends { type?: string }>(
  timeline: T[],
  gate: Employee360SectionGate,
  permissions: PermissionsMap | null | undefined,
): T[] {
  const timelineVisible = resolveSectionAccess(permissions, 'employee360', 'timeline') !== 'none';
  return timeline.filter((event) => {
    const owner = event.type ? TIMELINE_SECTION_BY_TYPE[event.type] : undefined;
    if (!owner) return timelineVisible;
    return gate[owner as keyof Employee360SectionGate];
  });
}

/** Registered section ids this gate enforces (stable contract). */
export const EMPLOYEE360_SECTION_IDS: ReadonlyArray<string> = SECTION_IDS;

/**
 * HR decision-support factor/scorecard category → the Employee 360
 * section that OWNS the underlying signals. A decision-support
 * viewer without that section must not receive the dimension's
 * factor lines or scorecard metrics (same no-leak rule as the
 * timeline). The overall status stays visible under the
 * decisionSupport section itself.
 */
export const HR_FACTOR_SECTION_BY_CATEGORY: Readonly<Record<string, keyof Employee360SectionGate>> = {
  KPI: 'performance',
  TREND: 'performance',
  FOLLOW_UP: 'followUps',
  PRODUCTIVITY: 'deals',
  QUALITY: 'quality',
  ATTENDANCE: 'attendance',
  HR_DISCIPLINARY: 'hrDeductions',
};
