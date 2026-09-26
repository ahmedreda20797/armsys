'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Documents section (Milestone 7 §17, relocated)
//  Metadata-only documents (type/title/expiry/uploader/status +
//  optional URL). The API enforces employees permission + scope;
//  the component never invents a status — expired is derived from
//  the stored expiry date only.
// ══════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { apiFetch } from '@/lib/api-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { useEmployeeDocuments } from '@/hooks/use-queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ExternalLink, Loader2, Plus, ShieldCheck, XCircle } from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS_LABELS,
  documentStatus,
  documentTypeLabel,
} from '@/lib/employee-documents';

const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.value, t.label]),
);

interface DocRow {
  id: string;
  employeeId: string;
  docType: string;
  title: string;
  url: string | null;
  expiryDate: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

function documentStatusOf(expiryDate: string | null): { label: string; cls: string } {
  const status = documentStatus(expiryDate);
  const cls =
    status === 'expired'
      ? 'bg-red-500/15 text-red-500 border-red-500/30'
      : status === 'valid'
        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
        : 'bg-muted/60 text-muted-foreground border-border';
  return { label: DOCUMENT_STATUS_LABELS[status], cls };
}

export function EmployeeDocumentsSection({ employeeId }: { employeeId: string }) {
  const { locale } = useLanguage();
  const { canUpdate } = usePermissions('employees');
  // Documents are cache-backed — subject-scoped identity.
  const queryClient = useQueryClient();
  const docsQuery = useEmployeeDocuments(employeeId);
  const docs = (docsQuery.data ?? null) as DocRow[] | null;
  const error = docsQuery.isError && !docsQuery.data;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', docType: 'identity', url: '', expiryDate: '' });
  const [saving, setSaving] = useState(false);

  const loadDocs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
  }, [queryClient, employeeId]);

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/employee-documents', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          title: form.title.trim(),
          docType: form.docType,
          url: form.url.trim() || null,
          expiryDate: form.expiryDate || null,
        }),
      });
      toast.success('تم إضافة المستند');
      setAdding(false);
      setForm({ title: '', docType: 'identity', url: '', expiryDate: '' });
      await loadDocs();
    } catch (err: unknown) {
      toast.error((err as Error)?.message || 'فشل إضافة المستند');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/employee-documents/${id}`, { method: 'DELETE' });
      toast.success('تم حذف المستند');
      await loadDocs();
    } catch {
      toast.error('فشل حذف المستند');
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/50 bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="size-4 text-brand-500" />
          <T>مستندات الموظف</T>
        </h4>
        {canUpdate && (
          <Button size="sm" variant="outline" className="h-8 border-border text-xs"
            onClick={() => setAdding((v) => !v)}>
            <Plus className="me-1 size-3.5" />
            <T>إضافة مستند</T>
          </Button>
        )}
      </div>

      {adding && canUpdate && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground"><T>العنوان *</T></Label>
            <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              className="h-9 text-sm" placeholder={translateUIText('مثال: صورة البطاقة', locale)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground"><T>النوع</T></Label>
            <Select value={form.docType} onValueChange={(v) => setForm((p) => ({ ...p, docType: v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground"><T>تاريخ الانتهاء (اختياري)</T></Label>
            <Input type="date" value={form.expiryDate} onChange={(e) => setForm((p) => ({ ...p, expiryDate: e.target.value }))}
              className="h-9 text-sm" dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground"><T>رابط المستند (اختياري)</T></Label>
            <Input value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              className="h-9 text-sm" placeholder="https://..." dir="ltr" />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button size="sm" onClick={handleAdd} disabled={saving || !form.title.trim()}
              className="bg-brand-600 text-white hover:bg-brand-700">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'حفظ'}
            </Button>
          </div>
        </div>
      )}

      {docs === null ? (
        error ? (
          <p className="py-6 text-center text-sm text-muted-foreground"><T>تعذر تحميل المستندات</T></p>
        ) : (
          <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        )
      ) : docs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground"><T>لا توجد مستندات مسجلة لهذا الموظف</T></p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => {
            const status = documentStatusOf(doc.expiryDate);
            return (
              <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {documentTypeLabel(doc.docType)}
                    {doc.expiryDate && <span dir="ltr"> · ينتهي: {doc.expiryDate}</span>}
                    {doc.uploadedByName && ` · رفعها: ${doc.uploadedByName}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${status.cls}`}>{status.label}</Badge>
                  {doc.url && (
                    <a href={doc.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400">
                      <ExternalLink className="size-3" /> <T>فتح</T>
                    </a>
                  )}
                  {canUpdate && (
                    <button onClick={() => void handleDelete(doc.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                      title={translateUIText('حذف المستند', locale)} aria-label={`حذف ${doc.title}`}>
                      <XCircle className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
