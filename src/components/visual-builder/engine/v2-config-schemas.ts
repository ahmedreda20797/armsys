/**
 * Universal Visual Builder — Dynamic Configuration Schemas (PART 4)
 * Each node type maps to a structured form schema (never raw JSON).
 * Consumes Workflow Foundation ActionType / TriggerType.
 */

import type { VBConfigSchema } from './v2-types';

const NOTIFY_CHANNELS = [
  { label: 'داخل التطبيق', value: 'in_app' },
  { label: 'بريد إلكتروني', value: 'email' },
  { label: 'SMS', value: 'sms' },
  { label: 'إشعار فوري', value: 'push' },
];

const SEVERITY = [
  { label: 'منخفضة', value: 'low' },
  { label: 'متوسطة', value: 'medium' },
  { label: 'عالية', value: 'high' },
  { label: 'حرجة', value: 'critical' },
];

export const CONFIG_SCHEMAS: Record<string, VBConfigSchema> = {
  /* ── Workflow nodes ────────────────────────────────────────────────── */
  start: {
    nodeType: 'start', title: 'Start', titleAr: 'البداية', icon: 'Play',
    groups: [{
      id: 'config', label: 'Configuration', labelAr: 'الإعدادات',
      fields: [
        { key: 'entryMessage', label: 'Entry Message', labelAr: 'رسالة البدء', type: 'text', placeholder: 'يبدأ المسار...' },
      ],
    }],
  },
  trigger: {
    nodeType: 'trigger', title: 'Trigger', titleAr: 'المحفز', icon: 'Zap',
    groups: [{
      id: 'config', label: 'Configuration', labelAr: 'الإعدادات',
      fields: [
        { key: 'triggerType', label: 'Trigger Type', labelAr: 'نوع المحفز', type: 'select', required: true, defaultValue: 'manual',
          options: [
            { label: 'يدوي', value: 'manual' }, { label: 'زر', value: 'button' },
            { label: 'API', value: 'api' }, { label: 'مجدول', value: 'scheduled' },
            { label: 'تغيير حالة', value: 'status_change' }, { label: 'فعل مستخدم', value: 'user_action' },
            { label: 'مؤقت', value: 'timer' }, { label: 'Webhook', value: 'webhook' },
          ] },
        { key: 'schedule', label: 'Schedule (cron)', labelAr: 'الجدولة', type: 'text', placeholder: '0 9 * * *', helperText: 'للمحفزات المجدولة' },
      ],
    }],
  },

  /* ── Logic nodes ───────────────────────────────────────────────────── */
  delay: {
    nodeType: 'delay', title: 'Delay', titleAr: 'تأخير', icon: 'Clock',
    groups: [{
      id: 'config', label: 'Duration', labelAr: 'المدة',
      fields: [
        { key: 'delayValue', label: 'Value', labelAr: 'القيمة', type: 'number', defaultValue: 1, required: true },
        { key: 'delayUnit', label: 'Unit', labelAr: 'الوحدة', type: 'select', defaultValue: 'hours',
          options: [
            { label: 'ثانية', value: 'seconds' }, { label: 'دقيقة', value: 'minutes' },
            { label: 'ساعة', value: 'hours' }, { label: 'يوم', value: 'days' },
          ] },
      ],
    }],
  },
  loop: {
    nodeType: 'loop', title: 'Loop', titleAr: 'حلقة', icon: 'RefreshCw',
    groups: [{
      id: 'config', label: 'Loop Settings', labelAr: 'إعدادات الحلقة',
      fields: [
        { key: 'loopType', label: 'Loop Type', labelAr: 'نوع الحلقة', type: 'select', defaultValue: 'count',
          options: [{ label: 'عدد مرات', value: 'count' }, { label: 'حتى شرط', value: 'until' }, { label: 'لكل عنصر', value: 'foreach' }] },
        { key: 'maxIterations', label: 'Max Iterations', labelAr: 'أقصى تكرار', type: 'number', defaultValue: 10, required: true },
        { key: 'loopVariable', label: 'Loop Variable', labelAr: 'متغير الحلقة', type: 'variable' },
      ],
    }],
  },

  /* ── Action nodes ──────────────────────────────────────────────────── */
  create_capa: {
    nodeType: 'create_capa', title: 'Create CAPA', titleAr: 'إنشاء كابا', icon: 'ShieldCheck',
    groups: [{
      id: 'capa', label: 'CAPA Fields', labelAr: 'حقول الكابا',
      fields: [
        { key: 'title', label: 'CAPA Title', labelAr: 'عنوان الكابا', type: 'text', required: true, placeholder: 'أدخل العنوان' },
        { key: 'severity', label: 'Severity', labelAr: 'الخطورة', type: 'select', required: true, defaultValue: 'medium', options: SEVERITY },
        { key: 'description', label: 'Description', labelAr: 'الوصف', type: 'textarea' },
        { key: 'dueDate', label: 'Due Date', labelAr: 'تاريخ الاستحقاق', type: 'variable' },
        { key: 'assignee', label: 'Assignee', labelAr: 'المسؤول', type: 'variable' },
      ],
    }],
  },
  notify: {
    nodeType: 'notify', title: 'Notify', titleAr: 'إشعار', icon: 'Bell',
    groups: [{
      id: 'notify', label: 'Notification Settings', labelAr: 'إعدادات الإشعار',
      fields: [
        { key: 'channel', label: 'Channel', labelAr: 'القناة', type: 'select', required: true, defaultValue: 'in_app', options: NOTIFY_CHANNELS },
        { key: 'recipient', label: 'Recipient', labelAr: 'المستلم', type: 'variable', required: true },
        { key: 'subject', label: 'Subject', labelAr: 'الموضوع', type: 'text' },
        { key: 'message', label: 'Message', labelAr: 'الرسالة', type: 'textarea', required: true },
      ],
    }],
  },
  create_follow_up: {
    nodeType: 'create_follow_up', title: 'Follow-Up', titleAr: 'متابعة', icon: 'ClipboardCheck',
    groups: [{
      id: 'fu', label: 'Follow-Up Settings', labelAr: 'إعدادات المتابعة',
      fields: [
        { key: 'title', label: 'Task Title', labelAr: 'عنوان المهمة', type: 'text', required: true },
        { key: 'assignee', label: 'Assignee', labelAr: 'المسؤول', type: 'variable', required: true },
        { key: 'dueInDays', label: 'Due In (days)', labelAr: 'خلال (أيام)', type: 'number', defaultValue: 3 },
        { key: 'priority', label: 'Priority', labelAr: 'الأولوية', type: 'select', defaultValue: 'medium', options: SEVERITY },
      ],
    }],
  },
  assign: {
    nodeType: 'assign', title: 'Assign', titleAr: 'تعيين', icon: 'UserCheck',
    groups: [{
      id: 'assign', label: 'Assignment', labelAr: 'التعيين',
      fields: [
        { key: 'assigneeType', label: 'Assign To', labelAr: 'التعيين إلى', type: 'select', defaultValue: 'user',
          options: [{ label: 'مستخدم', value: 'user' }, { label: 'دور', value: 'role' }, { label: 'قسم', value: 'department' }, { label: 'ديناميكي', value: 'dynamic' }] },
        { key: 'assigneeValue', label: 'Value', labelAr: 'القيمة', type: 'variable', required: true },
      ],
    }],
  },
  update_status: {
    nodeType: 'update_status', title: 'Update Status', titleAr: 'تحديث الحالة', icon: 'RefreshCcw',
    groups: [{
      id: 'status', label: 'Status Update', labelAr: 'تحديث الحالة',
      fields: [
        { key: 'target', label: 'Target Entity', labelAr: 'الكيان المستهدف', type: 'select', defaultValue: 'request',
          options: [{ label: 'طلب', value: 'request' }, { label: 'كابا', value: 'capa' }, { label: 'شكوى', value: 'complaint' }] },
        { key: 'targetId', label: 'Target ID', labelAr: 'معرف الهدف', type: 'variable', required: true },
        { key: 'newStatus', label: 'New Status', labelAr: 'الحالة الجديدة', type: 'text', required: true },
      ],
    }],
  },
  hr_action: {
    nodeType: 'hr_action', title: 'HR Action', titleAr: 'إجراء موارد بشرية', icon: 'Users',
    groups: [{
      id: 'hr', label: 'HR Settings', labelAr: 'إعدادات الموارد البشرية',
      fields: [
        { key: 'actionSubtype', label: 'Action Type', labelAr: 'نوع الإجراء', type: 'select', required: true,
          options: [{ label: 'خصم', value: 'deduction' }, { label: 'مكافأة', value: 'bonus' }, { label: 'تحذير', value: 'warning' }, { label: 'ترقية', value: 'promotion' }] },
        { key: 'employeeId', label: 'Employee', labelAr: 'الموظف', type: 'variable', required: true },
        { key: 'amount', label: 'Amount', labelAr: 'القيمة', type: 'number' },
        { key: 'reason', label: 'Reason', labelAr: 'السبب', type: 'textarea' },
      ],
    }],
  },
  quality_action: {
    nodeType: 'quality_action', title: 'Quality Action', titleAr: 'إجراء جودة', icon: 'Award',
    groups: [{
      id: 'qa', label: 'Quality Settings', labelAr: 'إعدادات الجودة',
      fields: [
        { key: 'actionSubtype', label: 'Action Type', labelAr: 'نوع الإجراء', type: 'select', required: true,
          options: [{ label: 'تدقيق', value: 'audit' }, { label: 'تفتيش', value: 'inspection' }, { label: 'مراجعة', value: 'review' }] },
        { key: 'targetId', label: 'Target', labelAr: 'الهدف', type: 'variable', required: true },
        { key: 'score', label: 'Score', labelAr: 'الدرجة', type: 'number' },
      ],
    }],
  },
  travel_action: {
    nodeType: 'travel_action', title: 'Travel Action', titleAr: 'إجراء سفر', icon: 'Plane',
    groups: [{
      id: 'travel', label: 'Travel Settings', labelAr: 'إعدادات السفر',
      fields: [
        { key: 'actionSubtype', label: 'Action Type', labelAr: 'نوع الإجراء', type: 'select', required: true,
          options: [{ label: 'حجز', value: 'booking' }, { label: 'اعتماد', value: 'approval' }, { label: 'إلغاء', value: 'cancellation' }] },
        { key: 'travelId', label: 'Travel Request', labelAr: 'طلب السفر', type: 'variable', required: true },
        { key: 'destination', label: 'Destination', labelAr: 'الوجهة', type: 'text' },
      ],
    }],
  },

  /* ── Variable nodes ────────────────────────────────────────────────── */
  set_variable: {
    nodeType: 'set_variable', title: 'Set Variable', titleAr: 'تعيين متغير', icon: 'PenLine',
    groups: [{
      id: 'var', label: 'Variable Assignment', labelAr: 'تعيين المتغير',
      fields: [
        { key: 'variableName', label: 'Variable Name', labelAr: 'اسم المتغير', type: 'text', required: true },
        { key: 'value', label: 'Value', labelAr: 'القيمة', type: 'variable' },
      ],
    }],
  },
  get_variable: {
    nodeType: 'get_variable', title: 'Get Variable', titleAr: 'قراءة متغير', icon: 'Eye',
    groups: [{
      id: 'var', label: 'Variable Read', labelAr: 'قراءة المتغير',
      fields: [
        { key: 'variableName', label: 'Variable Name', labelAr: 'اسم المتغير', type: 'text', required: true },
      ],
    }],
  },

  /* ── Request nodes ─────────────────────────────────────────────────── */
  create_request: {
    nodeType: 'create_request', title: 'Create Request', titleAr: 'إنشاء طلب', icon: 'FileText',
    groups: [{
      id: 'req', label: 'Request Fields', labelAr: 'حقول الطلب',
      fields: [
        { key: 'requestType', label: 'Request Type', labelAr: 'نوع الطلب', type: 'select', required: true,
          options: [{ label: 'عام', value: 'general' }, { label: 'صيانة', value: 'maintenance' }, { label: 'مشتريات', value: 'procurement' }] },
        { key: 'title', label: 'Title', labelAr: 'العنوان', type: 'text', required: true },
        { key: 'priority', label: 'Priority', labelAr: 'الأولوية', type: 'select', defaultValue: 'medium', options: SEVERITY },
        { key: 'description', label: 'Description', labelAr: 'الوصف', type: 'textarea' },
      ],
    }],
  },

  /* ── Future nodes ──────────────────────────────────────────────────── */
  send_email: {
    nodeType: 'send_email', title: 'Send Email', titleAr: 'إرسال بريد', icon: 'Mail',
    groups: [{
      id: 'email', label: 'Email Settings', labelAr: 'إعدادات البريد',
      fields: [
        { key: 'to', label: 'To', labelAr: 'إلى', type: 'variable', required: true },
        { key: 'subject', label: 'Subject', labelAr: 'الموضوع', type: 'text', required: true },
        { key: 'body', label: 'Body', labelAr: 'المحتوى', type: 'textarea', required: true },
        { key: 'isHtml', label: 'HTML Content', labelAr: 'محتوى HTML', type: 'boolean', defaultValue: false },
      ],
    }],
  },
  api_call: {
    nodeType: 'api_call', title: 'API Call', titleAr: 'استدعاء API', icon: 'Code2',
    groups: [{
      id: 'api', label: 'API Configuration', labelAr: 'إعدادات API',
      fields: [
        { key: 'method', label: 'Method', labelAr: 'الطريقة', type: 'select', defaultValue: 'GET',
          options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }, { label: 'PUT', value: 'PUT' }, { label: 'DELETE', value: 'DELETE' }] },
        { key: 'url', label: 'URL', labelAr: 'الرابط', type: 'text', required: true },
        { key: 'headers', label: 'Headers (JSON)', labelAr: 'الترويسات', type: 'textarea' },
        { key: 'body', label: 'Body', labelAr: 'المحتوى', type: 'textarea' },
      ],
    }],
  },
  webhook: {
    nodeType: 'webhook', title: 'Webhook', titleAr: 'Webhook', icon: 'Globe',
    groups: [{
      id: 'webhook', label: 'Webhook Configuration', labelAr: 'إعدادات Webhook',
      fields: [
        { key: 'url', label: 'Endpoint URL', labelAr: 'الرابط', type: 'text', required: true },
        { key: 'method', label: 'Method', labelAr: 'الطريقة', type: 'select', defaultValue: 'POST',
          options: [{ label: 'POST', value: 'POST' }, { label: 'PUT', value: 'PUT' }] },
        { key: 'secret', label: 'Secret', labelAr: 'السر', type: 'text' },
      ],
    }],
  },
  ai_action: {
    nodeType: 'ai_action', title: 'AI Action', titleAr: 'إجراء AI', icon: 'Sparkles',
    groups: [{
      id: 'ai', label: 'AI Configuration', labelAr: 'إعدادات AI',
      fields: [
        { key: 'model', label: 'Model', labelAr: 'النموذج', type: 'select', defaultValue: 'gpt-4',
          options: [{ label: 'GPT-4', value: 'gpt-4' }, { label: 'GPT-3.5', value: 'gpt-3.5' }, { label: 'مخصص', value: 'custom' }] },
        { key: 'prompt', label: 'Prompt', labelAr: 'الموجه', type: 'textarea', required: true },
        { key: 'temperature', label: 'Temperature', labelAr: 'الحرارة', type: 'number', defaultValue: 0.7 },
      ],
    }],
  },
};

/* Helper — get schema or null */
export function getConfigSchema(nodeType: string): VBConfigSchema | null {
  return CONFIG_SCHEMAS[nodeType] ?? null;
}
