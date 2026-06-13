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
}

export const APP_PAGES: PageConfig[] = [
  {
    id: 'home',
    title: 'الرئيسية',
    icon: 'LayoutDashboard',
    permissionKey: 'home',
    availableActions: [],
  },
  {
    id: 'employees',
    title: 'الموظفين',
    icon: 'Users',
    permissionKey: 'employees',
    availableActions: ['create', 'update', 'delete', 'export'],
  },
  {
    id: 'biometric',
    title: 'البصمة',
    icon: 'Fingerprint',
    permissionKey: 'biometric',
    availableActions: ['create', 'update', 'delete'],
  },
  {
    id: 'attendance',
    title: 'الحضور والانصراف',
    icon: 'Clock',
    permissionKey: 'attendance',
    availableActions: ['create', 'update', 'delete', 'export'],
  },
  {
    id: 'requests',
    title: 'الطلبات',
    icon: 'FileText',
    permissionKey: 'requests',
    availableActions: ['create', 'update', 'delete', 'approve'],
  },
  {
    id: 'rules',
    title: 'قواعد الخصم',
    icon: 'Scale',
    permissionKey: 'rules',
    availableActions: ['create', 'update', 'delete'],
  },
  {
    id: 'quality',
    title: 'الجودة',
    icon: 'Award',
    permissionKey: 'quality',
    availableActions: ['create', 'update', 'delete'],
  },
  {
    id: 'hrDeductions',
    title: 'خصومات الموارد البشرية',
    icon: 'Banknote',
    permissionKey: 'hrDeductions',
    availableActions: ['create', 'update', 'delete', 'approve'],
  },
  {
    id: 'travel',
    title: 'السفر',
    icon: 'Plane',
    permissionKey: 'travel',
    availableActions: ['create', 'update', 'delete', 'export'],
  },
  {
    id: 'reports',
    title: 'التقارير',
    icon: 'BarChart3',
    permissionKey: 'reports',
    availableActions: ['export'],
  },
  {
    id: 'dashboard',
    title: 'لوحة التحكم',
    icon: 'Settings',
    permissionKey: 'dashboard',
    availableActions: [],
  },
  {
    id: 'firebase',
    title: 'إعدادات Firebase',
    icon: 'Database',
    permissionKey: 'firebase',
    availableActions: [],
  },
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
  biometric: makeEditWithActions(['create', 'update', 'delete']),
  attendance: makeEditWithActions(['create', 'update', 'delete', 'export']),
  requests: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  rules: 'read',
  quality: 'read',
  hrDeductions: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  travel: 'read',
  reports: { level: 'edit', actions: { export: true } },
  dashboard: 'none',
  firebase: 'none',
};

export const MANAGER_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: makeEditWithActions(['create', 'update', 'delete', 'approve']),
  rules: 'none',
  quality: 'read',
  hrDeductions: 'read',
  travel: 'read',
  reports: { level: 'edit', actions: { export: true } },
  dashboard: 'none',
  firebase: 'none',
};

export const DEFAULT_PERMISSIONS: PermissionsMap = {
  home: 'read',
  employees: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: 'read',
  rules: 'none',
  quality: 'none',
  hrDeductions: 'none',
  travel: 'read',
  reports: 'read',
  dashboard: 'none',
  firebase: 'none',
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
