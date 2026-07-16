'use client';

/**
 * PART 9 — Workflow Template Library
 * Browse, preview, and apply workflow templates.
 */

import React, { memo, useState, useMemo } from 'react';
import {
  Search, Star, Eye, Plus, X, CheckCircle2, Users, Plane,
  ShieldCheck, Award, AlertTriangle, ClipboardCheck, MessageSquareWarning,
  Calendar, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKFLOW_TEMPLATES } from '../engine/v2-catalogs';
import type { VBWorkflowTemplate } from '../engine/v2-types';
import type { VBNode, VBEdge } from '../engine/types';

const ICONS: Record<string, React.ElementType> = {
  ShieldCheck, MessageSquareWarning, UserPlus: Users, Calendar, Plane, Award, AlertTriangle, ClipboardCheck, Users, FileText,
};

const IMPACT_COLORS: Record<string, string> = {
  low: 'text-slate-400',
  medium: 'text-blue-400',
  high: 'text-amber-400',
  critical: 'text-red-400',
};

interface TemplateLibraryProps {
  onClose: () => void;
  onApply: (nodes: VBNode[], edges: VBEdge[], variables: VBWorkflowTemplate['variables']) => void;
}

export const TemplateLibrary = memo(function TemplateLibrary({
  onClose, onApply,
}: TemplateLibraryProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [preview, setPreview] = useState<VBWorkflowTemplate | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const set = new Set(WORKFLOW_TEMPLATES.map((t) => t.category));
    return [...set];
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return WORKFLOW_TEMPLATES
      .filter((t) => {
        if (category && t.category !== category) return false;
        if (!q) return true;
        return t.name.toLowerCase().includes(q) || t.nameAr.includes(search) || t.description.toLowerCase().includes(q) || t.descriptionAr.includes(search);
      })
      .sort((a, b) => b.popularity - a.popularity);
  }, [search, category]);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-200">مكتبة القوالب</h2>
          <p className="text-[10px] text-slate-500">ابدأ من قالب جاهز</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4" /></button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في القوالب..."
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex flex-wrap gap-1">
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

      {/* Grid */}
      <div className="flex-1 overflow-y-auto arm-scroll p-3">
        <div className="grid grid-cols-1 gap-2">
          {filtered.map((t) => {
            const Icon = ICONS[t.icon] ?? FileText;
            return (
              <div key={t.id} className="group rounded-xl bg-slate-900/60 border border-slate-800 hover:border-violet-500/40 transition-all overflow-hidden">
                <div className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/20 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-violet-300" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-200">{t.nameAr}</p>
                        <p className="text-[9px] text-slate-500">{t.name}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleFav(t.id)}
                      className={cn('p-1 rounded transition-colors', favorites.has(t.id) ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400')}
                    >
                      <Star className="w-3.5 h-3.5" fill={favorites.has(t.id) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2 mb-2">{t.descriptionAr}</p>
                  <div className="flex items-center gap-2 text-[9px] text-slate-600 mb-2">
                    <span className="flex items-center gap-0.5"><Users className="w-2.5 h-2.5" />{t.nodes.length} عقدة</span>
                    {t.documentation.businessImpact && (
                      <span className={cn('flex items-center gap-0.5', IMPACT_COLORS[t.documentation.businessImpact])}>
                        تأثير: {t.documentation.businessImpact}
                      </span>
                    )}
                    <span className="mr-auto">★ {t.popularity}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPreview(t)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40 text-[10px] text-slate-300 hover:bg-slate-700/60 transition-colors"
                    >
                      <Eye className="w-3 h-3" /> معاينة
                    </button>
                    <button
                      onClick={() => { onApply(t.nodes, t.edges, t.variables); onClose(); }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-[10px] text-violet-300 hover:bg-violet-600/30 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> استخدام
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="absolute inset-0 z-10 bg-slate-950/95 flex flex-col" onClick={() => setPreview(null)}>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-bold text-slate-200">{preview.nameAr}</h3>
              <p className="text-[10px] text-slate-500">{preview.descriptionAr}</p>
            </div>
            <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto arm-scroll p-4" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Stat label="عدد العقد" value={preview.nodes.length} />
              <Stat label="عدد الاتصالات" value={preview.edges.length} />
              <Stat label="الوحدة" value={preview.module} />
              <Stat label="التأثير" value={preview.documentation.businessImpact ?? '-'} />
            </div>
            <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">العقد</h4>
            <div className="space-y-1">
              {preview.nodes.map((n) => (
                <div key={n.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className={cn('w-6 h-6 rounded flex items-center justify-center', n.data.definition.color)} />
                  <div className="flex-1">
                    <p className="text-xs text-slate-200">{n.data.label}</p>
                    <p className="text-[9px] text-slate-500 font-mono">{n.data.definition.type}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => { onApply(preview.nodes, preview.edges, preview.variables); onClose(); }}
              className="w-full mt-4 flex items-center justify-center gap-1 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-xs text-violet-300 hover:bg-violet-600/30 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" /> استخدام هذا القالب
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
      <p className="text-xs font-bold text-slate-200">{value}</p>
      <p className="text-[9px] text-slate-500">{label}</p>
    </div>
  );
}
