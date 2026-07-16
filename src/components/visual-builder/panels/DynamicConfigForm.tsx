'use client';

/**
 * PART 4 — Dynamic Configuration Forms
 * Renders a VBConfigSchema into structured fields. NEVER exposes raw JSON.
 * Each field type has its own memoized renderer for performance.
 */

import React, { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Variable as VarIcon, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBConfigSchema, VBFormField } from '../engine/v2-types';

interface DynamicConfigFormProps {
  schema: VBConfigSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onPickVariable?: (fieldKey: string) => void;
}

export const DynamicConfigForm = memo(function DynamicConfigForm({
  schema, values, onChange, onPickVariable,
}: DynamicConfigFormProps) {
  return (
    <div className="space-y-4" dir="rtl">
      {schema.groups.map((group) => (
        <ConfigGroup
          key={group.id}
          group={group}
          values={values}
          onChange={onChange}
          onPickVariable={onPickVariable}
        />
      ))}
    </div>
  );
});

/* ─── Collapsible group ─────────────────────────────────────────────────── */

const ConfigGroup = memo(function ConfigGroup({
  group, values, onChange, onPickVariable,
}: {
  group: VBConfigSchema['groups'][number];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onPickVariable?: (fieldKey: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-slate-700/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/40 hover:bg-slate-800/60 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{group.labelAr}</span>
      </button>
      {open && (
        <div className="p-3 space-y-3">
          {group.fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(v) => onChange(field.key, v)}
              onPickVariable={onPickVariable ? () => onPickVariable(field.key) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/* ─── Single field renderer ─────────────────────────────────────────────── */

const FieldRenderer = memo(function FieldRenderer({
  field, value, onChange, onPickVariable,
}: {
  field: VBFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  onPickVariable?: () => void;
}) {
  const inputClass = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-colors';

  return (
    <div>
      <label className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-slate-400">
          {field.labelAr}
          {field.required && <span className="text-red-400 mr-1">*</span>}
        </span>
        {(field.type === 'variable' || field.type === 'expression') && onPickVariable && (
          <button
            onClick={onPickVariable}
            className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-300 transition-colors"
          >
            <VarIcon className="w-2.5 h-2.5" />
            متغير
          </button>
        )}
      </label>

      {field.type === 'text' && (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputClass}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={cn(inputClass, 'resize-none')}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={value !== undefined && value !== null ? Number(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={inputClass}
        />
      )}

      {field.type === 'boolean' && (
        <button
          onClick={() => onChange(!value)}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors',
            value ? 'bg-violet-600' : 'bg-slate-700'
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            value ? 'left-0.5' : 'left-5'
          )} />
        </button>
      )}

      {field.type === 'select' && (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputClass, 'cursor-pointer')}
        >
          <option value="">— اختر —</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <MultiSelectField field={field} value={value} onChange={onChange} />
      )}

      {(field.type === 'variable' || field.type === 'expression' || field.type === 'user' || field.type === 'role') && (
        <div className="flex gap-1">
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder ?? '{{variable.path}}'}
            className={cn(inputClass, 'flex-1 font-mono')}
          />
          {onPickVariable && (
            <button
              onClick={onPickVariable}
              className="flex-shrink-0 px-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors"
              title="اختيار متغير"
            >
              <VarIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {field.type === 'duration' && (
        <DurationField value={value} onChange={onChange} />
      )}

      {field.type === 'tag' && (
        <TagField value={value} onChange={onChange} />
      )}

      {field.helperText && (
        <p className="text-[9px] text-slate-500 mt-1">{field.helperText}</p>
      )}
    </div>
  );
});

/* ─── Multi-select ──────────────────────────────────────────────────────── */

function MultiSelectField({
  field, value, onChange,
}: {
  field: VBFormField;
  value: unknown;
  onChange: (v: string[]) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter((v) => v !== val));
    else onChange([...selected, val]);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {field.options?.map((opt) => (
        <button
          key={opt.value}
          onClick={() => toggle(opt.value)}
          className={cn(
            'px-2 py-0.5 rounded-full text-[10px] border transition-colors',
            selected.includes(opt.value)
              ? 'bg-violet-600/30 text-violet-300 border-violet-500/40'
              : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Duration ──────────────────────────────────────────────────────────── */

function DurationField({ value, onChange }: { value: unknown; onChange: (v: { amount: number; unit: string }) => void }) {
  const v = (value as { amount: number; unit: string }) ?? { amount: 1, unit: 'hours' };
  return (
    <div className="flex gap-1">
      <input
        type="number"
        value={v.amount}
        onChange={(e) => onChange({ ...v, amount: Number(e.target.value) })}
        className="w-20 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50"
      />
      <select
        value={v.unit}
        onChange={(e) => onChange({ ...v, unit: e.target.value })}
        className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50 cursor-pointer"
      >
        <option value="seconds">ثانية</option>
        <option value="minutes">دقيقة</option>
        <option value="hours">ساعة</option>
        <option value="days">يوم</option>
      </select>
    </div>
  );
}

/* ─── Tag input ─────────────────────────────────────────────────────────── */

function TagField({ value, onChange }: { value: unknown; onChange: (v: string[]) => void }) {
  const tags = Array.isArray(value) ? (value as string[]) : [];
  const [input, setInput] = useState('');
  const add = () => {
    const t = input.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };
  return (
    <div>
      <div className="flex gap-1 mb-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="أضف وسماً..."
          className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
        <button onClick={add} className="px-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs">+</button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-700/40 text-[10px] text-slate-300">
              {t}
              <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-slate-500 hover:text-red-400">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
