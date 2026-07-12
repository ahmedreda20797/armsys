// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — Decision Store (Zustand + localStorage)
//
//  Manages decision lifecycle states, selection, filters, grouping,
//  and bulk actions. Decisions themselves are recomputed each load
//  (they are derived from the operational pipeline), but their
//  lifecycle state (status, assignee, history) survives across
//  sessions via localStorage — keyed per user so each operator sees
//  their own workflow state.
//
//  No backend changes. No new API calls. Pure client-side state.
// ═══════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type {
  Decision,
  DecisionStatus,
  DecisionStateEntry,
  DecisionStateTransition,
  DecisionFilters,
  DecisionGroupKey,
  DecisionSortKey,
  BulkActionType,
  DecisionGroup,
} from '@/lib/aocc/decision-types';
import type { PriorityLevel, SourceModule } from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  localStorage persistence (per-user)
// ═══════════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'erp_decision_states_';

function getStorageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId || 'anonymous'}`;
}

function loadStates(userId: string | null): Record<string, DecisionStateEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveStates(userId: string | null, states: Record<string, DecisionStateEntry>): void {
  if (typeof window === 'undefined') return;
  // Debounce writes to avoid thrashing on rapid state changes
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(getStorageKey(userId), JSON.stringify(states));
    } catch {
      // Storage full or unavailable — silently skip; state is transient anyway
    }
  }, 500);
}

// ═══════════════════════════════════════════════════════════════
//  Default filters
// ═══════════════════════════════════════════════════════════════

const DEFAULT_FILTERS: DecisionFilters = {
  search: '',
  priorities: [],
  types: [],
  departments: [],
  modules: [],
  statuses: [],
  assignees: [],
  timeWindow: 'all',
};

// ═══════════════════════════════════════════════════════════════
//  Store interface
// ═══════════════════════════════════════════════════════════════

interface DecisionStoreState {
  // ── Persisted lifecycle state ──
  states: Record<string, DecisionStateEntry>;
  userId: string | null;

  // ── Selection (transient) ──
  selectedIds: Set<string>;

  // ── Inbox controls (transient) ──
  filters: DecisionFilters;
  groupBy: DecisionGroupKey;
  sortBy: DecisionSortKey;
  commandBarOpen: boolean;

  // ── Lifecycle actions ──
  init: (userId: string | null) => void;
  getStatus: (decisionId: string) => DecisionStatus;
  getAssignee: (decisionId: string) => { id: string | null; name: string | null };
  transitionStatus: (decisionId: string, to: DecisionStatus, by: string, note?: string) => void;
  assign: (decisionId: string, assigneeId: string, assigneeName: string, by: string) => void;

  // ── Selection actions ──
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;

  // ── Bulk actions (Part 8) ──
  bulkAction: (
    type: BulkActionType,
    decisions: Decision[],
    by: string,
    options?: { assigneeId?: string; assigneeName?: string }
  ) => { count: number; label: string };

  // ── Filter / group / sort ──
  setFilter: <K extends keyof DecisionFilters>(key: K, value: DecisionFilters[K]) => void;
  toggleArrayFilter: <K extends 'priorities' | 'types' | 'departments' | 'modules' | 'statuses' | 'assignees'>(
    key: K,
    value: DecisionFilters[K][number]
  ) => void;
  resetFilters: () => void;
  setGroupBy: (key: DecisionGroupKey) => void;
  setSortBy: (key: DecisionSortKey) => void;
  setCommandBarOpen: (open: boolean) => void;

  // ── Derived selectors ──
  filterDecisions: (decisions: Decision[]) => Decision[];
  sortDecisions: (decisions: Decision[]) => Decision[];
  groupDecisions: (decisions: Decision[]) => DecisionGroup[];
}

// ═══════════════════════════════════════════════════════════════
//  Store implementation
// ═══════════════════════════════════════════════════════════════

export const useDecisionStore = create<DecisionStoreState>((set, get) => ({
  // ── Persisted state ──
  states: {},
  userId: null,

  // ── Selection ──
  selectedIds: new Set<string>(),

  // ── Inbox controls ──
  filters: { ...DEFAULT_FILTERS },
  groupBy: 'priority',
  sortBy: 'score',
  commandBarOpen: false,

  // ═══════════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════════

  init: (userId) => {
    const existing = get();
    if (existing.userId === userId) return; // already initialized for this user
    const states = loadStates(userId);
    set({ userId, states, selectedIds: new Set() });
  },

  getStatus: (decisionId) => {
    return get().states[decisionId]?.status ?? 'new';
  },

  getAssignee: (decisionId) => {
    const entry = get().states[decisionId];
    return { id: entry?.assigneeId ?? null, name: entry?.assigneeName ?? null };
  },

  transitionStatus: (decisionId, to, by, note) => {
    const states = { ...get().states };
    const existing = states[decisionId];
    const from: DecisionStatus = existing?.status ?? 'new';
    if (from === to) return;

    const transition: DecisionStateTransition = { from, to, at: new Date().toISOString(), by, note };
    states[decisionId] = {
      decisionId,
      status: to,
      assigneeId: existing?.assigneeId ?? null,
      assigneeName: existing?.assigneeName ?? null,
      history: [...(existing?.history ?? []), transition],
      updatedAt: new Date().toISOString(),
    };
    set({ states });
    saveStates(get().userId, states);
  },

  assign: (decisionId, assigneeId, assigneeName, by) => {
    const states = { ...get().states };
    const existing = states[decisionId] ?? {
      decisionId,
      status: 'new' as DecisionStatus,
      assigneeId: null,
      assigneeName: null,
      history: [],
      updatedAt: new Date().toISOString(),
    };
    const from = existing.status;
    const to: DecisionStatus = from === 'new' ? 'assigned' : from;
    const transition: DecisionStateTransition = {
      from,
      to,
      at: new Date().toISOString(),
      by,
      note: `تم التعيين لـ ${assigneeName}`,
    };
    states[decisionId] = {
      ...existing,
      assigneeId,
      assigneeName,
      status: to,
      history: [...existing.history, transition],
      updatedAt: new Date().toISOString(),
    };
    set({ states });
    saveStates(get().userId, states);
  },

  // ═══════════════════════════════════════════════════════════════
  //  Selection
  // ═══════════════════════════════════════════════════════════════

  toggleSelect: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  selectAll: (ids) => {
    set({ selectedIds: new Set(ids) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  isSelected: (id) => get().selectedIds.has(id),

  // ═══════════════════════════════════════════════════════════════
  //  Bulk Actions (Part 8 — 9 types)
  // ═══════════════════════════════════════════════════════════════

  bulkAction: (type, decisions, by, options) => {
    const selected = get().selectedIds;
    const targets = decisions.filter((d) => selected.has(d.id));

    if (targets.length === 0) return { count: 0, label: '' };

    const states = { ...get().states };

    for (const decision of targets) {
      const existing = states[decision.id];
      const from: DecisionStatus = existing?.status ?? 'new';
      let to: DecisionStatus = from;
      let note = '';

      switch (type) {
        case 'assign':
          if (options?.assigneeId) {
            to = from === 'new' ? 'assigned' : from;
            note = `تم التعيين لـ ${options.assigneeName || 'موظف'}`;
            states[decision.id] = {
              decisionId: decision.id,
              status: to,
              assigneeId: options.assigneeId,
              assigneeName: options.assigneeName || null,
              history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
              updatedAt: new Date().toISOString(),
            };
          }
          break;
        case 'review':
          to = 'acknowledged';
          note = 'مراجعة جماعية';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'close':
          to = 'resolved';
          note = 'إغلاق جماعي';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'notify':
          // Notify doesn't change status, just records the action
          note = 'تم إشعار المدير';
          states[decision.id] = {
            decisionId: decision.id,
            status: from,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to: from, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'escalate':
          to = 'escalated';
          note = 'تصعيد جماعي';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'open_capa':
          // Opens CAPA — marks as in_progress (the actual CAPA creation happens in the hook)
          to = 'in_progress';
          note = 'فتح كابا جماعي';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'create_followup':
          // Creates follow-up — marks as in_progress (actual creation in the hook)
          to = 'in_progress';
          note = 'إنشاء متابعة جماعية';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
        case 'export':
          // Export doesn't change status — just a no-op for lifecycle
          note = 'تصدير جماعي';
          break;
        case 'archive':
          to = 'archived';
          note = 'أرشفة جماعية';
          states[decision.id] = {
            decisionId: decision.id,
            status: to,
            assigneeId: existing?.assigneeId ?? null,
            assigneeName: existing?.assigneeName ?? null,
            history: [...(existing?.history ?? []), { from, to, at: new Date().toISOString(), by, note }],
            updatedAt: new Date().toISOString(),
          };
          break;
      }
    }

    set({ states });
    saveStates(get().userId, states);
    // Clear selection after bulk action (except export which keeps selection)
    if (type !== 'export') {
      set({ selectedIds: new Set() });
    }

    const labels: Record<BulkActionType, string> = {
      assign: 'تعيين',
      review: 'مراجعة',
      close: 'إغلاق',
      notify: 'إشعار',
      escalate: 'تصعيد',
      open_capa: 'فتح كابا',
      create_followup: 'متابعة',
      export: 'تصدير',
      archive: 'أرشفة',
    };

    return { count: targets.length, label: labels[type] };
  },

  // ═══════════════════════════════════════════════════════════════
  //  Filter / group / sort
  // ═══════════════════════════════════════════════════════════════

  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
  },

  toggleArrayFilter: (key, value) => {
    const current = get().filters[key] as any[];
    const exists = current.includes(value);
    set({
      filters: {
        ...get().filters,
        [key]: exists ? current.filter((v) => v !== value) : [...current, value],
      },
    });
  },

  resetFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },

  setGroupBy: (key) => set({ groupBy: key }),
  setSortBy: (key) => set({ sortBy: key }),
  setCommandBarOpen: (open) => set({ commandBarOpen: open }),

  // ═══════════════════════════════════════════════════════════════
  //  Derived selectors
  // ═══════════════════════════════════════════════════════════════

  filterDecisions: (decisions) => {
    const { filters, states } = get();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return decisions.filter((d) => {
      // Search
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const haystack = `${d.title} ${d.affectedEmployeeName ?? ''} ${d.affectedDepartment ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Priorities
      if (filters.priorities.length > 0 && !filters.priorities.includes(d.priority)) return false;
      // Types
      if (filters.types.length > 0 && !filters.types.includes(d.type)) return false;
      // Departments
      if (filters.departments.length > 0 && (!d.affectedDepartment || !filters.departments.includes(d.affectedDepartment))) return false;
      // Modules
      if (filters.modules.length > 0 && !filters.modules.some((m) => d.affectedModules.includes(m as SourceModule))) return false;
      // Statuses
      if (filters.statuses.length > 0) {
        const status = states[d.id]?.status ?? 'new';
        if (!filters.statuses.includes(status)) return false;
      }
      // Assignees
      if (filters.assignees.length > 0) {
        const assigneeId = states[d.id]?.assigneeId ?? 'unassigned';
        if (!filters.assignees.includes(assigneeId)) return false;
      }
      // Time window
      if (filters.timeWindow !== 'all') {
        const created = new Date(d.createdAt).getTime();
        const limit = filters.timeWindow === 'today' ? dayMs : 7 * dayMs;
        if (now - created > limit) return false;
      }
      return true;
    });
  },

  sortDecisions: (decisions) => {
    const { sortBy, states } = get();
    const priorityOrder: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusOrder: Record<DecisionStatus, number> = {
      new: 0, acknowledged: 1, assigned: 2, in_progress: 3, waiting: 4, escalated: 5, resolved: 6, dismissed: 7, archived: 8,
    };

    return [...decisions].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.score.overall - a.score.overall;
        case 'priority':
          return priorityOrder[a.priority] - priorityOrder[b.priority] || b.score.overall - a.score.overall;
        case 'dueDate': {
          const aT = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bT = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return aT - bT;
        }
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'confidence':
          return b.score.confidence - a.score.confidence;
        case 'impact': {
          const impactOrder: Record<string, number> = { severe: 0, high: 1, moderate: 2, low: 3, minimal: 4 };
          return impactOrder[a.businessImpact] - impactOrder[b.businessImpact];
        }
        default:
          return b.score.overall - a.score.overall;
      }
    });
  },

  groupDecisions: (decisions) => {
    const { groupBy, states } = get();
    if (groupBy === 'none') {
      return [{
        key: 'all',
        label: 'الكل',
        decisions,
        priority: decisions[0]?.priority ?? 'low',
      }];
    }

    const groups = new Map<string, Decision[]>();

    for (const d of decisions) {
      let key = 'other';
      switch (groupBy) {
        case 'priority':
          key = d.priority;
          break;
        case 'department':
          key = d.affectedDepartment || 'بدون قسم';
          break;
        case 'employee':
          key = d.affectedEmployeeName || 'بدون موظف';
          break;
        case 'manager':
          key = d.suggestedOwner || 'غير معيّن';
          break;
        case 'module':
          key = d.affectedModules[0] || 'other';
          break;
        case 'status':
          key = states[d.id]?.status ?? 'new';
          break;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }

    const priorityOrder: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    return Array.from(groups.entries()).map(([key, decs]) => {
      const worst = decs.reduce<PriorityLevel>(
        (worst, d) => (priorityOrder[d.priority] < priorityOrder[worst] ? d.priority : worst),
        'low'
      );
      return { key, label: groupLabel(groupBy, key), decisions: decs, priority: worst };
    }).sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  },
}));

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function groupLabel(groupBy: DecisionGroupKey, key: string): string {
  const priorityLabels: Record<string, string> = { critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' };
  const statusLabels: Record<string, string> = {
    new: 'جديد', acknowledged: 'تمت المراجعة', assigned: 'معيّن', in_progress: 'قيد التنفيذ',
    waiting: 'بانتظار', escalated: 'مصعّد', resolved: 'محلول', dismissed: 'مُستبعد', archived: 'مؤرشف',
  };
  const moduleLabels: Record<string, string> = {
    capa: 'كابا', complaints: 'الشكاوى', followUps: 'المتابعات', attendance: 'الحضور',
    riskCenter: 'المخاطر', hrDeductions: 'الخصومات', requests: 'الطلبات', quality: 'الجودة',
    biometric: 'البصمة', notifications: 'الإشعارات', travel: 'السفر', rulesEngine: 'الأتمتة',
  };

  switch (groupBy) {
    case 'priority': return priorityLabels[key] || key;
    case 'status': return statusLabels[key] || key;
    case 'module': return moduleLabels[key] || key;
    default: return key;
  }
}

// ═══════════════════════════════════════════════════════════════
//  CSV Export utility (client-side — no API needed)
// ═══════════════════════════════════════════════════════════════

/** Export decisions to CSV entirely client-side. No new API endpoint. */
export function exportDecisionsToCSV(decisions: Decision[]): string {
  const headers = [
    'ID', 'Type', 'Title', 'Priority', 'Score', 'Employee', 'Department',
    'Modules', 'Urgency', 'Business Impact', 'Due Date', 'Confidence',
    'Suggested Owner', 'Status', 'Reason', 'Consequence',
  ];

  const rows = decisions.map((d) => {
    const status = useDecisionStore.getState().getStatus(d.id);
    return [
      d.id, d.type, d.title, d.priority, d.score.overall,
      d.affectedEmployeeName || '', d.affectedDepartment || '',
      d.affectedModules.join('|'), d.urgency, d.businessImpact,
      d.dueDate || '', d.score.confidence,
      d.suggestedOwner || '', status,
      d.explanation.reason, d.explanation.consequence,
    ].map((v) => {
      const s = String(v ?? '');
      // Escape quotes and wrap in quotes if contains comma/quote/newline
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/** Trigger a browser download of the CSV. */
export function downloadDecisionsCSV(decisions: Decision[], filename?: string): void {
  const csv = exportDecisionsToCSV(decisions);
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `decisions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
