'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
import { Plus, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { logCreate } from '@/lib/activity-logger';
import { useAuth } from '@/contexts/AuthContext';
import { PRIORITY_OPTIONS, DEPARTMENTS, SOURCE_OPTIONS } from '@/lib/capa-constants';
import type { Employee } from '@/types';

interface CAPAQuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  defaultValues?: {
    title?: string;
    department?: string;
    priority?: string;
    employeeId?: string;
    problemDescription?: string;
    source?: string;
    relatedFollowUpId?: string;
    relatedComplaintId?: string;
    relatedQualityDeductionId?: string;
    relatedHrDeductionId?: string;
  };
  employees: Employee[];
  systemUsers: { id: string; name: string; email?: string; role?: string }[];
}

export default function CAPAQuickCreate({
  open, onOpenChange, onCreated, defaultValues, employees, systemUsers,
}: CAPAQuickCreateProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: defaultValues?.title || '',
    department: defaultValues?.department || '',
    priority: defaultValues?.priority || 'medium',
    employeeId: defaultValues?.employeeId || '',
    assignedTo: '',
    source: defaultValues?.source || 'manual',
    problemDescription: defaultValues?.problemDescription || '',
  });

  const upd = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  const canSave = form.title.trim() && form.department && form.assignedTo && form.problemDescription.trim();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        ...form,
        createdBy: user?.id || 'system',
        createdByName: user?.name || 'النظام',
      };
      // Preserve cross-module linking from defaults
      if (defaultValues?.relatedFollowUpId) payload.relatedFollowUpId = defaultValues.relatedFollowUpId;
      if (defaultValues?.relatedComplaintId) payload.relatedComplaintId = defaultValues.relatedComplaintId;
      if (defaultValues?.relatedQualityDeductionId) payload.relatedQualityDeductionId = defaultValues.relatedQualityDeductionId;
      if (defaultValues?.relatedHrDeductionId) payload.relatedHrDeductionId = defaultValues.relatedHrDeductionId;

      const res = await authFetch('/api/capa-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        logCreate('capa', 'حالة كابا', form.title);
        toast.success('تم إنشاء حالة كابا بنجاح');
        // Reset form for next use
        setForm({ title: '', department: '', priority: 'medium', employeeId: '', assignedTo: '', source: 'manual', problemDescription: '' });
        onCreated?.(data.id);
        onOpenChange(false);
      } else {
        toast.error('فشل في إنشاء الحالة');
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700/70 max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white text-lg flex items-center gap-2">
            <Plus className="size-5 text-violet-400" />
            إنشاء حالة كابا جديدة
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            أدخل البيانات الأساسية فقط — يمكنك إكمال التفاصيل لاحقاً
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-medium">العنوان *</Label>
            <Input
              value={form.title}
              onChange={(e) => upd('title', e.target.value)}
              placeholder="وصف مختصر للمشكلة أو الإجراء المطلوب"
              className="bg-slate-800 border-slate-600 text-white h-9 text-sm"
              autoFocus
            />
          </div>

          {/* Department + Priority — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs font-medium">القسم *</Label>
              <Select value={form.department} onValueChange={(v) => upd('department', v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
                  <SelectValue placeholder="اختر القسم" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs font-medium">الأولوية *</Label>
              <Select value={form.priority} onValueChange={(v) => upd('priority', v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Related Employee + Assigned To — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs font-medium">الموظف المرتبط</Label>
              <EmployeeSearchInput
                employees={employees}
                value={form.employeeId}
                onChange={(id) => upd('employeeId', id)}
                placeholder="ابحث عن موظف..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs font-medium">المسؤول *</Label>
              <UserSearchInput
                users={systemUsers}
                value={form.assignedTo}
                onChange={(id) => upd('assignedTo', id)}
                placeholder="ابحث عن مستخدم..."
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-medium">المصدر *</Label>
            <Select value={form.source} onValueChange={(v) => upd('source', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Problem Description */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-medium">وصف المشكلة *</Label>
            <Textarea
              value={form.problemDescription}
              onChange={(e) => upd('problemDescription', e.target.value)}
              placeholder="صف المشكلة بالتفصيل..."
              className="bg-slate-800 border-slate-600 text-white resize-none text-sm"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {saving ? <Loader2 className="size-4 animate-spin ml-1" /> : <Plus className="size-4 ml-1" />}
            إنشاء الحالة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}