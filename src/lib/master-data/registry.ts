// ══════════════════════════════════════════════════════════════
//  Master Data & System Lists — DOMAIN REGISTRY
//
//  The registry is the single place that declares which configurable
//  business-list domains exist under Settings → Master Data. It is a
//  UI-organization registry ONLY: each domain's data continues to
//  live in its own canonical store (its existing table + API). Adding
//  a future domain (Travel Service Types, Deal Statuses, …) means
//  adding ONE entry here + its workspace component — never a new
//  settings architecture.
//
//  status:
//    'available' → a workspace exists; the domain is manageable today.
//    'planned'   → the framework slot is reserved; no fake screens —
//                  the workspace mounts when the domain's canonical
//                  source/consumer lands.
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
  workspace?: 'observationCategories';
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
    id: 'travelServiceTypes',
    titleAr: 'أنواع خدمات السفر',
    titleEn: 'Travel Service Types',
    descriptionAr: 'أنواع خدمات السفر (طيران، فنادق، تأشيرات…) — يُفعّل عند ربطه بنموذج الحجوزات',
    descriptionEn: 'Travel service types (flights, hotels, visas…) — activates with the booking model',
    icon: 'plane',
    status: 'planned',
  },
  {
    id: 'dealStatuses',
    titleAr: 'حالات الصفقات',
    titleEn: 'Deal Statuses',
    descriptionAr: 'مفردات حالات الصفقات — يُفعّل عند ربطه بمصدر الحالات الحالي',
    descriptionEn: 'Deal-status vocabulary — activates with its canonical source',
    icon: 'briefcase',
    status: 'planned',
  },
  {
    id: 'followUpTypes',
    titleAr: 'أنواع المتابعات',
    titleEn: 'Follow-up Types',
    descriptionAr: 'أنواع المتابعات اليومية — يُفعّل عند الترحيل من القائمة الثابتة',
    descriptionEn: 'Daily follow-up types — activates when migrated from the static list',
    icon: 'clipboard-list',
    status: 'planned',
  },
  {
    id: 'complaintTypes',
    titleAr: 'أنواع الشكاوى',
    titleEn: 'Complaint Types',
    descriptionAr: 'تصنيفات شكاوى العملاء — يُفعّل عند الترحيل من القائمة الثابتة',
    descriptionEn: 'Customer complaint types — activates when migrated from the static list',
    icon: 'message-square',
    status: 'planned',
  },
  {
    id: 'requestTypes',
    titleAr: 'أنواع الطلبات',
    titleEn: 'Request Types',
    descriptionAr: 'أنواع طلبات الموظفين — يُفعّل عند الترحيل من القائمة الثابتة',
    descriptionEn: 'Employee request types — activates when migrated from the static list',
    icon: 'file-text',
    status: 'planned',
  },
];

export function masterDataDomainById(id: string): MasterDataDomain | undefined {
  return MASTER_DATA_DOMAINS.find((d) => d.id === id);
}
