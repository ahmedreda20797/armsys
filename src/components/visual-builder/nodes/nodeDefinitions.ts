/**
 * Workflow Designer — Node Definitions
 * Maps Workflow Foundation types to Visual Builder node definitions.
 * Consumes: WorkflowStep types, ActionType, TriggerType from @/workflow/types
 */

import type { VBNodeDefinition } from '../engine/types';

export interface NodeCategory {
  id: string;
  label: string;
  labelAr: string;
  icon: string;
  color: string;
}

export const NODE_CATEGORIES: NodeCategory[] = [
  { id: 'workflow',   label: 'Workflow',   labelAr: 'المسار',       icon: 'GitBranch',    color: 'violet' },
  { id: 'logic',      label: 'Logic',      labelAr: 'المنطق',       icon: 'Cpu',          color: 'amber'  },
  { id: 'variables',  label: 'Variables',  labelAr: 'المتغيرات',    icon: 'Variable',     color: 'cyan'   },
  { id: 'actions',    label: 'Actions',    labelAr: 'الإجراءات',    icon: 'Zap',          color: 'emerald'},
  { id: 'requests',   label: 'Requests',   labelAr: 'الطلبات',      icon: 'FileText',     color: 'blue'   },
  { id: 'future',     label: 'Future',     labelAr: 'مستقبلي',      icon: 'Sparkles',     color: 'pink'   },
];

const io = (label: string) => [
  { id: 'in',  label, type: 'input'  as const },
  { id: 'out', label, type: 'output' as const },
];

export const WORKFLOW_NODE_DEFINITIONS: VBNodeDefinition[] = [
  // ── Workflow ──────────────────────────────────────────────
  {
    type: 'start',
    category: 'workflow',
    label: 'بداية',
    description: 'نقطة بداية المسار',
    icon: 'Play',
    color: 'bg-emerald-500',
    ports: [{ id: 'out', label: 'التالي', type: 'output' }],
    isSingleton: true,
  },
  {
    type: 'end',
    category: 'workflow',
    label: 'نهاية',
    description: 'نقطة نهاية المسار',
    icon: 'Square',
    color: 'bg-red-500',
    ports: [{ id: 'in', label: 'السابق', type: 'input' }],
  },
  {
    type: 'trigger',
    category: 'workflow',
    label: 'محفز',
    description: 'يبدأ المسار عند حدث معين',
    icon: 'Zap',
    color: 'bg-violet-500',
    ports: [{ id: 'out', label: 'التالي', type: 'output' }],
    defaultData: { triggerType: 'manual' },
  },
  // ── Logic ─────────────────────────────────────────────────
  {
    type: 'condition',
    category: 'logic',
    label: 'شرط (إذا)',
    description: 'تفرع بناءً على شرط',
    icon: 'GitBranch',
    color: 'bg-amber-500',
    ports: [
      { id: 'in',  label: 'الدخل',  type: 'input'  },
      { id: 'yes', label: 'نعم',    type: 'output' },
      { id: 'no',  label: 'لا',     type: 'output' },
    ],
  },
  {
    type: 'switch',
    category: 'logic',
    label: 'تبديل',
    description: 'تفرع متعدد الحالات',
    icon: 'Shuffle',
    color: 'bg-orange-500',
    ports: [
      { id: 'in',      label: 'الدخل',   type: 'input'  },
      { id: 'case1',   label: 'حالة 1',  type: 'output' },
      { id: 'case2',   label: 'حالة 2',  type: 'output' },
      { id: 'default', label: 'افتراضي', type: 'output' },
    ],
  },
  {
    type: 'merge',
    category: 'logic',
    label: 'دمج',
    description: 'يدمج مسارات متعددة',
    icon: 'Merge',
    color: 'bg-yellow-600',
    ports: [
      { id: 'in1', label: 'مدخل 1', type: 'input'  },
      { id: 'in2', label: 'مدخل 2', type: 'input'  },
      { id: 'out', label: 'الخرج',  type: 'output' },
    ],
  },
  {
    type: 'delay',
    category: 'logic',
    label: 'تأخير',
    description: 'ينتظر مدة زمنية محددة',
    icon: 'Clock',
    color: 'bg-slate-500',
    ports: io(''),
    defaultData: { delayMs: 3600000 },
  },
  {
    type: 'loop',
    category: 'logic',
    label: 'حلقة',
    description: 'يكرر مجموعة من الخطوات',
    icon: 'RefreshCw',
    color: 'bg-indigo-500',
    ports: [
      { id: 'in',   label: 'الدخل',  type: 'input'  },
      { id: 'body', label: 'الجسم',  type: 'output' },
      { id: 'done', label: 'انتهى',  type: 'output' },
    ],
  },
  // ── Variables ─────────────────────────────────────────────
  {
    type: 'set_variable',
    category: 'variables',
    label: 'تعيين متغير',
    description: 'يعين قيمة لمتغير',
    icon: 'PenLine',
    color: 'bg-cyan-600',
    ports: io(''),
    defaultData: { variableName: '', value: '' },
  },
  {
    type: 'get_variable',
    category: 'variables',
    label: 'قراءة متغير',
    description: 'يقرأ قيمة متغير',
    icon: 'Eye',
    color: 'bg-teal-600',
    ports: io(''),
    defaultData: { variableName: '' },
  },
  {
    type: 'math',
    category: 'variables',
    label: 'عملية حسابية',
    description: 'يجري عملية حسابية',
    icon: 'Calculator',
    color: 'bg-sky-600',
    ports: io(''),
  },
  {
    type: 'compare',
    category: 'variables',
    label: 'مقارنة',
    description: 'يقارن قيمتين',
    icon: 'Scale',
    color: 'bg-blue-600',
    ports: [
      { id: 'in',    label: 'الدخل',  type: 'input'  },
      { id: 'true',  label: 'صحيح',   type: 'output' },
      { id: 'false', label: 'خطأ',    type: 'output' },
    ],
  },
  // ── Actions ───────────────────────────────────────────────
  {
    type: 'create_capa',
    category: 'actions',
    label: 'إنشاء كابا',
    description: 'ينشئ حالة كابا جديدة',
    icon: 'ShieldCheck',
    color: 'bg-emerald-600',
    ports: io(''),
    defaultData: { actionType: 'create_capa' },
  },
  {
    type: 'create_follow_up',
    category: 'actions',
    label: 'إنشاء متابعة',
    description: 'ينشئ مهمة متابعة',
    icon: 'ClipboardCheck',
    color: 'bg-green-600',
    ports: io(''),
    defaultData: { actionType: 'create_follow_up' },
  },
  {
    type: 'notify',
    category: 'actions',
    label: 'إشعار',
    description: 'يرسل إشعاراً للمستخدمين',
    icon: 'Bell',
    color: 'bg-blue-500',
    ports: io(''),
    defaultData: { actionType: 'send_notification' },
  },
  {
    type: 'assign',
    category: 'actions',
    label: 'تعيين',
    description: 'يعين مهمة لمستخدم أو دور',
    icon: 'UserCheck',
    color: 'bg-violet-600',
    ports: io(''),
    defaultData: { actionType: 'assign_user' },
  },
  {
    type: 'update_status',
    category: 'actions',
    label: 'تحديث الحالة',
    description: 'يحدث حالة سجل',
    icon: 'RefreshCcw',
    color: 'bg-indigo-600',
    ports: io(''),
    defaultData: { actionType: 'update_status' },
  },
  {
    type: 'hr_action',
    category: 'actions',
    label: 'إجراء HR',
    description: 'ينفذ إجراء موارد بشرية',
    icon: 'Users',
    color: 'bg-pink-600',
    ports: io(''),
    defaultData: { actionType: 'create_hr_action' },
  },
  {
    type: 'quality_action',
    category: 'actions',
    label: 'إجراء جودة',
    description: 'ينفذ إجراء جودة',
    icon: 'Award',
    color: 'bg-amber-600',
    ports: io(''),
  },
  {
    type: 'travel_action',
    category: 'actions',
    label: 'إجراء سفر',
    description: 'ينفذ إجراء سفر',
    icon: 'Plane',
    color: 'bg-sky-600',
    ports: io(''),
  },
  // ── Requests ──────────────────────────────────────────────
  {
    type: 'create_request',
    category: 'requests',
    label: 'إنشاء طلب',
    description: 'ينشئ طلباً جديداً',
    icon: 'FileText',
    color: 'bg-blue-600',
    ports: io(''),
    defaultData: { actionType: 'create_request' },
  },
  {
    type: 'risk_action',
    category: 'requests',
    label: 'إجراء مخاطر',
    description: 'يسجل أو يحدث مخاطرة',
    icon: 'AlertTriangle',
    color: 'bg-red-600',
    ports: io(''),
  },
  {
    type: 'generate_report',
    category: 'requests',
    label: 'تقرير',
    description: 'يولد تقريراً',
    icon: 'BarChart3',
    color: 'bg-teal-600',
    ports: io(''),
    defaultData: { actionType: 'generate_report' },
  },
  // ── Future ────────────────────────────────────────────────
  {
    type: 'webhook',
    category: 'future',
    label: 'Webhook',
    description: 'يستدعي رابط خارجي',
    icon: 'Globe',
    color: 'bg-slate-600',
    ports: io(''),
  },
  {
    type: 'api_call',
    category: 'future',
    label: 'API Call',
    description: 'يستدعي واجهة برمجية',
    icon: 'Code2',
    color: 'bg-slate-600',
    ports: io(''),
  },
  {
    type: 'send_email',
    category: 'future',
    label: 'بريد إلكتروني',
    description: 'يرسل بريداً إلكترونياً',
    icon: 'Mail',
    color: 'bg-slate-600',
    ports: io(''),
    defaultData: { actionType: 'send_email' },
  },
  {
    type: 'ai_action',
    category: 'future',
    label: 'إجراء AI',
    description: 'يستدعي نموذج ذكاء اصطناعي',
    icon: 'Sparkles',
    color: 'bg-gradient-to-r from-violet-600 to-pink-600',
    ports: io(''),
  },
];

export const NODE_DEF_MAP = new Map(WORKFLOW_NODE_DEFINITIONS.map((d) => [d.type, d]));
