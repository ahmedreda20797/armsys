'use client';

import React, { memo, useState } from 'react';
import { Settings, Variable, GitBranch, Zap, Users, Shield, Info, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode, VBEdge, VBValidationResult } from '../engine/types';
import type { WorkflowVariable } from '@/workflow/types';

interface PropertiesPanelProps {
  selectedNode: VBNode | null;
  selectedEdge: VBEdge | null;
  variables: WorkflowVariable[];
  validation: VBValidationResult;
  onUpdateNode: (id: string, data: Partial<VBNode['data']>) => void;
  onClose: () => void;
}

type Tab = 'general' | 'variables' | 'conditions' | 'actions' | 'permissions' | 'validation';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'general',     label: 'عام',        icon: Settings    },
  { id: 'variables',   label: 'متغيرات',    icon: Variable    },
  { id: 'conditions',  label: 'شروط',       icon: GitBranch   },
  { id: 'actions',     label: 'إجراءات',    icon: Zap         },
  { id: 'permissions', label: 'صلاحيات',    icon: Shield      },
  { id: 'validation',  label: 'التحقق',     icon: AlertCircle },
];

const SCOPE_LABELS: Record<string, string> = {
  input: 'مدخل', output: 'مخرج', computed: 'محسوب', system: 'نظام', temp: 'مؤقت',
};

export const PropertiesPanel = memo(function PropertiesPanel({
  selectedNode,
  selectedEdge,
  variables,
  validation,
  onUpdateNode,
  onClose,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  if (!selectedNode && !selectedEdge) {
    return (
      <div className="flex flex-col h-full bg-slate-950/80 border-l border-slate-800/60">
        <div className="px-4 py-3 border-b border-slate-800/60">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">الخصائص</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-600 px-4">
          <Settings className="w-10 h-10 opacity-20" />
          <p className="text-xs text-center">اختر عقدة أو اتصالاً لعرض خصائصه</p>
        </div>
      </div>
    );
  }

  const nodeErrors = selectedNode
    ? validation.errors.filter((e) => e.nodeId === selectedNode.id)
    : [];
  const nodeWarnings = selectedNode
    ? validation.warnings.filter((w) => w.nodeId === selectedNode.id)
    : [];

  return (
    <div className="flex flex-col h-full bg-slate-950/80 border-l border-slate-800/60">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">الخصائص</h2>
          {selectedNode && (
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">{selectedNode.data.label}</p>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800/60 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-2 text-[10px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
              activeTab === id
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            <Icon className="w-3 h-3" />
            {label}
            {id === 'validation' && (nodeErrors.length + nodeWarnings.length) > 0 && (
              <span className="w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center">
                {nodeErrors.length + nodeWarnings.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 arm-scroll">
        {activeTab === 'general' && selectedNode && (
          <GeneralTab node={selectedNode} onUpdate={onUpdateNode} />
        )}
        {activeTab === 'variables' && (
          <VariablesTab variables={variables} />
        )}
        {activeTab === 'validation' && (
          <ValidationTab errors={nodeErrors} warnings={nodeWarnings} globalErrors={validation.errors} globalWarnings={validation.warnings} />
        )}
        {(activeTab === 'conditions' || activeTab === 'actions' || activeTab === 'permissions') && (
          <div className="flex flex-col items-center justify-center py-8 text-slate-600">
            <Info className="w-8 h-8 opacity-20 mb-2" />
            <p className="text-xs text-center">سيتم تفعيل هذا القسم في الإصدار القادم</p>
          </div>
        )}
      </div>
    </div>
  );
});

function GeneralTab({ node, onUpdate }: { node: VBNode; onUpdate: (id: string, data: Partial<VBNode['data']>) => void }) {
  return (
    <div className="space-y-4" dir="rtl">
      <Field label="الاسم">
        <input
          value={node.data.label}
          onChange={(e) => onUpdate(node.id, { label: e.target.value })}
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      </Field>
      <Field label="الوصف">
        <textarea
          value={node.data.description ?? ''}
          onChange={(e) => onUpdate(node.id, { description: e.target.value })}
          rows={2}
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50 resize-none"
        />
      </Field>
      <Field label="النوع">
        <div className="px-3 py-1.5 bg-slate-800/40 rounded-lg text-xs text-slate-400 border border-slate-700/30">
          {node.data.definition.type}
        </div>
      </Field>
      <Field label="الفئة">
        <div className="px-3 py-1.5 bg-slate-800/40 rounded-lg text-xs text-slate-400 border border-slate-700/30">
          {node.data.definition.category}
        </div>
      </Field>
      <Field label="الحالة">
        <div className="px-3 py-1.5 bg-slate-800/40 rounded-lg text-xs text-slate-400 border border-slate-700/30">
          {node.data.status}
        </div>
      </Field>
      <Field label="المعرف">
        <div className="px-3 py-1.5 bg-slate-800/40 rounded-lg text-[10px] text-slate-500 border border-slate-700/30 font-mono truncate">
          {node.id}
        </div>
      </Field>
    </div>
  );
}

function VariablesTab({ variables }: { variables: WorkflowVariable[] }) {
  const [search, setSearch] = useState('');
  const filtered = variables.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3" dir="rtl">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="بحث في المتغيرات..."
        className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
      />
      {filtered.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-4">لا توجد متغيرات</p>
      )}
      {filtered.map((v) => (
        <div key={v.id} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-200 font-mono">{v.name}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-600/20 text-violet-400 border border-violet-500/20">
              {SCOPE_LABELS[v.scope] ?? v.scope}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500">{v.type}</span>
            {v.required && <span className="text-[9px] text-amber-400">مطلوب</span>}
          </div>
          {v.description && <p className="text-[10px] text-slate-500 mt-1">{v.description}</p>}
        </div>
      ))}
    </div>
  );
}

function ValidationTab({
  errors, warnings, globalErrors, globalWarnings,
}: {
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  globalErrors: Array<{ code: string; message: string; nodeId?: string }>;
  globalWarnings: Array<{ code: string; message: string; nodeId?: string }>;
}) {
  const allGlobalErrors = globalErrors.filter((e) => !e.nodeId);
  const allGlobalWarnings = globalWarnings.filter((w) => !w.nodeId);

  return (
    <div className="space-y-3" dir="rtl">
      {errors.length === 0 && warnings.length === 0 && allGlobalErrors.length === 0 && allGlobalWarnings.length === 0 && (
        <div className="flex flex-col items-center py-8 text-emerald-500">
          <AlertCircle className="w-8 h-8 opacity-40 mb-2" />
          <p className="text-xs">لا توجد مشاكل</p>
        </div>
      )}
      {[...errors, ...allGlobalErrors].map((e, i) => (
        <div key={i} className="flex gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{e.message}</p>
        </div>
      ))}
      {[...warnings, ...allGlobalWarnings].map((w, i) => (
        <div key={i} className="flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">{w.message}</p>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
