'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Shield,
  UserPlus,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { APP_PAGES, getActionLabel, type PermissionsMap, type PagePermission, type PermissionLevel, type ActionKey } from '@/config/permissions';
import ActivityMonitor from './ActivityMonitor';

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: PermissionsMap;
  isSuspended?: boolean;
  suspendedAt?: string;
  createdAt: string;
}

// Pages to exclude from permissions editing (system pages)
const EXCLUDED_PAGES = ['home', 'dashboard', 'firebase'];

export default function DashboardPage() {
  const { isAdmin } = usePermissions('dashboard');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'user',
  });
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [permUser, setPermUser] = useState<UserRecord | null>(null);
  const [tempPermissions, setTempPermissions] = useState<PermissionsMap>({});
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/dashboard/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!addForm.email || !addForm.password) return;
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        await fetchUsers();
        setIsAddOpen(false);
        setAddForm({ email: '', name: '', password: '', role: 'user' });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/dashboard/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    }
  };

  const toggleSuspend = async (user: UserRecord) => {
    try {
      const res = await fetch(`/api/dashboard/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: !user.isSuspended }),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } catch {
      // Error handled silently
    }
  };

  const openPermissions = (user: UserRecord) => {
    setPermUserId(user.id);
    setPermUser(user);
    setTempPermissions({ ...user.permissions });
    setExpandedPage(null);
  };

  // Get permission level for display
  const getPermLevel = (pid: string): PermissionLevel => {
    const perm = tempPermissions[pid];
    if (!perm) return 'none';
    if (typeof perm === 'string') return perm as PermissionLevel;
    return (perm as PagePermission).level || 'none';
  };

  // Get action state for a page
  const getActionState = (pid: string, action: ActionKey): boolean => {
    const perm = tempPermissions[pid];
    if (!perm) return false;
    if (typeof perm === 'string') return perm === 'edit';
    return (perm as PagePermission).actions?.[action] === true;
  };

  // Set permission level
  const setPermLevel = (pid: string, level: PermissionLevel) => {
    setTempPermissions((prev) => {
      const existing = prev[pid];
      if (typeof existing === 'string' || !existing) {
        // Simple format or new
        if (level === 'edit') {
          const page = APP_PAGES.find(p => p.id === pid);
          const actions: Record<string, boolean> = {};
          page?.availableActions.forEach(a => { actions[a] = true; });
          return { ...prev, [pid]: { level: 'edit', actions } };
        }
        return { ...prev, [pid]: level };
      } else {
        // PagePermission format
        return { ...prev, [pid]: { ...existing, level } };
      }
    });
  };

  // Toggle a specific action
  const toggleAction = (pid: string, action: ActionKey) => {
    setTempPermissions((prev) => {
      const existing = prev[pid];
      let perm: PagePermission;
      if (typeof existing === 'string' || !existing) {
        perm = { level: 'edit', actions: {} };
      } else {
        perm = { ...existing, actions: { ...existing.actions } };
      }
      perm.level = 'edit';
      if (!perm.actions) perm.actions = {};
      perm.actions[action] = !perm.actions[action];
      return { ...prev, [pid]: perm };
    });
  };

  const savePermissions = async () => {
    if (!permUserId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/users/${permUserId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: tempPermissions }),
      });
      if (res.ok) {
        await fetchUsers();
        setPermUserId(null);
        setPermUser(null);
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">مدير النظام</Badge>;
      case 'hr':
        return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">موارد بشرية</Badge>;
      case 'manager':
        return <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20">مدير</Badge>;
      case 'quality':
        return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20">جودة</Badge>;
      default:
        return <Badge variant="outline">موظف</Badge>;
    }
  };

  // Filtered pages for permissions editing (exclude system pages)
  const permissionPages = APP_PAGES.filter(p => !EXCLUDED_PAGES.includes(p.id));

  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <Shield className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400">صلاحية غير كافية</h2>
        <p className="text-slate-500 mt-2">هذه الصفحة متاحة لمسؤولي النظام فقط</p>
      </div>
    );
  }

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
            <Settings className="size-6 text-blue-400" />
            لوحة التحكم
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            إدارة المستخدمين والصلاحيات
          </p>
        </div>
        <Button
          onClick={() => setIsAddOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <UserPlus className="size-4" />
          إنشاء مستخدم
        </Button>
      </motion.div>

      {/* Users Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Settings className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا يوجد مستخدمون</p>
            <p className="text-slate-500 text-sm mt-1">أنشئ مستخدمين جدداً</p>
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
                  <TableHead className="text-slate-400 text-sm font-medium">الاسم</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden sm:table-cell">البريد</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الدور</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الحالة</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden md:table-cell">تاريخ الإنشاء</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow
                    key={user.id}
                    className="border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <TableCell className="text-white font-medium">
                      {user.name || user.email.split('@')[0]}
                    </TableCell>
                    <TableCell className="text-slate-300 hidden sm:table-cell" dir="ltr">
                      {user.email}
                    </TableCell>
                    <TableCell>{getRoleLabel(user.role)}</TableCell>
                    <TableCell>
                      {user.isSuspended ? (
                        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">
                          موقوف
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">
                          نشط
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm hidden md:table-cell" dir="ltr">
                      {new Date(user.createdAt).toLocaleDateString('ar-EG')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openPermissions(user)}
                          className="text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                          title="تعديل الصلاحيات"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {user.role !== 'admin' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleSuspend(user)}
                              className={`${
                                user.isSuspended
                                  ? 'text-amber-400 hover:text-blue-400 hover:bg-blue-500/10'
                                  : 'text-slate-400 hover:text-amber-400 hover:bg-amber-500/10'
                              }`}
                              title={user.isSuspended ? 'تفعيل الحساب' : 'تعليق الحساب'}
                            >
                              {user.isSuspended ? (
                                <CheckCircle2 className="size-4" />
                              ) : (
                                <Ban className="size-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingId(user.id)}
                              className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                              title="حذف المستخدم"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Activity Monitor Section */}
      <ActivityMonitor />

      {/* Add User Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">إنشاء مستخدم جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل بيانات المستخدم الجديد</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">الاسم</Label>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="الاسم الكامل"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">البريد الإلكتروني</Label>
              <Input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="user@company.com"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">كلمة المرور</Label>
              <Input
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm((p) => ({ ...p, password: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="كلمة المرور"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">الدور</Label>
              <Select
                value={addForm.role}
                onValueChange={(v) => setAddForm((p) => ({ ...p, role: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user" className="text-white">موظف</SelectItem>
                  <SelectItem value="quality" className="text-white">جودة</SelectItem>
                  <SelectItem value="hr" className="text-white">موارد بشرية</SelectItem>
                  <SelectItem value="manager" className="text-white">مدير</SelectItem>
                  <SelectItem value="admin" className="text-white">مدير النظام</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={saving || !addForm.email || !addForm.password}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? 'جاري الإنشاء...' : 'إنشاء'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!permUserId} onOpenChange={() => setPermUserId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              صلاحيات: {permUser?.name || permUser?.email}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              تعديل صلاحيات الوصول لكل صفحة
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 pr-4 pb-2">
              {permissionPages.map((page) => {
                const level = getPermLevel(page.id);
                const isExpanded = expandedPage === page.id;
                const hasActions = page.availableActions.length > 0;

                return (
                  <div
                    key={page.id}
                    className="rounded-lg bg-slate-800/50 border border-slate-700/50 overflow-hidden"
                  >
                    {/* Page row */}
                    <div className="flex items-center justify-between p-3">
                      <span className="text-white text-sm font-medium">{page.title}</span>
                      <div className="flex items-center gap-2">
                        <RadioGroup
                          value={level}
                          onValueChange={(v) => setPermLevel(page.id, v as PermissionLevel)}
                          className="flex gap-2"
                          dir="rtl"
                        >
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="none" id={`none-${page.id}`} className="border-slate-600" />
                            <Label htmlFor={`none-${page.id}`} className="text-slate-400 text-xs cursor-pointer whitespace-nowrap">
                              مخفي
                            </Label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="read" id={`read-${page.id}`} className="border-slate-600" />
                            <Label htmlFor={`read-${page.id}`} className="text-slate-400 text-xs cursor-pointer whitespace-nowrap">
                              قراءة
                            </Label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="edit" id={`edit-${page.id}`} className="border-slate-600" />
                            <Label htmlFor={`edit-${page.id}`} className="text-slate-400 text-xs cursor-pointer whitespace-nowrap">
                              تعديل
                            </Label>
                          </div>
                        </RadioGroup>
                        {hasActions && level === 'edit' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 text-slate-400 hover:text-white"
                            onClick={() => setExpandedPage(isExpanded ? null : page.id)}
                          >
                            {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expanded actions */}
                    {hasActions && level === 'edit' && isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-slate-700/50 p-3 bg-slate-800/30"
                      >
                        <p className="text-slate-500 text-xs mb-2">تحديد الإجراءات المتاحة:</p>
                        <div className="flex flex-wrap gap-3">
                          {page.availableActions.map((action) => (
                            <div key={action} className="flex items-center gap-1.5">
                              <Checkbox
                                id={`action-${page.id}-${action}`}
                                checked={getActionState(page.id, action)}
                                onCheckedChange={() => toggleAction(page.id, action)}
                                className="border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                              />
                              <Label
                                htmlFor={`action-${page.id}-${action}`}
                                className="text-slate-300 text-xs cursor-pointer"
                              >
                                {getActionLabel(action)}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPermUserId(null)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={savePermissions}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">
              هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingId) handleDelete(deletingId);
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
