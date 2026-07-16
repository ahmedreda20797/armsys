'use client';

/**
 * PART 8 — Node Template Library Panel
 * Browse / search / favorite / clone / apply / delete node templates.
 * Backed by the node template store (localStorage-persisted).
 */

import React, { memo, useState, useMemo, useSyncExternalStore } from 'react';
import {
  Search, Star, Copy, Trash2, Plus, X, Bookmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNodeTemplate, VBNodeConfig } from '../engine/v2-types';
import {
  subscribe, getAllTemplates, getFavorites, toggleFavorite,
  cloneTemplate, deleteTemplate, searchTemplates, getCategories, incrementUsage,
} from '../engine/v2-node-template-store';

interface NodeTemplateLibraryProps {
  open: boolean;
  onClose: () => void;
  onApply: (template: VBNodeTemplate) => void;
}

export const NodeTemplateLibrary = memo(function NodeTemplateLibrary({
  open, onClose, onApply,
}: NodeTemplateLibraryProps) {
  // Subscribe to store changes so favorites/clones reflect instantly
  useSyncExternalStore(subscribe, () => getAllTemplates().length, () => 0);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const filtered = useMemo(
    () => searchTemplates(search, { category, favoritesOnly }),
    [search, category, favoritesOnly],
  );
  const categories = useMemo(() => getCategories(), []);
  const favs = getFavorites();

  if (!open) return null;

  const handleApply = (tpl: VBNodeTemplate) => {
    incrementUsage(tpl.id);
    onApply(tpl);
    onClose();
  };

  const handleClone = (tpl: VBNodeTemplate) => {
    cloneTemplate(tpl.id);
  };

  const handleDelete = (tpl: VBNodeTemplate) => {
    if (confirm(`حذف القالب "${tpl.name}"؟`)) {
      deleteTemplate(tpl.id);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-[80vh] flex flex-col bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-violet-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-200">قوالب العقد</h3>
              <p className="text-[10px] text-slate-500">قوالب جاهزة ومحفوظة</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في القوالب..."
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            <button
              onClick={() => setFavoritesOnly((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] border transition-colors',
                favoritesOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
              )}
            >
              <Star className="w-2.5 h-2.5" /> المفضلة
            </button>
            <button
              onClick={() => setCategory(null)}
              className={cn('px-2 py-0.5 rounded-full text-[9px] border transition-colors', category === null ? 'bg-violet-600/30 text-violet-300 border-violet-500/40' : 'text-slate-500 border-slate-700/40 hover:text-slate-300')}
            >الكل</button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn('px-2 py-0.5 rounded-full text-[9px] border transition-colors', category === c ? 'bg-violet-600/30 text-violet-300 border-violet-500/40' : 'text-slate-500 border-slate-700/40 hover:text-slate-300')}
              >{c}</button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto arm-scroll p-3">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-600">
              <Bookmark className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-xs">لا توجد قوالب</p>
            </div>
          )}
          <div className="space-y-2">
            {filtered.map((tpl) => {
              const isFav = favs.has(tpl.id);
              return (
                <div
                  key={tpl.id}
                  className="group rounded-xl bg-slate-900/60 border border-slate-800 hover:border-violet-500/40 transition-all p-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200 truncate">{tpl.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800/60 text-slate-400 font-mono">{tpl.nodeType}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{tpl.description}</p>
                    </div>
                    <button
                      onClick={() => toggleFavorite(tpl.id)}
                      className={cn('p-1 rounded transition-colors flex-shrink-0', isFav ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400')}
                      aria-label="تفضيل"
                    >
                      <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>

                  {tpl.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {tpl.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded-full bg-slate-800/60 text-[9px] text-slate-400">{t}</span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-600">استُخدم {tpl.usageCount} مرة · {tpl.category}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleClone(tpl)}
                        className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                        title="نسخ"
                        aria-label="نسخ القالب"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(tpl)}
                        className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                        title="حذف"
                        aria-label="حذف القالب"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleApply(tpl)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> إضافة
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
