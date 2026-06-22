'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Zap, Plus, Pencil, Trash2, Play, Pause, Eye, Clock, Search, X, CheckCircle2, AlertTriangle, Settings, ArrowUpDown, Filter, ShieldAlert, Activity, AlertOctagon, ChevronDown, ChevronUp, RotateCcw, History, Beaker, Wrench, Brain, Workflow, Timer, ArrowRight } from 'lucide-react';
import type { AutomationRule, RuleConditionGroup, RuleCondition, RuleAction, EscalationStep, RuleExecutionLog } from '@/types';
import { authFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════

const MODULES = ['employees', 'attendance', 'biometric', 'requests', 'quality', 'hrDeductions', 'followUps', 'capa', 'complaints', 'riskCenter', 'travel'];

const MODULE_LABELS: Record<string, string> = {
  employees: 'الموظفين',
  attendance: 'الحضور',
  biometric: 'البصمة',
  requests: 'الطلبات',
  quality: 'الجودة',
  hrDeductions: 'خصومات الموارد البشرية',
  followUps: 'المتابعة',
  capa: 'كابا',
  complaints: 'الشكاوى',
  riskCenter: 'مركز المخاطر',
  travel: 'السفر',
};

const TRIGGER_LABELS: Record<string, string> = {
  record_created: 'إنشاء سجل',
  record_updated: 'تحديث سجل',
  record_deleted: 'حذف سجل',
  status_changed: 'تغيير الحالة',
  date_reached: 'وصول تاريخ',
  threshold_reached: 'تجاوز حد',
  manual: 'تشغيل يدوي',
  scheduled: 'جدولة زمنية',
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'يساوي',
  not_equals: 'لا يساوي',
  contains: 'يحتوي',
  greater_than: 'أكبر من',
  less_than: 'أقل من',
  between: 'بين',
  in_list: 'في القائمة',
  not_in_list: 'ليس في القائمة',
  empty: 'فارغ',
  not_empty: 'ليس فارغاً',
};

const ACTION_LABELS: Record<string, string> = {
  create_notification: 'إنشاء إشعار',
  create_follow_up: 'إنشاء متابعة',
  update_risk_score: 'تحديث درجة المخاطر',
  assign_user: 'تعيين مسؤول',
  create_hr_warning: 'إنشاء إنذار HR',
  create_quality_review: 'إنشاء مراجعة جودة',
  escalate_case: 'تصعيد حالة',
  update_employee_status: 'تحديث حالة موظف',
  add_timeline_event: 'إضافة حدث للجدول الزمني',
  create_capa: 'إنشاء CAPA',
};

const COMMON_FIELDS = [
  { value: 'employeeId', label: 'رقم الموظف' },
  { value: 'status', label: 'الحالة' },
  { value: 'minutesLate', label: 'دقائق التأخير' },
  { value: 'deductionDays', label: 'أيام الخصم' },
  { value: 'riskScore', label: 'درجة المخاطر' },
  { value: 'department', label: 'القسم' },
  { value: 'priorityLevel', label: 'مستوى الأولوية' },
  { value: 'followUpType', label: 'نوع المتابعة' },
  { value: 'complaintType', label: 'نوع الشكوى' },
  { value: 'severity', label: 'الشدة' },
  { value: 'score', label: 'الدرجة' },
  { value: 'type', label: 'النوع' },
  { value: 'amount', label: 'المبلغ' },
  { value: 'date', label: 'التاريخ' },
  { value: 'month', label: 'الشهر' },
  { value: 'notes', label: 'الملاحظات' },
];

const OPERATORS = Object.keys(OPERATOR_LABELS) as Array<keyof typeof OPERATOR_LABELS>;
const ACTION_TYPES = Object.keys(ACTION_LABELS) as Array<keyof typeof ACTION_LABELS>;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active: { label: 'نشط', color: 'text-violet-400', bg: 'bg-violet-500/15', border: 'border-violet-500/30' },
  inactive: { label: 'غير نشط', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
  draft: { label: 'مسودة', color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/30' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low: { label: 'منخفض', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
  medium: { label: 'متوسط', color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30' },
  high: { label: 'مرتفع', color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/30' },
  critical: { label: 'حرج', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
};

// ═══════════════════════════════════════════════════
//  FORM STATE
// ═══════════════════════════════════════════════════

interface RuleFormState {
  name: string;
  description: string;
  module: string;
  priority: string;
  status: string;
  triggerType: string;
  schedule: string;
  throttleMinutes: number;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  enableEscalation: boolean;
  escalationSteps: EscalationStep[];
}

function emptyCondition(id: string): RuleCondition {
  return { id, field: '', operator: 'equals', value: '', valueTo: '' };
}

function emptyConditionGroup(id: string): RuleConditionGroup {
  return { logic: 'and', conditions: [emptyCondition(`${id}-c1`)], groups: [] };
}

function emptyAction(id: string): RuleAction {
  return { id, type: 'create_notification', config: {} };
}

function emptyEscalationStep(): EscalationStep {
  return { afterHours: 24, action: 'create_notification', config: {} };
}

const emptyForm = (): RuleFormState => ({
  name: '',
  description: '',
  module: 'attendance',
  priority: 'medium',
  status: 'draft',
  triggerType: 'record_created',
  schedule: '',
  throttleMinutes: 60,
  conditions: emptyConditionGroup('root'),
  actions: [emptyAction('a1')],
  enableEscalation: false,
  escalationSteps: [],
});

// ═══════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
} as const;

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

let uid = Date.now();
function genId() { return `id_${++uid}`; }

function formatDate(iso: string | null): string {
  if (!iso) return 'لم يتم تشغيله';
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function getSuccessRate(rule: AutomationRule): number {
  if (rule.totalExecutions === 0) return 0;
  return Math.round((rule.successCount / rule.totalExecutions) * 100);
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Deep clone conditions for editing
function cloneConditions(g: RuleConditionGroup): RuleConditionGroup {
  return {
    logic: g.logic,
    conditions: g.conditions.map(c => ({ ...c })),
    groups: (g.groups || []).map(cloneConditions),
  };
}

// ═══════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════

export default function RulesEnginePage() {
  const { canView, canEdit, canCreate, canUpdate, canDelete } = usePermissions('rulesEngine');

  // ── State ──
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<RuleExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [triggerFilter, setTriggerFilter] = useState('all');

  // Dialogs
  const [formOpen, setFormOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Test dialog state
  const [testRuleId, setTestRuleId] = useState('');
  const [testEmployeeId, setTestEmployeeId] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Expanded conditions
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['root']));

  // ── Data Fetching ──
  const fetchRules = useCallback(async () => {
    try {
      const res = await authFetch('/api/rules?limit=100');
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
      }
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await authFetch('/api/rule-logs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
      }
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    fetchRules();
  }, [canView, fetchRules]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter(r => r.status === 'active').length;
    const inactive = rules.filter(r => r.status === 'inactive').length;
    const triggeredToday = rules.filter(r => isToday(r.lastRunAt)).length;
    const successExec = rules.reduce((sum, r) => sum + r.successCount, 0);
    const failedExec = rules.reduce((sum, r) => sum + r.failCount, 0);
    return { total, active, inactive, triggeredToday, successExec, failedExec };
  }, [rules]);

  // ── Filtered Rules ──
  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (moduleFilter !== 'all' && r.module !== moduleFilter) return false;
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
      if (triggerFilter !== 'all' && r.triggerType !== triggerFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return r.name.toLowerCase().includes(s) || r.description.toLowerCase().includes(s);
      }
      return true;
    });
  }, [rules, statusFilter, moduleFilter, priorityFilter, triggerFilter, search]);

  const hasFilters = search || statusFilter !== 'all' || moduleFilter !== 'all' || priorityFilter !== 'all' || triggerFilter !== 'all';

  // ── Form Helpers ──
  const openCreate = () => {
    setEditingRule(null);
    setForm(emptyForm());
    setFormErrors({});
    setExpandedGroups(new Set(['root']));
    setFormOpen(true);
  };

  const openEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      description: rule.description,
      module: rule.module,
      priority: rule.priority,
      status: rule.status,
      triggerType: rule.triggerType,
      schedule: rule.schedule || '',
      throttleMinutes: rule.throttleMinutes,
      conditions: cloneConditions(rule.conditions),
      actions: rule.actions.map(a => ({ ...a, config: { ...a.config } })),
      enableEscalation: !!rule.escalationConfig && rule.escalationConfig.length > 0,
      escalationSteps: rule.escalationConfig ? rule.escalationConfig.map(s => ({ ...s, config: { ...s.config } })) : [],
    });
    setFormErrors({});
    setExpandedGroups(new Set(['root']));
    setFormOpen(true);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'اسم القاعدة مطلوب';
    if (!form.module) errors.module = 'يرجى اختيار الوحدة';
    if (!form.triggerType) errors.triggerType = 'يرجى اختيار نوع التشغيل';
    if (form.triggerType === 'scheduled' && !form.schedule.trim()) errors.schedule = 'يرجى إدخال الجدول الزمني';
    if (form.conditions.conditions.length === 0 && (!form.conditions.groups || form.conditions.groups.length === 0)) {
      errors.conditions = 'يجب إضافة شرط واحد على الأقل';
    }
    if (form.actions.length === 0) errors.actions = 'يجب إضافة إجراء واحد على الأقل';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        description: form.description,
        module: form.module,
        priority: form.priority,
        status: form.status,
        triggerType: form.triggerType,
        schedule: form.triggerType === 'scheduled' ? form.schedule : null,
        throttleMinutes: form.throttleMinutes,
        conditions: form.conditions,
        actions: form.actions.map(a => ({ type: a.type, config: a.config })),
        escalationConfig: form.enableEscalation && form.escalationSteps.length > 0 ? form.escalationSteps : null,
      };

      if (editingRule) {
        const res = await authFetch(`/api/rules/${editingRule.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
          toast.success('تم تحديث القاعدة بنجاح');
          setFormOpen(false);
          fetchRules();
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || 'فشل في تحديث القاعدة');
        }
      } else {
        const res = await authFetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
          toast.success('تم إنشاء القاعدة بنجاح');
          setFormOpen(false);
          fetchRules();
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || 'فشل في إنشاء القاعدة');
        }
      }
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await authFetch(`/api/rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف القاعدة بنجاح');
        setRules(prev => prev.filter(r => r.id !== id));
      } else {
        toast.error('فشل في حذف القاعدة');
      }
    } catch {
      toast.error('حدث خطأ أثناء الحذف');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (rule: AutomationRule) => {
    setTogglingId(rule.id);
    try {
      const newStatus = rule.status === 'active' ? 'inactive' : 'active';
      const res = await authFetch(`/api/rules/${rule.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
      if (res.ok) {
        toast.success(newStatus === 'active' ? 'تم تفعيل القاعدة' : 'تم إيقاف القاعدة');
        fetchRules();
      } else {
        toast.error('فشل في تغيير حالة القاعدة');
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setTogglingId(null);
    }
  };

  const handleExecute = async (id: string) => {
    setExecutingId(id);
    try {
      const res = await authFetch(`/api/rules/execute/${id}`, { method: 'POST' });
      if (res.ok) {
        toast.success('تم تشغيل القاعدة بنجاح');
        fetchRules();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'فشل في تشغيل القاعدة');
      }
    } catch {
      toast.error('حدث خطأ أثناء التشغيل');
    } finally {
      setExecutingId(null);
    }
  };

  const handleTest = async () => {
    if (!testRuleId) { toast.error('يرجى اختيار قاعدة'); return; }
    setTestRunning(true);
    setTestResult(null);
    try {
      const body: any = {};
      if (testEmployeeId) body.employeeId = testEmployeeId;
      const res = await authFetch(`/api/rules/execute/${testRuleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      setTestResult(data);
      if (res.ok) {
        toast.success('تم تشغيل الاختبار بنجاح');
      } else {
        toast.error(data?.error || 'فشل الاختبار');
      }
    } catch {
      toast.error('حدث خطأ أثناء الاختبار');
      setTestResult({ error: 'حدث خطأ أثناء الاتصال بالخادم' });
    } finally {
      setTestRunning(false);
    }
  };

  // ── Condition Builder Helpers ──
  const updateCondition = useCallback((groupId: string, condId: string, field: keyof RuleCondition, value: any) => {
    setForm(prev => {
      const newForm = { ...prev, conditions: { ...prev.conditions } };
      const updateInGroup = (g: RuleConditionGroup): boolean => {
        const ci = g.conditions.findIndex(c => c.id === condId);
        if (ci !== -1) {
          g.conditions = g.conditions.map(c => c.id === condId ? { ...c, [field]: value } : c);
          return true;
        }
        if (g.groups) {
          for (const sub of g.groups) {
            if (updateInGroup(sub)) return true;
          }
        }
        return false;
      };
      updateInGroup(newForm.conditions);
      return newForm;
    });
  }, []);

  const addCondition = useCallback((groupId: string) => {
    setForm(prev => {
      const newForm = { ...prev, conditions: { ...prev.conditions, conditions: [...prev.conditions.conditions], groups: prev.conditions.groups ? [...prev.conditions.groups] : [] } };
      const addInGroup = (g: RuleConditionGroup): boolean => {
        if (g.conditions.length > 0 && g.conditions[0].id.startsWith(groupId)) {
          // Check if this is the root or the matching group by id convention
        }
        // Simple approach: only add at root level or by explicit groupId='root'
        if (groupId === 'root' && g === newForm.conditions) {
          g.conditions = [...g.conditions, emptyCondition(genId())];
          return true;
        }
        if (g.groups) {
          for (const sub of g.groups) {
            // Check if sub's first condition starts with this groupId
            if (sub.conditions.length > 0 && sub.conditions[0].id.startsWith(groupId + '-')) {
              sub.conditions = [...sub.conditions, emptyCondition(genId())];
              return true;
            }
          }
        }
        return false;
      };
      // Simpler approach: always add to root
      if (groupId === 'root') {
        newForm.conditions = { ...newForm.conditions, conditions: [...newForm.conditions.conditions, emptyCondition(genId())] };
      }
      return newForm;
    });
  }, []);

  const removeCondition = useCallback((condId: string) => {
    setForm(prev => {
      const removeFromGroup = (g: RuleConditionGroup): RuleConditionGroup => {
        return {
          ...g,
          conditions: g.conditions.filter(c => c.id !== condId),
          groups: (g.groups || []).map(removeFromGroup),
        };
      };
      return { ...prev, conditions: removeFromGroup(prev.conditions) };
    });
  }, []);

  const toggleGroupLogic = useCallback((groupId: string) => {
    setForm(prev => {
      const toggleInGroup = (g: RuleConditionGroup): RuleConditionGroup => {
        const isTarget = g.conditions.length > 0 && (groupId === 'root' || g.conditions[0].id.startsWith(groupId + '-'));
        if (isTarget || groupId === 'root') {
          return { ...g, logic: g.logic === 'and' ? 'or' : 'and', conditions: [...g.conditions], groups: (g.groups || []).map(toggleInGroup) };
        }
        return { ...g, conditions: [...g.conditions], groups: (g.groups || []).map(toggleInGroup) };
      };
      // Always toggle root
      if (groupId === 'root') {
        return { ...prev, conditions: { ...prev.conditions, logic: prev.conditions.logic === 'and' ? 'or' : 'and' } };
      }
      return prev;
    });
  }, []);

  const addGroup = useCallback(() => {
    const newGroupId = genId();
    setForm(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        groups: [...(prev.conditions.groups || []), emptyConditionGroup(newGroupId)],
      },
    }));
    setExpandedGroups(prev => new Set([...prev, newGroupId]));
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setForm(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        groups: (prev.conditions.groups || []).filter(g => !g.conditions[0]?.id.startsWith(groupId + '-')),
      },
    }));
  }, []);

  const updateGroupCondition = useCallback((groupId: string, condId: string, field: keyof RuleCondition, value: any) => {
    setForm(prev => {
      const updateInGroups = (groups: RuleConditionGroup[]): RuleConditionGroup[] => {
        return groups.map(g => {
          if (g.conditions.some(c => c.id === condId)) {
            return { ...g, conditions: g.conditions.map(c => c.id === condId ? { ...c, [field]: value } : c) };
          }
          return { ...g, groups: updateInGroups(g.groups || []) };
        });
      };
      return {
        ...prev,
        conditions: { ...prev.conditions, groups: updateInGroups(prev.conditions.groups || []) },
      };
    });
  }, []);

  const removeGroupCondition = useCallback((groupId: string, condId: string) => {
    setForm(prev => {
      const removeFromGroups = (groups: RuleConditionGroup[]): RuleConditionGroup[] => {
        return groups.map(g => {
          if (g.conditions.some(c => c.id === condId)) {
            return { ...g, conditions: g.conditions.filter(c => c.id !== condId) };
          }
          return { ...g, groups: removeFromGroups(g.groups || []) };
        });
      };
      return {
        ...prev,
        conditions: { ...prev.conditions, groups: removeFromGroups(prev.conditions.groups || []) },
      };
    });
  }, []);

  const addGroupCondition = useCallback((groupId: string) => {
    setForm(prev => {
      const addToGroups = (groups: RuleConditionGroup[]): RuleConditionGroup[] => {
        return groups.map(g => {
          if (g.conditions.length > 0 && g.conditions[0].id.startsWith(groupId + '-')) {
            return { ...g, conditions: [...g.conditions, emptyCondition(genId())] };
          }
          return { ...g, groups: addToGroups(g.groups || []) };
        });
      };
      return {
        ...prev,
        conditions: { ...prev.conditions, groups: addToGroups(prev.conditions.groups || []) },
      };
    });
  }, []);

  const toggleSubGroupLogic = useCallback((groupId: string) => {
    setForm(prev => {
      const toggleInGroups = (groups: RuleConditionGroup[]): RuleConditionGroup[] => {
        return groups.map(g => {
          if (g.conditions.length > 0 && g.conditions[0].id.startsWith(groupId + '-')) {
            return { ...g, logic: g.logic === 'and' ? 'or' : 'and' };
          }
          return { ...g, groups: toggleInGroups(g.groups || []) };
        });
      };
      return {
        ...prev,
        conditions: { ...prev.conditions, groups: toggleInGroups(prev.conditions.groups || []) },
      };
    });
  }, []);

  // ── Action Builder Helpers ──
  const addAction = useCallback(() => {
    setForm(prev => ({ ...prev, actions: [...prev.actions, emptyAction(genId())] }));
  }, []);

  const removeAction = useCallback((actionId: string) => {
    setForm(prev => ({ ...prev, actions: prev.actions.filter(a => a.id !== actionId) }));
  }, []);

  const updateAction = useCallback((actionId: string, field: keyof RuleAction | 'configKey', value: any) => {
    setForm(prev => ({
      ...prev,
      actions: prev.actions.map(a => {
        if (a.id !== actionId) return a;
        if (field === 'configKey') return a; // handled separately
        return { ...a, [field]: value, config: field === 'type' ? {} : a.config };
      }),
    }));
  }, []);

  const updateActionConfig = useCallback((actionId: string, key: string, value: any) => {
    setForm(prev => ({
      ...prev,
      actions: prev.actions.map(a => a.id === actionId ? { ...a, config: { ...a.config, [key]: value } } : a),
    }));
  }, []);

  // ── Escalation Helpers ──
  const addEscalationStep = useCallback(() => {
    setForm(prev => ({ ...prev, escalationSteps: [...prev.escalationSteps, emptyEscalationStep()] }));
  }, []);

  const removeEscalationStep = useCallback((index: number) => {
    setForm(prev => ({ ...prev, escalationSteps: prev.escalationSteps.filter((_, i) => i !== index) }));
  }, []);

  const updateEscalationStep = useCallback((index: number, field: keyof EscalationStep, value: any) => {
    setForm(prev => ({
      ...prev,
      escalationSteps: prev.escalationSteps.map((s, i) => i === index ? { ...s, [field]: value } : s),
    }));
  }, []);

  const updateEscalationConfig = useCallback((index: number, key: string, value: any) => {
    setForm(prev => ({
      ...prev,
      escalationSteps: prev.escalationSteps.map((s, i) => i === index ? { ...s, config: { ...s.config, [key]: value } } : s),
    }));
  }, []);

  const toggleExpandedGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── Action Config Fields ──
  const getActionConfigFields = (actionType: string): { key: string; label: string; type: 'text' | 'number' | 'select'; options?: { value: string; label: string }[] }[] => {
    switch (actionType) {
      case 'create_notification':
        return [
          { key: 'title', label: 'عنوان الإشعار', type: 'text' },
          { key: 'message', label: 'نص الرسالة', type: 'text' },
          { key: 'priority', label: 'الأولوية', type: 'select', options: [
            { value: 'low', label: 'منخفض' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'مرتفع' }, { value: 'critical', label: 'حرج' },
          ]},
          { key: 'category', label: 'التصنيف', type: 'select', options: [
            { value: 'automation', label: 'أتمتة' }, { value: 'attendance', label: 'حضور' }, { value: 'quality', label: 'جودة' },
            { value: 'hr', label: 'موارد بشرية' }, { value: 'risk', label: 'مخاطر' }, { value: 'followUp', label: 'متابعة' },
          ]},
        ];
      case 'create_follow_up':
        return [
          { key: 'subject', label: 'الموضوع', type: 'text' },
          { key: 'followUpType', label: 'النوع', type: 'select', options: [
            { value: 'quality', label: 'جودة' }, { value: 'behavior', label: 'سلوك' }, { value: 'attendance', label: 'حضور' },
            { value: 'productivity', label: 'إنتاجية' }, { value: 'training', label: 'تدريب' }, { value: 'coaching', label: 'توجيه' },
            { value: 'complaint', label: 'شكوى' }, { value: 'improvement', label: 'تحسين' }, { value: 'other', label: 'أخرى' },
          ]},
          { key: 'priorityLevel', label: 'الأولوية', type: 'select', options: [
            { value: 'low', label: 'منخفض' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'مرتفع' }, { value: 'critical', label: 'حرج' },
          ]},
          { key: 'responsiblePerson', label: 'المسؤول (ID)', type: 'text' },
        ];
      case 'update_risk_score':
        return [
          { key: 'scoreChange', label: 'تغيير الدرجة', type: 'number' },
          { key: 'reason', label: 'السبب', type: 'text' },
        ];
      case 'assign_user':
        return [
          { key: 'userId', label: 'معرف المستخدم', type: 'text' },
          { key: 'role', label: 'الدور', type: 'text' },
        ];
      case 'add_timeline_event':
        return [
          { key: 'eventTitle', label: 'عنوان الحدث', type: 'text' },
          { key: 'eventDescription', label: 'وصف الحدث', type: 'text' },
          { key: 'eventCategory', label: 'التصنيف', type: 'text' },
        ];
      case 'create_hr_warning':
        return [
          { key: 'warningType', label: 'نوع الإنذار', type: 'text' },
          { key: 'message', label: 'نص الإنذار', type: 'text' },
        ];
      case 'create_quality_review':
        return [
          { key: 'reviewTitle', label: 'عنوان المراجعة', type: 'text' },
          { key: 'department', label: 'القسم', type: 'text' },
        ];
      case 'escalate_case':
        return [
          { key: 'escalateTo', label: 'التصعيد إلى (ID)', type: 'text' },
          { key: 'reason', label: 'سبب التصعيد', type: 'text' },
        ];
      case 'update_employee_status':
        return [
          { key: 'newStatus', label: 'الحالة الجديدة', type: 'text' },
          { key: 'reason', label: 'السبب', type: 'text' },
        ];
      default:
        return [];
    }
  };

  // ── Permission Guard ──
  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldAlert className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">غير مصرح بالوصول</p>
        <p className="text-slate-600 text-xs mt-1">ليس لديك صلاحية لعرض محرك القواعد</p>
      </div>
    );
  }

  // ── Render ──
  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-violet-500/15 border border-violet-500/30">
            <Brain className="size-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">محرك الأتمتة والقواعد</h1>
            <p className="text-slate-500 text-xs mt-0.5">إدارة القواعد الآلية وتنفيذها — نظام الذكاء التشغيلي</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setTestOpen(true); setTestRuleId(''); setTestEmployeeId(''); setTestResult(null); }} className="text-slate-400 hover:text-white">
            <Beaker className="size-4 ml-1" />
            اختبار
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setLogsOpen(true); fetchLogs(); }} className="text-slate-400 hover:text-white">
            <History className="size-4 ml-1" />
            سجل التنفيذ
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white">
              <Plus className="size-4 ml-1" />
              قاعدة جديدة
            </Button>
          )}
        </div>
      </motion.div>

      {/* ═══ Dashboard Stats ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="rounded-lg border border-slate-700/25 bg-slate-800/40 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">إجمالي القواعد</p>
          <p className="text-white font-bold text-lg leading-tight">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-violet-500/30 bg-emerald-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">قواعد نشطة</p>
          <p className="text-violet-400 font-bold text-lg leading-tight">{stats.active}</p>
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">قواعد غير نشطة</p>
          <p className="text-red-400 font-bold text-lg leading-tight">{stats.inactive}</p>
        </div>
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">تم تشغيلها اليوم</p>
          <p className="text-blue-400 font-bold text-lg leading-tight">{stats.triggeredToday}</p>
        </div>
        <div className="rounded-lg border border-green-500/25 bg-green-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">تنفيذات ناجحة</p>
          <p className="text-green-400 font-bold text-lg leading-tight">{stats.successExec}</p>
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">تنفيذات فاشلة</p>
          <p className="text-red-400 font-bold text-lg leading-tight">{stats.failedExec}</p>
        </div>
      </motion.div>

      {/* ═══ Filters Bar ═══ */}
      <Card className="border-slate-700/40 bg-slate-800/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                placeholder="بحث بالاسم أو الوصف..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-9 text-sm">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الحالات</SelectItem>
                <SelectItem value="active" className="text-white">نشط</SelectItem>
                <SelectItem value="inactive" className="text-white">غير نشط</SelectItem>
                <SelectItem value="draft" className="text-white">مسودة</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <SelectValue placeholder="الوحدة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الوحدات</SelectItem>
                {MODULES.map(m => (
                  <SelectItem key={m} value={m} className="text-white">{MODULE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-9 text-sm">
                <SelectValue placeholder="الأولوية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الأولويات</SelectItem>
                <SelectItem value="low" className="text-white">منخفض</SelectItem>
                <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                <SelectItem value="critical" className="text-white">حرج</SelectItem>
              </SelectContent>
            </Select>
            <Select value={triggerFilter} onValueChange={setTriggerFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <SelectValue placeholder="نوع التشغيل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الأنواع</SelectItem>
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('all'); setModuleFilter('all'); setPriorityFilter('all'); setTriggerFilter('all'); }} className="text-slate-400 hover:text-white h-9 px-3">
                <X className="size-3.5 ml-1" />
                مسح
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Loading ═══ */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : filteredRules.length === 0 ? (
        /* ═══ Empty State ═══ */
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="size-14 rounded-full bg-slate-800 flex items-center justify-center mb-4">
                <Workflow className="size-7 text-violet-500/60" />
              </div>
              <p className="text-slate-300 text-sm font-semibold">لا توجد قواعد أتمتة</p>
              <p className="text-slate-500 text-xs mt-1.5 max-w-sm text-center leading-relaxed">
                {hasFilters
                  ? 'لا توجد قواعد تطابق معايير البحث الحالية. جرّب تغيير الفلاتر.'
                  : 'ابدأ بإنشاء أول قاعدة أتمتة لتنفيذ المهام تلقائياً بناءً على الأحداث والشروط.'}
              </p>
              {!hasFilters && canCreate && (
                <Button size="sm" onClick={openCreate} className="mt-4 bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="size-4 ml-1" />
                  إنشاء قاعدة أولى
                </Button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        /* ═══ Rules Table ═══ */
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2">
          {filteredRules.map(rule => {
            const sCfg = STATUS_CONFIG[rule.status] || STATUS_CONFIG.draft;
            const pCfg = PRIORITY_CONFIG[rule.priority] || PRIORITY_CONFIG.medium;
            const rate = getSuccessRate(rule);

            return (
              <motion.div key={rule.id} variants={itemVariants} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3.5 hover:bg-slate-800/60 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  {/* Main Info */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-2 items-center">
                    {/* Rule Name + Description */}
                    <div className="lg:col-span-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <Zap className="size-4 text-violet-400 flex-shrink-0" />
                        <p className="text-white text-sm font-semibold truncate">{rule.name}</p>
                      </div>
                      {rule.description && (
                        <p className="text-slate-500 text-[11px] mt-0.5 truncate pr-6">{rule.description}</p>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      <Badge variant="outline" className={`${sCfg.color} ${sCfg.bg} ${sCfg.border} border text-[11px] font-medium`}>
                        {sCfg.label}
                      </Badge>
                    </div>

                    {/* Priority */}
                    <div>
                      <Badge variant="outline" className={`${pCfg.color} ${pCfg.bg} ${pCfg.border} border text-[11px] font-medium`}>
                        {pCfg.label}
                      </Badge>
                    </div>

                    {/* Module */}
                    <div>
                      <Badge variant="outline" className="text-slate-400 bg-slate-700/30 border-slate-600/30 text-[11px]">
                        {MODULE_LABELS[rule.module] || rule.module}
                      </Badge>
                    </div>

                    {/* Trigger Type */}
                    <div className="text-slate-400 text-xs">
                      {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
                    </div>

                    {/* Last Run */}
                    <div className="text-slate-500 text-[11px] flex items-center gap-1">
                      <Clock className="size-3 flex-shrink-0" />
                      <span className="truncate">{formatDate(rule.lastRunAt)}</span>
                    </div>

                    {/* Executions + Success Rate */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">{rule.totalExecutions}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden min-w-[50px]">
                        <div
                          className={`h-full rounded-full transition-all ${rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-medium ${rate >= 80 ? 'text-violet-400' : rate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {rate}%
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canUpdate && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(rule)}
                          disabled={togglingId === rule.id}
                          className={`h-8 w-8 p-0 ${rule.status === 'active' ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10' : 'text-violet-400 hover:text-violet-300 hover:bg-violet-500/10'}`}
                          title={rule.status === 'active' ? 'إيقاف' : 'تفعيل'}
                        >
                          {togglingId === rule.id ? (
                            <RotateCcw className="size-3.5 animate-spin" />
                          ) : rule.status === 'active' ? (
                            <Pause className="size-3.5" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExecute(rule.id)}
                          disabled={executingId === rule.id}
                          className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          title="تشغيل"
                        >
                          {executingId === rule.id ? (
                            <RotateCcw className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(rule)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700/50"
                          title="تعديل"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { if (confirm('هل أنت متأكد من حذف هذه القاعدة؟')) handleDelete(rule.id); }}
                        disabled={deletingId === rule.id}
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        title="حذف"
                      >
                        {deletingId === rule.id ? <RotateCcw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          CREATE / EDIT RULE DIALOG
         ═══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-slate-900 border-slate-700/60 text-white max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Wrench className="size-5 text-violet-400" />
              {editingRule ? 'تعديل القاعدة' : 'إنشاء قاعدة جديدة'}
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              {editingRule ? 'قم بتعديل إعدادات القاعدة والشروط والإجراءات' : 'أنشئ قاعدة أتمتة جديدة مع الشروط والإجراءات المطلوبة'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90vh-12rem)] pr-3">
            <div className="space-y-6 pb-4">
              {/* ── Basic Info ── */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Settings className="size-4 text-violet-400" />
                  المعلومات الأساسية
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <Label className="text-slate-300 text-xs mb-1.5 block">اسم القاعدة *</Label>
                    <Input
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="مثال: إنذار تأخير الموظفين"
                      className="bg-slate-800/70 border-slate-700/70 text-white placeholder:text-slate-500 h-9 text-sm"
                    />
                    {formErrors.name && <p className="text-red-400 text-[11px] mt-1">{formErrors.name}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-slate-300 text-xs mb-1.5 block">الوصف</Label>
                    <Textarea
                      value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="وصف مختصر للقاعدة..."
                      className="bg-slate-800/70 border-slate-700/70 text-white placeholder:text-slate-500 text-sm min-h-[60px]"
                      rows={2}
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300 text-xs mb-1.5 block">الوحدة *</Label>
                    <Select value={form.module} onValueChange={v => setForm(p => ({ ...p, module: v }))}>
                      <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                        <SelectValue placeholder="اختر الوحدة" />
                      </SelectTrigger>
                      <SelectContent>
                        {MODULES.map(m => (
                          <SelectItem key={m} value={m} className="text-white">{MODULE_LABELS[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.module && <p className="text-red-400 text-[11px] mt-1">{formErrors.module}</p>}
                  </div>
                  <div>
                    <Label className="text-slate-300 text-xs mb-1.5 block">الأولوية</Label>
                    <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                      <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                        <SelectValue placeholder="اختر الأولوية" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low" className="text-white">منخفض</SelectItem>
                        <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                        <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                        <SelectItem value="critical" className="text-white">حرج</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-slate-300 text-xs mb-1.5 block">الحالة</Label>
                    <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                      <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                        <SelectValue placeholder="اختر الحالة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft" className="text-white">مسودة</SelectItem>
                        <SelectItem value="active" className="text-white">نشط</SelectItem>
                        <SelectItem value="inactive" className="text-white">غير نشط</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator className="bg-slate-700/40" />

              {/* ── Trigger Configuration ── */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Zap className="size-4 text-yellow-400" />
                  إعدادات التشغيل
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-300 text-xs mb-1.5 block">نوع التشغيل *</Label>
                    <Select value={form.triggerType} onValueChange={v => setForm(p => ({ ...p, triggerType: v }))}>
                      <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                        <SelectValue placeholder="اختر نوع التشغيل" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.triggerType && <p className="text-red-400 text-[11px] mt-1">{formErrors.triggerType}</p>}
                  </div>
                  {form.triggerType === 'scheduled' && (
                    <div>
                      <Label className="text-slate-300 text-xs mb-1.5 block">الجدول الزمني (Cron) *</Label>
                      <Input
                        value={form.schedule}
                        onChange={e => setForm(p => ({ ...p, schedule: e.target.value }))}
                        placeholder="0 8 * * * (كل يوم الساعة 8)"
                        className="bg-slate-800/70 border-slate-700/70 text-white placeholder:text-slate-500 h-9 text-sm font-mono"
                      />
                      {formErrors.schedule && <p className="text-red-400 text-[11px] mt-1">{formErrors.schedule}</p>}
                    </div>
                  )}
                  <div>
                    <Label className="text-slate-300 text-xs mb-1.5 block">فترة التهدئة (دقيقة)</Label>
                    <Input
                      type="number"
                      value={form.throttleMinutes}
                      onChange={e => setForm(p => ({ ...p, throttleMinutes: parseInt(e.target.value) || 60 }))}
                      className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                      min={0}
                    />
                  </div>
                </div>
              </div>

              <Separator className="bg-slate-700/40" />

              {/* ── Condition Builder ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Filter className="size-4 text-blue-400" />
                    الشروط
                  </h3>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => addCondition('root')} className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 h-7 text-xs px-2">
                      <Plus className="size-3 ml-1" />
                      إضافة شرط
                    </Button>
                    <Button variant="ghost" size="sm" onClick={addGroup} className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 h-7 text-xs px-2">
                      <Plus className="size-3 ml-1" />
                      إضافة مجموعة
                    </Button>
                  </div>
                </div>

                {formErrors.conditions && <p className="text-red-400 text-[11px]">{formErrors.conditions}</p>}

                {/* Root Group */}
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleGroupLogic('root')}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${form.conditions.logic === 'and' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}
                    >
                      {form.conditions.logic === 'and' ? 'و (AND)' : 'أو (OR)'}
                    </button>
                    <span className="text-slate-500 text-[11px]">المجموعة الرئيسية</span>
                  </div>

                  {/* Root Conditions */}
                  <AnimatePresence>
                    {form.conditions.conditions.map(cond => (
                      <motion.div key={cond.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2">
                        <Select value={cond.field} onValueChange={v => updateCondition('root', cond.id, 'field', v)}>
                          <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs flex-1 min-w-[120px]">
                            <SelectValue placeholder="الحقل" />
                          </SelectTrigger>
                          <SelectContent>
                            {COMMON_FIELDS.map(f => (
                              <SelectItem key={f.value} value={f.value} className="text-white">{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={cond.operator} onValueChange={v => updateCondition('root', cond.id, 'operator', v)}>
                          <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs w-[110px]">
                            <SelectValue placeholder="العملية" />
                          </SelectTrigger>
                          <SelectContent>
                            {OPERATORS.map(op => (
                              <SelectItem key={op} value={op} className="text-white">{OPERATOR_LABELS[op]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(cond.operator !== 'empty' && cond.operator !== 'not_empty') && (
                          <Input
                            value={cond.value || ''}
                            onChange={e => updateCondition('root', cond.id, 'value', e.target.value)}
                            placeholder="القيمة"
                            className="bg-slate-900/70 border-slate-700/70 text-white placeholder:text-slate-500 h-8 text-xs flex-1 min-w-[100px]"
                          />
                        )}
                        {cond.operator === 'between' && (
                          <Input
                            value={cond.valueTo || ''}
                            onChange={e => updateCondition('root', cond.id, 'valueTo', e.target.value)}
                            placeholder="إلى"
                            className="bg-slate-900/70 border-slate-700/70 text-white placeholder:text-slate-500 h-8 text-xs w-20"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCondition(cond.id)}
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {/* Sub Groups */}
                  {(form.conditions.groups || []).map((group, gi) => {
                    const groupId = group.conditions[0]?.id.split('-')[0] || `g${gi}`;
                    const isExpanded = expandedGroups.has(groupId);
                    return (
                      <div key={gi} className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleExpandedGroup(groupId)}
                              className="text-slate-400 hover:text-white"
                            >
                              {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                            </button>
                            <button
                              onClick={() => toggleSubGroupLogic(groupId)}
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${group.logic === 'and' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}
                            >
                              {group.logic === 'and' ? 'و (AND)' : 'أو (OR)'}
                            </button>
                            <span className="text-slate-500 text-[11px]">مجموعة فرعية</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => addGroupCondition(groupId)} className="h-6 w-6 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10">
                              <Plus className="size-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => removeGroup(groupId)} className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10">
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                        {isExpanded && (
                          <AnimatePresence>
                            {group.conditions.map(cond => (
                              <motion.div key={cond.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 pr-2">
                                <Select value={cond.field} onValueChange={v => updateGroupCondition(groupId, cond.id, 'field', v)}>
                                  <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-7 text-xs flex-1 min-w-[110px]">
                                    <SelectValue placeholder="الحقل" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {COMMON_FIELDS.map(f => (
                                      <SelectItem key={f.value} value={f.value} className="text-white">{f.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select value={cond.operator} onValueChange={v => updateGroupCondition(groupId, cond.id, 'operator', v)}>
                                  <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-7 text-xs w-[100px]">
                                    <SelectValue placeholder="العملية" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {OPERATORS.map(op => (
                                      <SelectItem key={op} value={op} className="text-white">{OPERATOR_LABELS[op]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {(cond.operator !== 'empty' && cond.operator !== 'not_empty') && (
                                  <Input
                                    value={cond.value || ''}
                                    onChange={e => updateGroupCondition(groupId, cond.id, 'value', e.target.value)}
                                    placeholder="القيمة"
                                    className="bg-slate-900/70 border-slate-700/70 text-white placeholder:text-slate-500 h-7 text-xs flex-1 min-w-[80px]"
                                  />
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeGroupCondition(groupId, cond.id)}
                                  className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator className="bg-slate-700/40" />

              {/* ── Actions Configuration ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <ArrowRight className="size-4 text-violet-400" />
                    الإجراءات
                  </h3>
                  <Button variant="ghost" size="sm" onClick={addAction} className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 h-7 text-xs px-2">
                    <Plus className="size-3 ml-1" />
                    إضافة إجراء
                  </Button>
                </div>

                {formErrors.actions && <p className="text-red-400 text-[11px]">{formErrors.actions}</p>}

                <div className="space-y-2">
                  <AnimatePresence>
                    {form.actions.map((action, ai) => {
                      const configFields = getActionConfigFields(action.type);
                      return (
                        <motion.div key={action.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 text-[11px] font-medium w-5">{ai + 1}.</span>
                            <Select value={action.type} onValueChange={v => updateAction(action.id, 'type', v)}>
                              <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs flex-1">
                                <SelectValue placeholder="نوع الإجراء" />
                              </SelectTrigger>
                              <SelectContent>
                                {ACTION_TYPES.map(t => (
                                  <SelectItem key={t} value={t} className="text-white">{ACTION_LABELS[t]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAction(action.id)}
                              disabled={form.actions.length <= 1}
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0 disabled:opacity-30"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          {configFields.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-7">
                              {configFields.map(cf => (
                                <div key={cf.key}>
                                  <Label className="text-slate-400 text-[11px] mb-1 block">{cf.label}</Label>
                                  {cf.type === 'select' ? (
                                    <Select value={action.config[cf.key] || ''} onValueChange={v => updateActionConfig(action.id, cf.key, v)}>
                                      <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs">
                                        <SelectValue placeholder={`اختر ${cf.label}`} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {cf.options?.map(opt => (
                                          <SelectItem key={opt.value} value={opt.value} className="text-white">{opt.label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      type={cf.type}
                                      value={action.config[cf.key] || ''}
                                      onChange={e => updateActionConfig(action.id, cf.key, cf.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                                      placeholder={cf.label}
                                      className="bg-slate-900/70 border-slate-700/70 text-white placeholder:text-slate-500 h-8 text-xs"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>

              <Separator className="bg-slate-700/40" />

              {/* ── Escalation Configuration ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <AlertOctagon className="size-4 text-orange-400" />
                    التصعيد (اختياري)
                  </h3>
                  <div className="flex items-center gap-2">
                    <Label className="text-slate-400 text-xs">تفعيل التصعيد</Label>
                    <Checkbox
                      checked={form.enableEscalation}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, enableEscalation: !!checked }))}
                      className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                    />
                  </div>
                </div>

                {form.enableEscalation && (
                  <div className="space-y-2">
                    <Button variant="ghost" size="sm" onClick={addEscalationStep} className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 h-7 text-xs px-2">
                      <Plus className="size-3 ml-1" />
                      إضافة خطوة تصعيد
                    </Button>
                    <AnimatePresence>
                      {form.escalationSteps.map((step, si) => (
                        <motion.div key={si} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-orange-400 text-[11px] font-bold">خطوة {si + 1}</span>
                            <div className="flex-1" />
                            <Button variant="ghost" size="sm" onClick={() => removeEscalationStep(si)} className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10">
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <Label className="text-slate-400 text-[11px] mb-1 block">بعد (ساعات)</Label>
                              <Input
                                type="number"
                                value={step.afterHours}
                                onChange={e => updateEscalationStep(si, 'afterHours', parseInt(e.target.value) || 0)}
                                className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs"
                                min={1}
                              />
                            </div>
                            <div>
                              <Label className="text-slate-400 text-[11px] mb-1 block">الإجراء</Label>
                              <Select value={step.action} onValueChange={v => updateEscalationStep(si, 'action', v)}>
                                <SelectTrigger className="bg-slate-900/70 border-slate-700/70 text-white h-8 text-xs">
                                  <SelectValue placeholder="اختر الإجراء" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(ACTION_LABELS).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-slate-400 text-[11px] mb-1 block">معرف المستهدف</Label>
                              <Input
                                value={step.config?.targetId || ''}
                                onChange={e => updateEscalationConfig(si, 'targetId', e.target.value)}
                                placeholder="ID"
                                className="bg-slate-900/70 border-slate-700/70 text-white placeholder:text-slate-500 h-8 text-xs"
                              />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-row gap-2 justify-start">
            <Button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white h-9">
              {saving ? (
                <>
                  <RotateCcw className="size-4 ml-1 animate-spin" />
                  جاري الحفظ...
                </>
              ) : editingRule ? (
                'حفظ التعديلات'
              ) : (
                'إنشاء القاعدة'
              )}
            </Button>
            <Button variant="ghost" onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-white h-9">
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════════════
          EXECUTION LOGS DIALOG
         ═══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="bg-slate-900 border-slate-700/60 text-white max-w-5xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <History className="size-5 text-blue-400" />
              سجل التنفيذ
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">جميع عمليات تنفيذ القواعد الآلية</DialogDescription>
          </DialogHeader>

          {logsLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 rounded-lg bg-slate-800/50" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                <Clock className="size-6 text-slate-600" />
              </div>
              <p className="text-slate-400 text-sm">لا توجد سجلات تنفيذ بعد</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[calc(85vh-10rem)]">
              <div className="space-y-1.5">
                {logs.map(log => {
                  const resultCfg: Record<string, { label: string; color: string; bg: string; border: string }> = {
                    success: { label: 'ناجح', color: 'text-violet-400', bg: 'bg-violet-500/15', border: 'border-violet-500/30' },
                    failed: { label: 'فاشل', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
                    skipped: { label: 'تم تخطيه', color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30' },
                  };
                  const rc = resultCfg[log.result] || resultCfg.skipped;

                  return (
                    <div key={log.id} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3 hover:bg-slate-800/60 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-6 gap-1.5 items-center text-xs">
                          <div className="sm:col-span-1">
                            <p className="text-slate-500 text-[10px]">القاعدة</p>
                            <p className="text-white text-xs font-medium truncate">{log.ruleName}</p>
                          </div>
                          <div className="sm:col-span-1">
                            <p className="text-slate-500 text-[10px]">التاريخ</p>
                            <p className="text-slate-300 text-xs">{formatDate(log.executionDate)}</p>
                          </div>
                          <div className="sm:col-span-1">
                            <p className="text-slate-500 text-[10px]">التشغيل بواسطة</p>
                            <p className="text-slate-300 text-xs truncate">{log.triggeredBy}</p>
                          </div>
                          <div className="sm:col-span-1">
                            <p className="text-slate-500 text-[10px]">الموظف</p>
                            <p className="text-slate-300 text-xs truncate">{log.affectedEmployeeName || '—'}</p>
                          </div>
                          <div>
                            <Badge variant="outline" className={`${rc.color} ${rc.bg} ${rc.border} border text-[10px] font-medium`}>
                              {rc.label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Timer className="size-3 text-slate-500" />
                            <span className="text-slate-400 text-[11px]">{log.executionDuration}ms</span>
                          </div>
                        </div>
                      </div>
                      {log.errorMessage && (
                        <div className="mt-2 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1.5">
                          <p className="text-red-400 text-[11px] flex items-center gap-1">
                            <AlertTriangle className="size-3 flex-shrink-0" />
                            {log.errorMessage}
                          </p>
                        </div>
                      )}
                      {log.actionsTaken && log.actionsTaken.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {log.actionsTaken.map((action, i) => (
                            <Badge key={i} variant="outline" className="text-slate-400 bg-slate-700/20 border-slate-600/20 text-[10px]">
                              {action}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════════════
          TEST RULE DIALOG
         ═══════════════════════════════════════════════════════════════════════════ */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="bg-slate-900 border-slate-700/60 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Beaker className="size-5 text-cyan-400" />
              اختبار القاعدة
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">اختبار تشغيل قاعدة على سياق محدد لمعرفة النتيجة المتوقعة</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 text-xs mb-1.5 block">اختر القاعدة *</Label>
              <Select value={testRuleId} onValueChange={setTestRuleId}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                  <SelectValue placeholder="اختر قاعدة للاختبار" />
                </SelectTrigger>
                <SelectContent>
                  {rules.filter(r => r.status !== 'inactive').map(r => (
                    <SelectItem key={r.id} value={r.id} className="text-white">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-xs mb-1.5 block">معرف الموظف (اختياري)</Label>
              <Input
                value={testEmployeeId}
                onChange={e => setTestEmployeeId(e.target.value)}
                placeholder="أدخل معرف الموظف لاختبار السياق"
                className="bg-slate-800/70 border-slate-700/70 text-white placeholder:text-slate-500 h-9 text-sm"
              />
            </div>

            <Button onClick={handleTest} disabled={testRunning || !testRuleId} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white h-9">
              {testRunning ? (
                <>
                  <RotateCcw className="size-4 ml-1 animate-spin" />
                  جاري الاختبار...
                </>
              ) : (
                <>
                  <Play className="size-4 ml-1" />
                  تشغيل الاختبار
                </>
              )}
            </Button>

            {testResult && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {testResult.error ? (
                    <AlertOctagon className="size-4 text-red-400" />
                  ) : (
                    <CheckCircle2 className="size-4 text-violet-400" />
                  )}
                  <span className="text-sm font-semibold text-white">
                    {testResult.error ? 'فشل الاختبار' : 'نجح الاختبار'}
                  </span>
                </div>
                <ScrollArea className="max-h-[200px]">
                  <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed" dir="ltr">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </ScrollArea>
              </motion.div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}