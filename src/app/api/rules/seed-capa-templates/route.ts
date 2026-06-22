import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { AutomationRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  POST /api/rules/seed-capa-templates
//  Seeds 6 built-in CAPA automation templates (draft, not auto-enabled)
// ══════════════════════════════════════════════════════════════

// Helper: auto-generate scoped IDs for conditions & actions
function c(prefix: string, idx: number) { return `tpl-${prefix}-c${idx}`; }
function a(prefix: string, idx: number) { return `tpl-${prefix}-a${idx}`; }

const CAPA_TEMPLATES = [
  {
    // Template 1: 3 Quality Violations in 30 Days → Create CAPA
    name: '3 مخالفات جودة في 30 يوم — إنشاء CAPA',
    nameEn: '3 Quality Violations in 30 Days → Create CAPA',
    description: 'ينشئ حالة CAPA تلقائياً عندما يصل عدد مخالفات الجودة للموظف إلى 3 أو أكثر خلال آخر 30 يوم.',
    module: 'quality',
    priority: 'high' as const,
    status: 'draft' as const,
    triggerType: 'threshold_reached',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('q30d', 1),
          field: 'qualityViolationCount30d',
          operator: 'greater_than' as const,
          value: '2',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('q30d', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تلقائي: مخالفات جودة متكررة',
          description: 'الموظف لديه 3 أو أكثر مخالفات جودة خلال آخر 30 يوم. يتطلب تحليل سبب جذري وإجراء تصحيحي.',
          priority: 'high',
          issueCategory: 'quality_issue',
          actionUrl: null,
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 10080, // 7 days
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
  {
    // Template 2: Risk Score Above Threshold → Create CAPA
    name: 'درجة مخاطر أعلى من الحد — إنشاء CAPA',
    nameEn: 'Risk Score Above Threshold → Create CAPA',
    description: 'ينشئ حالة CAPA تلقائياً عندما تتجاوز درجة مخاطر الموظف الحد المحدد (36+ = critical).',
    module: 'riskCenter',
    priority: 'critical' as const,
    status: 'draft' as const,
    triggerType: 'threshold_reached',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('risk', 1),
          field: 'riskScore',
          operator: 'greater_than' as const,
          value: '35',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('risk', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تلقائي: درجة مخاطر حرجة',
          description: 'درجة مخاطر الموظف تجاوزت الحد الحرج. يتطلب مراجعة فورية وإنشاء خطة تصحيحية.',
          priority: 'critical',
          issueCategory: 'behavior_issue',
          actionUrl: null,
        },
      },
      {
        id: a('risk', 2),
        type: 'create_notification' as const,
        config: {
          title: 'تنبيه حرج: درجة مخاطر عالية',
          description: 'تم تجاوز حد المخاطر لدرجة حرجة. تم إنشاء حالة CAPA تلقائياً.',
          priority: 'critical',
          category: 'risk',
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 4320, // 3 days
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
  {
    // Template 3: Critical Complaint → Create CAPA
    name: 'شكوى حرجة — إنشاء CAPA',
    nameEn: 'Critical Complaint → Create CAPA',
    description: 'ينشئ حالة CAPA تلقائياً عند تسجيل شكوى عميل بشدة حرجة.',
    module: 'complaints',
    priority: 'critical' as const,
    status: 'draft' as const,
    triggerType: 'record_created',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('comp', 1),
          field: 'severity',
          operator: 'equals' as const,
          value: 'critical',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('comp', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تلقائي: شكوى عميل حرجة',
          description: 'تم تسجيل شكوى عميل بشدة حرجة. يتطلب تحقيق فوري وإنشاء إجراء تصحيحي.',
          priority: 'critical',
          issueCategory: 'customer_complaint',
          actionUrl: null,
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 1440, // 1 day
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
  {
    // Template 4: Repeated Follow-Up → Create CAPA
    name: 'متابعة متكررة — إنشاء CAPA',
    nameEn: 'Repeated Follow-Up → Create CAPA',
    description: 'ينشئ حالة CAPA تلقائياً عند وجود 3 حالات متابعة لنفس النوع خلال 30 يوم.',
    module: 'followUps',
    priority: 'high' as const,
    status: 'draft' as const,
    triggerType: 'threshold_reached',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('fup', 1),
          field: 'repeatedFollowUps',
          operator: 'greater_than' as const,
          value: '2',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('fup', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تلقائي: متابعة متكررة',
          description: 'الموظف لديه 3 حالات متابعة متكررة لنفس النوع خلال 30 يوم. يتطلب تحليل السبب الجذري.',
          priority: 'high',
          issueCategory: 'behavior_issue',
          actionUrl: null,
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 10080, // 7 days
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
  {
    // Template 5: Repeated HR Violations → Create CAPA
    name: 'مخالفات HR متكررة — إنشاء CAPA',
    nameEn: 'Repeated HR Violations → Create CAPA',
    description: 'ينشئ حالة CAPA تلقائياً عند وجود 3 خصومات HR أو أكثر خلال آخر 30 يوم.',
    module: 'hrDeductions',
    priority: 'high' as const,
    status: 'draft' as const,
    triggerType: 'threshold_reached',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('hrd', 1),
          field: 'hrDeductionCount30d',
          operator: 'greater_than' as const,
          value: '2',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('hrd', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تلقائي: مخالفات HR متكررة',
          description: 'الموظف لديه 3 خصومات HR أو أكثر خلال 30 يوم. يتطلب مراجعة السلوك وإنشاء خطة تحسين.',
          priority: 'high',
          issueCategory: 'behavior_issue',
          actionUrl: null,
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 10080, // 7 days
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
  {
    // Template 6: Manual Escalation → Create CAPA
    name: 'تصعيد يدوي — إنشاء CAPA',
    nameEn: 'Manual Escalation → Create CAPA',
    description: 'قالب لتصعيد يدوي: ينشئ حالة CAPA عند تشغيل يدوي من قبل المدير.',
    module: 'capa',
    priority: 'medium' as const,
    status: 'draft' as const,
    triggerType: 'manual',
    schedule: null,
    conditions: {
      logic: 'and' as const,
      conditions: [
        {
          id: c('esc', 1),
          field: 'escalationRequested',
          operator: 'equals' as const,
          value: 'true',
        },
      ],
      groups: [],
    },
    actions: [
      {
        id: a('esc', 1),
        type: 'create_capa' as const,
        config: {
          title: 'كابا تصعيد يدوي',
          description: 'تم إنشاء حالة CAPA عبر تصعيد يدوي من المدير.',
          priority: 'medium',
          issueCategory: 'other',
          actionUrl: null,
        },
      },
    ],
    escalationConfig: null,
    throttleMinutes: 0,
    createdById: 'system',
    createdByName: 'قوالب CAPA',
    isTemplate: true,
    templateCategory: 'capa',
  },
];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existingRules = await getAll<AutomationRule>('automationRules', TTL.LONG);

    // Check which templates already exist by name
    const existingNames = new Set(existingRules.map(r => r.name));
    const toCreate = CAPA_TEMPLATES.filter(t => !existingNames.has(t.name));

    if (toCreate.length === 0) {
      return NextResponse.json({
        message: 'All CAPA templates already exist',
        created: 0,
        skipped: CAPA_TEMPLATES.length,
        total: CAPA_TEMPLATES.length,
      });
    }

    const created: AutomationRule[] = [];
    for (const template of toCreate) {
      const rule = await createRecord<AutomationRule>('automationRules', {
        ...template,
        lastRunAt: null,
        lastTriggeredBy: null,
        totalExecutions: 0,
        successCount: 0,
        failCount: 0,
      } as any);
      created.push(rule);
    }

    return NextResponse.json({
      message: `Successfully created ${created.length} CAPA templates`,
      created: created.length,
      skipped: CAPA_TEMPLATES.length - created.length,
      total: CAPA_TEMPLATES.length,
      templates: created.map(r => ({ id: r.id, name: r.name, status: r.status })),
    });
  } catch (error) {
    console.error('[POST /api/rules/seed-capa-templates] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — List existing CAPA templates
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rules = await getAll<AutomationRule>('automationRules', TTL.LONG);
    const capaTemplates = rules.filter(
      (r) => (r as any).isTemplate === true && (r as any).templateCategory === 'capa'
    );

    return NextResponse.json({
      data: capaTemplates,
      total: capaTemplates.length,
    });
  } catch (error) {
    console.error('[GET /api/rules/seed-capa-templates] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}