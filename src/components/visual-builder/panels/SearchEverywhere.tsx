'use client';

/**
 * PART 15 — Search Everywhere
 * Command-palette style search across workflows, nodes, variables, templates, etc.
 */

import React, { memo, useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, Workflow, Hash, Variable as VarIcon, GitBranch, Zap,
  FileText, Clock, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode, VBSearchResult } from '../engine/v2-types';
import { SAMPLE_WORKFLOWS, NODE_TEMPLATES, WORKFLOW_TEMPLATES, VARIABLE_SOURCES } from '../engine/v2-catalogs';

interface SearchEverywhereProps {
  open: boolean;
  nodes: VBNode[];
  onClose: () => void;
  onJumpToNode: (id: string) => void;
  onOpenWorkflow: (id: string) => void;
}

const KIND_META: Record<string, { icon: React.ElementType; color: string; labelAr: string }> = {
  workflow:  { icon: Workflow, color: 'text-violet-300', labelAr: 'مسار' },
  node:      { icon: Hash, color: 'text-emerald-300', labelAr: 'عقدة' },
  variable:  { icon: VarIcon, color: 'text-cyan-300', labelAr: 'متغير' },
  condition: { icon: GitBranch, color: 'text-amber-300', labelAr: 'شرط' },
  action:    { icon: Zap, color: 'text-blue-300', labelAr: 'إجراء' },
  template:  { icon: FileText, color: 'text-pink-300', labelAr: 'قالب' },
  version:   { icon: Clock, color: 'text-slate-300', labelAr: 'إصدار' },
};

export const SearchEverywhere = memo(function SearchEverywhere({
  open, nodes, onClose, onJumpToNode, onOpenWorkflow,
}: SearchEverywhereProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo<VBSearchResult[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: VBSearchResult[] = [];

    // Workflows
    SAMPLE_WORKFLOWS.forEach((w) => {
      if (w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q)) {
        out.push({ id: w.id, kind: 'workflow', title: w.name, subtitle: w.description, icon: 'Workflow', workflowId: w.id });
      }
    });
    // Nodes
    nodes.forEach((n) => {
      if (n.data.label.toLowerCase().includes(q) || n.data.definition.type.includes(q)) {
        out.push({ id: n.id, kind: 'node', title: n.data.label, subtitle: n.data.definition.type, icon: 'Hash', nodeId: n.id });
      }
    });
    // Variables
    VARIABLE_SOURCES.forEach((src) => {
      src.variables.forEach((v) => {
        if (v.name.toLowerCase().includes(q) || v.labelAr.includes(query)) {
          out.push({ id: v.id, kind: 'variable', title: v.name, subtitle: `${v.labelAr} · ${src.labelAr}`, icon: 'Variable' });
        }
      });
    });
    // Templates
    [...NODE_TEMPLATES, ...WORKFLOW_TEMPLATES].forEach((t) => {
      const name = 'name' in t ? t.name : '';
      const desc = 'description' in t ? t.description : '';
      if (name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
        out.push({ id: t.id, kind: 'template', title: name, subtitle: desc, icon: 'FileText' });
      }
    });
    return out.slice(0, 30);
  }, [query, nodes]);

  const handleSelect = (r: VBSearchResult) => {
    if (r.kind === 'node' && r.nodeId) onJumpToNode(r.nodeId);
    else if (r.kind === 'workflow' && r.workflowId) onOpenWorkflow(r.workflowId);
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && results[activeIdx]) { e.preventDefault(); handleSelect(results[activeIdx]); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, activeIdx]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="ابحث في كل مكان... (مسارات، عقد، متغيرات، قوالب)"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto arm-scroll">
          {query.trim() === '' && (
            <div className="px-4 py-8 text-center">
              <Search className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">ابدأ الكتابة للبحث</p>
            </div>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-slate-500">لا توجد نتائج لـ "{query}"</p>
            </div>
          )}
          {results.map((r, idx) => {
            const meta = KIND_META[r.kind];
            const Icon = meta.icon;
            return (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-right transition-colors border-b border-slate-800/40',
                  activeIdx === idx ? 'bg-violet-600/15' : 'hover:bg-slate-800/40'
                )}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', meta.color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 truncate">{r.title}</p>
                  <p className="text-[10px] text-slate-500 truncate">{r.subtitle}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800/60 text-slate-500 flex-shrink-0">{meta.labelAr}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
