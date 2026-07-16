'use client';

/**
 * PART 14 — Workflow Outline
 * Tree view of every node. Search, jump-to-node, expand/collapse.
 */

import React, { memo, useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight, Hash, GitBranch, Zap,
  CircleDot, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode, VBEdge, VBValidationReport } from '../engine/v2-types';

interface WorkflowOutlineProps {
  nodes: VBNode[];
  edges: VBEdge[];
  validation: VBValidationReport;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
}

const DECISION_TYPES = new Set(['condition', 'switch', 'compare', 'loop']);

export const WorkflowOutline = memo(function WorkflowOutline({
  nodes, edges, validation, selectedId, onSelectNode,
}: WorkflowOutlineProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Build tree: each node → its direct children via outgoing edges
  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>();
    edges.forEach((e) => {
      const arr = map.get(e.source) ?? [];
      arr.push(e.target);
      map.set(e.source, arr);
    });
    return map;
  }, [edges]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const roots = useMemo(() => {
    const incoming = new Set(edges.map((e) => e.target));
    return nodes.filter((n) => n.data.definition.type === 'start' || !incoming.has(n.id));
  }, [nodes, edges]);

  const filtered = useMemo(() => {
    if (!search) return roots;
    const q = search.toLowerCase();
    // when searching, show all matching nodes flat
    return nodes.filter((n) =>
      n.data.label.toLowerCase().includes(q) ||
      n.data.definition.type.includes(q) ||
      n.data.definition.category.includes(q)
    );
  }, [roots, nodes, search]);

  const errorNodeIds = useMemo(
    () => new Set(validation.issues.filter((i) => i.severity === 'error' && i.nodeId).map((i) => i.nodeId!)),
    [validation]
  );

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (nodeId: string, depth: number, visited: Set<string>): React.ReactNode => {
    if (visited.has(nodeId)) return null; // cycle guard
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    const kids = childrenOf.get(nodeId) ?? [];
    const isCollapsed = collapsed.has(nodeId);
    const hasError = errorNodeIds.has(nodeId);
    const isSelected = selectedId === nodeId;
    const isDecision = DECISION_TYPES.has(node.data.definition.type);
    const isAction = node.data.definition.category === 'actions';

    return (
      <div key={nodeId}>
        <div
          className={cn(
            'group flex items-center gap-1 px-1.5 py-1 rounded-md cursor-pointer transition-colors',
            isSelected ? 'bg-violet-600/20 text-violet-200' : 'hover:bg-slate-800/50 text-slate-400'
          )}
          style={{ paddingRight: `${depth * 12 + 6}px` }}
          onClick={() => onSelectNode(nodeId)}
        >
          {kids.length > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); toggle(nodeId); }} className="p-0.5">
              {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-3.5" />
          )}
          {isDecision ? <GitBranch className="w-3 h-3 text-amber-400 flex-shrink-0" /> :
           isAction ? <Zap className="w-3 h-3 text-emerald-400 flex-shrink-0" /> :
           node.data.definition.type === 'start' ? <CircleDot className="w-3 h-3 text-emerald-400 flex-shrink-0" /> :
           node.data.definition.type === 'end' ? <CircleDot className="w-3 h-3 text-red-400 flex-shrink-0" /> :
           <Hash className="w-3 h-3 text-slate-500 flex-shrink-0" />}
          <span className="text-[11px] truncate flex-1">{node.data.label}</span>
          {hasError && <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
        </div>
        {!isCollapsed && kids.length > 0 && (
          <div>
            {kids.map((kidId) => renderNode(kidId, depth + 1, new Set([...visited, nodeId])))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full" dir="rtl">
      <div className="p-2 border-b border-slate-800">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">المخطط الشجري</span>
      </div>
      <div className="p-2 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في العقد..."
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto arm-scroll p-1">
        {search ? (
          <div className="space-y-0.5">
            {filtered.map((n) => (
              <div
                key={n.id}
                onClick={() => onSelectNode(n.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors',
                  selectedId === n.id ? 'bg-violet-600/20 text-violet-200' : 'hover:bg-slate-800/50 text-slate-400'
                )}
              >
                <Hash className="w-3 h-3 text-slate-500" />
                <span className="text-[11px] truncate">{n.data.label}</span>
              </div>
            ))}
          </div>
        ) : (
          roots.map((r) => renderNode(r.id, 0, new Set()))
        )}
        {nodes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-600">
            <GitBranch className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-xs">لا توجد عقد</p>
          </div>
        )}
      </div>
    </div>
  );
});
