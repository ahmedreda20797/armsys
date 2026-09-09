// src/config/permissions.ts
// Action-level permission system

export type PermissionLevel = 'none' | 'read' | 'edit';

export type ActionKey = 'create' | 'update' | 'delete' | 'export' | 'approve' | 'upload' | 'override';

export interface PageActions {
  [key: string]: ActionKey[];
}

/**
 * DATA SCOPE (Part K — Milestone 10 foundation, ACTIVATED by M0.3).
 *
 * A scope answers "on WHOSE data may the user act?" while the level
 * answers "what may the user do?". Scopes are resolved against the
 * organization tree by src/lib/scope — this type only lives here
 * because it is carried ON the permission entry (one map, one
 * resolver, no second permission system).
 *
 *   all         — every record in the system
 *   department  — the viewer's department subtree (org tree)
 *   team        — the viewer's team subtree (org tree)
 *   subtree     — subtrees of nodes the viewer MANAGES (managerUserId)
 *   assigned    — records/employees explicitly assigned to the viewer
 *   own         — only the viewer's own employee record (requires the
 *                 optional user ↔ employee linkage)
 *
 * Vocabulary mapping to the M0.3 canonical model: all = ALL,
 * department/team = DEPARTMENT/TEAM (nearest typed ancestor in the
 * generic-depth tree — a "branch" is any intermediate node, its
 * subtree resolves identically), own = SELF, subtree/assigned are
 * assignment-driven variants the existing architecture already had.
 *
 * DEFAULT (M0.3 — fail-closed): a NON-ADMIN entry without a scope
 * resolves to FAIL_CLOSED_SCOPE ('own'), never silently to 'all'.
 * Resolution precedence: admin bypass → explicit entry scope
 * (stored / position / preset, see resolveEffectivePermissions'
 * scope-tier inheritance) → fail-closed.
 */
export type DataScope = 'all' | 'department' | 'team' | 'subtree' | 'assigned' | 'own';

const DATA_SCOPES: ReadonlySet<string> = new Set(['all', 'department', 'team', 'subtree', 'assigned', 'own']);

/**
 * The scope applied when a non-admin's scope cannot be resolved from
 * any tier (M0.3 DEFAULT SCOPE SAFETY). 'own' is the most restrictive
 * value in the vocabulary: without the optional user ↔ employee
 * linkage the scope engine resolves it to an EMPTY set.
 */
export const FAIL_CLOSED_SCOPE: DataScope = 'own';

export interface PagePermission {
  level: PermissionLevel;
  actions?: Partial<Record<ActionKey, boolean>>;
  /** Data scope for this page (defaults to 'all' — see DataScope). */
  scope?: DataScope;
  /**
   * SECTION-LEVEL overrides (Milestone 10 foundation): restrict a
   * section INSIDE a page without hiding the whole page. Keys are
   * section ids from PAGE_SECTIONS; values use the SAME level
   * vocabulary. A section without an entry inherits the page level,
   * and a page level of 'none' always wins over any section entry.
   */
  sections?: Partial<Record<string, PermissionLevel>>;
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
  // ── KPI Reporting Layer (Phase 2): read-only reporting over the
  //    existing KPI Framework; 'export' gates the Excel path. Safe
  //    default: explicitly granted per role preset below, 'none' for
  //    the generic role (see the organization-page doctrine).
  { id: 'kpiReports', title: 'تقارير KPI', icon: 'FileBarChart', permissionKey: 'kpiReports', availableActions: ['export'], groupId: 'quality_ctrl' },
  { id: 'qualityAuditLog', title: 'سجل مراجعة الجودة', icon: 'ScrollText', permissionKey: 'qualityAuditLog', availableActions: [], groupId: 'quality_ctrl' },
  // ── Smart Quality Report (Phase 4): a READ-ONLY presentation layer
  //    over the existing Performance Intelligence dataset. Mounts
  //    under the SAME 'kpiReports' permission key — existing role
  //    grants apply unchanged (same doctrine as
  //    qualityDeductionsReport / 'reports' above). No new permission
  //    system, no server-side changes.
  { id: 'smartQualityReport', title: 'تقرير الجودة الذكي', icon: 'FileSearch', permissionKey: 'kpiReports', availableActions: ['export'], groupId: 'quality_ctrl' },
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
  // ── Organization & Positions (Milestone 10) ──
  // SAFE DEFAULT: only the computed ADMIN preset grants this page.
  // Every other preset explicitly denies it below — a newly introduced
  // page must never be exposed to anyone by accident (Safe Defaults).
  { id: 'organization', title: 'الهيكل التنظيمي', icon: 'Network', permissionKey: 'organization', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  { id: 'workflowDesigner', title: 'مصمم المسارات', icon: 'Workflow', permissionKey: 'workflowDesigner', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  { id: 'rulesEngine', title: 'الأتمتة والقواعد', icon: 'Zap', permissionKey: 'rulesEngine', availableActions: ['create', 'update', 'delete'], groupId: 'settings' },
  // §14: the standalone 'firebase' settings page was REMOVED — Firebase
  // configuration itself (admin SDK, RTDB) is unchanged; it simply has
  // no in-app administration surface anymore.
  // ── Month close / KPI settings (Phase 1) ──
  { id: 'monthClose', title: 'إغلاق الشهر', icon: 'CalendarCog', permissionKey: 'monthClose', availableActions: ['approve'], groupId: 'settings' },
  { id: 'kpiSettings', title: 'إعدادات محرك الأداء', icon: 'Settings2', permissionKey: 'kpiSettings', availableActions: ['update'], groupId: 'settings' },
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
  // M0.3 scope: 'all' — the HR preset grants FULL workforce
  // administration (create/update/delete/export). Workforce
  // administration is inherently organization-wide; a narrower scope
  // would contradict the create/delete authority this same entry
  // already grants.
  employees: { ...makeEditWithActions(['create', 'update', 'delete', 'export']), scope: 'all' },
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
  // KPI reports (Phase 2) — read-only for HR (view + print, no export)
  kpiReports: 'read',
  qualityAuditLog: 'none',
  monthClose: 'none',
  kpiSettings: 'none',
  // Organization (Milestone 10) — admin-only by default (safe default)
  organization: 'none',
};

export const MANAGER_PERMISSIONS: PermissionsMap = {
  home: 'read',
  // M0.3 scope: 'subtree' — assignment-driven, NOT role→data. The
  // manager's actual reach is the union of org nodes whose
  // managerUserId is this user (OrgNode.managerUserId is the ONLY
  // manager relationship in the data model) ∪ their own linked
  // record. A manager of one team gets that team; of a department,
  // its whole subtree; of nothing, the fail-closed minimum. Role and
  // organizational assignment stay separate concepts.
  employees: { level: 'read', scope: 'subtree' },
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
  // KPI reports (Phase 2) — management visibility + Excel export
  kpiReports: makeEditWithActions(['export']),
  qualityAuditLog: 'read',
  monthClose: makeEditWithActions(['approve']),
  // Manager may view and update KPI settings (level 'edit' grants read + update)
  kpiSettings: makeEditWithActions(['update']),
  // Organization (Milestone 10) — admin-only by default (safe default)
  organization: 'none',
};

export const QUALITY_PERMISSIONS: PermissionsMap = {
  home: 'read',
  // M0.3 scope: 'all' — the quality function monitors the whole
  // workforce by construction: this same preset grants observation /
  // follow-up / CAPA creation against any employee and read access to
  // the organization-wide KPI dashboard. Scoping quality below 'all'
  // would break every one of those org-wide workflows.
  employees: { level: 'read', scope: 'all' },
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
  // KPI reports (Phase 2) — the Quality Department generates the
  // employee/monthly/MTD/historical reports (spec: quality users get
  // Quality KPI reporting incl. export)
  kpiReports: makeEditWithActions(['export']),
  qualityAuditLog: 'read',
  monthClose: 'none',
  kpiSettings: 'none',
  // Organization (Milestone 10) — admin-only by default (safe default)
  organization: 'none',
};

export const DEFAULT_PERMISSIONS: PermissionsMap = {
  home: 'read',
  // M0.3 scope: deliberately UNCONFIGURED. The generic 'user' role
  // has no organizational function over employee records, and no
  // business configuration in this codebase evidence org-wide
  // employee visibility for it — so it falls through to the
  // fail-closed default (FAIL_CLOSED_SCOPE) rather than inheriting
  // 'all'. The page permission stays 'read': permission and scope
  // remain separate axes.
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
  // KPI reports (Phase 2) — not part of the generic default role
  kpiReports: 'none',
  qualityAuditLog: 'none',
  monthClose: 'none',
  kpiSettings: 'none',
  // Organization (Milestone 10) — admin-only by default (safe default)
  organization: 'none',
};

// Migrate old string permissions to new format
export function migratePermission(value: string | PagePermission | undefined): PagePermission {
  if (!value) return { level: 'none', actions: {} };
  if (typeof value === 'object' && 'level' in value) {
    const perm = value as PagePermission;
    // Validate the optional scope/sections extensions: an unknown
    // scope value is DROPPED (fail-safe to the 'all' default) rather
    // than trusted. Invalid section entries are ignored by
    // resolveSectionAccess for the same reason.
    if (perm.scope !== undefined && !DATA_SCOPES.has(perm.scope)) {
      return { ...perm, scope: undefined };
    }
    return perm;
  }
  // Old format: 'none' | 'read' | 'edit'
  return { level: value as PermissionLevel, actions: {} };
}

/**
 * Resolve a user's EFFECTIVE permissions from their role, their
 * optional POSITION template, and their stored per-user permission
 * map.
 *
 * This is the SINGLE resolution rule used by every consumer (client
 * AuthContext, server verifyPermission, Control Panel editor):
 *
 *   effective = rolePreset
 *               overridden by positionTemplate (when the user holds a
 *               position with a permission template)
 *               overridden by stored per-user entries
 *
 * Semantics:
 *   • A key MISSING from the stored map falls back to the position
 *     template, and then to the role preset — users created before a
 *     page existed inherit their role's grant.
 *   • An explicit stored entry ALWAYS wins, including 'none' — an admin
 *     restriction or grant persists regardless of the preset/template.
 *     (The stored map is the PERSONAL override tier: it outranks both
 *     the position template and the role.)
 *   • positionTemplate is optional and omitted by every pre-Milestone-10
 *     caller — resolution is byte-identical when it is absent.
 *   • Admin role users bypass permission lookups entirely at the
 *     enforcement sites (unchanged behavior).
 *   • DATA SCOPE (M0.3): an overriding tier that does NOT carry a
 *     scope INHERITS the lower tier's scope (see mergePermissionTier)
 *     so a stored/position entry saved before scopes existed can
 *     never silently strip the role's configured scope. Scope chain:
 *     stored.scope → position.scope → rolePreset.scope → fail-closed
 *     (resolvePageScope). Levels/actions/sections still replace the
 *     lower tier exactly as before.
 */
export function resolveEffectivePermissions(
  role: string | null | undefined,
  stored: Record<string, unknown> | null | undefined,
  positionTemplate?: Record<string, unknown> | null,
): PermissionsMap {
  let merged = getPermissionsForRole(role || 'user');
  if (positionTemplate && typeof positionTemplate === 'object') {
    merged = mergePermissionTier(merged, positionTemplate as PermissionsMap);
  }
  if (!stored || typeof stored !== 'object') return merged;
  return mergePermissionTier(merged, stored as PermissionsMap);
}

/**
 * Tier merge: entry-level replacement (legacy semantics) with ONE
 * M0.3 refinement — the DATA SCOPE inherits from the lower tier when
 * the overriding tier does not carry one. Without this, every stored
 * override saved before M0.3 (which is all of them — they predate
 * scopes) would strip the role preset's scope and fail the user
 * closed. An explicitly configured scope on ANY tier still wins
 * against the tiers below it. Entries with no scope on any tier are
 * merged byte-identically to the pre-M0.3 spread for objects; legacy
 * STRING overrides gain the inherited scope only when a lower tier
 * actually carries one (migratePermission-equivalent shape).
 */
function mergePermissionTier(lower: PermissionsMap, upper: PermissionsMap): PermissionsMap {
  const out: PermissionsMap = { ...lower, ...upper };
  for (const key of Object.keys(upper)) {
    const upperEntry = upper[key] as PagePermission | PermissionLevel | undefined;
    if (upperEntry === undefined || upperEntry === null) continue;
    const lowerEntry = lower[key] as PagePermission | PermissionLevel | undefined;
    const lowerScope = typeof lowerEntry === 'object' && lowerEntry !== null ? lowerEntry.scope : undefined;
    // Only a VALID scope survives the tier chain — junk from a
    // hand-edited map is dropped exactly like migratePermission does.
    if (lowerScope === undefined || !DATA_SCOPES.has(lowerScope)) continue;
    if (typeof upperEntry === 'object') {
      if (upperEntry.scope === undefined || upperEntry.scope === null) {
        out[key] = { ...upperEntry, scope: lowerScope };
      }
    } else {
      out[key] = { level: upperEntry, actions: {}, scope: lowerScope };
    }
  }
  return out;
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

// ══════════════════════════════════════════════════════════════
//  Field-level access — Milestone 9 (Granular Access Control)
//
//  Extends the page+action model with FIELD granularity while
//  reusing the same permission keys and the same effective
//  resolution (resolveEffectivePermissions). There is no second
//  permission system: a field's access derives from its page entry
//  unless the field is listed as sensitive below.
//
//  Sensitive fields are REAL fields that exist today and carry
//  personal data: employees.mobile. (A salary field does NOT exist
//  in this system — payroll is a future milestone; when it lands,
//  it registers here. Do not invent fields.)
// ══════════════════════════════════════════════════════════════

export type FieldAccess = 'hidden' | 'read-only' | 'editable';

/**
 * Sensitive fields per page key. A listed field is only returned /
 * shown when the user has EDIT level on the page; read-level users
 * get 'hidden' (the backend must strip it — hiding in CSS is not
 * enough, see stripRestrictedFields).
 */
export const SENSITIVE_FIELDS: Record<string, Record<string, true>> = {
  employees: { mobile: true },
};

/**
 * Resolve a single field's access from the EFFECTIVE permission map
 * (the same map usePermissions / verifyPermission already produce).
 *
 *   page level 'none'          → 'hidden'    (whole page denied)
 *   sensitive field + 'read'   → 'hidden'    (restricted content)
 *   sensitive field + 'edit'   → 'editable'
 *   normal field + 'read'      → 'read-only'
 *   normal field + 'edit'      → 'editable'
 */
export function resolveFieldAccess(
  permissions: PermissionsMap | null | undefined,
  pageKey: string,
  field: string
): FieldAccess {
  const perm = migratePermission(permissions?.[pageKey]);
  if (perm.level === 'none') return 'hidden';

  if (SENSITIVE_FIELDS[pageKey]?.[field]) {
    return perm.level === 'edit' ? 'editable' : 'hidden';
  }
  return perm.level === 'edit' ? 'editable' : 'read-only';
}

/**
 * Server-side serializer: remove fields the viewer must not see so
 * restricted data never reaches the browser (Part J — the backend is
 * authoritative; frontend hiding is UX only). Returns a new object;
 * records without restricted fields pass through untouched.
 */
export function stripRestrictedFields<T extends Record<string, any>>(
  record: T,
  pageKey: string,
  permissions: PermissionsMap | null | undefined
): T {
  const sensitive = SENSITIVE_FIELDS[pageKey];
  if (!sensitive) return record;
  let stripped = false;
  const out: Record<string, any> = { ...record };
  for (const field of Object.keys(sensitive)) {
    if (resolveFieldAccess(permissions, pageKey, field) === 'hidden') {
      delete out[field];
      stripped = true;
    }
  }
  return stripped ? (out as T) : record;
}

// ══════════════════════════════════════════════════════════════
//  DATA SCOPE — Milestone 10 foundation, ACTIVATED by M0.3
//
//  The scope vocabulary and its carrier field are defined above
//  (DataScope / PagePermission.scope). Resolution against the
//  organization tree lives in src/lib/scope — it consumes the
//  effective map produced by the SAME resolver above. The helpers
//  below extract the configured scope for a page; callers pass the
//  viewer's role so admin always resolves to 'all'. Since M0.3 the
//  role presets carry evidence-based scopes for the employees page
//  and a missing non-admin scope FAILS CLOSED (never 'all').
// ══════════════════════════════════════════════════════════════

/**
 * Where a resolved scope came from — for debugging and audit trails
 * (structured scope decision, M0.3). Never exposed to normal users.
 */
export type ScopeResolutionSource = 'admin' | 'configured' | 'fail-closed';

/** Structured result of the scope decision for one page/viewer. */
export interface ScopeResolution {
  scope: DataScope;
  source: ScopeResolutionSource;
  /** True when an explicit entry (any tier) carried this scope. */
  configured: boolean;
}

/**
 * Explain the DATA SCOPE decision for a page from the EFFECTIVE
 * permission map. Resolution precedence (M0.3):
 *
 *   admin role                  → 'all'      (existing full-access bypass)
 *   entry carries a valid scope → that scope (stored / position /
 *                                 preset tier — the effective entry is
 *                                 already the tier winner)
 *   anything else (non-admin)   → FAIL_CLOSED_SCOPE — never 'all'
 *
 * 'configured' cannot distinguish the stored/position/preset tier
 * because the effective map is already merged; use
 * explainPageAccess for the full tier trace.
 */
export function explainScopeResolution(
  permissions: PermissionsMap | null | undefined,
  pageKey: string,
  role?: string | null,
): ScopeResolution {
  if (role === 'admin') return { scope: 'all', source: 'admin', configured: false };
  const perm = migratePermission(permissions?.[pageKey]);
  if (perm.scope !== undefined) return { scope: perm.scope, source: 'configured', configured: true };
  return { scope: FAIL_CLOSED_SCOPE, source: 'fail-closed', configured: false };
}

/**
 * Resolve the configured DATA SCOPE for a page from the EFFECTIVE
 * permission map. M0.3 DEFAULT SCOPE SAFETY: a non-admin entry
 * WITHOUT a scope resolves to FAIL_CLOSED_SCOPE ('own' — empty for
 * viewers without the employee linkage), NOT to 'all'. A non-admin
 * must never gain organization-wide visibility because scope
 * resolution produced no answer.
 */
export function resolvePageScope(
  permissions: PermissionsMap | null | undefined,
  pageKey: string,
  role?: string | null,
): DataScope {
  return explainScopeResolution(permissions, pageKey, role).scope;
}

// ══════════════════════════════════════════════════════════════
//  SECTION PERMISSIONS — Milestone 10 foundation
//
//  A page is not a monolith: a user may see the Employee profile
//  but not its HR/salary sections. Section overrides ride ON the
//  page's permission entry (PagePermission.sections) so there is
//  no second storage format and no second resolver.
//
//  Resolution rule:
//    page level 'none'        → section 'none' (page gate wins)
//    sections[id] set         → that level (may only RESTRICT or
//                               grant within the page ceiling — an
//                               explicit entry replaces inheritance)
//    no entry for the section → inherit the page level
//
//  FOUNDATION ONLY — NOT WIRED: no page renders through this rule
//  yet. The registry below documents the known sections of the
//  Employee 360 overlay so future wiring has stable ids; adding a
//  section here changes nothing until a page consumes it.
// ══════════════════════════════════════════════════════════════

/** Known sections per page key (stable ids for future page wiring). */
export const PAGE_SECTIONS: Record<string, ReadonlyArray<{ id: string; title: string }>> = {
  employee360: [
    { id: 'basicInfo', title: 'البيانات الأساسية' },
    { id: 'attendance', title: 'الحضور والانصراف' },
    { id: 'quality', title: 'الجودة' },
    { id: 'hrDeductions', title: 'خصومات الموارد البشرية' },
    { id: 'requests', title: 'الطلبات' },
    { id: 'followUps', title: 'المتابعات' },
    { id: 'travel', title: 'السفر' },
    { id: 'complaints', title: 'الشكاوى' },
    { id: 'capa', title: 'كابا' },
    { id: 'timeline', title: 'السجل الزمني' },
  ],
};

/**
 * Resolve a SECTION's access level from the EFFECTIVE map. Uses the
 * same PermissionLevel vocabulary — sections cannot exceed the page
 * gate ('none' page hides every section) and inherit the page level
 * when no override is stored.
 */
export function resolveSectionAccess(
  permissions: PermissionsMap | null | undefined,
  pageKey: string,
  sectionId: string,
): PermissionLevel {
  const perm = migratePermission(permissions?.[pageKey]);
  if (perm.level === 'none') return 'none';
  const override = perm.sections?.[sectionId];
  if (override === 'none' || override === 'read' || override === 'edit') return override;
  return perm.level;
}

// ══════════════════════════════════════════════════════════════
//  EXPLAINABLE AUTHORIZATION — Milestone 10
//
//  "WHY can this user see this?" Every authorization decision can
//  be traced to its source tier. This is the foundation for the
//  Permission Simulator, the Effective Access Inspector and the
//  Permission Conflict Detector: pure functions over the same
//  inputs as resolveEffectivePermissions — no execution, no side
//  effects, identical answer to the enforcement path.
// ══════════════════════════════════════════════════════════════

export type AccessSource = 'admin' | 'stored' | 'position' | 'role' | 'default-deny';

export interface AccessExplanation {
  pageKey: string;
  level: PermissionLevel;
  scope: DataScope;
  /** True when the decision came from the admin bypass, not the map. */
  isAdminBypass: boolean;
  /** Ordered tiers that carried an explicit entry for this page. */
  sources: Array<{ source: AccessSource; level: PermissionLevel }>;
  /** The tier that produced the effective level. */
  winner: AccessSource;
  /** Human-readable Arabic trace. */
  reason: string;
}

const SOURCE_LABELS_AR: Record<AccessSource, string> = {
  admin: 'مدير النظام (تجاوز كامل)',
  stored: 'تجاوز محفوظ للمستخدم',
  position: 'قالب الوظيفة',
  role: 'دور المستخدم',
  'default-deny': 'الرفض الافتراضي',
};

/**
 * Explain (and thereby SIMULATE — pass any hypothetical inputs) why
 * a user would or would not access a page. Returns exactly the same
 * effective level resolveEffectivePermissions produces, plus the
 * tier-by-tier trace. When multiple tiers disagree the trace IS the
 * conflict report: the winner is always stored → position → role,
  * matching the resolver.
 */
export function explainPageAccess(
  role: string | null | undefined,
  stored: Record<string, unknown> | null | undefined,
  pageKey: string,
  positionTemplate?: Record<string, unknown> | null,
): AccessExplanation {
  if (role === 'admin') {
    return {
      pageKey,
      level: 'edit',
      scope: 'all',
      isAdminBypass: true,
      sources: [{ source: 'admin', level: 'edit' }],
      winner: 'admin',
      reason: 'مدير النظام: تجاوز كامل لجميع فحوصات الصلاحيات',
    };
  }

  const sources: Array<{ source: AccessSource; level: PermissionLevel }> = [];
  const hasEntry = (m: Record<string, unknown> | null | undefined) =>
    Boolean(m && typeof m === 'object' && pageKey in m);

  const rolePreset = getPermissionsForRole(role || 'user');
  if (hasEntry(rolePreset)) {
    sources.push({ source: 'role', level: migratePermission(rolePreset[pageKey]).level });
  }
  if (hasEntry(positionTemplate)) {
    sources.push({ source: 'position', level: migratePermission((positionTemplate as Record<string, unknown>)[pageKey] as PagePermission | PermissionLevel).level });
  }
  if (hasEntry(stored)) {
    sources.push({ source: 'stored', level: migratePermission((stored as Record<string, unknown>)[pageKey] as PagePermission | PermissionLevel).level });
  }

  const effective = resolveEffectivePermissions(role, stored, positionTemplate);
  const level = migratePermission(effective[pageKey]).level;
  const scope = resolvePageScope(effective, pageKey, role);

  let winner: AccessSource = 'default-deny';
  if (hasEntry(stored)) winner = 'stored';
  else if (hasEntry(positionTemplate)) winner = 'position';
  else if (hasEntry(rolePreset)) winner = 'role';

  const reason = level === 'none'
    ? `مرفوض — لا يوجد أي مصدر صلاحية يمنح "${pageKey}" (الافتراضي: رفض)`
    : `مسموح (${level}) — المصدر الفاصل: ${SOURCE_LABELS_AR[winner]}${sources.length > 1 ? ` (طبقات: ${sources.map(s => `${SOURCE_LABELS_AR[s.source]}=${s.level}`).join('، ')})` : ''}`;

  return { pageKey, level, scope, isAdminBypass: false, sources, winner, reason };
}

export interface PermissionDiffEntry {
  pageKey: string;
  before: PermissionLevel;
  after: PermissionLevel;
  /** 'added' = none→X, 'removed' = X→none, 'changed' = X→Y. */
  change: 'added' | 'removed' | 'changed';
}

/**
 * Configuration diff / change preview: compare two effective maps and
 * describe exactly what access appears, disappears or changes. Pure —
 * used before saving permission edits so an administrator can review
 * the impact of a configuration change (foundation for the future
 * Permission Change Preview UI).
 */
export function diffPermissionMaps(
  before: PermissionsMap | null | undefined,
  after: PermissionsMap | null | undefined,
): PermissionDiffEntry[] {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const entries: PermissionDiffEntry[] = [];
  for (const pageKey of keys) {
    const b = migratePermission(before?.[pageKey]).level;
    const a = migratePermission(after?.[pageKey]).level;
    if (b === a) continue;
    entries.push({
      pageKey,
      before: b,
      after: a,
      change: b === 'none' ? 'added' : a === 'none' ? 'removed' : 'changed',
    });
  }
  // Stable, readable order: removals first, then additions, then changes
  const order = { removed: 0, added: 1, changed: 2 } as const;
  return entries.sort((x, y) => order[x.change] - order[y.change] || x.pageKey.localeCompare(y.pageKey));
}
