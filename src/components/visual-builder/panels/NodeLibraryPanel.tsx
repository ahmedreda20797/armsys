'use client';

import React, { useState, useMemo, memo } from 'react';
import { Search, Star, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock as ClockIcon, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKFLOW_NODE_DEFINITIONS, NODE_CATEGORIES } from '../nodes/nodeDefinitions';
import type { VBNodeDefinition } from '../engine/types';

const ICON_MAP: Record<string, React.ElementType> = {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock: ClockIcon, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles,
};

interface NodeLibraryProps {
  onDragStart: (e: React.DragEvent, definition: VBNodeDefinition) => void;
  favorites: string[];
  recentlyUsed: string[];
  onToggleFavorite: (type: string) => void;
}

const NodeCard = memo(function NodeCard({
  def,
  isFavorite,
  onDragStart,
  onToggleFavorite,
}: {
  def: VBNodeDefinition;
  isFavorite: boolean;
  onDragStart: (e: React.DragEvent, def: VBNodeDefinition) => void;
  onToggleFavorite: (type: string) => void;
}) {
  const Icon = ICON_MAP[def.icon] ?? Zap;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, def)}
      className="group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 transition-all duration-100 select-none"
    >
      <div className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0', def.color, 'bg-opacity-20 border border-white/10')}>
        <Icon className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-200 truncate">{def.label}</p>
        <p className="text-[10px] text-slate-500 truncate">{def.description}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(def.type); }}
        className={cn('opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded', isFavorite ? 'opacity-100 text-amber-400' : 'text-slate-500 hover:text-amber-400')}
      >
        <Star className="w-3 h-3" fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
});

export const NodeLibraryPanel = memo(function NodeLibraryPanel({
  onDragStart,
  favorites,
  recentlyUsed,
  onToggleFavorite,
}: NodeLibraryProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'recent'>('all');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return WORKFLOW_NODE_DEFINITIONS.filter(
      (d) => !q || d.label.includes(q) || d.description.includes(q) || d.type.includes(q)
    );
  }, [search]);

  const displayNodes = useMemo(() => {
    if (activeTab === 'favorites') return filtered.filter((d) => favorites.includes(d.type));
    if (activeTab === 'recent') return filtered.filter((d) => recentlyUsed.includes(d.type));
    return filtered;
  }, [filtered, activeTab, favorites, recentlyUsed]);

  const byCategory = useMemo(() => {
    const map = new Map<string, VBNodeDefinition[]>();
    NODE_CATEGORIES.forEach((c) => map.set(c.id, []));
    displayNodes.forEach((d) => map.get(d.category)?.push(d));
    return map;
  }, [displayNodes]);

  const toggleCategory = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="flex flex-col h-full bg-slate-950/80 border-r border-slate-800/60">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60">
        <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">مكتبة العقد</h2>
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث..."
            dir="rtl"
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
          />
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-2">
          {(['all', 'favorites', 'recent'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors',
                activeTab === tab ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {tab === 'favorites' && <Star className="w-2.5 h-2.5" />}
              {tab === 'recent' && <Clock className="w-2.5 h-2.5" />}
              {tab === 'all' ? 'الكل' : tab === 'favorites' ? 'المفضلة' : 'الأخيرة'}
            </button>
          ))}
        </div>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto py-2 arm-scroll">
        {NODE_CATEGORIES.map((cat) => {
          const nodes = byCategory.get(cat.id) ?? [];
          if (nodes.length === 0) return null;
          const isCollapsed = collapsed[cat.id];
          return (
            <div key={cat.id} className="mb-1">
              <button
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/40 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{cat.labelAr}</span>
                <span className="mr-auto text-[9px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded-full">{nodes.length}</span>
              </button>
              {!isCollapsed && (
                <div className="px-2 pb-1">
                  {nodes.map((def) => (
                    <NodeCard
                      key={def.type}
                      def={def}
                      isFavorite={favorites.includes(def.type)}
                      onDragStart={onDragStart}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {displayNodes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Search className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">لا توجد نتائج</p>
          </div>
        )}
      </div>
    </div>
  );
});
