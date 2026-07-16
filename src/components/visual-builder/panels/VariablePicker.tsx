'use client';

/**
 * PART 5 — Visual Variable Picker
 * Browsable catalog of all available variables grouped by source.
 * Supports search, filtering, favorites, and selection.
 */

import React, { memo, useState, useMemo } from 'react';
import { Search, Star, X, Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VARIABLE_SOURCES } from '../engine/v2-catalogs';
import type { VBVariableEntry, VariableType } from '../engine/v2-types';

const TYPE_COLORS: Record<string, string> = {
  string: 'text-emerald-400',
  number: 'text-blue-400',
  boolean: 'text-amber-400',
  date: 'text-violet-400',
  array: 'text-pink-400',
  object: 'text-cyan-400',
};

const SOURCE_ICON_COLORS: Record<string, string> = {
  workflow: 'bg-violet-500/20 text-violet-300',
  employee: 'bg-blue-500/20 text-blue-300',
  attendance: 'bg-cyan-500/20 text-cyan-300',
  capa: 'bg-emerald-500/20 text-emerald-300',
  quality: 'bg-amber-500/20 text-amber-300',
  risk: 'bg-red-500/20 text-red-300',
  travel: 'bg-sky-500/20 text-sky-300',
  hr: 'bg-pink-500/20 text-pink-300',
  requests: 'bg-indigo-500/20 text-indigo-300',
  notifications: 'bg-orange-500/20 text-orange-300',
  system: 'bg-slate-500/20 text-slate-300',
};

interface VariablePickerProps {
  open: boolean;
  onSelect: (variable: VBVariableEntry) => void;
  onClose: () => void;
  title?: string;
}

export const VariablePicker = memo(function VariablePicker({
  open, onSelect, onClose, title = 'اختيار متغير',
}: VariablePickerProps) {
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wf_var_favorites') ?? '[]')); } catch { return new Set(); }
  });

  const allVars = useMemo(
    () => VARIABLE_SOURCES.flatMap((s) => s.variables),
    []
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allVars.filter((v) => {
      if (activeSource && v.source !== activeSource) return false;
      if (!q) return true;
      return v.name.toLowerCase().includes(q) || v.labelAr.includes(q) || v.label.toLowerCase().includes(q);
    });
  }, [allVars, search, activeSource]);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('wf_var_favorites', JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="text-sm font-bold text-slate-200">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-md hover:bg-slate-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في المتغيرات..."
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          {/* Source chips */}
          <div className="flex flex-wrap gap-1 mt-2">
            <button
              onClick={() => setActiveSource(null)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors border',
                activeSource === null
                  ? 'bg-violet-600/30 text-violet-300 border-violet-500/40'
                  : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
              )}
            >
              الكل
            </button>
            {VARIABLE_SOURCES.map((src) => (
              <button
                key={src.id}
                onClick={() => setActiveSource(src.id)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors border',
                  activeSource === src.id
                    ? 'bg-violet-600/30 text-violet-300 border-violet-500/40'
                    : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
                )}
              >
                {src.labelAr}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto arm-scroll">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-600">
              <Search className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">لا توجد نتائج</p>
            </div>
          )}
          {filtered.map((v) => (
            <button
              key={v.id}
              onClick={() => onSelect(v)}
              className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-slate-800/50 transition-colors text-right border-b border-slate-800/40 group"
            >
              <div className={cn('w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-[9px] font-bold', SOURCE_ICON_COLORS[v.source] ?? SOURCE_ICON_COLORS.system)}>
                {v.source[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-violet-300 truncate">{v.name}</span>
                  <span className={cn('text-[9px]', TYPE_COLORS[v.type] ?? 'text-slate-400')}>{v.type}</span>
                </div>
                <p className="text-[10px] text-slate-500 truncate">{v.labelAr}{v.description ? ` — ${v.description}` : ''}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFav(v.id); }}
                className={cn('p-0.5 transition-opacity', favorites.has(v.id) ? 'text-amber-400 opacity-100' : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-amber-400')}
              >
                <Star className="w-3 h-3" fill={favorites.has(v.id) ? 'currentColor' : 'none'} />
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-violet-400 transition-colors" />
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/60">
          <p className="text-[9px] text-slate-500 text-center">{filtered.length} متغير</p>
        </div>
      </div>
    </div>
  );
});
