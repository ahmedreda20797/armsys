'use client';

/**
 * PART 6 — Expression Builder
 * Visual nested condition editor. Supports AND/OR/NOT groups, 12 operators,
 * variable picking, and live expression preview. Pure data manipulation.
 */

import React, { memo, useState } from 'react';
import { Plus, Trash2, Copy, GitBranch, Parentheses, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  VBExprNode, VBExprGroup, VBExprCondition,
} from '../engine/v2-types';
import { emptyExprGroup, emptyExprCondition, isExprGroup, isExprCondition } from '../engine/v2-types';
import type { ConditionOperator, ConditionLogic } from '@/workflow/types';

const OPERATORS: { value: ConditionOperator; label: string; labelAr: string }[] = [
  { value: 'equals', label: '=', labelAr: 'يساوي' },
  { value: 'not_equals', label: '≠', labelAr: 'لا يساوي' },
  { value: 'greater_than', label: '>', labelAr: 'أكبر من' },
  { value: 'less_than', label: '<', labelAr: 'أصغر من' },
  { value: 'contains', label: '⊃', labelAr: 'يحتوي' },
  { value: 'starts_with', label: 'starts', labelAr: 'يبدأ بـ' },
  { value: 'ends_with', label: 'ends', labelAr: 'ينتهي بـ' },
  { value: 'in_list', label: 'in', labelAr: 'ضمن' },
  { value: 'not_in_list', label: 'not in', labelAr: 'ليس ضمن' },
  { value: 'empty', label: '∅', labelAr: 'فارغ' },
  { value: 'not_empty', label: '¬∅', labelAr: 'غير فارغ' },
  { value: 'between', label: '⇆', labelAr: 'بين' },
];

const LOGIC_COLORS: Record<ConditionLogic, { bg: string; text: string; ring: string }> = {
  and: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', ring: 'ring-emerald-500/30' },
  or: { bg: 'bg-amber-500/20', text: 'text-amber-300', ring: 'ring-amber-500/30' },
  not: { bg: 'bg-red-500/20', text: 'text-red-300', ring: 'ring-red-500/30' },
};

interface ExpressionBuilderProps {
  value: VBExprNode | undefined;
  onChange: (node: VBExprNode | undefined) => void;
  onPickVariable?: (conditionId: string) => void;
}

export const ExpressionBuilder = memo(function ExpressionBuilder({
  value, onChange, onPickVariable,
}: ExpressionBuilderProps) {
  const [showPreview, setShowPreview] = useState(false);

  const root: VBExprGroup = value && isExprGroup(value)
    ? value
    : value && isExprCondition(value)
    ? { id: 'root_wrap', type: 'group', logic: 'and', children: [value] }
    : emptyExprGroup('and');

  return (
    <div className="space-y-3" dir="rtl">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">منشئ الشروط</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            معاينة
          </button>
        </div>
      </div>

      {/* Preview */}
      {showPreview && value && (
        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-700/40 font-mono text-[10px] text-emerald-300 leading-relaxed" dir="ltr">
          {previewExpr(value)}
        </div>
      )}

      {/* Root group */}
      <GroupEditor
        group={root}
        isRoot
        onChange={(g) => onChange(g.children.length === 0 ? undefined : g.children.length === 1 ? g.children[0] : g)}
        onPickVariable={onPickVariable}
      />
    </div>
  );
});

/* ─── Group editor ──────────────────────────────────────────────────────── */

const GroupEditor = memo(function GroupEditor({
  group, isRoot, onChange, onPickVariable,
}: {
  group: VBExprGroup;
  isRoot?: boolean;
  onChange: (g: VBExprGroup) => void;
  onPickVariable?: (conditionId: string) => void;
}) {
  const color = LOGIC_COLORS[group.logic];

  const setLogic = (logic: ConditionLogic) => onChange({ ...group, logic });
  const updateChild = (id: string, child: VBExprNode) =>
    onChange({ ...group, children: group.children.map((c) => (c.id === id ? child : c)) });
  const removeChild = (id: string) =>
    onChange({ ...group, children: group.children.filter((c) => c.id !== id) });
  const addChild = (type: 'condition' | 'group') =>
    onChange({ ...group, children: [...group.children, type === 'condition' ? emptyExprCondition() : emptyExprGroup('and')] });

  return (
    <div className={cn('rounded-lg border p-2', isRoot ? 'border-slate-700/40 bg-slate-900/30' : 'border-slate-700/30 bg-slate-800/20')}>
      {/* Logic selector */}
      <div className="flex items-center gap-1 mb-2">
        {!isRoot && <Parentheses className="w-3 h-3 text-slate-600" />}
        <div className="flex gap-0.5 rounded-md bg-slate-900/60 p-0.5">
          {(['and', 'or', 'not'] as ConditionLogic[]).map((l) => (
            <button
              key={l}
              onClick={() => setLogic(l)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors',
                group.logic === l ? cn(LOGIC_COLORS[l].bg, LOGIC_COLORS[l].text) : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {l === 'and' ? 'و' : l === 'or' ? 'أو' : 'ليس'}
            </button>
          ))}
        </div>
        <span className="text-[9px] text-slate-600">{group.children.length} شرط</span>
      </div>

      {/* Children */}
      <div className="space-y-1.5 mr-3 border-r border-slate-700/30 pr-2">
        {group.children.map((child) => (
          <div key={child.id}>
            {isExprCondition(child) ? (
              <ConditionEditor
                condition={child}
                onChange={(c) => updateChild(child.id, c)}
                onRemove={() => removeChild(child.id)}
                onPickVariable={onPickVariable ? () => onPickVariable(child.id) : undefined}
              />
            ) : (
              <div className="relative">
                <GroupEditor group={child} onChange={(g) => updateChild(child.id, g)} onPickVariable={onPickVariable} />
                <button
                  onClick={() => removeChild(child.id)}
                  className="absolute -top-1 left-0 w-5 h-5 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 flex items-center justify-center"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex gap-1 mt-2 mr-3">
        <button
          onClick={() => addChild('condition')}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 transition-colors border border-slate-700/40"
        >
          <Plus className="w-3 h-3" /> شرط
        </button>
        <button
          onClick={() => addChild('group')}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 transition-colors border border-slate-700/40"
        >
          <Parentheses className="w-3 h-3" /> مجموعة
        </button>
      </div>
    </div>
  );
});

/* ─── Condition editor ──────────────────────────────────────────────────── */

const ConditionEditor = memo(function ConditionEditor({
  condition, onChange, onRemove, onPickVariable,
}: {
  condition: VBExprCondition;
  onChange: (c: VBExprCondition) => void;
  onRemove: () => void;
  onPickVariable?: () => void;
}) {
  const needsValue = !['empty', 'not_empty'].includes(condition.operator);
  const needsValueTo = condition.operator === 'between';
  const op = OPERATORS.find((o) => o.value === condition.operator);

  return (
    <div className="flex items-center gap-1 p-1.5 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/40 transition-colors">
      <GitBranch className="w-3 h-3 text-slate-500 flex-shrink-0" />

      {/* Field */}
      <input
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
        placeholder="variable.path"
        className="flex-1 min-w-0 bg-slate-900/60 border border-slate-700/40 rounded px-2 py-1 text-[10px] font-mono text-violet-300 focus:outline-none focus:border-violet-500/50"
      />
      {onPickVariable && (
        <button onClick={onPickVariable} className="text-[9px] text-violet-400 hover:text-violet-300 px-1">⌖</button>
      )}

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator })}
        className="bg-slate-900/60 border border-slate-700/40 rounded px-1 py-1 text-[10px] text-slate-300 focus:outline-none focus:border-violet-500/50 cursor-pointer"
        title={op?.labelAr}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.labelAr}</option>
        ))}
      </select>

      {/* Value */}
      {needsValue && (
        <input
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder="قيمة"
          className="w-20 bg-slate-900/60 border border-slate-700/40 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      )}
      {needsValueTo && (
        <input
          value={String(condition.valueTo ?? '')}
          onChange={(e) => onChange({ ...condition, valueTo: e.target.value })}
          placeholder="إلى"
          className="w-16 bg-slate-900/60 border border-slate-700/40 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      )}

      <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
});

/* ─── Preview text generator ─────────────────────────────────────────────── */

function previewExpr(node: VBExprNode): string {
  if (isExprCondition(node)) {
    const op = OPERATORS.find((o) => o.value === node.operator);
    if (['empty', 'not_empty'].includes(node.operator)) {
      return `${node.field} ${op?.labelAr ?? node.operator}`;
    }
    if (node.operator === 'between') {
      return `${node.field} ${op?.labelAr} [${node.value}, ${node.valueTo}]`;
    }
    return `${node.field} ${op?.label ?? node.operator} ${node.value}`;
  }
  if (isExprGroup(node)) {
    const parts = node.children.map(previewExpr);
    const joiner = node.logic === 'and' ? ' AND ' : node.logic === 'or' ? ' OR ' : ' NOT ';
    if (node.logic === 'not') return `NOT (${parts[0] ?? ''})`;
    return `(${parts.join(joiner)})`;
  }
  return '';
}
