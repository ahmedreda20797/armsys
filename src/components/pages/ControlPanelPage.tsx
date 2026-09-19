'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { shouldPollNow, shouldRefreshOnForeground } from '@/lib/polling-policy';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  Users,
  Lock,
  ClipboardList,
  MonitorSmartphone,
  Search,
  Filter,
  Copy,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Eye,
  KeyRound,
  LogIn,
  LogOut,
  PlusCircle,
  Edit3,
  Trash,
  Download,
  Printer,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Globe,
  RefreshCw,
  MoreHorizontal,
  Copy as CopyIcon,
  AlertTriangle,
  XCircle,
  Activity,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEmployees } from '@/hooks/use-queries';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { APP_PAGES, type PermissionsMap } from '@/config/permissions';
import { PermissionManagerConsole } from '@/components/permissions/PermissionManagerConsole';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { authFetch } from '@/lib/api-fetch';

// ══════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: PermissionsMap;
  isSuspended?: boolean;
  suspendedAt?: string;
  department?: string;
  lastActivity?: string;
  createdAt: string;
  // Milestone 10: position template + optional employee linkage
  positionId?: string | null;
  positionTitle?: string | null;
  positionPermissions?: Record<string, unknown> | null;
  linkedEmployeeId?: string | null;
  // Permission Manager console: override indicator + employee code
  hasOverrides?: boolean;
  linkedEmployeeCode?: string | null;
  // §USER-PROFILE — operational identity
  photoURL?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  responsibilities?: string | null;
  linkedEmployeeName?: string | null;
  team?: string | null;
  employeePosition?: string | null;
}

interface ActivityLogItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  page: string;
  details: string;
  createdAt?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
  beforeValue?: string | null;
  afterValue?: string | null;
  ipAddress?: string;
  browser?: string;
  device?: string;
}

interface SessionUser {
  userId: string;
  userName: string;
  userEmail: string;
  lastActivity: string;
  currentPage: string;
  lastAction: string;
  ipAddress: string;
  browser: string;
  device: string;
  status: 'active' | 'idle' | 'away';
  durationLabel: string;
}

// §6 — the grouped page registry + scope vocabulary + per-facet
// editing live inside the Permission Manager console
// (src/components/permissions) now.

const ROLE_OPTIONS = [
  { value: 'admin', label: 'مدير النظام', color: 'bg-red-500/15 text-red-400 border-red-500/20' },
  { value: 'hr', label: 'موارد بشرية', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  { value: 'manager', label: 'مدير', color: 'bg-brand-500/15 text-brand-400 border-brand-500/20' },
  { value: 'quality', label: 'جودة', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' },
  { value: 'user', label: 'موظف', color: 'bg-slate-500/15 text-slate-400 border-slate-500/20' },
];

// ══════════════════════════════════════════════════════════════
//  Action color helpers
// ══════════════════════════════════════════════════════════════

const ACTION_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  create:      { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: PlusCircle },
  view:        { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: Eye },
  update:      { bg: 'bg-amber-500/10', text: 'text-amber-400', icon: Edit3 },
  delete:      { bg: 'bg-red-500/10', text: 'text-red-400', icon: Trash },
  export:      { bg: 'bg-sky-500/10', text: 'text-sky-400', icon: Download },
  print:       { bg: 'bg-sky-500/10', text: 'text-sky-400', icon: Printer },
  approve:     { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: ThumbsUp },
  reject:      { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: ThumbsDown },
  login:       { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: LogIn },
  logout:      { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: LogOut },
  permission:  { bg: 'bg-brand-500/10', text: 'text-brand-400', icon: Shield },
};

function getActionColor(action: string) {
  return ACTION_COLORS[action] || { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: Activity };
}

function getActionArLabel(action: string): string {
  const labels: Record<string, string> = {
    create: 'إنشاء', view: 'عرض', update: 'تعديل', delete: 'حذف',
    export: 'تصدير', print: 'طباعة', approve: 'موافقة', reject: 'رفض',
    login: 'تسجيل دخول', logout: 'تسجيل خروج', permission: 'تغيير صلاحيات',
    upload: 'رفع', override: 'تجاوز',
  };
  return labels[action] || action;
}

function getRoleBadge(role: string) {
  const r = ROLE_OPTIONS.find(o => o.value === role) || ROLE_OPTIONS[4];
  return <Badge className={`${r.color} border`}>{r.label}</Badge>;
}

// ══════════════════════════════════════════════════════════════
//  Main Component
// ══════════════════════════════════════════════════════════════

export default function ControlPanelPage() {
  const { isAdmin } = usePermissions('controlPanel');
  const { user: currentUser } = useAuth();

  // ═══ TAB 1: Users state ═══
  const [users, setUsers] = useState<UserRecord[]>([]);
  const { data: employeesList } = useEmployees(); // §USER-PROFILE — employee picker
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');

  // ═══ TAB 2: Permissions state — the console owns profile loading,
  //     editing and saving; this page only holds the deep-navigation
  //     target (the selected user id from the Users tab). ═══
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('users');

  // ═══ TAB 3: Activity Logs state ═══
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logSearch, setLogSearch] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('all');
  const [logModuleFilter, setLogModuleFilter] = useState('all');

  // ═══ TAB 4: Sessions state ═══
  const [sessions, setSessions] = useState<SessionUser[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // ═══ Shared state ═══
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isResetPwdOpen, setIsResetPwdOpen] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [addForm, setAddForm] = useState({
    email: '', name: '', password: '', role: 'user',
    jobTitle: '', mobile: '', linkedEmployeeId: '', responsibilities: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', department: '', jobTitle: '', mobile: '', linkedEmployeeId: '', responsibilities: '' });
  const [resetPwdTarget, setResetPwdTarget] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [cloneForm, setCloneForm] = useState({ email: '', name: '', password: '', role: 'user' });

  // ═══ Data Fetching ═══
  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch('/api/dashboard/users');
      if (res.ok) {
        const data = await res.json();
        // Filter out null entries and ensure all users have a role
        setUsers((Array.isArray(data) ? data : []).filter((u: any) => u && u.id));
      }
    } catch { setUsers([]); }
    finally { setUsersLoading(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (logActionFilter !== 'all') params.set('action', logActionFilter);
      if (logModuleFilter !== 'all') params.set('module', logModuleFilter);
      if (logSearch) params.set('keyword', logSearch);
      const res = await authFetch(`/api/activity-logs?${params}`);
      if (res.ok) setLogs(await res.json());
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  }, [logActionFilter, logModuleFilter, logSearch]);

  // §DOWNLOAD-OPT — online-sessions polling. Previously a bare 15s
  // setInterval that kept re-downloading the activity-logs table even
  // while the tab was hidden. Now: same 15s cadence, gated by the
  // shared polling policy (hidden tabs never poll; returning to the
  // foreground refreshes once when stale) and an in-flight guard so
  // interval + visibility + manual refresh can never overlap.
  const sessionsInFlightRef = useRef(false);
  const lastSessionsFetchRef = useRef<number>(0);

  const fetchSessions = useCallback(async () => {
    if (sessionsInFlightRef.current) return;
    sessionsInFlightRef.current = true;
    try {
      const res = await authFetch('/api/activity-logs/online?minutes=5');
      if (res.ok) setSessions(await res.json());
    } catch { setSessions([]); }
    finally {
      sessionsInFlightRef.current = false;
      lastSessionsFetchRef.current = Date.now();
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Async boundary: state updates happen after the first await, never
    // synchronously within the effect body.
    void (async () => { await fetchUsers(); })();
  }, [fetchUsers]);
  useEffect(() => {
    void (async () => { await fetchLogs(); })();
  }, [fetchLogs]);
  useEffect(() => {
    void (async () => { await fetchSessions(); })();
    const iv = setInterval(() => {
      if (
        shouldPollNow({
          isVisible: typeof document === 'undefined' || !document.hidden,
          lastPollAt: lastSessionsFetchRef.current || null,
          now: Date.now(),
          intervalMs: 15000,
        })
      ) {
        void fetchSessions();
      }
    }, 15000);
    const onVisibilityChange = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      if (
        shouldRefreshOnForeground({
          lastFetchAt: lastSessionsFetchRef.current || null,
          now: Date.now(),
          staleThresholdMs: 30000,
        })
      ) {
        void fetchSessions();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchSessions]);

  // ═══ Filtered data ═══
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
      if (userStatusFilter === 'active' && u.isSuspended) return false;
      if (userStatusFilter === 'suspended' && !u.isSuspended) return false;
      if (userSearch) {
        const q = userSearch.toLowerCase();
        return (u.name || '').toLowerCase().includes(q) ||
               (u.email || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [users, userSearch, userRoleFilter, userStatusFilter]);

  const filteredLogs = useMemo(() => logs, [logs]);

  // ═══ Unique modules & actions for filters ═══
  const uniqueActions = useMemo(() => {
    const s = new Set(logs.map(l => l.action));
    return Array.from(s).sort();
  }, [logs]);

  const uniqueModules = useMemo(() => {
    const s = new Set(logs.map(l => l.page).filter(Boolean));
    return Array.from(s).sort();
  }, [logs]);

  // ═══ Permission helpers ═══
  // §6 — the per-page/per-section/per-action editing logic (levels,
  // tri-state overrides, data scope) now lives INSIDE the Permission
  // Manager console; this page keeps only the deep-navigation target
  // (the selected user) and hands the user list to the console.

  // ═══ Handlers ═══
  const handleAddUser = async () => {
    if (!addForm.email || !addForm.password) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await authFetch('/api/dashboard/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addForm,
          linkedEmployeeId: addForm.linkedEmployeeId || null,
        }),
      });
      if (res.ok) {
        await fetchUsers();
        setIsAddOpen(false);
        setAddForm({ email: '', name: '', password: '', role: 'user', jobTitle: '', mobile: '', linkedEmployeeId: '', responsibilities: '' });
      } else {
        // §9 — the API returns a MEANINGFUL Arabic message + field;
        // surface it in the dialog (and a toast) instead of a silent 400.
        const data = await res.json().catch(() => null);
        const message = data?.error || 'تعذر إنشاء المستخدم — تأكد من البيانات المدخلة';
        setFormError(message);
        toast.error(message);
      }
    } catch {
      const message = 'تعذر الاتصال بالخادم';
      setFormError(message);
      toast.error(message);
    } finally { setSaving(false); }
  };

  // §USER-PHOTO — admin uploads a profile photo for an existing user.
  const handlePhotoUpload = async (file: File) => {
    if (!selectedUser) return;
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch(`/api/dashboard/users/${selectedUser.id}/photo`, { method: 'POST', body: fd });
      if (res.ok) { await fetchUsers(); toast.success('تم تحديث صورة المستخدم'); }
      else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'تعذر رفع الصورة');
      }
    } catch {
      toast.error('تعذر رفع الصورة');
    } finally { setPhotoUploading(false); }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await authFetch(`/api/dashboard/users/${selectedUser.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          linkedEmployeeId: editForm.linkedEmployeeId || null,
        }),
      });
      if (res.ok) { await fetchUsers(); setIsEditOpen(false); setSelectedUser(null); }
      else {
        const data = await res.json().catch(() => null);
        const message = data?.error || 'تعذر تحديث المستخدم';
        setFormError(message);
        toast.error(message);
      }
    } catch {
      const message = 'تعذر الاتصال بالخادم';
      setFormError(message);
      toast.error(message);
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/dashboard/users/${selectedUser.id}`, { method: 'DELETE' });
      if (res.ok) { await fetchUsers(); setIsDeleteOpen(false); setSelectedUser(null); }
    } catch {} finally { setDeleting(false); }
  };

  const handleToggleSuspend = async (u: UserRecord) => {
    try {
      const res = await authFetch(`/api/dashboard/users/${u.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: !u.isSuspended }),
      });
      if (res.ok) await fetchUsers();
    } catch {}
  };

  const handleResetPassword = async () => {
    if (!resetPwdTarget || !newPassword) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/dashboard/users/${resetPwdTarget.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) { setIsResetPwdOpen(false); setResetPwdTarget(null); setNewPassword(''); }
    } catch {} finally { setSaving(false); }
  };

  const handleCloneUser = async () => {
    if (!selectedUser || !cloneForm.email || !cloneForm.password) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await authFetch('/api/dashboard/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // §CLONE — send the permission MAP as an object; the API accepts
        // an explicit admin-provided map for clones (role presets would
        // otherwise silently replace the cloned permissions).
        body: JSON.stringify({ ...cloneForm, permissions: selectedUser.permissions }),
      });
      if (res.ok) { await fetchUsers(); setIsCloneOpen(false); setSelectedUser(null); setCloneForm({ email: '', name: '', password: '', role: 'user' }); }
      else {
        const data = await res.json().catch(() => null);
        const message = data?.error || 'تعذر استنساخ المستخدم';
        setFormError(message);
        toast.error(message);
      }
    } catch {
      toast.error('تعذر الاتصال بالخادم');
    } finally { setSaving(false); }
  };

  // Deep navigation from the Users tab: lands on the console with the
  // target user loaded; the console loads, edits and saves the
  // override tier itself (audited server-side).
  const openPermissions = (user: UserRecord) => {
    setPermUserId(user.id);
    setActiveTab('permissions');
  };

  const openEdit = (u: UserRecord) => {
    setSelectedUser(u);
    setFormError(null);
    setEditForm({
      name: u.name || '', email: u.email, role: u.role, department: u.department || '',
      jobTitle: u.jobTitle || '', mobile: u.mobile || '',
      linkedEmployeeId: u.linkedEmployeeId || '', responsibilities: u.responsibilities || '',
    });
    setIsEditOpen(true);
  };

  const openClone = (u: UserRecord) => {
    setSelectedUser(u);
    setCloneForm({ email: '', name: u.name || '', password: '', role: u.role });
    setIsCloneOpen(true);
  };

  const isOwnerProtected = (u: UserRecord | null) => !!u && u.role === 'admin' && u.id === currentUser?.id;

  // ═══ Permission guard ═══
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400">صلاحية غير كافية</h2>
        <p className="text-slate-500 mt-2">هذه الصفحة متاحة لمسؤولي النظام فقط</p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-6">
      {/* ═══ HEADER (§7 — unified page identity) ═══ */}
      <PageIdentity
        pageId="controlPanel"
        icon={<Settings className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        title="مركز التحكم والإدارة"
        description="إدارة المستخدمين والصلاحيات والمراقبة والتدقيق"
        actions={
          <Button onClick={() => setIsAddOpen(true)}
            className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all">
            <UserPlus className="size-4 ml-1" />
            إنشاء مستخدم
          </Button>
        }
      />

      {/* ═══ STATS BAR ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المستخدمين', value: users.length, icon: Users, color: 'from-brand-500/20 to-brand-500/20 text-brand-400' },
          { label: 'مستخدمين نشطين', value: users.filter(u => !u.isSuspended).length, icon: CheckCircle2, color: 'from-emerald-500/20 to-cyan-500/20 text-emerald-400' },
          { label: 'جلسات نشطة', value: sessions.length, icon: Wifi, color: 'from-amber-500/20 to-orange-500/20 text-amber-400' },
          { label: 'سجل الأنشطة', value: logs.length, icon: ClipboardList, color: 'from-blue-500/20 to-sky-500/20 text-blue-400' },
        ].map((stat, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="border-slate-700/30 bg-slate-800/40 backdrop-blur-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2.5 rounded-xl bg-linear-to-br ${stat.color}`}>
                  <stat.icon className="size-5" />
                </div>
                <div>
                  <p className="text-slate-400 text-xs">{stat.label}</p>
                  <p className="text-white text-xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ═══ MAIN TABS ═══ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-slate-800/60 border border-slate-700/40 p-1 h-auto">
          <TabsTrigger value="users" className="data-[state=active]:bg-brand-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <Users className="size-4" /> المستخدمين
          </TabsTrigger>
          <TabsTrigger value="permissions" className="data-[state=active]:bg-brand-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <Lock className="size-4" /> الصلاحيات
          </TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-brand-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <ClipboardList className="size-4" /> سجل الأنشطة
          </TabsTrigger>
          <TabsTrigger value="sessions" className="data-[state=active]:bg-brand-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <MonitorSmartphone className="size-4" /> الجلسات النشطة
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════
            TAB 1: USERS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="users" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input placeholder="بحث بالاسم أو البريد..." value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="bg-slate-800/60 border-slate-700/50 text-white pr-10 h-10" />
            </div>
            <Select value={userRoleFilter} onValueChange={setUserRoleFilter}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700/50 text-white w-40 h-10">
                <Filter className="size-4 ml-1 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={userStatusFilter} onValueChange={setUserStatusFilter}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700/50 text-white w-40 h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="suspended">موقوف</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <Card className="border-slate-700/30 bg-slate-800/30 backdrop-blur-sm overflow-hidden">
            {usersLoading ? (
              <div className="p-6 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-lg bg-slate-800/60" />)}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Users className="size-12 text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">لا يوجد مستخدمون</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700/40 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-xs font-semibold">المستخدم</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden lg:table-cell">البريد</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold">الدور</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold">الحالة</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden xl:table-cell">آخر نشاط</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden xl:table-cell">تاريخ الإنشاء</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold text-left">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => (
                      <TableRow key={u.id} className="border-slate-700/20 hover:bg-slate-700/20 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-full bg-linear-to-br from-brand-500/30 to-brand-500/30 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {(u.name || u.email)[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="text-white text-sm font-medium">{u.name || u.email.split('@')[0]}</p>
                              {isOwnerProtected(u) && <span className="text-[10px] text-brand-400">مالك النظام</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs hidden lg:table-cell" dir="ltr">{u.email}</TableCell>
                        <TableCell>{getRoleBadge(u.role)}</TableCell>
                        <TableCell>
                          {u.isSuspended ? (
                            <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">موقوف</Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">نشط</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs hidden xl:table-cell">
                          {u.lastActivity ? new Date(u.lastActivity).toLocaleDateString('ar-EG') : '—'}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs hidden xl:table-cell" dir="ltr">
                          {new Date(u.createdAt).toLocaleDateString('ar-EG')}
                        </TableCell>
                        <TableCell>
                          {/* §2 — SmartActionMenu: all user-row actions as an
                              icon fan with tooltips; System Owner rows carry
                              no destructive/delete action (owner-protected). */}
                          <SmartActionMenu
                            label={`إجراءات المستخدم ${u.name || u.email}`}
                            actions={[
                              { key: 'permissions', label: 'الصلاحيات', icon: <Lock className="size-3.5" />, onSelect: () => openPermissions(u) },
                              { key: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(u) },
                              { key: 'clone', label: 'نسخ المستخدم', icon: <CopyIcon className="size-3.5" />, onSelect: () => openClone(u) },
                              { key: 'password', label: 'إعادة كلمة المرور', icon: <KeyRound className="size-3.5" />, onSelect: () => { setResetPwdTarget(u); setIsResetPwdOpen(true); setNewPassword(''); } },
                              { key: 'suspend', label: u.isSuspended ? 'تفعيل الحساب' : 'تعليق الحساب', icon: u.isSuspended ? <CheckCircle2 className="size-3.5" /> : <Ban className="size-3.5" />, onSelect: () => handleToggleSuspend(u) },
                              { key: 'delete', label: 'حذف المستخدم', icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => { setSelectedUser(u); setIsDeleteOpen(true); }, hidden: isOwnerProtected(u) },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2: PERMISSIONS — the Permission Manager console.
            One component owns the user list (search + persisted
            filters + override indicators), the canonical profile
            (sources → effective → scope/section/action/field) and
            the audited override editing. Deep navigation from the
            Users tab lands on the selected user.
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="permissions" className="space-y-4">
          <PermissionManagerConsole
            users={users}
            selectedUserId={permUserId}
            onSelectUser={(u) => setPermUserId(u ? u.id : null)}
            onSaved={fetchUsers}
          />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3: ACTIVITY LOGS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="logs" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input placeholder="بحث في السجل..." value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                className="bg-slate-800/60 border-slate-700/50 text-white pr-10 h-10" />
            </div>
            <Select value={logActionFilter} onValueChange={setLogActionFilter}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700/50 text-white w-36 h-10">
                <SelectValue placeholder="الإجراء" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الإجراءات</SelectItem>
                {uniqueActions.map(a => (
                  <SelectItem key={a} value={a}>{getActionArLabel(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={logModuleFilter} onValueChange={setLogModuleFilter}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700/50 text-white w-36 h-10">
                <SelectValue placeholder="القسم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                {uniqueModules.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-400 h-10 gap-1.5"
              onClick={() => { fetchLogs(); }}>
              <RefreshCw className="size-3.5" /> تحديث
            </Button>
          </div>

          {/* Logs Table */}
          <Card className="border-slate-700/30 bg-slate-800/30 backdrop-blur-sm overflow-hidden">
            {logsLoading ? (
              <div className="p-6 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-lg bg-slate-800/60" />)}</div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <ClipboardList className="size-12 text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">لا توجد سجلات</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700/40 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-xs font-semibold">المستخدم</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold">الإجراء</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden md:table-cell">التفاصيل</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden lg:table-cell">قبل/بعد</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden xl:table-cell">IP</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold">التاريخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 100).map(log => {
                      const ac = getActionColor(log.action);
                      const Icon = ac.icon;
                      const ts = log.createdAt || log.timestamp || '';
                      return (
                        <TableRow key={log.id} className="border-slate-700/20 hover:bg-slate-700/20 transition-colors">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="size-7 rounded-full bg-slate-700/50 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                {(log.userName || '?')[0]}
                              </div>
                              <div>
                                <p className="text-white text-xs font-medium">{log.userName}</p>
                                <p className="text-slate-500 text-[10px]" dir="ltr">{log.userEmail}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${ac.bg} ${ac.text} border-0 text-[10px] gap-1 px-2 py-0.5`}>
                              <Icon className="size-3" /> {getActionArLabel(log.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-300 text-xs hidden md:table-cell max-w-xs truncate">
                            {log.details}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {(log.beforeValue || log.afterValue) ? (
                              <div className="flex items-center gap-2 text-[10px]">
                                {log.beforeValue && (
                                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border text-[9px] max-w-[100px] truncate" title={log.beforeValue}>
                                    {log.beforeValue}
                                  </Badge>
                                )}
                                {log.beforeValue && log.afterValue && <span className="text-slate-600">→</span>}
                                {log.afterValue && (
                                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border text-[9px] max-w-[100px] truncate" title={log.afterValue}>
                                    {log.afterValue}
                                  </Badge>
                                )}
                              </div>
                            ) : <span className="text-slate-600 text-[10px]">—</span>}
                          </TableCell>
                          <TableCell className="text-slate-500 text-[10px] hidden xl:table-cell" dir="ltr">
                            {log.ipAddress || '—'}
                          </TableCell>
                          <TableCell className="text-slate-500 text-[10px]" dir="ltr">
                            {ts ? new Date(ts).toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 4: ACTIVE SESSIONS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="sessions" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs gap-1">
                <Wifi className="size-3" /> {sessions.filter(s => s.status === 'active').length} نشط
              </Badge>
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs gap-1">
                <Clock className="size-3" /> {sessions.filter(s => s.status === 'idle').length} خامل
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-400 h-9 gap-1.5"
              onClick={fetchSessions}>
              <RefreshCw className="size-3.5" /> تحديث
            </Button>
          </div>

          <Card className="border-slate-700/30 bg-slate-800/30 backdrop-blur-sm overflow-hidden">
            {sessionsLoading ? (
              <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-lg bg-slate-800/60" />)}</div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <MonitorSmartphone className="size-12 text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">لا توجد جلسات نشطة</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700/40 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-xs font-semibold">المستخدم</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold">الحالة</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden md:table-cell">الصفحة الحالية</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden lg:table-cell">آخر نشاط</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden xl:table-cell">المتصفح</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold hidden xl:table-cell">IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map(s => (
                      <TableRow key={s.userId} className="border-slate-700/20 hover:bg-slate-700/20 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`size-2 rounded-full ${
                              s.status === 'active' ? 'bg-emerald-400 animate-pulse' :
                              s.status === 'idle' ? 'bg-amber-400' : 'bg-slate-500'
                            }`} />
                            <div>
                              <p className="text-white text-xs font-medium">{s.userName}</p>
                              <p className="text-slate-500 text-[10px]" dir="ltr">{s.userEmail}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] border ${
                            s.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            s.status === 'idle' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-slate-500/10 text-slate-400 border-slate-500/20'
                          }`}>
                            {s.status === 'active' ? 'نشط' : s.status === 'idle' ? 'خامل' : 'بعيد'}
                          </Badge>
                          <p className="text-slate-500 text-[9px] mt-0.5">{s.durationLabel}</p>
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs hidden md:table-cell">
                          {s.currentPage || '—'}
                        </TableCell>
                        <TableCell className="text-slate-500 text-[10px] hidden lg:table-cell" dir="ltr">
                          {s.lastActivity ? new Date(s.lastActivity).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </TableCell>
                        <TableCell className="text-slate-500 text-[10px] hidden xl:table-cell">
                          {s.browser || '—'}
                        </TableCell>
                        <TableCell className="text-slate-500 text-[10px] hidden xl:table-cell" dir="ltr">
                          {s.ipAddress || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════
          DIALOGS
      ═══════════════════════════════════════════════════════ */}

      {/* Add User Dialog — §USER-PROFILE: full operational identity +
          explicit link to an EXISTING employee record. */}
      <Dialog open={isAddOpen} onOpenChange={(o) => { setIsAddOpen(o); if (o) setFormError(null); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><UserPlus className="size-5 text-brand-400" /> إنشاء مستخدم جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل بيانات المستخدم الجديد — يمكن ربطه بسجل موظف قائم</DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
              {formError}
            </div>
          )}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الاسم</Label>
                <Input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" placeholder="الاسم الكامل" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">البريد الإلكتروني</Label>
                <Input type="email" value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" placeholder="user@company.com" dir="ltr" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">كلمة المرور</Label>
                <Input type="password" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" placeholder="8 أحرف على الأقل" dir="ltr" required />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الدور</Label>
                <Select value={addForm.role} onValueChange={v => setAddForm(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value} className="text-white">{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">المسمى الوظيفي</Label>
                <Input value={addForm.jobTitle} onChange={e => setAddForm(p => ({ ...p, jobTitle: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" placeholder="مثال: مشرف جودة" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الهاتف</Label>
                <Input value={addForm.mobile} onChange={e => setAddForm(p => ({ ...p, mobile: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" placeholder="اختياري" dir="ltr" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">ربط بسجل موظف قائم</Label>
              <Select value={addForm.linkedEmployeeId || '__none__'} onValueChange={v => setAddForm(p => ({ ...p, linkedEmployeeId: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-10"><SelectValue placeholder="بدون ربط" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-white">بدون ربط</SelectItem>
                  {((employeesList ?? []) as Array<{ id: string; name: string; code?: string | null; department?: string | null }>).map(emp => (
                    <SelectItem key={emp.id} value={emp.id} className="text-white">
                      {emp.name}{emp.code ? ` — ${emp.code}` : ''}{emp.department ? ` (${emp.department})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-slate-500 text-[10px]">القسم والفريق يتم الحصول عليهما تلقائياً من موضع الموظف في الهيكل التنظيمي</p>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">المسؤوليات</Label>
              <Input value={addForm.responsibilities} onChange={e => setAddForm(p => ({ ...p, responsibilities: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" placeholder="اختياري" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button onClick={handleAddUser} disabled={saving || !addForm.email || !addForm.password}
              className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5">
              {saving ? 'جاري الإنشاء...' : 'إنشاء'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog — §USER-PROFILE: identity, photo, employee link */}
      <Dialog open={isEditOpen} onOpenChange={(o) => { setIsEditOpen(o); if (o) setFormError(null); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><Pencil className="size-5 text-amber-400" /> تعديل المستخدم</DialogTitle>
            <DialogDescription className="text-slate-400">تعديل بيانات المستخدم وصورته وربطه بسجل موظف</DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
              {formError}
            </div>
          )}
          <div className="grid gap-4">
            {/* §USER-PHOTO — avatar + upload for the selected user */}
            {selectedUser && (
              <div className="flex items-center gap-4">
                <UserAvatar name={selectedUser.name} src={selectedUser.photoURL} className="size-16 text-lg" />
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-xs block">صورة المستخدم</Label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={photoUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handlePhotoUpload(file);
                        e.target.value = '';
                      }}
                    />
                    {photoUploading ? 'جاري الرفع...' : 'رفع صورة'}
                  </label>
                  <p className="text-slate-500 text-[10px]">تُقص إلى مربع 256×256 تلقائياً</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الاسم</Label>
                <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">البريد الإلكتروني</Label>
                <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" dir="ltr" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">المسمى الوظيفي</Label>
                <Input value={editForm.jobTitle} onChange={e => setEditForm(p => ({ ...p, jobTitle: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الهاتف</Label>
                <Input value={editForm.mobile} onChange={e => setEditForm(p => ({ ...p, mobile: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white h-10" dir="ltr" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">ربط بسجل موظف قائم</Label>
              <Select value={editForm.linkedEmployeeId || '__none__'} onValueChange={v => setEditForm(p => ({ ...p, linkedEmployeeId: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-10"><SelectValue placeholder="بدون ربط" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-white">بدون ربط</SelectItem>
                  {((employeesList ?? []) as Array<{ id: string; name: string; code?: string | null; department?: string | null }>).map(emp => (
                    <SelectItem key={emp.id} value={emp.id} className="text-white">
                      {emp.name}{emp.code ? ` — ${emp.code}` : ''}{emp.department ? ` (${emp.department})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedUser?.department && (
                <p className="text-slate-500 text-[10px]">
                  القسم الحالي: <span className="text-slate-400">{selectedUser.department}</span>
                  {selectedUser.team ? ` · الفريق: ${selectedUser.team}` : ''}
                  {' '}(مشتق من الهيكل التنظيمي)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">المسؤوليات</Label>
              <Input value={editForm.responsibilities} onChange={e => setEditForm(p => ({ ...p, responsibilities: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" />
            </div>
            {selectedUser && !isOwnerProtected(selectedUser) && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-xs">الدور</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value} className="text-white">{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button onClick={handleEditUser} disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white h-9 px-5">{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog — unified ConfirmDialog (§4) */}
      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        description="هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء."
        itemName={selectedUser?.name}
        loading={deleting}
        onConfirm={handleDelete}
      />

      {/* Reset Password Dialog */}
      <Dialog open={isResetPwdOpen} onOpenChange={setIsResetPwdOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><KeyRound className="size-5 text-amber-400" /> إعادة تعيين كلمة المرور</DialogTitle>
            <DialogDescription className="text-slate-400">
              المستخدم: <span className="text-white font-medium">{resetPwdTarget?.name || resetPwdTarget?.email}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">كلمة المرور الجديدة</Label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="bg-slate-800 border-slate-600 text-white h-10" placeholder="أدخل كلمة المرور الجديدة" dir="ltr" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetPwdOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button onClick={handleResetPassword} disabled={saving || !newPassword}
              className="bg-amber-600 hover:bg-amber-700 text-white h-9 px-5">{saving ? 'جاري الحفظ...' : 'تحديث'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone User Dialog */}
      <Dialog open={isCloneOpen} onOpenChange={setIsCloneOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><CopyIcon className="size-5 text-blue-400" /> نسخ المستخدم</DialogTitle>
            <DialogDescription className="text-slate-400">
              نسخ من: <span className="text-white font-medium">{selectedUser?.name || selectedUser?.email}</span> — سيتم نسخ الصلاحيات أيضاً
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">الاسم</Label>
              <Input value={cloneForm.name} onChange={e => setCloneForm(p => ({ ...p, name: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">البريد الإلكتروني</Label>
              <Input type="email" value={cloneForm.email} onChange={e => setCloneForm(p => ({ ...p, email: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" dir="ltr" required />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">كلمة المرور</Label>
              <Input type="password" value={cloneForm.password} onChange={e => setCloneForm(p => ({ ...p, password: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" dir="ltr" required />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">الدور</Label>
              <Select value={cloneForm.role} onValueChange={v => setCloneForm(p => ({ ...p, role: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value} className="text-white">{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloneOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button onClick={handleCloneUser} disabled={saving || !cloneForm.email || !cloneForm.password}
              className="bg-blue-600 hover:bg-blue-700 text-white h-9 px-5">{saving ? 'جاري النسخ...' : 'نسخ وإنشاء'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </TooltipProvider>
  );
}
