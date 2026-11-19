// src/components/connect/NewConversationDialog.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — GROUP / DEPARTMENT creation dialog
//
//  §WORKFLOW-CHANGE (1.0 → 1.0.1): direct conversations are NO LONGER
//  created here. The ONLY direct-chat workflow is account search in
//  the floating panel (selecting an account opens-or-creates the
//  conversation). The old direct mode depended on the controlPanel-
//  gated /api/dashboard/users directory — which 403s for every
//  non-admin role, making direct-chat creation impossible for exactly
//  the roles Connect was granted to (the reported 1.0 bug).
//
//  Group member picking now uses the SAME connect account-search
//  endpoint (connect-permission-gated, minimal projection) so groups
//  are creatable by every Connect-enabled role too.
// ══════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Network, Plus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import { useCreateConversation, useConnectAccountSearch } from '@/hooks/use-connect';
import { usePermissions } from '@/hooks/usePermissions';
import { initialsOf } from './ConversationList';
import type { ConnectAccountSummary } from '@/lib/connect/types';

export interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the conversation id to open after creation. */
  onCreated: (conversationId: string) => void;
}

type Mode = 'group' | 'department';

interface OrgNodeLite { id: string; name: string; status?: string }

const SEARCH_DEBOUNCE_MS = 250;

export function NewConversationDialog({ open, onOpenChange, onCreated }: NewConversationDialogProps) {
  const [mode, setMode] = useState<Mode>('group');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<ConnectAccountSummary[]>([]);
  const [deptNodeId, setDeptNodeId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const create = useCreateConversation();
  const { canViewPage } = usePermissions();
  const canCreateDepartment = canViewPage('organization');

  // Debounce the member search input (one request per settled query).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // ── Member picker: connect ACCOUNT search (never the controlPanel
  // directory; works for every Connect-enabled role) ──
  const trimmed = debouncedSearch.trim();
  const accountsQuery = useConnectAccountSearch(trimmed, open && trimmed.length >= 2);

  // Department selector — active org nodes (existing endpoint).
  const orgNodesQuery = useQuery<OrgNodeLite[]>({
    queryKey: ['connect', 'org-nodes'],
    enabled: open && mode === 'department' && canCreateDepartment,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiFetch<{ nodes: OrgNodeLite[] }>('/api/employees/org-nodes');
      return (res.nodes ?? []).filter((n) => !n.status || n.status === 'active');
    },
  });

  const candidates = useMemo(() => {
    const found = accountsQuery.data ?? [];
    const picked = new Set(selected.map((s) => s.id));
    return found.filter((u) => !picked.has(u.id));
  }, [accountsQuery.data, selected]);

  const reset = () => {
    setMode('group');
    setSearch('');
    setDebouncedSearch('');
    setSelected([]);
    setDeptNodeId(null);
    setTitle('');
    setDescription('');
    setSubmitting(false);
  };

  const addMember = (account: ConnectAccountSummary) => {
    setSelected((prev) => (prev.some((s) => s.id === account.id) ? prev : [...prev, account]));
    setSearch('');
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error('أدخل اسم المجموعة');
      return;
    }
    if (mode === 'department' && !deptNodeId) {
      toast.error('اختر الجهة التنظيمية');
      return;
    }
    setSubmitting(true);
    try {
      const res = await create.mutateAsync({
        type: mode,
        title: title.trim(),
        description: description.trim() || null,
        memberUserIds: selected.map((s) => s.id),
        ...(mode === 'department' ? { deptNodeId } : {}),
      });
      onCreated(res.data.id);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء المحادثة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 max-w-md">
        <DialogHeader>
          <DialogTitle>مجموعة جديدة</DialogTitle>
          <DialogDescription className="text-slate-400">
            أنشئ مجموعة عمل أو محادثة جهة — للمحادثات المباشرة استخدم البحث في لوحة التواصل
          </DialogDescription>
        </DialogHeader>

        {/* Mode tabs (direct mode lives in the floating panel's account search) */}
        <div className="grid grid-cols-2 gap-1.5">
          {([
            { id: 'group' as Mode, label: 'مجموعة', icon: <Users className="w-4 h-4" /> },
            { id: 'department' as Mode, label: 'جهة تنظيمية', icon: <Network className="w-4 h-4" />, locked: !canCreateDepartment },
          ]).map((tab) => (
            <button
              key={tab.id}
              disabled={tab.locked || submitting}
              onClick={() => { setMode(tab.id); setSelected([]); }}
              title={tab.locked ? 'تتطلب صلاحية الوصول للهيكل التنظيمي' : undefined}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-colors ${
                mode === tab.id
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200'
              } ${tab.locked ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Group fields */}
        <div className="space-y-2.5">
          <div>
            <Label className="text-slate-400 text-xs">{mode === 'department' ? 'اسم محادثة الجهة' : 'اسم المجموعة'}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === 'department' ? 'مثال: فريق مراقبة الجودة' : 'مثال: فريق المتابعة اليومية'}
              maxLength={120}
              className="bg-slate-800/60 border-slate-700 text-slate-200 mt-1"
            />
          </div>
          <div>
            <Label className="text-slate-400 text-xs">الوصف (اختياري)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="هدف المجموعة..."
              maxLength={500}
              rows={2}
              className="bg-slate-800/60 border-slate-700 text-slate-200 mt-1 resize-none"
            />
          </div>
          {mode === 'department' && (
            <div>
              <Label className="text-slate-400 text-xs">الجهة التنظيمية</Label>
              <select
                value={deptNodeId ?? ''}
                onChange={(e) => setDeptNodeId(e.target.value || null)}
                className="w-full mt-1 rounded-md bg-slate-800/60 border border-slate-700 text-slate-200 text-sm px-3 py-2"
              >
                <option value="">اختر الجهة...</option>
                {(orgNodesQuery.data ?? []).map((node) => (
                  <option key={node.id} value={node.id}>{node.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                العضوية تُثبَّت بالأعضاء المحددين أدناه فقط — لا تُمنح تلقائياً لموظفي الجهة لاحقاً.
              </p>
            </div>
          )}
        </div>

        {/* Member picker — connect ACCOUNT search */}
        <div className="space-y-2">
          <Label className="text-slate-400 text-xs">الأعضاء (اختياري — أنت المالك تلقائياً)</Label>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-600 pl-1 pr-2.5 py-0.5 text-xs text-slate-200">
                  {s.name ?? 'مستخدم'}
                  <button
                    onClick={() => setSelected((prev) => prev.filter((p) => p.id !== s.id))}
                    className="text-slate-500 hover:text-slate-300"
                    aria-label={`إزالة ${s.name ?? 'العضو'}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن حساب بالاسم أو البريد لإضافته..."
              className="bg-slate-800/60 border-slate-700 text-slate-200 pr-9"
            />
            {accountsQuery.isFetching && search.trim().length >= 2 && (
              <Loader2 className="w-4 h-4 animate-spin text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            )}
          </div>

          {search.trim().length >= 2 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/30">
              {accountsQuery.isError ? (
                <p className="text-xs text-amber-400/90 px-3 py-2.5">
                  {accountsQuery.error instanceof Error ? accountsQuery.error.message : 'تعذر البحث — أعد المحاولة'}
                </p>
              ) : candidates.length === 0 && !accountsQuery.isFetching ? (
                <p className="text-xs text-slate-500 px-3 py-3 text-center">لا توجد حسابات مطابقة</p>
              ) : (
                candidates.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-right hover:bg-slate-700/40 transition-colors"
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-slate-700 text-[10px] text-slate-200">{initialsOf(u.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{u.name ?? 'مستخدم'}</p>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  </button>
                ))
              )}
            </div>
          )}
          {selected.length > 0 && (
            <p className="text-[11px] text-slate-400">{selected.length} عضو محدد</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="text-slate-400" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {submitting ? 'جارٍ الإنشاء...' : 'إنشاء'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
