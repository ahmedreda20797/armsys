/**
 * Universal Visual Builder — V2 Seed Catalogs
 * Variable sources (PART 5), Workflow templates (PART 9), Node templates (PART 8).
 * Pure data — no execution. Designed for the authoring experience.
 */

import type {
  VBVariableSource, VBWorkflowTemplate, VBNodeTemplate,
} from './v2-types';
import type { VBNode, VBEdge } from './types';
import { NODE_DEF_MAP } from '../nodes/nodeDefinitions';

/* ════════════════════════════════════════════════════════════════════════
   PART 5 — VARIABLE SOURCES (catalog for the Visual Variable Picker)
   ════════════════════════════════════════════════════════════════════════ */

export const VARIABLE_SOURCES: VBVariableSource[] = [
  {
    id: 'workflow', label: 'Workflow', labelAr: 'المسار', icon: 'Workflow',
    variables: [
      { id: 'wf-1', name: 'workflow.id', label: 'Workflow ID', labelAr: 'معرف المسار', type: 'string', scope: 'system', source: 'workflow', description: 'Unique workflow identifier' },
      { id: 'wf-2', name: 'workflow.name', label: 'Workflow Name', labelAr: 'اسم المسار', type: 'string', scope: 'system', source: 'workflow' },
      { id: 'wf-3', name: 'workflow.version', label: 'Version', labelAr: 'الإصدار', type: 'number', scope: 'system', source: 'workflow' },
    ],
  },
  {
    id: 'employee', label: 'Employee', labelAr: 'الموظف', icon: 'Users',
    variables: [
      { id: 'emp-1', name: 'employee.id', label: 'Employee ID', labelAr: 'رقم الموظف', type: 'string', scope: 'input', source: 'employee' },
      { id: 'emp-2', name: 'employee.name', label: 'Name', labelAr: 'الاسم', type: 'string', scope: 'input', source: 'employee' },
      { id: 'emp-3', name: 'employee.department', label: 'Department', labelAr: 'القسم', type: 'string', scope: 'input', source: 'employee' },
      { id: 'emp-4', name: 'employee.position', label: 'Position', labelAr: 'المسمى الوظيفي', type: 'string', scope: 'input', source: 'employee' },
      { id: 'emp-5', name: 'employee.manager', label: 'Manager', labelAr: 'المدير المباشر', type: 'string', scope: 'input', source: 'employee' },
      { id: 'emp-6', name: 'employee.hireDate', label: 'Hire Date', labelAr: 'تاريخ التعيين', type: 'date', scope: 'input', source: 'employee' },
    ],
  },
  {
    id: 'attendance', label: 'Attendance', labelAr: 'الحضور', icon: 'Clock',
    variables: [
      { id: 'att-1', name: 'attendance.id', label: 'Attendance ID', labelAr: 'معرف الحضور', type: 'string', scope: 'input', source: 'attendance' },
      { id: 'att-2', name: 'attendance.checkIn', label: 'Check In', labelAr: 'وقت الحضور', type: 'date', scope: 'input', source: 'attendance' },
      { id: 'att-3', name: 'attendance.checkOut', label: 'Check Out', labelAr: 'وقت الانصراف', type: 'date', scope: 'input', source: 'attendance' },
      { id: 'att-4', name: 'attendance.status', label: 'Status', labelAr: 'الحالة', type: 'string', scope: 'computed', source: 'attendance' },
    ],
  },
  {
    id: 'capa', label: 'CAPA', labelAr: 'الكابا', icon: 'ShieldCheck',
    variables: [
      { id: 'cap-1', name: 'capa.id', label: 'CAPA ID', labelAr: 'معرف الكابا', type: 'string', scope: 'output', source: 'capa' },
      { id: 'cap-2', name: 'capa.severity', label: 'Severity', labelAr: 'الخطورة', type: 'string', scope: 'input', source: 'capa' },
      { id: 'cap-3', name: 'capa.dueDate', label: 'Due Date', labelAr: 'تاريخ الاستحقاق', type: 'date', scope: 'input', source: 'capa' },
    ],
  },
  {
    id: 'quality', label: 'Quality', labelAr: 'الجودة', icon: 'Award',
    variables: [
      { id: 'qa-1', name: 'quality.score', label: 'Score', labelAr: 'الدرجة', type: 'number', scope: 'computed', source: 'quality' },
      { id: 'qa-2', name: 'quality.auditId', label: 'Audit ID', labelAr: 'معرف التدقيق', type: 'string', scope: 'input', source: 'quality' },
    ],
  },
  {
    id: 'risk', label: 'Risk', labelAr: 'المخاطر', icon: 'AlertTriangle',
    variables: [
      { id: 'rsk-1', name: 'risk.id', label: 'Risk ID', labelAr: 'معرف المخاطرة', type: 'string', scope: 'input', source: 'risk' },
      { id: 'rsk-2', name: 'risk.level', label: 'Risk Level', labelAr: 'مستوى المخاطرة', type: 'string', scope: 'computed', source: 'risk' },
    ],
  },
  {
    id: 'travel', label: 'Travel', labelAr: 'السفر', icon: 'Plane',
    variables: [
      { id: 'trv-1', name: 'travel.id', label: 'Travel ID', labelAr: 'معرف السفر', type: 'string', scope: 'input', source: 'travel' },
      { id: 'trv-2', name: 'travel.destination', label: 'Destination', labelAr: 'الوجهة', type: 'string', scope: 'input', source: 'travel' },
      { id: 'trv-3', name: 'travel.cost', label: 'Cost', labelAr: 'التكلفة', type: 'number', scope: 'input', source: 'travel' },
    ],
  },
  {
    id: 'hr', label: 'HR', labelAr: 'الموارد البشرية', icon: 'Users',
    variables: [
      { id: 'hr-1', name: 'hr.requestId', label: 'HR Request ID', labelAr: 'معرف طلب الموارد البشرية', type: 'string', scope: 'input', source: 'hr' },
      { id: 'hr-2', name: 'hr.type', label: 'Request Type', labelAr: 'نوع الطلب', type: 'string', scope: 'input', source: 'hr' },
    ],
  },
  {
    id: 'requests', label: 'Requests', labelAr: 'الطلبات', icon: 'FileText',
    variables: [
      { id: 'req-1', name: 'request.id', label: 'Request ID', labelAr: 'معرف الطلب', type: 'string', scope: 'input', source: 'requests' },
      { id: 'req-2', name: 'request.type', label: 'Type', labelAr: 'النوع', type: 'string', scope: 'input', source: 'requests' },
      { id: 'req-3', name: 'request.priority', label: 'Priority', labelAr: 'الأولوية', type: 'string', scope: 'input', source: 'requests' },
    ],
  },
  {
    id: 'notifications', label: 'Notifications', labelAr: 'الإشعارات', icon: 'Bell',
    variables: [
      { id: 'ntf-1', name: 'notification.id', label: 'Notification ID', labelAr: 'معرف الإشعار', type: 'string', scope: 'output', source: 'notifications' },
      { id: 'ntf-2', name: 'notification.channel', label: 'Channel', labelAr: 'القناة', type: 'string', scope: 'input', source: 'notifications' },
    ],
  },
  {
    id: 'system', label: 'System Variables', labelAr: 'متغيرات النظام', icon: 'Cpu',
    variables: [
      { id: 'sys-1', name: 'system.now', label: 'Current Time', labelAr: 'الوقت الحالي', type: 'date', scope: 'system', source: 'system' },
      { id: 'sys-2', name: 'system.user.id', label: 'Current User ID', labelAr: 'المستخدم الحالي', type: 'string', scope: 'system', source: 'system' },
      { id: 'sys-3', name: 'system.user.role', label: 'Current Role', labelAr: 'دور المستخدم', type: 'string', scope: 'system', source: 'system' },
      { id: 'sys-4', name: 'system.execution.id', label: 'Execution ID', labelAr: 'معرف التنفيذ', type: 'string', scope: 'system', source: 'system' },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
   PART 8 — NODE TEMPLATES (starter library)
   ════════════════════════════════════════════════════════════════════════ */

export const NODE_TEMPLATES: VBNodeTemplate[] = [
  {
    id: 'tpl-notify-manager',
    name: 'إشعار المدير',
    description: 'يرسل إشعاراً للمدير المباشر',
    category: 'actions', nodeType: 'notify',
    config: { label: 'إشعار المدير', description: '', config: { channel: 'in_app', recipient: '{{employee.manager}}' }, inputs: [], onError: 'skip', metadata: {}, documentation: '' },
    tags: ['إشعار', 'مدير'], favorite: true,
    createdAt: '2026-01-01', createdBy: 'system', usageCount: 42,
  },
  {
    id: 'tpl-high-priority-capa',
    name: 'كابا عالية الأولوية',
    description: 'إنشاء كابا ذات خطورة عالية',
    category: 'actions', nodeType: 'create_capa',
    config: { label: 'كابا عالية', description: '', config: { severity: 'high' }, inputs: [], onError: 'escalate', metadata: {}, documentation: '' },
    tags: ['كابا', 'عاجل'], favorite: false,
    createdAt: '2026-01-01', createdBy: 'system', usageCount: 18,
  },
];

/* ════════════════════════════════════════════════════════════════════════
   PART 9 — WORKFLOW TEMPLATES
   ════════════════════════════════════════════════════════════════════════ */

let nid = 0;
function nId(t: string) { nid += 1; return `${t}_tpl${nid}`; }
let eid = 0;
function eId() { eid += 1; return `tpl_edge_${eid}`; }

function makeNode(type: string, x: number, y: number): VBNode {
  const def = NODE_DEF_MAP.get(type);
  if (!def) throw new Error(`Unknown node type: ${type}`);
  return {
    id: nId(type),
    type: 'workflowNode',
    position: { x, y },
    data: {
      definition: def,
      label: def.label,
      description: def.description,
      status: 'idle',
      config: { ...(def.defaultData ?? {}) },
      validationErrors: [],
    },
  };
}

function edge(s: VBNode, t: VBNode, sh?: string, th?: string): VBEdge {
  return { id: eId(), source: s.id, target: t.id, sourceHandle: sh ?? 'out', targetHandle: th ?? 'in', type: 'default' };
}

function linearTemplate(types: string[], gap = 280): { nodes: VBNode[]; edges: VBEdge[] } {
  const nodes = types.map((t, i) => makeNode(t, i * gap, 200));
  const edges: VBEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push(edge(nodes[i], nodes[i + 1]));
  return { nodes, edges };
}

export const WORKFLOW_TEMPLATES: VBWorkflowTemplate[] = [
  {
    id: 'wf-tpl-capa',
    name: 'CAPA Workflow', nameAr: 'مسار الكابا',
    description: 'Corrective and Preventive Action workflow', descriptionAr: 'مسار الإجراءات التصحيحية والوقائية',
    category: 'quality', module: 'capa', icon: 'ShieldCheck',
    tags: ['quality', 'capa'], popularity: 95, builtIn: true,
    ...linearTemplate(['start', 'create_capa', 'notify', 'end']),
    variables: [],
    documentation: { businessImpact: 'high', complexity: 'medium' },
  },
  {
    id: 'wf-tpl-complaint',
    name: 'Complaint Workflow', nameAr: 'مسار الشكاوى',
    description: 'Customer complaint resolution', descriptionAr: 'حل شكاوى العملاء',
    category: 'quality', module: 'complaints', icon: 'MessageSquareWarning',
    tags: ['quality', 'complaints'], popularity: 88, builtIn: true,
    ...linearTemplate(['start', 'create_request', 'condition', 'create_capa', 'end']),
    variables: [],
    documentation: { businessImpact: 'high', complexity: 'medium' },
  },
  {
    id: 'wf-tpl-onboarding',
    name: 'Employee Onboarding', nameAr: 'إلحاق موظف',
    description: 'New employee onboarding process', descriptionAr: 'عملية إلحاق موظف جديد',
    category: 'hr', module: 'employee360', icon: 'UserPlus',
    tags: ['hr', 'employee'], popularity: 82, builtIn: true,
    ...linearTemplate(['start', 'hr_action', 'notify', 'create_follow_up', 'end']),
    variables: [],
    documentation: { businessImpact: 'medium', complexity: 'low' },
  },
  {
    id: 'wf-tpl-vacation',
    name: 'Vacation Approval', nameAr: 'اعتماد إجازة',
    description: 'Vacation request approval chain', descriptionAr: 'سلسلة اعتماد طلب الإجازة',
    category: 'hr', module: 'hr', icon: 'Calendar',
    tags: ['hr', 'approval'], popularity: 91, builtIn: true,
    ...linearTemplate(['start', 'condition', 'notify', 'end']),
    variables: [],
    documentation: { businessImpact: 'medium', complexity: 'low' },
  },
  {
    id: 'wf-tpl-travel',
    name: 'Travel Approval', nameAr: 'اعتماد سفر',
    description: 'Business travel approval', descriptionAr: 'اعتماد سفر عمل',
    category: 'travel', module: 'travel', icon: 'Plane',
    tags: ['travel', 'approval'], popularity: 76, builtIn: true,
    ...linearTemplate(['start', 'condition', 'assign', 'notify', 'end']),
    variables: [],
    documentation: { businessImpact: 'medium', complexity: 'medium' },
  },
  {
    id: 'wf-tpl-quality-audit',
    name: 'Quality Audit', nameAr: 'تدقيق الجودة',
    description: 'Quality audit workflow', descriptionAr: 'مسار تدقيق الجودة',
    category: 'quality', module: 'quality', icon: 'Award',
    tags: ['quality', 'audit'], popularity: 70, builtIn: true,
    ...linearTemplate(['start', 'quality_action', 'condition', 'generate_report', 'end']),
    variables: [],
    documentation: { businessImpact: 'high', complexity: 'high' },
  },
  {
    id: 'wf-tpl-risk',
    name: 'Risk Investigation', nameAr: 'تحقيق المخاطر',
    description: 'Risk investigation workflow', descriptionAr: 'مسار تحقيق المخاطر',
    category: 'quality', module: 'risk', icon: 'AlertTriangle',
    tags: ['risk'], popularity: 65, builtIn: true,
    ...linearTemplate(['start', 'risk_action', 'condition', 'escalate', 'end']),
    variables: [],
    documentation: { businessImpact: 'critical', complexity: 'high' },
  },
  {
    id: 'wf-tpl-followup',
    name: 'Follow-Up Workflow', nameAr: 'مسار المتابعات',
    description: 'Task follow-up automation', descriptionAr: 'أتمتة متابعة المهام',
    category: 'operations', module: 'follow_up', icon: 'ClipboardCheck',
    tags: ['follow_up'], popularity: 80, builtIn: true,
    ...linearTemplate(['start', 'create_follow_up', 'delay', 'notify', 'end']),
    variables: [],
    documentation: { businessImpact: 'medium', complexity: 'low' },
  },
  {
    id: 'wf-tpl-hr-approval',
    name: 'HR Approval', nameAr: 'اعتماد الموارد البشرية',
    description: 'HR request approval workflow', descriptionAr: 'مسار اعتماد طلبات الموارد البشرية',
    category: 'hr', module: 'hr', icon: 'Users',
    tags: ['hr', 'approval'], popularity: 85, builtIn: true,
    ...linearTemplate(['start', 'hr_action', 'condition', 'update_status', 'notify', 'end']),
    variables: [],
    documentation: { businessImpact: 'high', complexity: 'medium' },
  },
];

/* ════════════════════════════════════════════════════════════════════════
   PART 1 — Sample workflow records for the Explorer
   ════════════════════════════════════════════════════════════════════════ */

import type { VBWorkflowRecord } from './v2-types';

export const SAMPLE_WORKFLOWS: VBWorkflowRecord[] = [
  {
    id: 'wf-1', name: 'كابا - إجراء تصحيحي', description: 'مسار معالجة الإجراءات التصحيحية والوقائية',
    module: 'capa', category: 'quality', ownerId: 'u1', ownerName: 'أحمد', status: 'published',
    folder: 'published', tags: ['quality', 'capa'], favorite: true, currentVersion: 3, publishedVersion: 2,
    nodeCount: 8, createdAt: '2026-05-10', updatedAt: '2026-07-01', lastOpenedAt: '2026-07-15',
    documentation: { purpose: 'ضمان معالجة عدم المطابقات', description: '', ownerId: 'u1', ownerName: 'أحمد', businessUnit: 'الجودة', department: 'إدارة الجودة', tags: ['quality'], versionNotes: 'إضافة خطوة الإشعار', relatedModules: ['capa', 'quality'], businessImpact: 'high', estimatedRuntimeMs: 5000, complexity: 'medium' },
  },
  {
    id: 'wf-2', name: 'اعتماد إجازة', description: 'مسار اعتماد طلبات الإجازات',
    module: 'hr', category: 'hr', ownerId: 'u2', ownerName: 'سارة', status: 'draft',
    folder: 'draft', tags: ['hr', 'approval'], favorite: false, currentVersion: 1, publishedVersion: null,
    nodeCount: 5, createdAt: '2026-06-20', updatedAt: '2026-07-10', lastOpenedAt: '2026-07-14',
    documentation: { purpose: 'اعتماد طلبات الإجازة', description: '', ownerId: 'u2', ownerName: 'سارة', businessUnit: 'الموارد البشرية', department: 'إدارة شؤون الموظفين', tags: ['hr'], versionNotes: '', relatedModules: ['hr'], businessImpact: 'medium', estimatedRuntimeMs: 3000, complexity: 'low' },
  },
  {
    id: 'wf-3', name: 'اعتماد سفر', description: 'مسار اعتماد طلبات السفر',
    module: 'travel', category: 'travel', ownerId: 'u1', ownerName: 'أحمد', status: 'published',
    folder: 'published', tags: ['travel'], favorite: true, currentVersion: 2, publishedVersion: 2,
    nodeCount: 6, createdAt: '2026-04-15', updatedAt: '2026-06-30', lastOpenedAt: '2026-07-12',
    documentation: { purpose: 'اعتماد سفر العمل', description: '', ownerId: 'u1', ownerName: 'أحمد', businessUnit: 'العمليات', department: 'إدارة السفر', tags: ['travel'], versionNotes: '', relatedModules: ['travel'], businessImpact: 'medium', estimatedRuntimeMs: 4000, complexity: 'medium' },
  },
  {
    id: 'wf-4', name: 'متابعة يومية (مؤرشف)', description: 'مسار متابعة قديم',
    module: 'follow_up', category: 'operations', ownerId: 'u3', ownerName: 'محمد', status: 'archived',
    folder: 'archived', tags: ['follow_up'], favorite: false, currentVersion: 4, publishedVersion: 3,
    nodeCount: 4, createdAt: '2025-11-01', updatedAt: '2026-03-01', lastOpenedAt: '2026-05-01',
    documentation: { purpose: 'متابعة المهام اليومية', description: '', ownerId: 'u3', ownerName: 'محمد', businessUnit: 'العمليات', department: 'المتابعة', tags: [], versionNotes: '', relatedModules: ['follow_up'], businessImpact: 'low', estimatedRuntimeMs: 2000, complexity: 'low' },
  },
];
