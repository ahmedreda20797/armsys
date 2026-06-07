// src/config/permissions.ts

export interface PageConfig {
  id: string;
  name: string;
  nameAr: string;
  path: string;
  icon: string; // lucide icon name
  order: number;
}

export const APP_PAGES: PageConfig[] = [
  { id: 'home', name: 'Home', nameAr: 'الرئيسية', path: 'home', icon: 'LayoutDashboard', order: 0 },
  { id: 'employees', name: 'Employees', nameAr: 'الموظفين', path: 'employees', icon: 'Users', order: 1 },
  { id: 'biometric', name: 'Biometric', nameAr: 'البصمة', path: 'biometric', icon: 'Fingerprint', order: 2 },
  { id: 'attendance', name: 'Attendance', nameAr: 'الحضور', path: 'attendance', icon: 'Clock', order: 3 },
  { id: 'requests', name: 'Requests', nameAr: 'الطلبات', path: 'requests', icon: 'FileText', order: 4 },
  { id: 'rules', name: 'Deduction Rules', nameAr: 'قواعد الخصم', path: 'rules', icon: 'Scale', order: 5 },
  { id: 'quality', name: 'Quality', nameAr: 'الجودة', path: 'quality', icon: 'Award', order: 6 },
  { id: 'travel', name: 'Travel', nameAr: 'السفر', path: 'travel', icon: 'Plane', order: 7 },
  { id: 'reports', name: 'Reports', nameAr: 'التقارير', path: 'reports', icon: 'BarChart3', order: 8 },
  { id: 'dashboard', name: 'Dashboard', nameAr: 'لوحة التحكم', path: 'dashboard', icon: 'Settings', order: 9 },
  { id: 'firebase', name: 'Firebase', nameAr: 'إعدادات Firebase', path: 'firebase', icon: 'Database', order: 10 },
];

export type PermissionLevel = 'none' | 'read' | 'edit';

export const DEFAULT_PERMISSIONS: Record<string, PermissionLevel> = {
  home: 'read',
  employees: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: 'read',
  rules: 'none',
  quality: 'none',
  travel: 'read',
  reports: 'read',
  dashboard: 'none',
  firebase: 'none',
};

export const ADMIN_PERMISSIONS: Record<string, PermissionLevel> = {
  home: 'edit',
  employees: 'edit',
  biometric: 'edit',
  attendance: 'edit',
  requests: 'edit',
  rules: 'edit',
  quality: 'edit',
  travel: 'edit',
  reports: 'edit',
  dashboard: 'edit',
  firebase: 'edit',
};

export const HR_PERMISSIONS: Record<string, PermissionLevel> = {
  home: 'read',
  employees: 'edit',
  biometric: 'edit',
  attendance: 'edit',
  requests: 'edit',
  rules: 'read',
  quality: 'read',
  travel: 'read',
  reports: 'read',
  dashboard: 'none',
  firebase: 'none',
};

export const MANAGER_PERMISSIONS: Record<string, PermissionLevel> = {
  home: 'read',
  employees: 'read',
  biometric: 'read',
  attendance: 'read',
  requests: 'edit',
  rules: 'none',
  quality: 'read',
  travel: 'read',
  reports: 'read',
  dashboard: 'none',
  firebase: 'none',
};
