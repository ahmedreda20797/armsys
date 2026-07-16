'use client';

/**
 * PART 2 — Workflow Documentation
 * Editable documentation: purpose, owner, business unit, tags, impact, etc.
 */

import React, { memo } from 'react';
import {
  BookOpen, FileText, User, Building2, Tag, GitBranch,
  TrendingUp, Clock, Gauge, Layers, Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBWorkflowDocumentation } from '../engine/v2-types';
import type { WorkflowModule } from '@/workflow/types';

const MODULES: WorkflowModule[] = [
  'attendance', 'complaints', 'capa', 'employee360', 'risk', 'hr',
  'travel', 'quality', 'requests', 'follow_up', 'notifications', 'aocc', 'system',
];

const IMPACTS = [
  { value: 'low', label: 'منخفض', color: 'text-slate-400' },
  { value: 'medium', label: 'متوسط', color: 'text-blue-400' },
  { value: 'high', label: 'عالي', color: 'text-amber-400' },
  { value: 'critical', label: 'حرج', color: 'text-red-400' },
] as const;

const COMPLEXITIES = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'very_high', label: 'عالي جداً' },
] as const;

interface DocumentationPanelProps {
  documentation: VBWorkflowDocumentation;
  onChange: (doc: VBWorkflowDocumentation) => void;
}

export const DocumentationPanel = memo(function DocumentationPanel({
  documentation, onChange,
}: DocumentationPanelProps) {
  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50';
  const set = <K extends keyof VBWorkflowDocumentation>(key: K, value: VBWorkflowDocumentation[K]) =>
    onChange({ ...documentation, [key]: value });

  return (
    <div className="flex flex-col h-full overflow-y-auto arm-scroll p-3 space-y-4" dir="rtl">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
        <BookOpen className="w-4 h-4 text-violet-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">وثائق المسار</h3>
      </div>

      <Field label="الغرض" icon={FileText}>
        <textarea
          value={documentation.purpose}
          onChange={(e) => set('purpose', e.target.value)}
          rows={2}
          placeholder="ما الهدف من هذا المسار؟"
          className={cn(inputCls, 'resize-none')}
        />
      </Field>

      <Field label="الوصف" icon={FileText}>
        <textarea
          value={documentation.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          placeholder="وصف تفصيلي..."
          className={cn(inputCls, 'resize-none')}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="المالك" icon={User}>
          <input value={documentation.ownerName} onChange={(e) => onChange({ ...documentation, ownerName: e.target.value, ownerId: e.target.value })} className={inputCls} />
        </Field>
        <Field label="الوحدة" icon={Building2}>
          <input value={documentation.businessUnit} onChange={(e) => set('businessUnit', e.target.value)} className={inputCls} />
        </Field>
      </div>

      <Field label="القسم">
        <input value={documentation.department} onChange={(e) => set('department', e.target.value)} className={inputCls} />
      </Field>

      <Field label="الوحدات المرتبطة" icon={Layers}>
        <div className="flex flex-wrap gap-1">
          {MODULES.map((m) => {
            const active = documentation.relatedModules.includes(m);
            return (
              <button
                key={m}
                onClick={() => {
                  const next = active
                    ? documentation.relatedModules.filter((x) => x !== m)
                    : [...documentation.relatedModules, m];
                  set('relatedModules', next);
                }}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[9px] border transition-colors',
                  active ? 'bg-violet-600/30 text-violet-300 border-violet-500/40' : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="الوسوم" icon={Tag}>
        <input
          value={documentation.tags.join(', ')}
          onChange={(e) => set('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="tag1, tag2"
          className={inputCls}
        />
      </Field>

      <Field label="ملاحظات الإصدار" icon={GitBranch}>
        <textarea
          value={documentation.versionNotes}
          onChange={(e) => set('versionNotes', e.target.value)}
          rows={2}
          className={cn(inputCls, 'resize-none')}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="التأثير" icon={TrendingUp}>
          <div className="flex gap-1">
            {IMPACTS.map((imp) => (
              <button
                key={imp.value}
                onClick={() => set('businessImpact', imp.value)}
                className={cn(
                  'flex-1 py-1 rounded-md text-[10px] border transition-colors',
                  documentation.businessImpact === imp.value
                    ? cn('bg-slate-700/60 border-slate-600', imp.color)
                    : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
                )}
              >
                {imp.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="التعقيد" icon={Gauge}>
          <select
            value={documentation.complexity}
            onChange={(e) => set('complexity', e.target.value as VBWorkflowDocumentation['complexity'])}
            className={cn(inputCls, 'cursor-pointer')}
          >
            {COMPLEXITIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="وقت التشغيل المقدّر (ms)" icon={Clock}>
        <input
          type="number"
          value={documentation.estimatedRuntimeMs}
          onChange={(e) => set('estimatedRuntimeMs', Number(e.target.value))}
          className={inputCls}
        />
      </Field>

      <div className="pt-2 border-t border-slate-800">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <Save className="w-3 h-3" />
          يتم الحفظ تلقائياً عند التعديل
        </div>
      </div>
    </div>
  );
});

function Field({ label, icon: Icon, children }: { label: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1 mb-1">
        {Icon && <Icon className="w-2.5 h-2.5 text-slate-500" />}
        <span className="text-[10px] font-medium text-slate-400">{label}</span>
      </label>
      {children}
    </div>
  );
}
