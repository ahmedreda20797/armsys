'use client';

/**
 * PART 8 — Save Node as Template Dialog
 * Lets users save a configured node as a reusable template (name, description,
 * category, tags). Persists via the node template store (localStorage-backed).
 */

import React, { memo, useState } from 'react';
import { BookmarkPlus, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode, VBNodeConfig } from '../engine/v2-types';
import { saveTemplate, getCategories } from '../engine/v2-node-template-store';

interface SaveNodeTemplateDialogProps {
  node: VBNode;
  onClose: () => void;
  onSaved?: () => void;
}

export const SaveNodeTemplateDialog = memo(function SaveNodeTemplateDialog({
  node, onClose, onSaved,
}: SaveNodeTemplateDialogProps) {
  const cfg = (node.data.config ?? {}) as Partial<VBNodeConfig>;
  const existingCategories = getCategories();

  const [name, setName] = useState(node.data.label);
  const [description, setDescription] = useState(node.data.description ?? '');
  const [category, setCategory] = useState(node.data.definition.category);
  const [tagsInput, setTagsInput] = useState('');

  const handleSave = () => {
    if (!name.trim()) return;
    saveTemplate({
      name: name.trim(),
      description: description.trim(),
      category: category.trim() || 'custom',
      nodeType: node.data.definition.type,
      config: {
        label: node.data.label,
        description: node.data.description ?? '',
        config: (cfg.config as Record<string, unknown>) ?? {},
        inputs: cfg.inputs ?? [],
        onError: cfg.onError ?? 'abort',
        metadata: cfg.metadata ?? {},
        documentation: cfg.documentation ?? '',
      },
      tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
    });
    onSaved?.();
    onClose();
  };

  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-slate-200">حفظ العقدة كقالب</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/30 text-[10px] text-slate-400 font-mono">
            النوع: {node.data.definition.type}
          </div>

          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">اسم القالب</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className={inputCls}
              placeholder="مثال: إشعار مدير عاجل"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">الوصف</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={cn(inputCls, 'resize-none')}
              placeholder="ماذا يفعل هذا القالب؟"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">الفئة</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
              placeholder="custom"
              list="tpl-categories"
            />
            <datalist id="tpl-categories">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">الوسوم (مفصولة بفواصل)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className={inputCls}
              placeholder="إشعار, عاجل"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-800 bg-slate-900/60">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              name.trim()
                ? 'bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/40'
                : 'bg-slate-800/40 border border-slate-700/40 text-slate-600 cursor-not-allowed'
            )}
          >
            <Check className="w-3.5 h-3.5" />
            حفظ القالب
          </button>
        </div>
      </div>
    </div>
  );
});
