'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Zap,
  AlertTriangle,
  XCircle,
  Activity,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { APP_PAGES, getPermissionsForRole, getActionLabel, type PermissionsMap, type PagePermission, type PermissionLevel, type ActionKey } from '@/config/permissions';
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

const EXCLUDED_PAGES = ['home', 'firebase'];

const ROLE_OPTIONS = [
  { value: 'admin', label: 'مدير النظام', color: 'bg-red-500/15 text-red-400 border-red-500/20' },
  { value: 'hr', label: 'موارد بشرية', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  { value: 'manager', label: 'مدير', color: 'bg-purple-500/15 text-purple-400 border-purple-500/20' },
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
  permission:  { bg: 'bg-violet-500/10', text: 'text-violet-400', icon: Shield },
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
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');

  // ═══ TAB 2: Permissions state ═══
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [permUser, setPermUser] = useState<UserRecord | null>(null);
  const [tempPermissions, setTempPermissions] = useState<PermissionsMap>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isResetPwdOpen, setIsResetPwdOpen] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [addForm, setAddForm] = useState({ email: '', name: '', password: '', role: 'user' });
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', department: '' });
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
      const res = await fetch(`/api/activity-logs?${params}`);
      if (res.ok) setLogs(await res.json());
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  }, [logActionFilter, logModuleFilter, logSearch]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await authFetch('/api/activity-logs/online?minutes=5');
      if (res.ok) setSessions(await res.json());
    } catch { setSessions([]); }
    finally { setSessionsLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    fetchSessions();
    const iv = setInterval(fetchSessions, 15000);
    return () => clearInterval(iv);
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
  const getPermLevel = (pid: string): PermissionLevel => {
    const perm = tempPermissions[pid];
    if (!perm) return 'none';
    if (typeof perm === 'string') return perm as PermissionLevel;
    return (perm as PagePermission).level || 'none';
  };

  const getActionState = (pid: string, action: ActionKey): boolean => {
    const perm = tempPermissions[pid];
    if (!perm) return false;
    if (typeof perm === 'string') return perm === 'edit';
    return (perm as PagePermission).actions?.[action] === true;
  };

  const setPermLevel = (pid: string, level: PermissionLevel) => {
    setTempPermissions(prev => {
      const existing = prev[pid];
      if (typeof existing === 'string' || !existing) {
        if (level === 'edit') {
          const page = APP_PAGES.find(p => p.id === pid);
          const actions: Record<string, boolean> = {};
          page?.availableActions.forEach(a => { actions[a] = true; });
          return { ...prev, [pid]: { level: 'edit', actions } };
        }
        return { ...prev, [pid]: level };
      } else {
        return { ...prev, [pid]: { ...existing, level } };
      }
    });
  };

  const toggleAction = (pid: string, action: ActionKey) => {
    setTempPermissions(prev => {
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

  const toggleGroup = (gid: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid); else next.add(gid);
      return next;
    });
  };

  // ═══ Quick Permission Actions ═══
  const grantAll = () => {
    const all: PermissionsMap = {};
    APP_PAGES.forEach(p => {
      if (EXCLUDED_PAGES.includes(p.id)) return;
      const actions: Record<string, boolean> = {};
      p.availableActions.forEach(a => { actions[a] = true; });
      all[p.id] = { level: 'edit', actions };
    });
    setTempPermissions(all);
  };

  const removeAll = () => {
    const none: PermissionsMap = {};
    APP_PAGES.forEach(p => { none[p.id] = 'none'; });
    setTempPermissions(none);
  };

  const resetToRole = () => {
    if (!permUser) return;
    setTempPermissions(getPermissionsForRole(permUser.role));
  };

  const grantAllForGroup = (gid: string) => {
    setTempPermissions(prev => {
      const next = { ...prev };
      APP_PAGES.filter(p => p.groupId === gid && !EXCLUDED_PAGES.includes(p.id)).forEach(p => {
        const actions: Record<string, boolean> = {};
        p.availableActions.forEach(a => { actions[a] = true; });
        next[p.id] = { level: 'edit', actions };
      });
      return next;
    });
  };

  // ═══ Handlers ═══
  const handleAddUser = async () => {
    if (!addForm.email || !addForm.password) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/dashboard/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (res.ok) { await fetchUsers(); setIsAddOpen(false); setAddForm({ email: '', name: '', password: '', role: 'user' }); }
    } catch {} finally { setSaving(false); }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/users/${selectedUser.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) { await fetchUsers(); setIsEditOpen(false); setSelectedUser(null); }
    } catch {} finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    try {
      const res = await fetch(`/api/dashboard/users/${selectedUser.id}`, { method: 'DELETE' });
      if (res.ok) { await fetchUsers(); setIsDeleteOpen(false); setSelectedUser(null); }
    } catch {}
  };

  const handleToggleSuspend = async (u: UserRecord) => {
    try {
      const res = await fetch(`/api/dashboard/users/${u.id}`, {
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
      const res = await fetch(`/api/dashboard/users/${resetPwdTarget.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) { setIsResetPwdOpen(false); setResetPwdTarget(null); setNewPassword(''); }
    } catch {} finally { setSaving(false); }
  };

  const handleCloneUser = async () => {
    if (!selectedUser || !cloneForm.email || !cloneForm.password) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/dashboard/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cloneForm, permissions: JSON.stringify(selectedUser.permissions) }),
      });
      if (res.ok) { await fetchUsers(); setIsCloneOpen(false); setSelectedUser(null); setCloneForm({ email: '', name: '', password: '', role: 'user' }); }
    } catch {} finally { setSaving(false); }
  };

  const savePermissions = async () => {
    if (!permUserId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/users/${permUserId}/permissions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: tempPermissions }),
      });
      if (res.ok) { await fetchUsers(); setPermUserId(null); setPermUser(null); }
    } catch {} finally { setSaving(false); }
  };

  const openPermissions = (user: UserRecord) => {
    setPermUserId(user.id);
    setPermUser(user);
    setTempPermissions({ ...user.permissions });
    setExpandedGroups(new Set());
  };

  const openEdit = (u: UserRecord) => {
    setSelectedUser(u);
    setEditForm({ name: u.name || '', email: u.email, role: u.role, department: u.department || '' });
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
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <Shield className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400">صلاحية غير كافية</h2>
        <p className="text-slate-500 mt-2">هذه الصفحة متاحة لمسؤولي النظام فقط</p>
      </div>
    );
  }

  // ═══ Grouped permissions for editing ═══
  const permissionGroups = useMemo(() => {
    const groups: Record<string, typeof APP_PAGES> = {};
    APP_PAGES.filter(p => !EXCLUDED_PAGES.includes(p.id)).forEach(p => {
      if (!groups[p.groupId]) groups[p.groupId] = [];
      groups[p.groupId].push(p);
    });
    return groups;
  }, []);

  const getGroupLabel = (gid: string) => {
    const g = { daily_ops: 'العمليات اليومية', employee_mgmt: 'إدارة الموظفين', quality_ctrl: 'الجودة والرقابة', hr: 'الموارد البشرية', travel_ops: 'السفر', reports: 'التقارير', settings: 'الإعدادات' };
    return g[gid] || gid;
  };

  const getGroupEmoji = (gid: string) => {
    const g: Record<string, string> = { daily_ops: '📊', employee_mgmt: '👥', quality_ctrl: '🎯', hr: '🏢', travel_ops: '✈️', reports: '📈', settings: '⚙️' };
    return g[gid] || '📁';
  };

  // ═══════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════

  return (
    <TooltipProvider delayDuration={300}>
    <div dir="rtl" className="space-y-6">
      {/* ═══ HEADER ═══ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings className="size-6 text-violet-400" />
            مركز التحكم والإدارة
          </h1>
          <p className="text-slate-400 mt-1 text-sm">إدارة المستخدمين والصلاحيات والمراقبة والتدقيق</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}
          className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all">
          <UserPlus className="size-4 ml-1" />
          إنشاء مستخدم
        </Button>
      </motion.div>

      {/* ═══ STATS BAR ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المستخدمين', value: users.length, icon: Users, color: 'from-violet-500/20 to-indigo-500/20 text-violet-400' },
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
      <Tabs defaultValue="users" className="space-y-6">
        <TabsList className="bg-slate-800/60 border border-slate-700/40 p-1 h-auto">
          <TabsTrigger value="users" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <Users className="size-4" /> المستخدمين
          </TabsTrigger>
          <TabsTrigger value="permissions" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <Lock className="size-4" /> الصلاحيات
          </TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
            <ClipboardList className="size-4" /> سجل الأنشطة
          </TabsTrigger>
          <TabsTrigger value="sessions" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white gap-2 px-4 py-2.5 text-sm rounded-lg">
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
                            <div className="size-8 rounded-full bg-linear-to-br from-violet-500/30 to-indigo-500/30 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {(u.name || u.email)[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="text-white text-sm font-medium">{u.name || u.email.split('@')[0]}</p>
                              {isOwnerProtected(u) && <span className="text-[10px] text-violet-400">مالك النظام</span>}
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
                          <div className="flex items-center gap-1 justify-end">
                            <Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                                onClick={() => openPermissions(u)}>
                                <Lock className="size-3.5" />
                              </Button>
                            </TooltipTrigger><TooltipContent>الصلاحيات</TooltipContent></Tooltip>

                            <Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                                onClick={() => openEdit(u)}>
                                <Pencil className="size-3.5" />
                              </Button>
                            </TooltipTrigger><TooltipContent>تعديل</TooltipContent></Tooltip>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-white hover:bg-slate-700/50">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="bg-slate-900 border-slate-700" align="start">
                                <DropdownMenuItem onClick={() => openClone(u)} className="text-slate-300 focus:bg-slate-800">
                                  <CopyIcon className="size-4 ml-2 text-blue-400" /> نسخ المستخدم
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setResetPwdTarget(u); setIsResetPwdOpen(true); setNewPassword(''); }}
                                  className="text-slate-300 focus:bg-slate-800">
                                  <KeyRound className="size-4 ml-2 text-amber-400" /> إعادة كلمة المرور
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-slate-700" />
                                <DropdownMenuItem onClick={() => handleToggleSuspend(u)}
                                  className="text-slate-300 focus:bg-slate-800">
                                  {u.isSuspended ? <><CheckCircle2 className="size-4 ml-2 text-emerald-400" /> تفعيل الحساب</> : <><Ban className="size-4 ml-2 text-amber-400" /> تعليق الحساب</>}
                                </DropdownMenuItem>
                                {!isOwnerProtected(u) && <>
                                  <DropdownMenuSeparator className="bg-slate-700" />
                                  <DropdownMenuItem onClick={() => { setSelectedUser(u); setIsDeleteOpen(true); }}
                                    className="text-red-400 focus:bg-red-500/10">
                                    <Trash2 className="size-4 ml-2" /> حذف المستخدم
                                  </DropdownMenuItem>
                                </>}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
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
            TAB 2: PERMISSIONS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="permissions" className="space-y-4">
          {/* User selector + quick actions */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={permUserId || ''} onValueChange={(v) => {
              const u = users.find(x => x.id === v);
              if (u) openPermissions(u);
            }}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700/50 text-white w-64 h-10">
                <Users className="size-4 ml-1 text-slate-400" />
                <SelectValue placeholder="اختر مستخدم لتعديل صلاحياته" />
              </SelectTrigger>
              <SelectContent>
                {users.filter(u => !isOwnerProtected(u)).map(u => (
                  <SelectItem key={u.id} value={u.id} className="text-white">
                    {u.name || u.email} — {ROLE_OPTIONS.find(r => r.value === u.role)?.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {permUser && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs gap-1.5 h-8"
                    onClick={grantAll}>
                    <ShieldCheck className="size-3.5" /> منح الكل
                  </Button>
                </TooltipTrigger><TooltipContent>منح كل الصلاحيات</TooltipContent></Tooltip>

                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs gap-1.5 h-8"
                    onClick={removeAll}>
                    <ShieldX className="size-3.5" /> إزالة الكل
                  </Button>
                </TooltipTrigger><TooltipContent>إزالة كل الصلاحيات</TooltipContent></Tooltip>

                <Tooltip><TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs gap-1.5 h-8"
                    onClick={resetToRole}>
                    <RotateCcw className="size-3.5" /> افتراضي الدور
                  </Button>
                </TooltipTrigger><TooltipContent>إعادة صلاحيات الدور الافتراضية</TooltipContent></Tooltip>

                <Button size="sm" onClick={savePermissions} disabled={saving}
                  className="bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1.5 h-8">
                  {saving ? 'جاري الحفظ...' : <><Zap className="size-3.5" /> حفظ الصلاحيات</>}
                </Button>
              </div>
            )}
          </div>

          {/* Permissions Editor */}
          {permUser ? (
            <Card className="border-slate-700/30 bg-slate-800/30 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Lock className="size-4 text-violet-400" />
                  صلاحيات: {permUser.name || permUser.email}
                  <Badge className={`${ROLE_OPTIONS.find(r => r.value === permUser.role)?.color} text-[10px] border`}>
                    {ROLE_OPTIONS.find(r => r.value === permUser.role)?.label}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="max-h-[65vh]">
                  <div className="space-y-4 pr-3 pb-3">
                    {Object.entries(permissionGroups).map(([gid, pages]) => {
                      const isExpanded = expandedGroups.has(gid);
                      const allEdit = pages.every(p => getPermLevel(p.id) === 'edit');
                      return (
                        <div key={gid} className="rounded-xl border border-slate-700/30 overflow-hidden">
                          {/* Group Header */}
                          <button onClick={() => toggleGroup(gid)}
                            className="w-full flex items-center justify-between p-3.5 hover:bg-slate-700/20 transition-colors">
                            <div className="flex items-center gap-2.5">
                              <span className="text-base">{getGroupEmoji(gid)}</span>
                              <span className="text-white text-sm font-semibold">{getGroupLabel(gid)}</span>
                              <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">
                                {pages.filter(p => getPermLevel(p.id) !== 'none').length}/{pages.length}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <Tooltip><TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-7 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                                  onClick={(e) => { e.stopPropagation(); grantAllForGroup(gid); }}>
                                  <ShieldCheck className="size-3.5" />
                                </Button>
                              </TooltipTrigger><TooltipContent>منح صلاحيات القسم</TooltipContent></Tooltip>
                              {isExpanded ? <ChevronUp className="size-4 text-slate-500" /> : <ChevronDown className="size-4 text-slate-500" />}
                            </div>
                          </button>

                          {/* Pages in group */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden">
                                <div className="border-t border-slate-700/20 space-y-0">
                                  {pages.map(page => {
                                    const level = getPermLevel(page.id);
                                    const hasActions = page.availableActions.length > 0;
                                    return (
                                      <div key={page.id} className="border-b border-slate-700/10 last:border-0">
                                        <div className="flex items-center justify-between p-3 px-4">
                                          <span className="text-slate-300 text-xs font-medium">{page.title}</span>
                                          <RadioGroup value={level} onValueChange={(v) => setPermLevel(page.id, v as PermissionLevel)}
                                            className="flex gap-3" dir="rtl">
                                            <div className="flex items-center gap-1">
                                              <RadioGroupItem value="none" id={`p-none-${page.id}`} className="border-slate-600" />
                                              <Label htmlFor={`p-none-${page.id}`} className="text-slate-500 text-[10px] cursor-pointer">مخفي</Label>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <RadioGroupItem value="read" id={`p-read-${page.id}`} className="border-slate-600" />
                                              <Label htmlFor={`p-read-${page.id}`} className="text-slate-400 text-[10px] cursor-pointer">قراءة</Label>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <RadioGroupItem value="edit" id={`p-edit-${page.id}`} className="border-slate-600" />
                                              <Label htmlFor={`p-edit-${page.id}`} className="text-blue-400 text-[10px] cursor-pointer">تعديل</Label>
                                            </div>
                                          </RadioGroup>
                                        </div>
                                        {/* Action toggles */}
                                        {hasActions && level === 'edit' && (
                                          <div className="px-4 pb-3 pt-0">
                                            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                              {page.availableActions.map(action => (
                                                <div key={action} className="flex items-center gap-1.5">
                                                  <Checkbox id={`a-${page.id}-${action}`}
                                                    checked={getActionState(page.id, action)}
                                                    onCheckedChange={() => toggleAction(page.id, action)}
                                                    className="border-slate-600 data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600 size-3.5" />
                                                  <Label htmlFor={`a-${page.id}-${action}`}
                                                    className="text-slate-400 text-[10px] cursor-pointer">{getActionLabel(action)}</Label>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-slate-700/30 bg-slate-800/30 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <Lock className="size-12 text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">اختر مستخدماً لتعديل صلاحياته</p>
                <p className="text-slate-500 text-sm mt-1">يمكنك تخصيص صلاحيات كل مستخدم بشكل مستقل عن دوره</p>
              </CardContent>
            </Card>
          )}
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

      {/* Add User Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><UserPlus className="size-5 text-violet-400" /> إنشاء مستخدم جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل بيانات المستخدم الجديد</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
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
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">كلمة المرور</Label>
              <Input type="password" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" placeholder="كلمة المرور" dir="ltr" required />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button onClick={handleAddUser} disabled={saving || !addForm.email || !addForm.password}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5">
              {saving ? 'جاري الإنشاء...' : 'إنشاء'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><Pencil className="size-5 text-amber-400" /> تعديل المستخدم</DialogTitle>
            <DialogDescription className="text-slate-400">تعديل بيانات المستخدم</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
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
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">القسم</Label>
              <Input value={editForm.department} onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white h-10" placeholder="مثال: قسم الجودة" />
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

      {/* Delete Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2"><AlertTriangle className="size-5" /> تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button variant="destructive" onClick={handleDelete}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
