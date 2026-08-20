// src/config/permissions.ts
// Action-level permission system

export type PermissionLevel = 'none' | 'read' | 'edit';

export type ActionKey = 'create' | 'update' | 'delete' | 'export' | 'approve' | 'upload' | 'override';

export interface PageActions {
  [key: string]: ActionKey[];
}

export interface PagePermission {
  level: PermissionLevel;
  actions?: Partial<Record<ActionKey, boolean>>;
}

export type PermissionsMap = Record<string, PagePermission | PermissionLevel>;

export interface PageConfig {
  id: string;
  title: string;       // Arabic display name
  icon: string;        // lucide icon name
  permissionKey: string;
  availableActions: ActionKey[];
  groupId: string;     // sidebar section group
  overlayOnly?: boolean; // true = in permissions but NOT in sidebar
}

export interface SidebarGroup {
  id: string;
  label: string;
  emoji: string;
}

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  { id: 'daily_ops',     label: 'العمليات اليومية',     emoji: '📊' },
  { id: 'employee_mgmt', label: 'إدارة الموظفين',       emoji: '👥' },
  { id: 'quality_ctrl',  label: 'الجودة والرقابة',      emoji: '🎯' },
  { id: 'hr',            label: 'الموارد البشرية',       emoji: '🏢' },
  { id: 'travel_ops',    label: 'العمليات والسفر',       emoji: '✈️' },
  { id: 'reports',       label: 'التقارير والتحليلات',   emoji: '📈' },
  { id: 'settings',      label: 'الإدارة والإعدادات',   emoji: '⚙️' },
];

export const APP_PAGES: PageConfig[] = [
  // ═══ 📊 العمليات اليومية ═══
  { id: 'home', title: 'الرئيسية', icon: 'LayoutDashboard', permissionKey: 'home', availableActions: [], groupId: 'daily_ops' },
  { id: 'operationsCenter', title: 'مركز العمليات', icon: 'Monitor', permissionKey: 'operationsCenter', availableActions: [], groupId: 'daily_ops' },
  { id: 'notifications', title: 'مركز الإشعارات', icon: 'Bell', permissionKey: 'notifications', availableActions: ['create', 'update', 'delete'], groupId: 'daily_ops' },
  { id: 'followUps', title: 'المتابعة اليومية', icon: 'ClipboardCheck', permissionKey: 'followUps', availableActions: ['create', 'update', 'delete'], groupId: 'daily_ops' },
  // ═══ 👥 إدارة الموظفين ═══
  { id: 'employees', title: 'الموظفين', icon: 'Users', permissionKey: 'employees', availableActions: ['create', 'update', 'delete', 'export'], groupId: 'employee_mgmt' },
  { id: 'employee360', title: 'ملف الموظف', icon: 'UserCircle', permissionKey: 'employee360', availableActions: [], groupId: 'employee_mgmt', overlayOnly: true },
  { id: 'attendance', title: 'الحضور والانصراف', icon: 'Clock', permissionKey: 'attendance', availableActions: ['create', 'update', 'delete', 'export'], groupId: 'employee_mgmt' },
  { id: 'biometric', title: 'البصمة', icon: 'Fingerprint', permissionKey: 'biometric', availableActions: ['create', 'update', 'delete', 'upload'], groupId: 'employee_mgmt' },
  { id: 'requests', title: 'الطلبات', icon: 'FileText', permissionKey: 'requests', availableActions: ['create', 'update', 'delete', 'approve'], groupId: 'employee_mgmt' },
  // ═══ 🎯 الجودة والرقابة ═══
  { id: 'quality', title: 'الجودة', icon: 'Award', permissionKey: 'quality', availableActions: ['create', 'update', 'delete'], groupId: 'quality_ctrl' },
  { id: 'capa', title: 'نظام كابا', icon: 'ShieldCheck', permissionKey: 'capa', availableActions: ['create', 'update', 'delete'], groupId: 'quality_ctrl' },
  { id: 'riskCenter', title: 'مركز المخاطر', icon: 'AlertTriangle', permissionKey: 'riskCenter', availableActions: [], groupId: 'quality_ctrl' },
  { id: 'complaints', title: 'شكاوى العملاء', icon: 'MessageSquareWarning', permissionKey: 'complaints', availableActions: ['create', 'update', 'delete'], groupId: 'quality_ctrl' },
  // ── Quality KPI (Phase 1) ──
  { id: 'observations', title: 'ملاحظات الجودة', icon: 'Eye', permissionKey: 'observations', availableActions: ['create', 'update', 'delete', 'approve'], groupId: 'quality_ctrl' },
  { id: 'observationCategories', title: 'تصنيفات الملاحظات', icon: 'Tags', permissionKey: 'observationCategories', availableActions: ['create', 'update', 'delete'], groupId: 'quality_ctrl', overlayOnly: true },
  { id: 'observationTemplates', title: 'قوالب الملاحظات', icon: 'FilePlus2', permissionKey: 'observationTemplates', availableActions: ['create', 'update', 'delete'], groupId: 'quality_ctrl', overlayOnly: true },
  { id: 'kpiDashboard', title: 'لوحة مؤشرات الجودة', icon: 'Gauge', permissionKey: 'kpiDashboard', availableActions: [], groupId: 'quality_ctrl' },
  { id: 'qualityAuditLog', title: 'سجل مراجعة الجودة', icon: 'ScrollText', permissionKey: 'qualityAuditLog', availableActions: [], groupId: 'quality_ctrl' },
  // ═══ 🏢 الموارد البشرية ═══
  { id: 'hrDeductions', title: 'خصومات الموارد البشرية', icon: 'Banknote', permissionKey: 'hrDeductions', availableActions: ['create', 'update', 'delete', 'approve'], groupId: 'hr' },
  { id: 'rules', title: 'قواعد الخصم', icon: 'Scale', permissionKey: 'rules', availableActions: ['create', 'update', 'delete'], groupId: 'hr' },
  // ═══ ✈️ العمليات والسفر ═══
  { id: 'travel', title: 'السفر', icon: 'Plane', permissionKey: 'travel', availableActions: ['create', 'update', 'delete', 'export'], groupId: 'travel_ops' },
  // ═══ 📈 التقارير والتحليلات ═══
  { id: 'reports', title: 'التقارير', icon: 'BarChart3', permissionKey: 'reports', availableActions: ['export'], groupId: 'reports' },
  // ── Unified Reporting Architecture (Milestone 8): the reference
  //    Quality Deductions report mounts as its own page under the
  //    SAME 'reports' permission key — existing role grants apply
  //    unchanged (backend enforcement lives in /api/reports/run).
  { id: 'qualityDeductionsReport', title: 'تقرير خصومات الجودة', icon: 'FileWarning', permissionKey: 'reports', availableActions: ['export'], groupId: 'reports' },
  { id: 'knowledgeBase', title: 'قاعدة المعرفة', icon: 'BookOpen', permissionKey: 'knowledgeBase', availableActions: ['create', 'update', 'delete'], groupId: 'reports' },
  // ═══ ⚙️ الإدارة والإعدادات ═══
  { id: 'controlPanel', title: 'مركز التحكم', icon: 'Shield', permissionKey: 'controlPanel', availableActions: [], groupId: 'settings' },
  { id: 'workflowDesigner', title: 'مصمم المسارات', icon: 'Workflow', permissionKey: 'workflowDesigner', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  { id: 'rulesEngine', title: 'الأتمتة والقواعد', icon: 'Zap', permissionKey: 'rulesEngine', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  { id: 'firebase', title: 'Firebase Settings', icon: 'Database', permissionKey: 'firebase', availableActions: [], groupId: 'settings' },
  // ── Month close / KPI settings (Phase 1) ──
  { id: 'monthClose', title: 'إغلاق الشهر', icon: 'CalendarCog', permissionKey: 'monthClose', availableActions: ['approve'], groupId: 'settings' },
  { id: 'kpiSettings', title: 'إعدادات مؤشرات الجودة', icon: 'Settings2', permissionKey: 'kpiSettings', availableActions: ['update'], groupId: 'settings' },
];

// Role presets with action-level permissions
function makeEditWithActions(actions: ActionKey[]): PagePermission {
  const actionMap: Partial<Record<ActionKey, boolean>> = {};
  actions.forEach(a => { actionMap[a] = true; });
  return { level: 'edit', actions: actionMap };
}

export const ADMIN_PERMISSIONS: PermissionsMap = (() => {
  const map: PermissionsMap = {};
  APP_PAGES.forEach(p => {
    map[p.permissionKey] = p.availableActions.length > 0
      ? makeEditWithActions(p.availableActions)
      : 'edit';
  });
  return map;
})();

export const HR_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: makeEditWithActions(['create', 'update', 'delete', 'export']),
  employee360: 'read',
  biometric: makeEditWithActions(['create', 'update', 'delete']),
  attendance: makeEditWithActions(['create', 'update', 'delete', 'export']),
  requests: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  rules: 'none',
  quality: 'none',
  hrDeductions: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  travel: 'read',
  reports: { level: 'edit', actions: { export: false } },
  controlPanel: 'none',
  firebase: 'none',
  followUps: 'none',
  capa: 'none',
  complaints: 'none',
  knowledgeBase: 'none',
  riskCenter: 'none',
  operationsCenter: 'none',
  notifications: 'read',
  rulesEngine: 'none',
  // Quality KPI (Phase 1)
  observations: 'none',
  observationCategories: 'none',
  observationTemplates: 'none',
  // HR may view the KPI dashboard (read-only); no management/approval authority
  kpiDashboard: 'read',
  qualityAuditLog: 'none',
  monthClose: 'none',
  kpiSettings: 'none',
};

export const MANAGER_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: 'read',
  employee360: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  rules: 'none',
  quality: 'read',
  hrDeductions: 'read',
  travel: 'read',
  reports: { level: 'edit', actions: { export: true } },
  controlPanel: 'none',
  firebase: 'none',
  followUps: 'read',
  capa: 'read',
  complaints: makeEditWithActions(['create', 'update', 'delete']),
  knowledgeBase: 'read',
  riskCenter: 'read',
  operationsCenter: 'read',
  notifications: 'read',
  rulesEngine: 'none',
  // Quality KPI (Phase 1) — managers approve and close months
  observations: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  observationCategories: makeEditWithActions(['create', 'update', 'delete']),
  observationTemplates: makeEditWithActions(['create', 'update', 'delete']),
  kpiDashboard: 'read',
  qualityAuditLog: 'read',
  monthClose: makeEditWithActions(['approve']),
  // Manager may view and update KPI settings (level 'edit' grants read + update)
  kpiSettings: makeEditWithActions(['update']),
};

export const QUALITY_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: 'read',
  employee360: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: 'read',
  rules: 'none',
  quality: makeEditWithActions(['create', 'update', 'delete']),
  hrDeductions: 'none',
  travel: 'read',
  reports: { level: 'edit', actions: { export: true } },
  controlPanel: 'none',
  firebase: 'none',
  followUps: makeEditWithActions(['create', 'update', 'delete']),
  capa: makeEditWithActions(['create', 'update', 'delete']),
  complaints: makeEditWithActions(['create', 'update', 'delete']),
  knowledgeBase: makeEditWithActions(['create', 'update', 'delete']),
  riskCenter: makeEditWithActions([]),
  operationsCenter: 'read',
  notifications: makeEditWithActions([]),
  rulesEngine: makeEditWithActions([]),
  // Quality KPI (Phase 1) — quality creates observations, does NOT approve.
  // Categories are read-only for the quality role (no management authority);
  // category management belongs to manager/admin per the authorization model.
  observations: makeEditWithActions(['create', 'update', 'delete']),
  observationCategories: 'read',
  observationTemplates: makeEditWithActions(['create', 'update', 'delete']),
  kpiDashboard: 'read',
  qualityAuditLog: 'read',
  monthClose: 'none',
  kpiSettings: 'none',
};

export const DEFAULT_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: 'read',
  employee360: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: 'read',
  rules: 'none',
  quality: 'none',
  hrDeductions: 'none',
  travel: 'read',
  reports: 'none',
  controlPanel: 'none',
  firebase: 'none',
  followUps: 'read',
  capa: 'read',
  complaints: 'read',
  knowledgeBase: 'none',
  riskCenter: 'read',
  operationsCenter: 'read',
  notifications: 'read',
  rulesEngine: 'none',
  // Quality KPI (Phase 1) — management pages are NOT part of the generic
  // default role. Only named staff roles (quality/manager/admin/hr) get
  // explicit grants in their presets.
  observations: 'none',
  observationCategories: 'none',
  observationTemplates: 'none',
  kpiDashboard: 'none',
  qualityAuditLog: 'none',
  monthClose: 'none',
  kpiSettings: 'none',
};

// Migrate old string permissions to new format
export function migratePermission(value: string | PagePermission | undefined): PagePermission {
  if (!value) return { level: 'none', actions: {} };
  if (typeof value === 'object' && 'level' in value) {
    return value as PagePermission;
  }
  // Old format: 'none' | 'read' | 'edit'
  return { level: value as PermissionLevel, actions: {} };
}

/**
 * Resolve a user's EFFECTIVE permissions from their role and their stored
 * per-user permission map.
 *
 * This is the SINGLE resolution rule used by every consumer (client
 * AuthContext, server verifyPermission, Control Panel editor):
 *
 *   effective = rolePreset overridden by stored per-user entries
 *
 * Semantics:
 *   • A key MISSING from the stored map falls back to the role preset —
 *     users created before a page existed inherit their role's grant.
 *   • An explicit stored entry ALWAYS wins, including 'none' — an admin
 *     restriction or grant persists regardless of the preset.
 *   • Admin role users bypass permission lookups entirely at the
 *     enforcement sites (unchanged behavior).
 */
export function resolveEffectivePermissions(
  role: string | null | undefined,
  stored: Record<string, unknown> | null | undefined,
): PermissionsMap {
  const base = getPermissionsForRole(role || 'user');
  if (!stored || typeof stored !== 'object') return base;
  return { ...base, ...(stored as PermissionsMap) };
}

// Get permissions for a specific role
export function getPermissionsForRole(role: string): PermissionsMap {
  switch (role) {
    case 'admin': return { ...ADMIN_PERMISSIONS };
    case 'hr': return { ...HR_PERMISSIONS };
    case 'manager': return { ...MANAGER_PERMISSIONS };
    case 'quality': return { ...QUALITY_PERMISSIONS };
    default: return { ...DEFAULT_PERMISSIONS };
  }
}

// Get Arabic label for an action
export function getActionLabel(action: ActionKey): string {
  const labels: Record<ActionKey, string> = {
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    export: 'تصدير',
    approve: 'اعتماد',
    upload: 'رفع',
    override: 'تجاوز',
  };
  return labels[action] || action;
}
