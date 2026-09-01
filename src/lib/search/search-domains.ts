// ══════════════════════════════════════════════════════════════
//  Global Search — domain registry (Phase 6.1, spec §19)
//
//  Single unified registry of searchable domains discovered from the
//  SYSTEM INVENTORY. Each descriptor binds together:
//    • the CANONICAL RTDB table (identical name — no shadow
//      collections, same doctrine as the evidence registry),
//    • the source page permissionKey + page id (the same permission
//      doctrine that guards the records on their own page),
//    • the employee-scope doctrine for the domain,
//    • the exact-navigation capability of the target page.
//
//  The Search Service iterates this registry — it NEVER contains a
//  giant if/else per page (spec §18/§19). Adding a domain = adding
//  one descriptor + one adapter.
//
//  Client-safe: pure data, no server imports.
// ══════════════════════════════════════════════════════════════

import type { SearchDomain } from './types';

/** How the target page opens an exact record (mirrors the evidence doctrine). */
export type SearchNavStrategy = 'highlight' | 'detailParam' | 'generic';

/** How rows of this domain are authorized against the employee scope. */
export type SearchScopeKind =
  /** Records carry employeeId — default fail-closed row filter. */
  | 'rows'
  /** The records ARE employees — filtered with the employees filter. */
  | 'employees'
  /** Optionally-linked rows (complaints) / related ids (CAPA). */
  | 'linked'
  /** Org-wide / config records — source page permission alone. */
  | 'none';

export interface SearchDomainDescriptor {
  domain: SearchDomain;
  /** Canonical RTDB table — identical name (no shadow collections). */
  table: string;
  /** Arabic group label shown as the results section heading. */
  label: string;
  /** Arabic singular record type. */
  recordType: string;
  /** The permissionKey guarding the SOURCE records (APP_PAGES doctrine). */
  permissionKey: string;
  /** Sidebar page id owning these records. */
  page: string;
  navStrategy: SearchNavStrategy;
  /** navParams key for `detailParam` strategy (CAPA detail mode). */
  navParam?: string;
  scopeKind: SearchScopeKind;
  /** Employee-scope options for 'rows'/'linked' domains. */
  scopeOptions: {
    optionalLink: boolean;
    relatedEmployeeIdsField?: string;
  };
  /** Projection resolves missing employee names from the employee map. */
  usesEmployeeMap: boolean;
}

const ROWS_DEFAULT = { optionalLink: false } as const;

export const SEARCH_DOMAINS: Record<SearchDomain, SearchDomainDescriptor> = {
  employees: {
    domain: 'employees',
    table: 'employees',
    label: 'الموظفون',
    recordType: 'موظف',
    permissionKey: 'employees',
    page: 'employees',
    navStrategy: 'highlight',
    scopeKind: 'employees',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: false,
  },
  qualityObservations: {
    domain: 'qualityObservations',
    table: 'qualityObservations',
    label: 'ملاحظات الجودة',
    recordType: 'ملاحظة جودة',
    permissionKey: 'observations',
    page: 'observations',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  qualityDeductions: {
    domain: 'qualityDeductions',
    table: 'qualityDeductions',
    label: 'خصومات الجودة',
    recordType: 'خصم جودة',
    permissionKey: 'quality',
    page: 'quality',
    navStrategy: 'generic',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  hrDeductions: {
    domain: 'hrDeductions',
    table: 'hrDeductions',
    label: 'خصومات الموارد البشرية',
    recordType: 'خصم موارد بشرية',
    permissionKey: 'hrDeductions',
    page: 'hrDeductions',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  complaints: {
    domain: 'complaints',
    table: 'complaints',
    label: 'شكاوى العملاء',
    recordType: 'شكوى عميل',
    permissionKey: 'complaints',
    page: 'complaints',
    navStrategy: 'highlight',
    scopeKind: 'linked',
    scopeOptions: { optionalLink: true },
    usesEmployeeMap: true,
  },
  capaCases: {
    domain: 'capaCases',
    table: 'capaCases',
    label: 'حالات CAPA',
    recordType: 'حالة CAPA',
    permissionKey: 'capa',
    page: 'capa',
    navStrategy: 'detailParam',
    navParam: 'id',
    scopeKind: 'linked',
    scopeOptions: { optionalLink: true, relatedEmployeeIdsField: 'relatedEmployeeIds' },
    usesEmployeeMap: true,
  },
  followUps: {
    domain: 'followUps',
    table: 'followUps',
    label: 'المتابعات',
    recordType: 'متابعة',
    permissionKey: 'followUps',
    page: 'followUps',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  travelDeals: {
    domain: 'travelDeals',
    table: 'travelDeals',
    label: 'صفقات السفر',
    recordType: 'صفقة سفر',
    permissionKey: 'travel',
    page: 'travel',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  attendance: {
    domain: 'attendance',
    table: 'attendance',
    label: 'الحضور والانصراف',
    recordType: 'سجل حضور',
    permissionKey: 'attendance',
    page: 'attendance',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  requests: {
    domain: 'requests',
    table: 'requests',
    label: 'الطلبات',
    recordType: 'طلب',
    permissionKey: 'requests',
    page: 'requests',
    navStrategy: 'highlight',
    scopeKind: 'rows',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: true,
  },
  knowledgeBase: {
    domain: 'knowledgeBase',
    table: 'knowledgeBase',
    label: 'قاعدة المعرفة',
    recordType: 'مقالة معرفة',
    permissionKey: 'knowledgeBase',
    page: 'knowledgeBase',
    navStrategy: 'generic',
    scopeKind: 'none',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: false,
  },
  monthSnapshots: {
    domain: 'monthSnapshots',
    table: 'monthSnapshots',
    label: 'أشهر KPI',
    recordType: 'شهر KPI',
    permissionKey: 'monthClose',
    page: 'monthClose',
    navStrategy: 'generic',
    scopeKind: 'none',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: false,
  },
  orgNodes: {
    domain: 'orgNodes',
    table: 'orgNodes',
    label: 'الهيكل التنظيمي',
    recordType: 'وحدة تنظيمية',
    permissionKey: 'organization',
    page: 'organization',
    navStrategy: 'generic',
    scopeKind: 'none',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: false,
  },
  users: {
    domain: 'users',
    table: 'users',
    label: 'مستخدمو النظام',
    recordType: 'مستخدم',
    permissionKey: 'controlPanel',
    page: 'controlPanel',
    navStrategy: 'generic',
    scopeKind: 'none',
    scopeOptions: ROWS_DEFAULT,
    usesEmployeeMap: false,
  },
};

/** Registry iteration order (also the group tie-break order). */
export const SEARCH_DOMAIN_ORDER: SearchDomain[] = Object.keys(SEARCH_DOMAINS) as SearchDomain[];

export function isSearchDomain(value: unknown): value is SearchDomain {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SEARCH_DOMAINS, value)
  );
}
