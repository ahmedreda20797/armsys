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
  // ═══ 🏢 الموارد البشرية ═══
  { id: 'hrDeductions', title: 'خصومات الموارد البشرية', icon: 'Banknote', permissionKey: 'hrDeductions', availableActions: ['create', 'update', 'delete', 'approve'], groupId: 'hr' },
  { id: 'rules', title: 'قواعد الخصم', icon: 'Scale', permissionKey: 'rules', availableActions: ['create', 'update', 'delete'], groupId: 'hr' },
  // ═══ ✈️ العمليات والسفر ═══
  { id: 'travel', title: 'السفر', icon: 'Plane', permissionKey: 'travel', availableActions: ['create', 'update', 'delete', 'export'], groupId: 'travel_ops' },
  // ═══ 📈 التقارير والتحليلات ═══
  { id: 'reports', title: 'التقارير', icon: 'BarChart3', permissionKey: 'reports', availableActions: ['export'], groupId: 'reports' },
  { id: 'knowledgeBase', title: 'قاعدة المعرفة', icon: 'BookOpen', permissionKey: 'knowledgeBase', availableActions: ['create', 'update', 'delete'], groupId: 'reports' },
  // ═══ ⚙️ الإدارة والإعدادات ═══
  { id: 'controlPanel', title: 'مركز التحكم', icon: 'Shield', permissionKey: 'controlPanel', availableActions: [], groupId: 'settings' },
  { id: 'rulesEngine', title: 'الأتمتة والقواعد', icon: 'Zap', permissionKey: 'rulesEngine', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  { id: 'firebase', title: 'Firebase Settings', icon: 'Database', permissionKey: 'firebase', availableActions: [], groupId: 'settings' },
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
