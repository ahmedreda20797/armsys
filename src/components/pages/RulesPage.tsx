'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Scale,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import { PageIdentity } from '@/components/shared/PageIdentity';
import type { DeductionRule } from '@/types';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';

interface RuleFormData {
  key: string;
  label: string;
  amount: string;
  unit: 'EGP' | 'days';
}

const defaultRules: Omit<DeductionRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { key: 'late15', label: 'تأخير من 16 إلى 30 دقيقة', amount: 0.25, unit: 'days' },
  { key: 'late30', label: 'تأخير من 31 إلى 60 دقيقة', amount: 0.5, unit: 'days' },
  { key: 'late60', label: 'تأخير 61 دقيقة فأكثر', amount: 1, unit: 'days' },
  { key: 'absence', label: 'غياب', amount: 1, unit: 'days' },
  { key: 'singleFingerprint', label: 'بصمة واحدة فقط (دخول أو خروج بدون الأخرى)', amount: 0.5, unit: 'days' },
];

const emptyForm: RuleFormData = {
  key: '',
  label: '',
  amount: '',
  unit: 'days',
};

function getUnitDisplay(unit: string, amount: number): string {
  if (unit === 'days') {
    if (amount === 0) return '0 يوم (إنذار)';
    if (amount === 0.25) return 'ربع يوم';
    if (amount === 0.5) return 'نصف يوم';
    if (amount === 0.75) return 'ثلاثة أرباع يوم';
    if (amount === 1) return 'يوم كامل';
    if (amount === 1.5) return 'يوم ونصف';
    if (amount === 2) return 'يومين';
    return `${amount} يوم`;
  }
  return `${amount} جنيه`;
}

export default function RulesPage() {
  const { canEdit, canCreate, canUpdate, canDelete } = usePermissions('rules');
  const [rules, setRules] = useState<DeductionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DeductionRule | null>(null);
  const [form, setForm] = useState<RuleFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchRules();
  }, []);

  async function fetchRules() {
    try {
      const res = await authFetch('/api/deduction-rules');
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
      }
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingRule) {
        const res = await authFetch(`/api/deduction-rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: form.key,
            label: form.label,
            amount: parseFloat(form.amount) || 0,
            unit: form.unit,
          }),
        });
        if (res.ok) {
          logUpdate('rules', 'قاعدة خصم', form.label);
          await fetchRules();
        }
      } else {
        const res = await authFetch('/api/deduction-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: form.key,
            label: form.label,
            amount: parseFloat(form.amount) || 0,
            unit: form.unit,
          }),
        });
        if (res.ok) {
          logCreate('rules', 'قاعدة خصم', form.label);
          await fetchRules();
        }
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
      setEditingRule(null);
      setIsAddOpen(false);
      setForm(emptyForm);
    }
  };

  const [deleteLoading, setDeleteLoading] = useState(false);
  const handleDelete = async (id: string) => {
    setDeleteLoading(true);
    try {
      const rule = rules.find((r: any) => r.id === id);
      const res = await authFetch(`/api/deduction-rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (rule) logDelete('rules', 'قاعدة خصم', rule.label);
        setRules((prev) => prev.filter((r) => r.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleLoadDefaults = async () => {
    try {
      // The GET /api/rules endpoint auto-syncs canonical amounts
      // Just re-fetch to trigger sync and refresh UI
      await fetchRules();
    } catch {
      // Error handled silently
    }
  };

  const openEdit = (rule: DeductionRule) => {
    setEditingRule(rule);
    setForm({
      key: rule.key,
      label: rule.label,
      amount: rule.amount.toString(),
      unit: rule.unit as 'EGP' | 'days',
    });
  };

  const updateForm = (field: keyof RuleFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const renderFormDialog = (title: string, open: boolean, onOpenChange: (v: boolean) => void) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">أدخل تفاصيل قاعدة الخصم</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">المفتاح (key)</Label>
            <Input
              value={form.key}
              onChange={(e) => updateForm('key', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="مثال: late15"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300">الوصف</Label>
            <Input
              value={form.label}
              onChange={(e) => updateForm('label', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="مثال: تأخير 15 دقيقة"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">المبلغ / الأيام</Label>
            <Input
              type="number"
              step="0.25"
              value={form.amount}
              onChange={(e) => updateForm('amount', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">الوحدة</Label>
            <Select
              value={form.unit}
              onValueChange={(v) => updateForm('unit', v)}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days" className="text-white">أيام</SelectItem>
                <SelectItem value="EGP" className="text-white">جنيه (EGP)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setForm(emptyForm);
              setEditingRule(null);
            }}
            className="border-slate-600 text-slate-300"
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.key || !form.label || !form.amount}
            className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="rules"
        icon={<Scale className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        description={`${rules.length} قاعدة خصم`}
        actions={
          <>
            {canEdit && (
              <Button
                variant="outline"
                onClick={handleLoadDefaults}
                className="border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                مزامنة القواعد
              </Button>
            )}
            {canCreate && (
              <Button
                  onClick={() => {
                    setForm(emptyForm);
                    setEditingRule(null);
                    setIsAddOpen(true);
                  }}
                  className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all"
                >
                  <Plus className="size-4" />
                  إضافة قاعدة
                </Button>
            )}
          </>
        }
      />

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Scale className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد قواعد خصم</p>
            <p className="text-slate-500 text-sm mt-1">
              أضف قواعد الخصم لبدء حساب الاستقطاعات
            </p>
            {canCreate && (
              <Button
                onClick={handleLoadDefaults}
                className="mt-4 bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white"
              >
                تحميل القواعد الافتراضية
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-sm font-medium">المفتاح</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الوصف</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الخصم</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الوحدة</TableHead>
                  {(canUpdate || canDelete) && <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className="border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <TableCell>
                      <span className="text-brand-400 font-mono text-sm" dir="ltr">{rule.key}</span>
                    </TableCell>
                    <TableCell className="text-white font-medium">{rule.label}</TableCell>
                    <TableCell className="text-slate-300" dir="ltr">
                      {getUnitDisplay(rule.unit, rule.amount)}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {rule.unit === 'EGP' ? 'جنيه' : 'أيام'}
                    </TableCell>
                    {(canUpdate || canDelete) && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <SmartActionMenu
                            actions={[
                              { key: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(rule), hidden: !canUpdate },
                              { key: 'delete', label: 'حذف', icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => setDeletingId(rule.id), hidden: !canDelete },
                            ]}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Add Dialog */}
      {renderFormDialog('إضافة قاعدة خصم جديدة', isAddOpen, setIsAddOpen)}

      {/* Edit Dialog */}
      {renderFormDialog(
        `تعديل: ${editingRule?.label}`,
        !!editingRule,
        (v) => {
          if (!v) setEditingRule(null);
        }
      )}

      {/* Delete Dialog — unified ConfirmDialog (§4) */}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
        description="هل أنت متأكد من حذف هذه القاعدة؟ لا يمكن التراجع عن هذا الإجراء."
        itemName={deletingId ? rules.find((r: { id: string; label?: string }) => r.id === deletingId)?.label : undefined}
        loading={deleteLoading}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />
    </div>
  );
}