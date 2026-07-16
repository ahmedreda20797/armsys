'use client';

/**
 * PART 10 — Version Manager
 * Visual version browser with draft/published/archived, rollback, duplicate, notes.
 */

import React, { memo, useState, useMemo } from 'react';
import {
  GitBranch, RotateCcw, Copy, FileText, CheckCircle2, Archive,
  Clock, Upload, X, ArrowLeftRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBWorkflowVersion, VBVersionStatus } from '../engine/v2-types';

// Sample versions seeded from the in-memory store
function seedVersions(): VBWorkflowVersion[] {
  const now = Date.now();
  const mk = (v: number, status: VBVersionStatus, label: string, changelog: string, nodeCount: number): VBWorkflowVersion => ({
    id: `ver_${v}`, workflowId: 'current', version: v, label, status,
    nodes: [], edges: [], variables: [], changelog,
    nodeCount, edgeCount: nodeCount - 1,
    createdAt: new Date(now - (4 - v) * 86400000).toISOString(),
    createdBy: 'النظام',
    publishedAt: status === 'published' ? new Date(now - (4 - v) * 86400000 + 3600000).toISOString() : null,
    publishedBy: status === 'published' ? 'أحمد' : null,
  });
  return [
    mk(4, 'draft', 'v4 — مسودة', 'إضافة عقدة الإشعار', 8),
    mk(3, 'published', 'v3 — منشور', 'تحسين شروط الاعتماد', 7),
    mk(2, 'archived', 'v2 — مؤرشف', 'النسخة الأولية', 5),
    mk(1, 'archived', 'v1 — مؤرشف', 'الإنشاء', 3),
  ];
}

const STATUS_META: Record<VBVersionStatus, { labelAr: string; color: string; icon: React.ElementType }> = {
  draft:     { labelAr: 'مسودة',   color: 'bg-amber-500/20 text-amber-300 border-amber-500/20', icon: Clock },
  published: { labelAr: 'منشور',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20', icon: CheckCircle2 },
  archived:  { labelAr: 'مؤرشف',   color: 'bg-slate-500/20 text-slate-400 border-slate-500/20', icon: Archive },
};

interface VersionManagerProps {
  onClose: () => void;
  onRollback?: (version: VBWorkflowVersion) => void;
  onPublish?: (version: VBWorkflowVersion) => void;
}

export const VersionManager = memo(function VersionManager({
  onClose, onRollback, onPublish,
}: VersionManagerProps) {
  const [versions, setVersions] = useState<VBWorkflowVersion[]>(seedVersions);
  const [filter, setFilter] = useState<VBVersionStatus | 'all'>('all');
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');

  const filtered = useMemo(
    () => filter === 'all' ? versions : versions.filter((v) => v.status === filter),
    [versions, filter]
  );

  const updateNotes = (id: string) => {
    setVersions((vs) => vs.map((v) => v.id === id ? { ...v, changelog: notesValue } : v));
    setEditingNotes(null);
  };

  const duplicate = (v: VBWorkflowVersion) => {
    const newVersion: VBWorkflowVersion = {
      ...v, id: `ver_${versions.length + 1}`, version: versions.length + 1,
      label: `v${versions.length + 1} — نسخة من v${v.version}`, status: 'draft',
      createdAt: new Date().toISOString(), publishedAt: null, publishedBy: null,
    };
    setVersions((vs) => [newVersion, ...vs]);
  };

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">مدير الإصدارات</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4" /></button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 p-2 border-b border-slate-800">
        {(['all', 'draft', 'published', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
              filter === f ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30' : 'text-slate-500 hover:text-slate-300'
            )}
          >
            {f === 'all' ? 'الكل' : STATUS_META[f].labelAr}
          </button>
        ))}
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto arm-scroll p-2 space-y-2">
        {filtered.map((v) => {
          const meta = STATUS_META[v.status];
          const Icon = meta.icon;
          const isCompareA = compareA === v.id;
          const isCompareB = compareB === v.id;
          return (
            <div
              key={v.id}
              className={cn(
                'rounded-xl border p-3 transition-all',
                v.status === 'published' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-900/60 border-slate-800'
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-4 h-4', v.status === 'published' ? 'text-emerald-400' : v.status === 'draft' ? 'text-amber-400' : 'text-slate-500')} />
                  <span className="text-xs font-bold text-slate-200">{v.label}</span>
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', meta.color)}>{meta.labelAr}</span>
                </div>
                <span className="text-[9px] text-slate-600">{v.version}</span>
              </div>

              {/* Changelog */}
              {editingNotes === v.id ? (
                <div className="mb-2">
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/50 resize-none"
                    autoFocus
                  />
                  <div className="flex gap-1 mt-1">
                    <button onClick={() => updateNotes(v.id)} className="px-2 py-0.5 rounded text-[10px] bg-violet-600/30 text-violet-300">حفظ</button>
                    <button onClick={() => setEditingNotes(null)} className="px-2 py-0.5 rounded text-[10px] text-slate-500">إلغاء</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingNotes(v.id); setNotesValue(v.changelog); }}
                  className="block w-full text-right mb-2 group"
                >
                  <p className="text-[11px] text-slate-400 group-hover:text-slate-300">{v.changelog || '—'}</p>
                  <FileText className="w-2.5 h-2.5 text-slate-600 inline mr-1" />
                </button>
              )}

              {/* Meta */}
              <div className="flex items-center gap-3 text-[9px] text-slate-600 mb-2">
                <span>{v.nodeCount} عقدة</span>
                <span>·</span>
                <span>{new Date(v.createdAt).toLocaleDateString('ar')}</span>
                {v.publishedBy && (<><span>·</span><span>اعتمد: {v.publishedBy}</span></>)}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-1">
                {v.status === 'draft' && (
                  <button
                    onClick={() => { onPublish?.(v); setVersions((vs) => vs.map((x) => x.id === v.id ? { ...x, status: 'published', publishedAt: new Date().toISOString(), publishedBy: 'أنت' } : x.status === 'published' ? { ...x, status: 'archived' } : x)); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                  >
                    <Upload className="w-3 h-3" /> نشر
                  </button>
                )}
                <button
                  onClick={() => duplicate(v)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <Copy className="w-3 h-3" /> نسخ
                </button>
                {v.status !== 'draft' && (
                  <button
                    onClick={() => onRollback?.(v)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-amber-600/20 border border-amber-500/30 text-amber-300 hover:bg-amber-600/30 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> استرجاع
                  </button>
                )}
                <button
                  onClick={() => isCompareA ? setCompareA(null) : setCompareA(v.id)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-colors',
                    isCompareA ? 'bg-blue-600/30 border-blue-500/40 text-blue-300' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200'
                  )}
                >
                  <ArrowLeftRight className="w-3 h-3" /> A
                </button>
                <button
                  onClick={() => isCompareB ? setCompareB(null) : setCompareB(v.id)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-colors',
                    isCompareB ? 'bg-violet-600/30 border-violet-500/40 text-violet-300' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200'
                  )}
                >
                  <ArrowLeftRight className="w-3 h-3" /> B
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Compare footer */}
      {compareA && compareB && (
        <div className="p-3 border-t border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-400">مقارنة الإصدارات</span>
            <button onClick={() => { setCompareA(null); setCompareB(null); }} className="text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            {(() => {
              const a = versions.find((v) => v.id === compareA)!;
              const b = versions.find((v) => v.id === compareB)!;
              const diff = b.nodeCount - a.nodeCount;
              return (
                <>
                  <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-[9px] text-blue-300">{a.label}</p>
                    <p className="text-xs text-slate-300">{a.nodeCount} عقدة</p>
                  </div>
                  <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                    <p className="text-[9px] text-violet-300">{b.label}</p>
                    <p className="text-xs text-slate-300">{b.nodeCount} عقدة</p>
                  </div>
                  <div className="col-span-2 text-[10px] text-slate-400">
                    {diff > 0 ? `+${diff} عقد جديدة` : diff < 0 ? `${diff} عقد محذوفة` : 'نفس عدد العقد'}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
});
