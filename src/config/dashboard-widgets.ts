// ══════════════════════════════════════════════════════════════
//  Dashboard widget registry — Milestone 10 + §2 Command Center
//
//  Stable widget definitions for the home dashboard. This registry
//  is the SOURCE OF TRUTH for widget ids, titles, permission
//  requirements and default layout — user preferences only override
//  ORDER and VISIBILITY, and only within what permission allows (a
//  user can never personalize an unauthorized widget into view;
//  permission always wins over personalization).
//
//  §2 REWORK — the home page is an Operational Command Center:
//  every widget answers "ماذا يحدث؟ / ماذا يحتاج انتباهي؟ / ماذا
//  أفعل الآن؟". `attentionRequired` intentionally defaults to the
//  first slot — it is the "what needs me NOW" surface.
// ══════════════════════════════════════════════════════════════

export interface WidgetConfig {
  /** Stable widget id — persisted in user preferences. Never rename. */
  id: string;
  /** Arabic display title (used in the customization dialog). */
  title: string;
  /** Page permission key that governs the widget's content. */
  permissionKey: string;
  defaultVisible: boolean;
  /** Default position (lower renders first). */
  order: number;
}

export const DASHBOARD_WIDGETS: WidgetConfig[] = [
  { id: 'attentionRequired', title: 'يتطلب انتباهك', permissionKey: 'home', defaultVisible: true, order: 0 },
  { id: 'pendingRequests', title: 'الطلبات المعلقة', permissionKey: 'requests', defaultVisible: true, order: 1 },
  { id: 'attendanceToday', title: 'الحضور اليوم', permissionKey: 'attendance', defaultVisible: true, order: 2 },
  { id: 'todaysFollowUps', title: 'متابعات اليوم', permissionKey: 'followUps', defaultVisible: true, order: 3 },
  { id: 'travelAlerts', title: 'تنبيهات السفر', permissionKey: 'travel', defaultVisible: true, order: 4 },
  { id: 'qualitySnapshot', title: 'لمحة الجودة', permissionKey: 'quality', defaultVisible: true, order: 5 },
  { id: 'requestTypeAnalytics', title: 'تحليل الطلبات حسب النوع', permissionKey: 'requests', defaultVisible: true, order: 6 },
  { id: 'departmentsOverview', title: 'أقسام الشركة', permissionKey: 'employees', defaultVisible: true, order: 7 },
  { id: 'quickAccess', title: 'مختصراتي', permissionKey: 'home', defaultVisible: true, order: 8 },
  { id: 'recentActivity', title: 'النشاط الأخير', permissionKey: 'notifications', defaultVisible: true, order: 9 },
  // PHASE 9 — OPTIONAL widgets that restore data from the OLD tabs
  // (نظرة عامة / الأداء والتأخيرات / السفر والتنبيهات / الجودة والخصومات)
  // that the unified Command Center collapsed. They are NOT shown by
  // default; users can enable them via "تخصيص". Each maps to one of
  // the four legacy tabs so no information was silently lost.
  { id: 'performanceDetail', title: 'تفاصيل الأداء والتأخيرات', permissionKey: 'attendance', defaultVisible: false, order: 10 },
  { id: 'qualityDeductionsDetail', title: 'تفاصيل خصومات الجودة', permissionKey: 'quality', defaultVisible: false, order: 11 },
  { id: 'travelItineraryDetail', title: 'تفاصيل جدول السفر', permissionKey: 'travel', defaultVisible: false, order: 12 },
];
