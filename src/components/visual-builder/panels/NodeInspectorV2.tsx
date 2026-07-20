'use client';

/**
 * PART 3 — Node Inspector V2
 * Professional 14-tab inspector. Lazy-loads tab content for performance.
 * Replaces the basic PropertiesPanel with a complete authoring surface.
 * Includes "Save Node as Template" (PART 8) in the header.
 */

import React, { memo, useState, Suspense, lazy } from 'react';
import {
  Settings, SlidersHorizontal, ArrowDownToLine, ArrowUpFromLine,
  GitBranch, Variable as VarIcon, Shield, UserCheck, RefreshCw,
  Clock, AlertTriangle, FileText, CheckCircle2, BookOpen,
  X, ChevronRight, BookmarkPlus, Palette, Eye, EyeOff, StickyNote, Ban,
} from 'lucide-react';
// Icon catalog used by the Appearance tab (kept separate to avoid name clashes
// with the layout icons imported above).
import {
  Play, Square, Zap, Shuffle, Merge, Calculator, Scale, ShieldCheck,
  ClipboardCheck, Bell, RefreshCcw, Users, Award, Plane,
  BarChart3, Globe, Code2, Mail, Sparkles, Cpu, PenLine, Variable,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  VBNode, VBEdge, VBValidationReport, VBNodeConfig, VBExprNode, VBVariableEntry,
} from '../engine/v2-types';
import { getConfigSchema } from '../engine/v2-config-schemas';
import { DynamicConfigForm } from './DynamicConfigForm';
import { ExpressionBuilder } from './ExpressionBuilder';
import { EdgeInspector } from './EdgeInspector';
import { SaveNodeTemplateDialog } from './SaveNodeTemplateDialog';
import { NODE_COLORS } from '../components/ColorPalette';

type InspectorTab =
  | 'general' | 'config' | 'inputs' | 'outputs' | 'conditions'
  | 'variables' | 'permissions' | 'assignments' | 'retry' | 'timeout'
  | 'error' | 'metadata' | 'validation' | 'docs' | 'appearance';

const TABS: { id: InspectorTab; label: string; icon: React.ElementType }[] = [
  { id: 'general',      label: 'عام',        icon: Settings        },
  { id: 'config',       label: 'إعداد',      icon: SlidersHorizontal },
  { id: 'appearance',   label: 'المظهر',     icon: Palette         },
  { id: 'inputs',       label: 'مدخلات',     icon: ArrowDownToLine  },
  { id: 'outputs',      label: 'مخرجات',     icon: ArrowUpFromLine  },
  { id: 'conditions',   label: 'شروط',       icon: GitBranch        },
  { id: 'variables',    label: 'متغيرات',    icon: VarIcon          },
  { id: 'permissions',  label: 'صلاحيات',    icon: Shield           },
  { id: 'assignments',  label: 'تعيينات',    icon: UserCheck        },
  { id: 'retry',        label: 'إعادة',      icon: RefreshCw        },
  { id: 'timeout',      label: 'مهلة',       icon: Clock            },
  { id: 'error',        label: 'أخطاء',      icon: AlertTriangle    },
  { id: 'metadata',     label: 'بيانات',     icon: FileText         },
  { id: 'validation',   label: 'تحقق',       icon: CheckCircle2     },
  { id: 'docs',         label: 'وثائق',      icon: BookOpen         },
];

interface NodeInspectorV2Props {
  node: VBNode | null;
  edge: VBEdge | null;
  validation: VBValidationReport;
  onUpdateNode: (id: string, data: Partial<VBNode['data']> & { configPatch?: Record<string, unknown> }) => void;
  onUpdateEdge: (id: string, data: Partial<VBEdge>) => void;
  onClose: () => void;
  onPickVariable: (target: { kind: 'node-config' | 'node-condition' | 'edge-condition'; fieldKey?: string; conditionId?: string; edgeId?: string }) => void;
  /** Phase 8 — focus a validation issue (move camera + select). */
  onFocusIssue?: (nodeId?: string, edgeId?: string) => void;
}

export const NodeInspectorV2 = memo(function NodeInspectorV2({
  node, edge, validation, onUpdateNode, onUpdateEdge, onClose, onPickVariable, onFocusIssue,
}: NodeInspectorV2Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('general');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // ── Edge mode ────────────────────────────────────────────────────────
  if (!node && edge) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300">خصائص الاتصال</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1" aria-label="إغلاق"><X className="w-3.5 h-3.5" /></button>
        </div>
        <EdgeInspector edge={edge} onUpdate={(data) => onUpdateEdge(edge.id, data)} onPickCondition={() => onPickVariable({ kind: 'edge-condition', edgeId: edge.id })} />
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-slate-600 p-4">
        <Settings className="w-10 h-10 opacity-20" />
        <p className="text-xs text-center">اختر عقدة أو اتصالاً لعرض خصائصه</p>
      </div>
    );
  }

  const cfg = (node.data.config ?? {}) as Partial<VBNodeConfig>;
  const schema = getConfigSchema(node.data.definition.type);
  const nodeIssues = validation.issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-200 truncate">{node.data.label}</p>
          <p className="text-[9px] text-slate-500 truncate font-mono">{node.id}</p>
        </div>
        <button
          onClick={() => setShowSaveTemplate(true)}
          className="flex-shrink-0 p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-violet-300 transition-colors"
          title="حفظ كقالب"
          aria-label="حفظ كقالب"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} className="flex-shrink-0 text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800" aria-label="إغلاق">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab strip — scrollable */}
      <div className="flex border-b border-slate-800 overflow-x-auto arm-scroll-shadow" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => {
          const count = id === 'validation' ? nodeIssues.length : 0;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              role="tab"
              aria-selected={activeTab === id}
              className={cn(
                'flex items-center gap-1 px-2.5 py-2 text-[10px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px flex-shrink-0',
                activeTab === id
                  ? 'border-violet-500 text-violet-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
              {count > 0 && (
                <span className={cn(
                  'w-3.5 h-3.5 rounded-full text-[8px] flex items-center justify-center font-bold',
                  nodeIssues.some((i) => i.severity === 'error') ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                )}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content — lazy */}
      <div className="flex-1 overflow-y-auto arm-scroll p-3">
        <Suspense fallback={<div className="text-xs text-slate-500 text-center py-8">جارٍ التحميل...</div>}>
          <InspectorContent
            tab={activeTab}
            node={node}
            cfg={cfg}
            schema={schema}
            nodeIssues={nodeIssues}
            validation={validation}
            onUpdateNode={onUpdateNode}
            onPickVariable={onPickVariable}
            onFocusIssue={onFocusIssue}
          />
        </Suspense>
      </div>

      {/* Save-as-template dialog (PART 8) */}
      {showSaveTemplate && (
        <SaveNodeTemplateDialog
          node={node}
          onClose={() => setShowSaveTemplate(false)}
        />
      )}
    </div>
  );
});

/* ─── Tab content dispatcher ────────────────────────────────────────────── */

const InspectorContent = memo(function InspectorContent({
  tab, node, cfg, schema, nodeIssues, validation, onUpdateNode, onPickVariable, onFocusIssue,
}: {
  tab: InspectorTab;
  node: VBNode;
  cfg: Partial<VBNodeConfig>;
  schema: ReturnType<typeof getConfigSchema>;
  nodeIssues: VBValidationReport['issues'];
  validation: VBValidationReport;
  onUpdateNode: NodeInspectorV2Props['onUpdateNode'];
  onPickVariable: NodeInspectorV2Props['onPickVariable'];
  onFocusIssue?: NodeInspectorV2Props['onFocusIssue'];
}) {
  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50';

  switch (tab) {
    case 'general':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="الاسم">
            <input value={node.data.label} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })} className={inputCls} />
          </Field>
          <Field label="الوصف">
            <textarea value={node.data.description ?? ''} onChange={(e) => onUpdateNode(node.id, { description: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
          </Field>
          <Field label="النوع"><InfoChip>{node.data.definition.type}</InfoChip></Field>
          <Field label="الفئة"><InfoChip>{node.data.definition.category}</InfoChip></Field>
          <Field label="الحالة"><InfoChip>{node.data.status}</InfoChip></Field>
        </div>
      );

    case 'config':
      if (!schema) {
        return <EmptyTab icon={SlidersHorizontal} text="لا توجد إعدادات لهذا النوع من العقد" />;
      }
      return (
        <DynamicConfigForm
          schema={schema}
          values={(cfg.config as Record<string, unknown>) ?? {}}
          onChange={(key, value) => onUpdateNode(node.id, { configPatch: { ...((cfg.config as Record<string, unknown>) ?? {}), [key]: value } })}
          onPickVariable={(fieldKey) => onPickVariable({ kind: 'node-config', fieldKey })}
        />
      );

    case 'appearance':
      return (
        <AppearanceTab node={node} onUpdateNode={onUpdateNode} />
      );

    case 'inputs':
      return (
        <div className="space-y-2" dir="rtl">
          <p className="text-[10px] text-slate-400">ربط المدخلات بمتغيرات أو قيم ثابتة</p>
          {(cfg.inputs ?? []).length === 0 && <p className="text-[10px] text-slate-600 text-center py-4">لا توجد مدخلات</p>}
          {(cfg.inputs ?? []).map((inp) => (
            <div key={inp.id} className="p-2 rounded-lg bg-slate-800/40 border border-slate-700/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-violet-300">{inp.field}</span>
                <span className="text-[9px] text-slate-500">{inp.source}</span>
              </div>
              <p className="text-[10px] text-slate-400">{inp.variablePath ?? String(inp.literalValue ?? '')}</p>
            </div>
          ))}
        </div>
      );

    case 'outputs':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="متغير المخرجات">
            <div className="flex gap-1">
              <input
                value={cfg.outputVariable ?? ''}
                onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, outputVariable: e.target.value } })}
                placeholder="output_variable"
                className={`${inputCls} flex-1 font-mono`}
              />
              <button
                onClick={() => onPickVariable({ kind: 'node-config', fieldKey: '__output__' })}
                className="px-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs"
              >⌖</button>
            </div>
          </Field>
        </div>
      );

    case 'conditions':
      return (
        <ExpressionBuilder
          value={cfg.condition}
          onChange={(expr) => onUpdateNode(node.id, { configPatch: { ...cfg, condition: expr } })}
          onPickVariable={(conditionId) => onPickVariable({ kind: 'node-condition', conditionId })}
        />
      );

    case 'variables':
      return (
        <div className="space-y-2" dir="rtl">
          <p className="text-[10px] text-slate-400">المتغيرات المرتبطة بهذه العقدة</p>
          <button
            onClick={() => onPickVariable({ kind: 'node-config' })}
            className="w-full py-2 rounded-lg border border-dashed border-slate-700/50 text-[10px] text-slate-500 hover:text-violet-300 hover:border-violet-500/40 transition-colors"
          >
            + ربط متغير
          </button>
        </div>
      );

    case 'permissions':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="الأدوار المطلوبة (مفصولة بفواصل)">
            <input
              value={(cfg.permissions?.requiredRoles ?? []).join(', ')}
              onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, permissions: { ...(cfg.permissions ?? { requiredRoles: [], requiredPermissions: [] }), requiredRoles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } } })}
              placeholder="admin, manager"
              className={inputCls}
            />
          </Field>
          <Field label="الصلاحيات المطلوبة">
            <input
              value={(cfg.permissions?.requiredPermissions ?? []).join(', ')}
              onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, permissions: { requiredRoles: cfg.permissions?.requiredRoles ?? [], requiredPermissions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } } })}
              placeholder="workflows.execute"
              className={inputCls}
            />
          </Field>
        </div>
      );

    case 'assignments':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="نوع التعيين">
            <select
              value={cfg.assignment?.type ?? 'user'}
              onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, assignment: { type: e.target.value as 'user' | 'role' | 'department' | 'dynamic', value: cfg.assignment?.value ?? '' } } })}
              className={`${inputCls} cursor-pointer`}
            >
              <option value="user">مستخدم</option>
              <option value="role">دور</option>
              <option value="department">قسم</option>
              <option value="dynamic">ديناميكي</option>
            </select>
          </Field>
          <Field label="القيمة">
            <div className="flex gap-1">
              <input
                value={cfg.assignment?.value ?? ''}
                onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, assignment: { type: cfg.assignment?.type ?? 'user', value: e.target.value } } })}
                placeholder="{{employee.manager}}"
                className={`${inputCls} flex-1 font-mono`}
              />
              <button onClick={() => onPickVariable({ kind: 'node-config', fieldKey: '__assignee__' })} className="px-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs">⌖</button>
            </div>
          </Field>
        </div>
      );

    case 'retry':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="أقصى عدد محاولات">
            <input type="number" value={cfg.retryPolicy?.maxAttempts ?? 3} onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, retryPolicy: { ...(cfg.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 30000 }), maxAttempts: Number(e.target.value) } } })} className={inputCls} />
          </Field>
          <Field label="فترة الانتظار (ms)">
            <input type="number" value={cfg.retryPolicy?.backoffMs ?? 1000} onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, retryPolicy: { ...(cfg.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 30000 }), backoffMs: Number(e.target.value) } } })} className={inputCls} />
          </Field>
          <Field label="مضاعف الانتظار">
            <input type="number" step="0.1" value={cfg.retryPolicy?.backoffMultiplier ?? 2} onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, retryPolicy: { ...(cfg.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 30000 }), backoffMultiplier: Number(e.target.value) } } })} className={inputCls} />
          </Field>
          <Field label="أقصى فترة انتظار (ms)">
            <input type="number" value={cfg.retryPolicy?.maxBackoffMs ?? 30000} onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, retryPolicy: { ...(cfg.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 30000 }), maxBackoffMs: Number(e.target.value) } } })} className={inputCls} />
          </Field>
        </div>
      );

    case 'timeout':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="المهلة (ms)">
            <input type="number" value={cfg.timeoutMs ?? 0} onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, timeoutMs: Number(e.target.value) } })} className={inputCls} />
          </Field>
          <p className="text-[9px] text-slate-500">0 = بدون مهلة</p>
        </div>
      );

    case 'error':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="استراتيجية الأخطاء">
            <select
              value={cfg.onError ?? 'abort'}
              onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, onError: e.target.value as VBNodeConfig['onError'] } })}
              className={`${inputCls} cursor-pointer`}
            >
              <option value="retry">إعادة المحاولة</option>
              <option value="recover">تعافي</option>
              <option value="rollback">تراجع</option>
              <option value="skip">تخطي</option>
              <option value="abort">إيقاف</option>
              <option value="escalate">تصعيد</option>
            </select>
          </Field>
        </div>
      );

    case 'metadata':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="البيانات الوصفية (JSON)">
            <textarea
              value={JSON.stringify(cfg.metadata ?? {}, null, 2)}
              onChange={(e) => {
                try { onUpdateNode(node.id, { configPatch: { ...cfg, metadata: JSON.parse(e.target.value) } }); } catch { /* invalid */ }
              }}
              rows={6}
              className={`${inputCls} font-mono text-[10px] resize-none`}
            />
          </Field>
        </div>
      );

    case 'validation':
      return (
        <ValidationIssuesTab
          nodeIssues={nodeIssues}
          allIssues={validation.issues}
          onFocusIssue={onFocusIssue}
          currentNodeId={node.id}
        />
      );

    case 'docs':
      return (
        <div className="space-y-3" dir="rtl">
          <Field label="الوثائق">
            <textarea
              value={cfg.documentation ?? ''}
              onChange={(e) => onUpdateNode(node.id, { configPatch: { ...cfg, documentation: e.target.value } })}
              rows={6}
              placeholder="وثق غرض هذه العقدة وسلوكها..."
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>
      );

    default:
      return null;
  }
});

/* ─── Phase 4 — Appearance tab ───────────────────────────────────────────── */

const ICON_CHOICES = [
  'Zap', 'Bell', 'Mail', 'GitBranch', 'ShieldCheck', 'Users', 'Award',
  'Plane', 'FileText', 'AlertTriangle', 'BarChart3', 'Globe', 'Code2',
  'Sparkles', 'Variable', 'Cpu', 'PenLine', 'Eye', 'Calculator', 'Scale',
];

function AppearanceTab({
  node, onUpdateNode,
}: {
  node: VBNode;
  onUpdateNode: NodeInspectorV2Props['onUpdateNode'];
}) {
  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50';
  const currentColor = node.data.colorOverride ?? node.data.definition.color;
  const currentIcon = node.data.iconOverride ?? node.data.definition.icon;
  const isEnabled = node.data.enabled ?? true;
  const isCollapsed = node.data.collapsed ?? false;

  return (
    <div className="space-y-3" dir="rtl">
      {/* Color */}
      <Field label="اللون">
        <div className="grid grid-cols-5 gap-1.5">
          {NODE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onUpdateNode(node.id, { colorOverride: c })}
              className={cn(
                'h-7 rounded-md transition-transform hover:scale-110',
                c,
                currentColor === c && 'ring-2 ring-white ring-offset-1 ring-offset-slate-900',
              )}
              aria-label={c}
            />
          ))}
        </div>
      </Field>

      {/* Icon */}
      <Field label="الأيقونة">
        <div className="grid grid-cols-5 gap-1.5">
          {ICON_CHOICES.map((ic) => {
            const IconComp = ICON_LOOKUP[ic] ?? Settings;
            return (
              <button
                key={ic}
                onClick={() => onUpdateNode(node.id, { iconOverride: ic })}
                title={ic}
                className={cn(
                  'h-7 rounded-md flex items-center justify-center border transition-colors',
                  currentIcon === ic
                    ? 'bg-violet-600/30 border-violet-500/40 text-violet-300'
                    : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200',
                )}
              >
                <IconComp className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      </Field>

      {/* Enabled toggle */}
      <Field label="الحالة">
        <button
          onClick={() => onUpdateNode(node.id, { enabled: !isEnabled })}
          className={cn(
            'flex items-center justify-between w-full px-3 py-2 rounded-lg border transition-colors',
            isEnabled
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-slate-700/30 border-slate-600/40 text-slate-400',
          )}
        >
          <span className="text-xs flex items-center gap-1.5">
            {isEnabled ? <Eye className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
            {isEnabled ? 'مفعّلة' : 'معطّلة'}
          </span>
          <span className={cn(
            'relative w-9 h-5 rounded-full transition-colors',
            isEnabled ? 'bg-emerald-500' : 'bg-slate-600',
          )}>
            <span className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              isEnabled ? 'left-0.5' : 'left-4.5',
            )} style={{ left: isEnabled ? '2px' : '18px' }} />
          </span>
        </button>
      </Field>

      {/* Collapsed toggle */}
      <Field label="العرض">
        <button
          onClick={() => onUpdateNode(node.id, { collapsed: !isCollapsed })}
          className={cn(
            'flex items-center justify-between w-full px-3 py-2 rounded-lg border transition-colors',
            isCollapsed
              ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
              : 'bg-slate-800/60 border-slate-700/40 text-slate-400',
          )}
        >
          <span className="text-xs flex items-center gap-1.5">
            {isCollapsed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {isCollapsed ? 'مطوية' : 'موسّعة'}
          </span>
        </button>
      </Field>

      {/* Notes */}
      <Field label="ملاحظات داخلية">
        <textarea
          value={node.data.notes ?? ''}
          onChange={(e) => onUpdateNode(node.id, { notes: e.target.value })}
          rows={3}
          placeholder="ملاحظات للمصممين (لا تظهر في التنفيذ)..."
          className={`${inputCls} resize-none`}
        />
        <p className="text-[9px] text-slate-500 mt-1 flex items-center gap-1">
          <StickyNote className="w-2.5 h-2.5" /> تظهر عند تمرير الفأرة فوق العقدة
        </p>
      </Field>
    </div>
  );
}

/* ─── Phase 8 — Validation issues tab with click-to-focus ─────────────────── */

function ValidationIssuesTab({
  nodeIssues, allIssues, onFocusIssue, currentNodeId,
}: {
  nodeIssues: VBValidationReport['issues'];
  allIssues: VBValidationReport['issues'];
  onFocusIssue?: NodeInspectorV2Props['onFocusIssue'];
  currentNodeId: string;
}) {
  // Show node-specific issues first, then global issues that have no nodeId.
  const globalIssues = allIssues.filter((i) => !i.nodeId);
  const showGlobal = nodeIssues.length === 0;

  if (nodeIssues.length === 0 && globalIssues.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-emerald-500" dir="rtl">
        <CheckCircle2 className="w-8 h-8 opacity-40 mb-2" />
        <p className="text-xs">لا توجد مشاكل لهذه العقدة</p>
      </div>
    );
  }

  const renderIssue = (issue: VBValidationReport['issues'][number]) => (
    <button
      key={issue.id}
      onClick={() => {
        if (onFocusIssue && (issue.nodeId || issue.edgeId)) {
          onFocusIssue(issue.nodeId, issue.edgeId);
        }
      }}
      disabled={!onFocusIssue || (!issue.nodeId && !issue.edgeId)}
      className={cn(
        'w-full text-right flex gap-2 p-2.5 rounded-lg border transition-colors',
        issue.severity === 'error' ? 'bg-red-500/10 border-red-500/20 hover:bg-red-500/15' :
        issue.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15' :
        'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15',
        (!onFocusIssue || (!issue.nodeId && !issue.edgeId)) && 'cursor-default',
      )}
    >
      <AlertTriangle className={cn('w-3.5 h-3.5 flex-shrink-0 mt-0.5',
        issue.severity === 'error' ? 'text-red-400' : issue.severity === 'warning' ? 'text-amber-400' : 'text-blue-400')} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300">{issue.messageAr}</p>
        <p className="text-[8px] text-slate-500 mt-0.5 font-mono">{issue.code} · {issue.category}</p>
      </div>
      {(issue.nodeId || issue.edgeId) && onFocusIssue && (
        <ChevronRight className="w-3 h-3 text-slate-500 flex-shrink-0 mt-1" />
      )}
    </button>
  );

  return (
    <div className="space-y-2" dir="rtl">
      {nodeIssues.map(renderIssue)}
      {showGlobal && globalIssues.length > 0 && (
        <>
          <p className="text-[9px] text-slate-500 uppercase tracking-wider pt-2">مشاكل عامة</p>
          {globalIssues.map(renderIssue)}
        </>
      )}
      {/* Unused: silence TS for currentNodeId param used only for context. */}
      <span className="hidden">{currentNodeId}</span>
    </div>
  );
}

/* ─── Small helpers ─────────────────────────────────────────────────────── */

const ICON_LOOKUP: Record<string, React.ElementType> = {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles, Variable, Cpu,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function InfoChip({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1.5 bg-slate-800/40 rounded-lg text-xs text-slate-400 border border-slate-700/30 font-mono">{children}</div>;
}

function EmptyTab({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-600">
      <Icon className="w-8 h-8 opacity-20 mb-2" />
      <p className="text-xs text-center">{text}</p>
    </div>
  );
}
