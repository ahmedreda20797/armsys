'use client';

/**
 * PART 7 — Edge Inspector
 * Configures connections: label, kind, condition, priority, order, docs.
 */

import React, { memo } from 'react';
import {
  GitBranch, Flag, ArrowRight, FileText, ToggleLeft, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBEdge, VBEdgeData, VBEdgeKind } from '../engine/v2-types';
import { ExpressionBuilder } from './ExpressionBuilder';

const KIND_OPTIONS: { value: VBEdgeKind; label: string; color: string }[] = [
  { value: 'default',    label: 'عادي',     color: 'text-slate-300' },
  { value: 'success',    label: 'نجاح',     color: 'text-emerald-300' },
  { value: 'error',      label: 'خطأ',      color: 'text-red-300' },
  { value: 'timeout',    label: 'مهلة',     color: 'text-amber-300' },
  { value: 'conditional', label: 'مشروط',   color: 'text-violet-300' },
];

interface EdgeInspectorProps {
  edge: VBEdge;
  onUpdate: (data: Partial<VBEdge> & { dataPatch?: Partial<VBEdgeData> }) => void;
  onPickCondition: () => void;
}

export const EdgeInspector = memo(function EdgeInspector({
  edge, onUpdate, onPickCondition,
}: EdgeInspectorProps) {
  const data = (edge.data ?? {}) as Partial<VBEdgeData>;
  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50';

  return (
    <div className="flex-1 overflow-y-auto arm-scroll p-3 space-y-3" dir="rtl">
      {/* Connection info */}
      <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-mono text-violet-300 truncate">{edge.source}</span>
          <ArrowRight className="w-3 h-3 text-slate-600 rotate-180" />
          <span className="font-mono text-violet-300 truncate">{edge.target}</span>
        </div>
      </div>

      <Field label="التسمية" icon={Flag}>
        <input
          value={edge.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="مثال: نعم / لا"
          className={inputCls}
        />
      </Field>

      <Field label="نوع المسار" icon={GitBranch}>
        <select
          value={data.kind ?? 'default'}
          onChange={(e) => onUpdate({ dataPatch: { kind: e.target.value as VBEdgeKind } })}
          className={`${inputCls} cursor-pointer`}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="الأولوية" icon={ToggleLeft}>
          <input
            type="number"
            value={data.priority ?? 0}
            onChange={(e) => onUpdate({ dataPatch: { priority: Number(e.target.value) } })}
            className={inputCls}
          />
        </Field>
        <Field label="ترتيب التنفيذ">
          <input
            type="number"
            value={data.executionOrder ?? 0}
            onChange={(e) => onUpdate({ dataPatch: { executionOrder: Number(e.target.value) } })}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="الوصف">
        <textarea
          value={data.description ?? ''}
          onChange={(e) => onUpdate({ dataPatch: { description: e.target.value } })}
          rows={2}
          placeholder="وصف مختصر للاتصال..."
          className={`${inputCls} resize-none`}
        />
      </Field>

      <Field label="الوثائق" icon={FileText}>
        <textarea
          value={data.documentation ?? ''}
          onChange={(e) => onUpdate({ dataPatch: { documentation: e.target.value } })}
          rows={3}
          placeholder="متى يُؤخذ هذا المسار؟"
          className={`${inputCls} resize-none`}
        />
      </Field>

      <Field label="الحالة">
        <select
          value={data.status ?? 'active'}
          onChange={(e) => onUpdate({ dataPatch: { status: e.target.value as VBEdgeData['status'] } })}
          className={`${inputCls} cursor-pointer`}
        >
          <option value="active">نشط</option>
          <option value="disabled">معطّل</option>
          <option value="draft">مسودة</option>
        </select>
      </Field>

      {/* Condition section */}
      <div className="pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">الشرط</span>
          <button
            onClick={onPickCondition}
            className="text-[9px] text-violet-400 hover:text-violet-300"
          >
            متغير
          </button>
        </div>
        {data.condition ? (
          <ExpressionBuilder
            value={data.condition}
            onChange={(expr) => onUpdate({ dataPatch: { condition: expr } })}
          />
        ) : (
          <button
            onClick={() => onUpdate({ dataPatch: { condition: { id: `grp_${Date.now().toString(36)}`, type: 'group', logic: 'and', children: [] } } })}
            className="w-full py-2 rounded-lg border border-dashed border-slate-700/50 text-[10px] text-slate-500 hover:text-violet-300 hover:border-violet-500/40 transition-colors flex items-center justify-center gap-1"
          >
            <GitBranch className="w-3 h-3" /> إضافة شرط لهذا المسار
          </button>
        )}
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
