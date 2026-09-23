// ══════════════════════════════════════════════════════════════
//  Dashboard section registry — Milestone 10 + §Home-CC workspace
//
//  Stable SECTION definitions for the home workspace. This registry
//  is the SOURCE OF TRUTH for section ids, titles, permission
//  requirements and default layout — user preferences only override
//  ORDER and VISIBILITY, and only within what permission allows (a
//  user can never personalize an unauthorized section into view;
//  permission always wins over personalization).
//
//  §Home-CC OPERATIONAL WORKSPACE — the default layout follows the
//  canonical operational hierarchy (§1); every entry renders as a
//  borderless SECTION of one workspace (rows / queue / rail /
//  matrix), never a card:
//    1. Needs Attention (work queue)  → attentionRequired
//    2. Today (fixed summary strip)   → not a section — fixed UI
//    3. Operational Timeline          → operationalTimeline
//    4. Team Status (matrix)          → departmentsOverview
//    5. Performance (signal line)     → performancePulse
//    6. Recent Activity (stream)      → recentActivity
//    7. Upcoming departures           → travelAlerts
//    8. Shortcuts / system status     → quickAccess
//
//  Sections whose content was FOLDED into the queue or the Today
//  strip default to HIDDEN (they remain opt-in via تخصيص so no
//  functionality is lost): pendingRequests, todaysFollowUps,
//  attendanceToday, qualitySnapshot — their data lives on as queue
//  rows and Today indicators.
// ══════════════════════════════════════════════════════════════

export interface WidgetConfig {
  /** Stable section id — persisted in user preferences. Never rename. */
  id: string;
  /** Arabic display title (used in the customization UI). */
  title: string;
  /** Page permission key that governs the section's content. */
  permissionKey: string;
  defaultVisible: boolean;
  /** Default position (lower renders first). */
  order: number;
}

export const DASHBOARD_WIDGETS: WidgetConfig[] = [
  { id: 'attentionRequired', title: 'يحتاج انتباهك', permissionKey: 'home', defaultVisible: true, order: 0 },
  { id: 'operationalTimeline', title: 'الجدول الزمني التشغيلي', permissionKey: 'home', defaultVisible: true, order: 1 },
  { id: 'departmentsOverview', title: 'حالة الأقسام', permissionKey: 'employees', defaultVisible: true, order: 2 },
  { id: 'performancePulse', title: 'نبض الأداء', permissionKey: 'home', defaultVisible: true, order: 3 },
  { id: 'recentActivity', title: 'النشاط الأخير', permissionKey: 'notifications', defaultVisible: true, order: 4 },
  { id: 'travelAlerts', title: 'مغادرات قادمة', permissionKey: 'travel', defaultVisible: true, order: 5 },
  { id: 'quickAccess', title: 'مختصراتي', permissionKey: 'home', defaultVisible: true, order: 6 },
  // FOLDED sections — opt-in (content lives in the work queue and the
  // Today strip by default):
  { id: 'pendingRequests', title: 'الطلبات المعلقة', permissionKey: 'requests', defaultVisible: false, order: 7 },
  { id: 'todaysFollowUps', title: 'متابعات اليوم', permissionKey: 'followUps', defaultVisible: false, order: 8 },
  { id: 'attendanceToday', title: 'الحضور اليوم', permissionKey: 'attendance', defaultVisible: false, order: 9 },
  { id: 'qualitySnapshot', title: 'لمحة الجودة', permissionKey: 'quality', defaultVisible: false, order: 10 },
  { id: 'requestTypeAnalytics', title: 'تحليل الطلبات حسب النوع', permissionKey: 'requests', defaultVisible: false, order: 11 },
  { id: 'performanceDetail', title: 'تفاصيل الأداء والتأخيرات', permissionKey: 'attendance', defaultVisible: false, order: 12 },
  { id: 'qualityDeductionsDetail', title: 'تفاصيل خصومات الجودة', permissionKey: 'quality', defaultVisible: false, order: 13 },
  { id: 'travelItineraryDetail', title: 'تفاصيل جدول السفر', permissionKey: 'travel', defaultVisible: false, order: 14 },
];
