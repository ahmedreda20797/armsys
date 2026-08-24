// ══════════════════════════════════════════════════════════════
//  Dashboard widget registry — Milestone 10
//
//  Stable widget definitions for the home dashboard's overview
//  cards. This registry is the SOURCE OF TRUTH for widget ids,
//  titles, permission requirements and default layout — user
//  preferences only override ORDER and VISIBILITY, and only within
//  what permission allows (a user can never personalize an
//  unauthorized widget into view; permission always wins over
//  personalization).
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

/**
 * The five overview cards of the home dashboard. Adding a widget:
 * append here with defaultVisible reflecting the SAFEST appropriate
 * state, then render it from the resolved layout in HomePage —
 * never hand-place a new card outside the layout resolution.
 */
export const DASHBOARD_WIDGETS: WidgetConfig[] = [
  { id: 'pendingRequests', title: 'الطلبات المعلقة', permissionKey: 'requests', defaultVisible: true, order: 1 },
  { id: 'attendanceToday', title: 'الحضور اليوم', permissionKey: 'attendance', defaultVisible: true, order: 2 },
  { id: 'quickAccess', title: 'الوصول السريع', permissionKey: 'home', defaultVisible: true, order: 3 },
  { id: 'requestTypeAnalytics', title: 'تحليل الطلبات حسب النوع', permissionKey: 'requests', defaultVisible: true, order: 4 },
  { id: 'departmentsOverview', title: 'أقسام الشركة', permissionKey: 'employees', defaultVisible: true, order: 5 },
];
