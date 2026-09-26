// ══════════════════════════════════════════════════════════════
//  Canonical Query Key Factory — §CACHE-KEYS
//
//  Deterministic, collision-free cache identities for every domain.
//  Key contracts (§6/§16/§17/§43):
//    • Domain first — `['domain', ...identity]`.
//    • Every parameter that changes the SERVER RESPONSE (period,
//      metric dimension, filters, pagination, scope subject) is part
//      of the key, so two different views can never collide.
//    • Period-aware keys carry the month (YYYY-MM) — August and
//      September never share an entry.
//    • The travel/deal metric dimension (tab → status family, month →
//      closedAt/departureDate period) is already serialized into the
//      existing travel key; this module preserves that shape exactly.
//    • NO user id inside keys — user isolation is structural, enforced
//      by clearing the cache on identity change (lib/cache/cache-identity).
//      Embedding ids in every key would fragment the cache and break
//      every existing consumer for no added safety.
//
//  Existing shapes (use-queries.ts / use-kpi-queries.ts) are preserved
//  byte-for-byte — this factory EXTENDS them and becomes their home.
// ══════════════════════════════════════════════════════════════

/** Validation month key (YYYY-MM) or '' for "no period". */
export type MonthKey = string;

export const queryKeys = {
  // ── Home / Dashboard ─────────────────────────────────────────
  homeStats: ['home', 'stats'] as const,

  // ── Employees ────────────────────────────────────────────────
  employees: ['employees'] as const,
  employee: (id: string) => ['employees', id] as const,
  /** Lightweight org-node list for the employee form picker. */
  orgNodesForAssignment: ['employees', 'org-nodes'] as const,

  // ── Organization ─────────────────────────────────────────────
  organization: ['organization'] as const,
  positions: ['positions'] as const,

  // ── dashboard/users (scoped to the requesting caller server-side) ──
  /** `basic` variant (id/name/department) vs full management payload. */
  dashboardUsers: (variant: 'basic' | 'full' = 'full') => ['dashboard', 'users', variant] as const,

  // ── Attendance ───────────────────────────────────────────────
  attendance: ['attendance'] as const,
  attendanceList: ['attendance', 'list'] as const,

  // ── Requests ─────────────────────────────────────────────────
  requests: ['requests'] as const,
  requestsList: ['requests', 'list'] as const,

  // ── Rules ────────────────────────────────────────────────────
  rules: ['rules'] as const,
  rulesList: ['rules', 'list'] as const,
  ruleLogs: ['ruleLogs'] as const,

  // ── Quality (legacy deductions view) ─────────────────────────
  quality: ['quality'] as const,
  /** `includeArchived` is part of the identity — archived and live
   *  views must not collide (§43). */
  qualityList: (includeArchived: boolean) => ['quality', 'list', includeArchived] as const,

  // ── Travel / Deals ───────────────────────────────────────────
  // Identity includes the metric/status dimension (tab) and period
  // (month) — §16/§17: created/closed/travel views never collide.
  travel: ['travel'] as const,

  // ── Biometrics ───────────────────────────────────────────────
  biometrics: ['biometrics'] as const,
  biometricsList: ['biometrics', 'list'] as const,

  // ── Reports (legacy monthly generator page) ──────────────────
  reports: (month?: string) => ['reports', month] as const,

  // ── Notifications ────────────────────────────────────────────
  notifications: ['notifications'] as const,

  // ── Follow-ups ───────────────────────────────────────────────
  followUps: ['followUps'] as const,
  /** Full operational list (+employeeRiskScores) used by the page. */
  followUpsList: ['followUps', 'list'] as const,
  followUpsByEmployee: (employeeId: string) => ['followUps', 'employee', employeeId] as const,

  // ── CAPA ─────────────────────────────────────────────────────
  capaCases: ['capaCases'] as const,
  capaList: ['capaCases', 'list'] as const,
  capaCase: (id: string) => ['capaCases', id] as const,

  // ── Complaints ───────────────────────────────────────────────
  complaints: ['complaints'] as const,

  // ── Knowledge Base ───────────────────────────────────────────
  knowledgeBase: ['knowledgeBase'] as const,

  // ── HR Deductions ────────────────────────────────────────────
  hrDeductions: ['hrDeductions'] as const,
  hrDeductionsList: (includeArchived: boolean) => ['hrDeductions', 'list', includeArchived] as const,

  // ── Risk Center ──────────────────────────────────────────────
  /** Page-level risk snapshot — month-aware (§16). The bare
   *  ['riskCenter'] prefix stays reserved for the AOCC poll hook. */
  riskCenter: ['riskCenter'] as const,
  riskCenterMonth: (month: MonthKey) => ['riskCenter', 'month', month || 'current'] as const,

  // ── Employee 360 (overlay) — subject-aware keys (§39) ────────
  employee360: (employeeId: string) => ['employee360', employeeId] as const,
  employeePerformance: (employeeId: string) => ['employee-performance', employeeId] as const,

  // ── Profile / preferences ────────────────────────────────────
  profile: ['profile'] as const,
  userPreferences: ['userPreferences'] as const,
};

export type QueryKeyFactory = typeof queryKeys;
