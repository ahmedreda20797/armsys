// ══════════════════════════════════════════════════════════════
//  Master Data & System Lists — DOMAIN REGISTRY
//
//  The registry is the single place that declares which configurable
//  business-list domains exist under Settings → Master Data. It is a
//  UI-organization registry ONLY: each domain's data continues to
//  live in its own canonical store (its existing table + API). Adding
//  a future domain means adding ONE entry here + its workspace
//  component — never a new settings architecture.
//
//  status:
//    'available' → a workspace exists; the domain is manageable today.
//    'planned'   → the framework slot is reserved; no fake screens —
//                  the workspace mounts when the domain's canonical
//                  source/consumer lands.
//
//  workspace:
//    'observationCategories' — the quality-domain workspace over
//      /api/observation-categories (impact/points/weight model).
//    'simpleList' — the shared bilingual-vocabulary workspace over
//      /api/master-data/[domain] (key + name/nameEn + active + order;
//      server-side referential delete guard). Gated by the
//      'masterData' permission key.
// ══════════════════════════════════════════════════════════════

export type MasterDataDomainStatus = 'available' | 'planned';

export interface MasterDataDomain {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** lucide-react icon name (rendered by the workspace shell). */
  icon: 'tags' | 'plane' | 'briefcase' | 'message-square' | 'file-text' | 'clipboard-list';
  status: MasterDataDomainStatus;
  /** Which embedded workspace component renders this domain. */
  workspace?: 'observationCategories' | 'simpleList';
  /** Registry page id whose permission gates the domain, when one applies. */
  permissionPageId?: string;
}

export const MASTER_DATA_DOMAINS: MasterDataDomain[] = [
  {
    id: 'observationCategories',
    titleAr: 'تصنيفات ملاحظات الجودة',
    titleEn: 'Quality Observation Categories',
    descriptionAr: 'قائمة تصنيفات الملاحظات المستخدمة في محرك الجودة ومؤشرات الأداء',
    descriptionEn: 'The observation vocabulary used by the quality engine and KPIs',
    icon: 'tags',
    status: 'available',
    workspace: 'observationCategories',
    permissionPageId: 'observationCategories',
  },
  {
    id: 'followUpTypes',
    titleAr: 'أنواع المتابعات',
    titleEn: 'Follow-up Types',
    descriptionAr: 'قائمة أنواع المتابعات اليومية — تظهر في نموذج المتابعة والفلاتر والتقارير',
    descriptionEn: 'The daily follow-up type vocabulary — forms, filters, and reports',
    icon: 'clipboard-list',
    status: 'available',
    workspace: 'simpleList',
    permissionPageId: 'masterData',
  },
  {
    id: 'complaintTypes',
    titleAr: 'أنواع الشكاوى',
    titleEn: 'Complaint Types',
    descriptionAr: 'تصنيفات شكاوى العملاء — تظهر في نموذج الشكوى والفلاتر وتحليل العمليات',
    descriptionEn: 'The customer complaint vocabulary — forms, filters, and operations analysis',
    icon: 'message-square',
    status: 'available',
    workspace: 'simpleList',
    permissionPageId: 'masterData',
  },
  {
    id: 'requestTypes',
    titleAr: 'أنواع الطلبات',
    titleEn: 'Request Types',
    descriptionAr: 'أنواع طلبات الموظفين — تظهر في نموذج الطلب والفلاتر وملخصات لوحة الرئيسية',
    descriptionEn: 'The employee request vocabulary — forms, filters, and home summaries',
    icon: 'file-text',
    status: 'available',
    workspace: 'simpleList',
    permissionPageId: 'masterData',
  },
  {
    // §AUDITED-RESERVATION — the deal-status vocabulary is structurally
    // load-bearing: closure accounting (buildDealMetrics keys on
    // 'completed'), the travel tabs (current = upcoming ∪ in_progress),
    // tab counters and the analytics distributions all key on the exact
    // status values. A free-form status list would silently break those
    // aggregations, so the domain mounts only together with that
    // lifecycle wiring (add/deactivate → engine-aware).
    id: 'dealStatuses',
    titleAr: 'حالات الصفقات',
    titleEn: 'Deal Statuses',
    descriptionAr: 'مفردات حالات الصفقات — مرتبطة بدورة حياة الصفقة (الإغلاق والتبويبات ومؤشرات الأداء)؛ تُفعّل مع ربطها بمحرك الحالات',
    descriptionEn: 'Deal-status vocabulary — coupled to the deal lifecycle (closure, tabs, KPIs); mounts with its engine wiring',
    icon: 'briefcase',
    status: 'planned',
  },
  {
    // §AUDITED-RESERVATION — booking service types are validated
    // server-side (sanitizeBookingItems) and projected onto per-service
    // legacy fields on the deal (has*/*Status); new types require that
    // projection/validation wiring before they can flow through deals.
    id: 'travelServiceTypes',
    titleAr: 'أنواع خدمات السفر',
    titleEn: 'Travel Service Types',
    descriptionAr: 'أنواع خدمات السفر (طيران، فنادق، تأشيرات…) — مرتبطة بالتحقق الخادمي وحقول الخدمات في الصفقات؛ تُفعّل مع ربطها بنموذج الحجوزات',
    descriptionEn: 'Travel service types (flights, hotels, visas…) — coupled to server validation and deal service fields; mounts with the booking model',
    icon: 'plane',
    status: 'planned',
  },
];

export function masterDataDomainById(id: string): MasterDataDomain | undefined {
  return MASTER_DATA_DOMAINS.find((d) => d.id === id);
}
