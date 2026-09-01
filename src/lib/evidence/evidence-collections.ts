// ══════════════════════════════════════════════════════════════
//  Evidence Preview — collection registry (Phase 5.2, spec §31/§37)
//
//  Single shared mapping between the analytics/PI evidence-graph
//  collection names and:
//    • the SOURCE PAGE that owns those records (permissionKey +
//      sidebar page id) — used for permission checks (§37) and
//      navigation (§33);
//    • the navigation strategy (§34/§35/§36):
//        highlight    → navigate + locate + scroll + temporary
//                       highlight on the target page
//        detailParam  → the target page has a detail mode selected
//                       by a nav param (CAPA opens the exact case)
//        generic      → no exact-record navigation exists; the
//                       Evidence Preview stays fully functional and
//                       the button opens the source page generically
//                       (UI labels the difference explicitly, §36).
//
//  NO shadow collections, NO copies (spec §39): the preview reads
//  the canonical RTDB tables named exactly `collection` at request
//  time — this registry never stores record data.
//
//  Client-safe: pure data, no server imports.
// ══════════════════════════════════════════════════════════════

export type EvidenceCollection =
  | 'qualityObservations'
  | 'qualityDeductions'
  | 'complaints'
  | 'capaCases'
  | 'followUps'
  | 'travelDeals'
  | 'attendanceResults'
  | 'monthSnapshots'
  | 'kpiSchemes';

export type EvidenceNavStrategy = 'highlight' | 'detailParam' | 'generic';

export interface EvidenceCollectionDescriptor {
  /** Arabic singular title shown in preview headers/summaries. */
  title: string;
  /** Arabic group label (evidence section). */
  label: string;
  /** The sidebar permissionKey that guards the SOURCE records (§37). */
  permissionKey: string;
  /** Sidebar page id that owns these records. */
  page: string;
  /** Exact-navigation capability of the target page (§34-§36). */
  navStrategy: EvidenceNavStrategy;
  /** navParams key for `detailParam` strategy. */
  navParam?: string;
}

export const EVIDENCE_COLLECTIONS: Record<EvidenceCollection, EvidenceCollectionDescriptor> = {
  qualityObservations: {
    title: 'ملاحظة جودة',
    label: 'ملاحظات الجودة',
    permissionKey: 'observations',
    page: 'observations',
    navStrategy: 'highlight',
  },
  qualityDeductions: {
    title: 'خصم جودة',
    label: 'خصومات الجودة',
    permissionKey: 'quality',
    page: 'quality',
    // Phase 6.3 (§22-§25): the page renders stable data-record-id rows
    // and auto-expands the owning employee group — exact navigation is
    // now honest (was: generic page fallback).
    navStrategy: 'highlight',
  },
  complaints: {
    title: 'شكوى عميل',
    label: 'شكاوى العملاء',
    permissionKey: 'complaints',
    page: 'complaints',
    navStrategy: 'highlight',
  },
  capaCases: {
    title: 'حالة CAPA',
    label: 'حالات CAPA',
    permissionKey: 'capa',
    page: 'capa',
    navStrategy: 'detailParam',
    navParam: 'id',
  },
  followUps: {
    title: 'متابعة',
    label: 'المتابعات',
    permissionKey: 'followUps',
    page: 'followUps',
    navStrategy: 'highlight',
  },
  travelDeals: {
    title: 'صفقة سفر',
    label: 'صفقات السفر',
    permissionKey: 'travel',
    page: 'travel',
    navStrategy: 'highlight',
  },
  attendanceResults: {
    title: 'نتيجة حضور',
    label: 'نتائج الحضور',
    permissionKey: 'attendance',
    page: 'attendance',
    navStrategy: 'generic',
  },
  monthSnapshots: {
    title: 'لقطة شهر (KPI)',
    label: 'لقطات الشهر (KPI)',
    permissionKey: 'monthClose',
    page: 'monthClose',
    navStrategy: 'generic',
  },
  kpiSchemes: {
    title: 'مخطط KPI',
    label: 'مخططات KPI',
    permissionKey: 'kpiSettings',
    page: 'kpiSettings',
    navStrategy: 'generic',
  },
};

export function isEvidenceCollection(value: unknown): value is EvidenceCollection {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EVIDENCE_COLLECTIONS, value)
  );
}

/** Canonical RTDB table for a collection — identical name (§39). */
export function evidenceTableOf(collection: EvidenceCollection): string {
  return collection;
}
