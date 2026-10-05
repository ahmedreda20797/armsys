'use client';

// ═══════════════════════════════════════════════════════════════
//  SimpleMasterDataWorkspace — Settings → Master Data & System
//  Lists → (أنواع المتابعات / أنواع الشكاوى / أنواع الطلبات).
//
//  The ONE shared management workspace for the bilingual vocabulary
//  domains served by /api/master-data/[domain]. It renders the
//  domain's canonical collection — no local list, no second source of
//  truth — with the same capability contract as the reference
//  ObservationCategoriesWorkspace:
//    search · active/inactive filter · add · edit · deactivate/
//    reactivate (usage-count confirmation) · reorder (up/down →
//    PUT {reorder}) · safe delete (server rejects referenced keys).
//
//  Presentation names follow the global rule: name/nameEn only —
//  never record ids or internal keys as labels (keys render in the
//  management table's code column only).
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Pencil, Trash2, ShieldAlert, Power, ChevronUp, ChevronDown, Search, ListChecks } from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import {
  useMasterDataListWithUsage, useCreateMasterDataRecord, useUpdateMasterDataRecord,
  useDeleteMasterDataRecord, useReorderMasterDataRecords,
} from '@/hooks/use-master-data';
import {
  isListItemActive, listItemDisplayName, sortListItems,
} from '@/lib/master-data/simple-list-presentation';
import { formatDateTime } from '@/lib/i18n/format';
import type { MasterDataSimpleDomain, MasterDataListItem } from '@/types/master-data';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'active' | 'inactive';
type ListRow = MasterDataListItem & { usageCount?: number };

// ─── Create / edit dialog ─────────────────────────────────────
interface ItemFormData {
  key: string;
  name: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: ItemFormData = { key: '', name: '', nameEn: '', sortOrder: 0, isActive: true };

function ItemDialog({
  domainLabel,
  open, onOpenChange, initial, nextSortOrder, onSave, busy,
}: {
  domainLabel: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: ItemFormData | null;
  /** sortOrder offered to a NEW record (max existing + 1). */
  nextSortOrder: number;
  onSave: (data: ItemFormData) => Promise<void>;
  busy: boolean;
}) {
  const { locale } = useLanguage();
  const [form, setForm] = useState<ItemFormData>(initial ?? { ...EMPTY_FORM, sortOrder: nextSortOrder });
  const isEdit = !!initial;

  const [lastInitial, setLastInitial] = useState<ItemFormData | null>(null);
  if (open && initial && initial !== lastInitial) {
    setForm(initial);
    setLastInitial(initial);
  }
  if (open && !initial && lastInitial !== null) {
    setForm({ ...EMPTY_FORM, sortOrder: nextSortOrder });
    setLastInitial(null);
  }

  function update<K extends keyof ItemFormData>(field: K, value: ItemFormData[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error(translateUIText('الاسم العربي مطلوب', locale));
      return;
    }
    if (!form.nameEn.trim()) {
      toast.error(translateUIText('الاسم الإنجليزي مطلوب', locale));
      return;
    }
    if (!isEdit && !form.key.trim()) {
      toast.error(translateUIText('المعرّف البرمجي مطلوب', locale));
      return;
    }
    await onSave(form);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <ListChecks className="size-5 text-brand-400" />
            {isEdit
              ? <T>تعديل السجل</T>
              : <T>إضافة سجل</T>}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {domainLabel} — <T>قوائم الأعمال القابلة للتكوين — تظهر في النماذج والفلاتر حسب الترتيب والحالة</T>
          </DialogDescription>
        </DialogHeader>

        {isEdit && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <p>
              <T>تعديل التسمية يؤثر على السجلات الجديدة وواجهة العرض فقط. البيانات المحفوظة في السجلات التاريخية لا تتغير ولا تُترجم تلقائياً.</T>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label><T>الاسم العربي *</T></Label>
            <Input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={translateUIText('مثال: متابعة', locale)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>الاسم الإنجليزي *</T></Label>
            <Input
              value={form.nameEn}
              onChange={(e) => update('nameEn', e.target.value)}
              placeholder="e.g. Follow-up"
              dir="ltr"
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>المعرّف البرمجي</T></Label>
            <Input
              value={form.key}
              onChange={(e) => update('key', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="follow_up"
              disabled={isEdit}
              dir="ltr"
              className="bg-slate-800/50 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label><T>ترتيب العرض</T></Label>
            <Input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => update('sortOrder', parseInt(e.target.value, 10) || 0)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-800/50 px-3 py-2 col-span-2">
            <div>
              <p className="text-sm text-slate-200"><T>نشط للاستخدام في السجلات الجديدة</T></p>
              <p className="text-xs text-slate-500"><T>التعطيل يمنع الاستخدام الجديد فقط ولا يمس السجلات التاريخية</T></p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => update('isActive', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
          <Button onClick={handleSubmit} disabled={busy} className="gap-2">
            {busy ? <T>جارٍ الحفظ...</T> : isEdit ? <T>حفظ التغييرات</T> : <T>إضافة</T>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workspace ────────────────────────────────────────────────
export default function SimpleMasterDataWorkspace({ domainId }: { domainId: MasterDataSimpleDomain }) {
  const { locale } = useLanguage();
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('masterData');
  const { data, isLoading } = useMasterDataListWithUsage(domainId);
  const createMut = useCreateMasterDataRecord(domainId);
  const updateMut = useUpdateMasterDataRecord(domainId);
  const deleteMut = useDeleteMasterDataRecord(domainId);
  const reorderMut = useReorderMasterDataRecords(domainId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ItemFormData | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deactivateTarget, setDeactivateTarget] = useState<ListRow | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<ListRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListRow | null>(null);

  const records = useMemo(
    () => sortListItems((Array.isArray(data) ? data : []) as ListRow[]),
    [data],
  );

  const filtered = useMemo(() => {
    let list = records;
    if (statusFilter === 'active') list = list.filter(isListItemActive);
    if (statusFilter === 'inactive') list = list.filter((r) => !isListItemActive(r));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.nameEn.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q),
      );
    }
    return list;
  }, [records, statusFilter, search]);

  const isUnfiltered = !search.trim() && statusFilter === 'all';
  const nextSortOrder = records.reduce((max, r) => Math.max(max, Number(r.sortOrder ?? 0)), 0) + 1;

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <ListChecks className="size-10 mb-3 opacity-40" />
        <p className="text-sm"><T>ليس لديك صلاحية لإدارة هذه القائمة</T></p>
      </div>
    );
  }

  function startEdit(record: ListRow) {
    setEditTargetId(record.id);
    setEditing({
      key: record.key,
      name: record.name,
      nameEn: record.nameEn,
      sortOrder: Number(record.sortOrder ?? 0),
      isActive: isListItemActive(record),
    });
    setDialogOpen(true);
  }

  async function handleSave(form: ItemFormData) {
    try {
      if (editTargetId) {
        await updateMut.mutateAsync({
          id: editTargetId,
          data: {
            name: form.name,
            nameEn: form.nameEn,
            sortOrder: form.sortOrder,
            isActive: form.isActive,
          },
        });
        toast.success(translateUIText('تم تحديث السجل', locale));
      } else {
        await createMut.mutateAsync({
          key: form.key,
          name: form.name,
          nameEn: form.nameEn,
          sortOrder: form.sortOrder,
        });
        toast.success(translateUIText('تمت إضافة السجل', locale));
      }
      setDialogOpen(false);
      setEditing(null);
      setEditTargetId(null);
    } catch (e) {
      toast.error(translateUIText('فشل الحفظ', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    try {
      await updateMut.mutateAsync({ id: deactivateTarget.id, data: { isActive: false } });
      toast.success(translateUIText('تم تعطيل السجل', locale));
      setDeactivateTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل التعطيل', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmReactivate() {
    if (!reactivateTarget) return;
    try {
      await updateMut.mutateAsync({ id: reactivateTarget.id, data: { isActive: true } });
      toast.success(translateUIText('تمت إعادة تفعيل السجل', locale));
      setReactivateTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل التفعيل', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success(translateUIText('تم حذف السجل', locale));
      setDeleteTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل الحذف', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  // Reorder moves a record within the FULL canonical order.
  async function move(record: ListRow, dir: -1 | 1) {
    const ids = records.map((r) => r.id);
    const index = ids.indexOf(record.id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderMut.mutateAsync(next);
    } catch (e) {
      toast.error(translateUIText('فشل تحديث الترتيب', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  const canEdit = canUpdate || canCreate;
  const busy = createMut.isPending || updateMut.isPending || reorderMut.isPending;

  return (
    <div className="space-y-3">
      {/* Toolbar: search + status filter + add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translateUIText('بحث بالاسم أو الكود...', locale)}
            className="bg-slate-800/50 border-slate-700 ps-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-32 h-8 bg-slate-800/50 border-slate-700 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><T>الكل</T></SelectItem>
            <SelectItem value="active"><T>النشطة</T></SelectItem>
            <SelectItem value="inactive"><T>المعطّلة</T></SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {canCreate && (
          <Button size="sm" onClick={() => { setEditing(null); setEditTargetId(null); setDialogOpen(true); }} className="gap-1.5 h-8">
            <Plus className="size-3.5" />
            <T>إضافة سجل</T>
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-slate-700/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-800/40 border-slate-700/40">
                <TableHead className="text-slate-400 text-xs"><T>الاسم</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الكود</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الحالة</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الاستخدام</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>آخر تعديل</T></TableHead>
                <TableHead className="text-slate-400 text-xs text-end"><T>الإجراءات</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((record) => {
                const active = isListItemActive(record);
                const usage = record.usageCount;
                return (
                  <TableRow key={record.id} className={cn('border-slate-700/30', !active && 'opacity-55')}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100 truncate">{listItemDisplayName(record, locale)}</p>
                        {locale === 'ar' && record.nameEn && (
                          <p className="text-[11px] text-slate-500 truncate" dir="ltr">{record.nameEn}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* Admin-facing stable code — management context only, never in operational UI */}
                      <span className="text-xs text-slate-500 font-mono" dir="ltr">{record.key}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={active
                        ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                        : 'text-slate-400 border-slate-600/40 bg-slate-500/10'}
                      >
                        {active ? <T>نشط</T> : <T>معطّل</T>}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-400">
                        {typeof usage === 'number'
                          ? (locale === 'en'
                              ? `${usage} ${usage === 1 ? 'record' : 'records'}`
                              : usage === 0 ? 'لا يستخدم' : usage === 1 ? 'سجل واحد' : `${usage} سجل`)
                          : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-500">{record.updatedAt ? formatDateTime(record.updatedAt, locale) : '—'}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && isUnfiltered && (
                          <div className="flex items-center rounded-md border border-slate-700/50 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => move(record, -1)}
                              disabled={busy || record.id === records[0]?.id}
                              className="p-1 hover:bg-slate-700/40 disabled:opacity-30"
                              aria-label={translateUIText('تحريك للأعلى', locale)}
                            >
                              <ChevronUp className="size-3.5 text-slate-400" />
                            </button>
                            <button
                              type="button"
                              onClick={() => move(record, 1)}
                              disabled={busy || record.id === records[records.length - 1]?.id}
                              className="p-1 hover:bg-slate-700/40 disabled:opacity-30 border-s border-slate-700/50"
                              aria-label={translateUIText('تحريك للأسفل', locale)}
                            >
                              <ChevronDown className="size-3.5 text-slate-400" />
                            </button>
                          </div>
                        )}
                        {canEdit && (
                          <SmartActionMenu
                            size="sm"
                            label={translateUIText('الإجراءات', locale)}
                            actions={[
                              { key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => startEdit(record) },
                              active
                                ? { key: 'deactivate', label: translateUIText('تعطيل', locale), icon: <Power className="size-3.5" />, onSelect: () => setDeactivateTarget(record) }
                                : { key: 'reactivate', label: translateUIText('إعادة تفعيل', locale), icon: <Power className="size-3.5" />, onSelect: () => setReactivateTarget(record) },
                              ...(canDelete && usage === 0
                                ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => setDeleteTarget(record) }]
                                : []),
                            ]}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-14 text-slate-400">
          <ListChecks className="size-10 mb-2 opacity-50" />
          <p className="text-sm"><T>لا توجد سجلات مطابقة</T></p>
        </div>
      )}

      <ItemDialog
        domainLabel=""
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) { setEditing(null); setEditTargetId(null); } }}
        initial={editing}
        nextSortOrder={nextSortOrder}
        onSave={handleSave}
        busy={busy}
      />

      {/* Deactivation confirms usage and never implies deletion */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}
        title={translateUIText('تعطيل السجل', locale)}
        description={translateUIText('تعطيل هذا السجل سيمنع استخدامه في السجلات الجديدة، ولن يؤثر على السجلات التاريخية أو التقارير.', locale)}
        itemName={deactivateTarget ? listItemDisplayName(deactivateTarget, locale) : undefined}
        confirmLabel={translateUIText('تعطيل', locale)}
        destructive={false}
        loading={updateMut.isPending}
        onConfirm={confirmDeactivate}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(open) => { if (!open) setReactivateTarget(null); }}
        title={translateUIText('إعادة تفعيل السجل', locale)}
        description={translateUIText('سيعود هذا السجل للظهور في النماذج الجديدة حسب ترتيبه.', locale)}
        itemName={reactivateTarget ? listItemDisplayName(reactivateTarget, locale) : undefined}
        confirmLabel={translateUIText('إعادة تفعيل', locale)}
        destructive={false}
        loading={updateMut.isPending}
        onConfirm={confirmReactivate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={translateUIText('سيتم حذف السجل نهائياً. لا يمكن الحذف إذا كان مستخدماً في سجلات قائمة.', locale)}
        itemName={deleteTarget ? listItemDisplayName(deleteTarget, locale) : undefined}
        loading={deleteMut.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
