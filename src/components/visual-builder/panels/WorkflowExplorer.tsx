'use client';

/**
 * PART 1 — Workflow Explorer
 * Browse / search / filter all workflows. Folders, tags, owners, view modes.
 */

import React, { memo, useState, useMemo } from 'react';
import {
  Search, Folder, Star, Clock, Archive, FileText, CheckCircle2,
  LayoutGrid, List as ListIcon, ChevronRight, Filter, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SAMPLE_WORKFLOWS } from '../engine/v2-catalogs';
import type { VBWorkflowRecord, VBWorkflowFolder } from '../engine/v2-types';

const FOLDERS: { id: VBWorkflowFolder | 'all'; label: string; icon: React.ElementType }[] = [
  { id: 'all',        label: 'الكل',        icon: FileText },
  { id: 'draft',      label: 'مسودات',      icon: Folder },
  { id: 'published',  label: 'منشورة',      icon: CheckCircle2 },
  { id: 'archived',   label: 'مؤرشفة',      icon: Archive },
  { id: 'favorites',  label: 'المفضلة',     icon: Star },
  { id: 'recent',     label: 'الأخيرة',     icon: Clock },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-amber-500/20 text-amber-300 border-amber-500/20',
  published: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20',
  archived: 'bg-slate-500/20 text-slate-400 border-slate-500/20',
  running: 'bg-violet-500/20 text-violet-300 border-violet-500/20',
};

interface WorkflowExplorerProps {
  onOpen: (workflow: VBWorkflowRecord) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export const WorkflowExplorer = memo(function WorkflowExplorer({
  onOpen, onCreateNew, onClose,
}: WorkflowExplorerProps) {
  const [folder, setFolder] = useState<VBWorkflowFolder | 'all'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'name' | 'createdAt'>('updatedAt');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    SAMPLE_WORKFLOWS.forEach((w) => w.tags.forEach((t) => set.add(t)));
    return [...set];
  }, []);

  const filtered = useMemo(() => {
    let list = [...SAMPLE_WORKFLOWS];
    if (folder === 'favorites') list = list.filter((w) => w.favorite);
    else if (folder === 'recent') list = list.filter((w) => w.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
    else if (folder !== 'all') list = list.filter((w) => w.folder === folder);

    if (tagFilter) list = list.filter((w) => w.tags.includes(tagFilter));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some((t) => t.includes(q)) ||
        w.ownerName.includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return (b[sortBy] ?? '').localeCompare(a[sortBy] ?? '');
    });
    return list;
  }, [folder, search, tagFilter, sortBy]);

  return (
    <div className="flex flex-col h-full bg-slate-950" dir="rtl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">مستكشف المسارات</h2>
        <button onClick={onCreateNew} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-[11px] hover:bg-violet-600/30 transition-colors">
          <Plus className="w-3.5 h-3.5" /> جديد
        </button>
      </div>

      {/* Folders */}
      <div className="flex gap-1 p-2 border-b border-slate-800 overflow-x-auto arm-scroll">
        {FOLDERS.map((f) => {
          const count = f.id === 'all'
            ? SAMPLE_WORKFLOWS.length
            : f.id === 'favorites'
            ? SAMPLE_WORKFLOWS.filter((w) => w.favorite).length
            : SAMPLE_WORKFLOWS.filter((w) => w.folder === f.id).length;
          return (
            <button
              key={f.id}
              onClick={() => setFolder(f.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors',
                folder === f.id ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <f.icon className="w-3 h-3" />
              {f.label}
              <span className="text-[9px] text-slate-600">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + controls */}
      <div className="p-2 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث..."
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-2 py-1 text-[10px] text-slate-400 cursor-pointer">
            <option value="updatedAt">آخر تعديل</option>
            <option value="createdAt">تاريخ الإنشاء</option>
            <option value="name">الاسم</option>
          </select>
          <div className="flex gap-0.5 rounded-md bg-slate-800/60 p-0.5">
            <button onClick={() => setView('grid')} className={cn('p-1 rounded', view === 'grid' ? 'bg-violet-600/30 text-violet-300' : 'text-slate-500')}><LayoutGrid className="w-3 h-3" /></button>
            <button onClick={() => setView('list')} className={cn('p-1 rounded', view === 'list' ? 'bg-violet-600/30 text-violet-300' : 'text-slate-500')}><ListIcon className="w-3 h-3" /></button>
          </div>
        </div>
        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
              className={cn(
                'px-1.5 py-0.5 rounded-full text-[9px] border transition-colors',
                tagFilter === t ? 'bg-violet-600/30 text-violet-300 border-violet-500/40' : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto arm-scroll p-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-600">
            <Folder className="w-10 h-10 mb-2 opacity-20" />
            <p className="text-xs">لا توجد مسارات</p>
          </div>
        )}

        {view === 'grid' ? (
          <div className="grid grid-cols-1 gap-2">
            {filtered.map((w) => (
              <button
                key={w.id}
                onClick={() => onOpen(w)}
                className="group text-right p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-violet-500/40 hover:bg-slate-900 transition-all"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {w.favorite && <Star className="w-3 h-3 text-amber-400" fill="currentColor" />}
                    <span className="text-xs font-bold text-slate-200">{w.name}</span>
                  </div>
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', STATUS_COLORS[w.status] ?? STATUS_COLORS.draft)}>
                    {w.status === 'published' ? 'منشور' : w.status === 'draft' ? 'مسودة' : w.status === 'archived' ? 'مؤرشف' : w.status}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 line-clamp-2 mb-2">{w.description}</p>
                <div className="flex items-center gap-2 text-[9px] text-slate-600">
                  <span>{w.ownerName}</span>
                  <span>·</span>
                  <span>{w.nodeCount} عقدة</span>
                  <span>·</span>
                  <span>v{w.currentVersion}</span>
                  <span className="mr-auto">{w.updatedAt}</span>
                </div>
                {w.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {w.tags.slice(0, 3).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded-full bg-slate-800/60 text-[9px] text-slate-400">{t}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((w) => (
              <button
                key={w.id}
                onClick={() => onOpen(w)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800/50 transition-colors text-right"
              >
                {w.favorite && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" />}
                <span className="text-xs text-slate-200 flex-1 truncate">{w.name}</span>
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0', STATUS_COLORS[w.status] ?? STATUS_COLORS.draft)}>
                  {w.status === 'published' ? 'منشور' : w.status === 'draft' ? 'مسودة' : 'مؤرشف'}
                </span>
                <span className="text-[9px] text-slate-600 flex-shrink-0">{w.updatedAt}</span>
                <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
