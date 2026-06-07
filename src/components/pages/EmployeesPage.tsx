'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Upload,
  Search,
  Plus,
  Pencil,
  Trash2,
  Users,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import type { Employee } from '@/types';

interface EmployeeFormData {
  code: string;
  name: string;
  department: string;
  position: string;
  shiftStart: string;
  shiftEnd: string;
  hireDate: string;
  mobile: string;
}

const emptyForm: EmployeeFormData = {
  code: '',
  name: '',
  department: '',
  position: '',
  shiftStart: '',
  shiftEnd: '',
  hireDate: '',
  mobile: '',
};

export default function EmployeesPage() {
  const { canEdit } = usePermissions('employees');
  const { highlightId, setHighlightId } = useAppStore();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<EmployeeFormData>(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);

  // Swipe to delete state
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  // Auto-clear highlight after 3 seconds and scroll into view
  useEffect(() => {
    if (!highlightId) return;

    const timer = setTimeout(() => {
      setHighlightId(null);
    }, 3000);

    // Scroll the highlighted row into view after a small delay to let it render
    requestAnimationFrame(() => {
      highlightRowRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });

    return () => clearTimeout(timer);
  }, [highlightId, setHighlightId]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/employees');
      if (res.ok) {
        const data = await res.json();
        setEmployees(data);
      }
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/employees/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await fetchEmployees();
      }
    } catch {
      // Error handled silently
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingEmployee) {
        const res = await fetch(`/api/employees/${editingEmployee.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (res.ok) await fetchEmployees();
      } else {
        const res = await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (res.ok) await fetchEmployees();
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
      setEditingEmployee(null);
      setIsAddOpen(false);
      setForm(emptyForm);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setEmployees((prev) => prev.filter((emp) => emp.id !== id));
        setSwipeId(null);
      }
    } catch {
      // Error handled silently
    }
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setForm({
      code: emp.code || '',
      name: emp.name,
      department: emp.department || '',
      position: emp.position || '',
      shiftStart: emp.shiftStart || '',
      shiftEnd: emp.shiftEnd || '',
      hireDate: emp.hireDate || '',
      mobile: emp.mobile || '',
    });
  };

  const filtered = employees.filter(
    (emp) =>
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      (emp.code || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.department || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.position || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.mobile || '').toLowerCase().includes(search.toLowerCase())
  );

  // Touch handlers for swipe-to-delete (RTL: swipe left means swipe right visually)
  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
    setSwipeId(null);
  };

  const handleTouchMove = (e: React.TouchEvent, id: string) => {
    if (touchStartX.current === null) return;
    touchCurrentX.current = e.touches[0].clientX;
    const diff = touchStartX.current - touchCurrentX.current;
    // In RTL, swiping left (negative diff in screen coords) reveals delete
    if (diff < -60) {
      setSwipeId(id);
    } else {
      setSwipeId(null);
    }
  };

  const handleTouchEnd = () => {
    touchStartX.current = null;
    touchCurrentX.current = null;
  };

  const updateForm = useCallback((field: keyof EmployeeFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const renderFormDialog = (title: string, open: boolean, onOpenChange: (v: boolean) => void) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">أدخل بيانات الموظف</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">كود الموظف</Label>
            <Input
              value={form.code}
              onChange={(e) => updateForm('code', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="EMP-001"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">الاسم</Label>
            <Input
              value={form.name}
              onChange={(e) => updateForm('name', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">القسم</Label>
            <Input
              value={form.department}
              onChange={(e) => updateForm('department', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">الوظيفة</Label>
            <Input
              value={form.position}
              onChange={(e) => updateForm('position', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">بداية الدوام</Label>
            <Input
              value={form.shiftStart}
              onChange={(e) => updateForm('shiftStart', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="08:00"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">نهاية الدوام</Label>
            <Input
              value={form.shiftEnd}
              onChange={(e) => updateForm('shiftEnd', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="17:00"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">تاريخ التعيين</Label>
            <Input
              value={form.hireDate}
              onChange={(e) => updateForm('hireDate', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="DD/MM/YYYY"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">رقم الموبايل</Label>
            <Input
              value={form.mobile}
              onChange={(e) => updateForm('mobile', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="01XXXXXXXXX"
              dir="ltr"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setForm(emptyForm);
              setEditingEmployee(null);
            }}
            className="border-slate-600 text-slate-300"
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="size-6 text-emerald-400" />
            إدارة الموظفين
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {filtered.length} من {employees.length} موظف
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                {uploading ? (
                  <>جاري الرفع...</>
                ) : (
                  <>
                    <Upload className="size-4" />
                    رفع Excel
                  </>
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleUpload}
                className="hidden"
              />
              <Button
                onClick={() => {
                  setForm(emptyForm);
                  setEditingEmployee(null);
                  setIsAddOpen(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Plus className="size-4" />
                إضافة موظف
              </Button>
            </>
          )}
        </div>
      </motion.div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <Input
          placeholder="بحث بالاسم، الكود، القسم، الوظيفة، أو الموبايل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-600 text-white pr-10 placeholder:text-slate-500"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileSpreadsheet className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا يوجد موظفون</p>
            <p className="text-slate-500 text-sm mt-1">
              {search ? 'لم يتم العثور على نتائج' : 'ابدأ بإضافة موظفين جدد'}
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Table */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-sm font-medium">الكود</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الاسم</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden sm:table-cell">القسم</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden md:table-cell">الوظيفة</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden lg:table-cell">الدوام</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden lg:table-cell">الموبايل</TableHead>
                  {canEdit && <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => {
                  const isHighlighted = emp.id === highlightId;
                  return (
                    <TableRow
                      key={emp.id}
                      ref={isHighlighted ? highlightRowRef : undefined}
                      className={`border-slate-700/50 hover:bg-slate-700/30 relative transition-all duration-500 ${
                        isHighlighted ? 'ring-2 ring-emerald-500 bg-emerald-500/5' : ''
                      }`}
                      onTouchStart={(e) => handleTouchStart(e, emp.id)}
                      onTouchMove={(e) => handleTouchMove(e, emp.id)}
                      onTouchEnd={handleTouchEnd}
                    >
                      <TableCell className="text-emerald-400 font-mono text-sm" dir="ltr">
                        {emp.code || '—'}
                      </TableCell>
                      <TableCell className="text-white font-medium">{emp.name}</TableCell>
                      <TableCell className="text-slate-300 hidden sm:table-cell">{emp.department || '—'}</TableCell>
                      <TableCell className="text-slate-300 hidden md:table-cell">{emp.position || '—'}</TableCell>
                      <TableCell className="text-slate-300 hidden lg:table-cell" dir="ltr">
                        {emp.shiftStart && emp.shiftEnd ? `${emp.shiftStart} - ${emp.shiftEnd}` : '—'}
                      </TableCell>
                      <TableCell className="text-slate-300 hidden lg:table-cell" dir="ltr">
                        {emp.mobile || '—'}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(emp)}
                              className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            {/* Desktop delete button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingId(emp.id)}
                              className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 hidden sm:flex"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                      {/* Swipe delete indicator (mobile) */}
                      <AnimatePresence>
                        {swipeId === emp.id && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: 80 }}
                            exit={{ width: 0 }}
                            className="absolute left-0 top-0 h-full bg-red-500 flex items-center justify-center sm:hidden"
                            style={{ position: 'absolute' }}
                          >
                            <Trash2 className="size-5 text-white" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Add Dialog */}
      {renderFormDialog('إضافة موظف جديد', isAddOpen, setIsAddOpen)}

      {/* Edit Dialog */}
      {renderFormDialog(
        `تعديل بيانات ${editingEmployee?.name}`,
        !!editingEmployee,
        (v) => {
          if (!v) setEditingEmployee(null);
        }
      )}

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deletingId || !!swipeId} onOpenChange={() => { setDeletingId(null); setSwipeId(null); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">
              هل أنت متأكد من حذف هذا الموظف؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeletingId(null); setSwipeId(null); }}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = deletingId || swipeId;
                if (id) handleDelete(id);
                setDeletingId(null);
              }}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
