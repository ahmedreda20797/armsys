'use client';

// ══════════════════════════════════════════════════════════════
//  OrganizationPage — Milestone 10 Configuration Center
//
//  Three clear sections (NOT a monolithic settings page):
//    1. الهيكل        — org tree: create/rename/move/archive nodes,
//                       assign managers, assign/move employees, with
//                       impact preview before every restructure.
//    2. الوظائف       — position catalog with permission templates.
//    3. وصول المستخدمين — position assignment + optional employee
//                       linkage (user ↔ employee, never accounts).
//
//  Dark theme / RTL Arabic / responsive (no hardcoded widths).
//  Admin-only by default (safe defaults — permission registry).
// ══════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Network, Plus, Pencil, Trash2, FolderTree, ChevronDown, ChevronLeft,
  Building2, Users, UserCog, Briefcase, Save, Loader2, Search,
  ArrowRightLeft, ShieldAlert, UserRound, RotateCcw,
  Info,
} from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { OrgTreeWorkspace } from '@/components/pages/organization/OrgTreeWorkspace';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/query-provider';
import { usePermissions } from '@/hooks/usePermissions';
import { APP_PAGES } from '@/config/permissions';
import {
  ORG_NODE_TYPE_LABELS_AR, ORG_NODE_STATUS_LABELS_AR,
  type OrgNode, type OrgTreeNode, type OrgNodeType, type Position,
} from '@/lib/organization';

// ─── API types (mirrors /api/organization + /api/positions) ───
// status is the server-coerced currency flag: 'active' = current
// workforce, 'not-current' = archived/inactive (history kept, hidden
// from current rosters and counts).
interface OrgEmployeeRefDto { id: string; name: string | null; code: string | null; position: string | null; orgNodeId: string | null; status: 'active' | 'not-current' }
interface OrgUserDto {
  id: string; name: string; role: string;
  positionId: string | null; positionTitle: string | null; linkedEmployeeId: string | null;
}
interface OrganizationData {
  tree: OrgTreeNode[];
  nodes: OrgNode[];
  employees: OrgEmployeeRefDto[];
  unassignedEmployeeCount: number;
  users: OrgUserDto[];
}
interface ImpactPreview {
  impact: { nodeId: string; nodeName: string; subtreeNodeCount: number; employeeCount: number; managerUserIds: string[] };
  moveValidation: { ok: boolean; reason: string | null } | null;
}

const TYPE_OPTIONS: Array<{ value: OrgNodeType; label: string }> = [
  { value: 'company', label: ORG_NODE_TYPE_LABELS_AR.company },
  { value: 'department', label: ORG_NODE_TYPE_LABELS_AR.department },
  { value: 'team', label: ORG_NODE_TYPE_LABELS_AR.team },
  { value: 'subteam', label: ORG_NODE_TYPE_LABELS_AR.subteam },
];

const TYPE_STYLES: Record<OrgNodeType, string> = {
  company: 'bg-brand-500/10 text-brand-300 border-brand-500/20',
  department: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  team: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  subteam: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
};

const EDITABLE_PAGES = APP_PAGES.filter((p) => p.id !== 'home'); // §14: 'firebase' page removed

export default function OrganizationPage() {
  // Action checks against the 'organization' permission key — the
  // same registry the backend verifyPermission uses.
  const { canDoAction } = usePermissions();
  const canCreate = canDoAction('organization', 'create');
  const canUpdate = canDoAction('organization', 'update');
  const canDelete = canDoAction('organization', 'delete');
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('tree');

  const orgQuery = useQuery({
    queryKey: ['organization'],
    queryFn: () => apiFetch<OrganizationData>('/api/organization'),
  });
  const positionsQuery = useQuery({
    queryKey: ['positions'],
    queryFn: () => apiFetch<Position[]>('/api/positions'),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['organization'] });
    qc.invalidateQueries({ queryKey: ['positions'] });
  }, [qc]);

  if (orgQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl bg-slate-800/60" />
        <Skeleton className="h-[420px] rounded-2xl bg-slate-800/40" />
      </div>
    );
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">الهيكل التنظيمي</h1>
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="py-12 text-center text-slate-400">
            <ShieldAlert className="size-10 mx-auto mb-3 text-amber-400" />
            تعذر تحميل البيانات — تحقق من صلاحياتك ثم أعد المحاولة
            <div className="mt-4"><Button variant="outline" size="sm" onClick={() => orgQuery.refetch()}>إعادة المحاولة</Button></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const org = orgQuery.data;
  // Header shows the CURRENT workforce (active records) so the three
  // numbers stay semantically coherent — unassigned is active-only too.
  const currentEmployeeCount = org.employees.filter((e) => e.status === 'active').length;

  return (
    <div className="space-y-5 pb-8">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="organization"
        icon={<Network className="size-5" />}
        iconClassName="bg-gradient-to-br from-brand-500/20 to-brand-500/10 border border-brand-500/30 text-brand-400"
        description="إدارة الأقسام والفرق والوظائف وربط المستخدمين — أساس الصلاحيات والنطاقات"
        actions={
          <Badge variant="outline" className="border-slate-600/60 text-slate-400 text-[10px]">
            {org.nodes.length} عقدة · {currentEmployeeCount} موظف · {org.unassignedEmployeeCount} بدون عقدة
          </Badge>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800/50 border border-slate-700/30">
          <TabsTrigger value="tree" className="gap-1.5 data-[state=active]:bg-slate-700/60"><FolderTree className="size-3.5" />الهيكل</TabsTrigger>
          <TabsTrigger value="positions" className="gap-1.5 data-[state=active]:bg-slate-700/60"><Briefcase className="size-3.5" />الوظائف</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5 data-[state=active]:bg-slate-700/60"><UserCog className="size-3.5" />وصول المستخدمين</TabsTrigger>
        </TabsList>

        <TabsContent value="tree" className="mt-4">
          <TreeTab org={org} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onDone={invalidate} />
        </TabsContent>
        <TabsContent value="positions" className="mt-4">
          <PositionsTab positions={positionsQuery.data ?? []} loading={positionsQuery.isLoading}
            canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onDone={invalidate} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserAccessTab org={org} positions={positionsQuery.data ?? []} onDone={invalidate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  TAB 1 — Organization tree
// ══════════════════════════════════════════════════════════════

interface TreeTabProps {
  org: OrganizationData;
  canCreate: boolean; canUpdate: boolean; canDelete: boolean;
  onDone: () => void;
}

function TreeTab({ org, canCreate, canUpdate, canDelete, onDone }: TreeTabProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [createParent, setCreateParent] = useState<OrgNode | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editNode, setEditNode] = useState<OrgNode | null>(null);
  const [moveNode, setMoveNode] = useState<OrgNode | null>(null);
  const [memberNode, setMemberNode] = useState<OrgTreeNode | null>(null);
  // §12 — node details panel (children, manager, subtree counts).
  const [detailsNode, setDetailsNode] = useState<OrgTreeNode | null>(null);
  // §17 — spatial workspace vs accessible indented list (both render
  // the SAME tree data and drive the SAME dialogs).
  const [viewMode, setViewMode] = useState<'workspace' | 'list'>('workspace');

  // §ORG-TREE-V2 — direct members per node for the workspace's
  // in-card rosters (grouped once from the same employees array).
  // CURRENT workforce only: archived/inactive employees keep their
  // historical records but are not today's roster (§10).
  const employeesByNode = useMemo(() => {
    const map = new Map<string, { id: string; name: string | null; code: string | null }[]>();
    for (const e of org.employees) {
      if (!e.orgNodeId || e.status !== 'active') continue;
      const bucket = map.get(e.orgNodeId) ?? [];
      bucket.push({ id: e.id, name: e.name, code: e.code });
      map.set(e.orgNodeId, bucket);
    }
    return map;
  }, [org.employees]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCreate = (parent: OrgNode | null) => {
    setCreateParent(parent);
    setCreateOpen(true);
  };

  const renderNode = (node: OrgTreeNode, depth: number): React.ReactNode => (
    <div key={node.id}>
      <div
        className={`group flex items-center gap-2 py-2.5 px-2 md:px-3 rounded-xl border transition-colors ${
          node.status === 'archived'
            ? 'border-slate-700/20 bg-slate-800/20 opacity-60'
            : 'border-slate-700/30 bg-slate-800/40 hover:bg-slate-800/70'
        }`}
        style={{ marginRight: depth * 18 }}
      >
        {node.children.length > 0 ? (
          <button onClick={() => toggleCollapse(node.id)} className="text-slate-400 hover:text-white shrink-0" aria-label={collapsed.has(node.id) ? 'توسيع' : 'طي'}>
            {collapsed.has(node.id) ? <ChevronLeft className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Building2 className="size-4 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Long names: truncate the END with ellipsis (natural
                inline-end rule for Arabic RTL and English LTR alike);
                the full name stays on the title tooltip. min-w-0 lets
                the flex item actually shrink so the badges and action
                buttons can never be pushed out of the row. */}
            <span
              className={`text-sm font-semibold truncate min-w-0 max-w-full ${node.status === 'archived' ? 'text-slate-500 line-through' : 'text-white'}`}
              title={node.name}
            >
              {node.name}
            </span>
            <Badge variant="outline" className={`text-[9px] border ${TYPE_STYLES[node.type]}`}>{ORG_NODE_TYPE_LABELS_AR[node.type]}</Badge>
            {node.status === 'archived' && (
              <Badge variant="outline" className="text-[9px] border-slate-600 text-slate-400">{ORG_NODE_STATUS_LABELS_AR.archived}</Badge>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
            {node.subtreeEmployeeCount} موظف في الفرع{node.employeeCount !== node.subtreeEmployeeCount ? ` (${node.employeeCount} مباشرة)` : ''}
            {node.managerUserName ? ` · مدير: ${node.managerUserName}` : ' · بدون مدير'}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-60 md:group-hover:opacity-100 transition-opacity">
          {canUpdate && (
            <>
              <Button variant="ghost" size="icon" className="size-7 text-brand-300 hover:text-brand-200" onClick={() => setDetailsNode(node)} aria-label="تفاصيل العقدة">
                <Info className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-slate-400 hover:text-white" onClick={() => setMemberNode(node)} aria-label="أعضاء العقدة">
                <Users className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-slate-400 hover:text-white" onClick={() => setMoveNode(node)} aria-label="نقل العقدة">
                <ArrowRightLeft className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-slate-400 hover:text-white" onClick={() => setEditNode(node)} aria-label="تعديل العقدة">
                <Pencil className="size-3.5" />
              </Button>
            </>
          )}
          {canCreate && (
            <Button variant="ghost" size="icon" className="size-7 text-emerald-400 hover:text-emerald-300" onClick={() => openCreate(node)} aria-label="إضافة فرع">
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed.has(node.id) && node.children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-1.5 mt-1.5 border-slate-700/40"
            style={{ borderInlineStartWidth: 2, marginInlineStart: 10, paddingLeft: 8 }}
          >
            {node.children.map((child) => renderNode(child, depth + 1))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="space-y-4">
      {org.tree.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="py-12 text-center">
            <Network className="size-12 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-300 font-semibold mb-1">لا يوجد هيكل تنظيمي بعد</p>
            <p className="text-slate-500 text-xs mb-4">ابدأ بإنشاء عقدة الشركة — جذر الهيكل</p>
            {canCreate && <Button size="sm" className="bg-brand-600 hover:bg-brand-700" onClick={() => openCreate(null)}>إنشاء عقدة الشركة</Button>}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-slate-500 text-xs">انقل موظفاً بين الفرق فيغير نطاق بياناته تلقائياً — دون إعادة ضبط أي صلاحيات</p>
            {/* §17 — view switch: spatial workspace (default) or the
                accessible indented list */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-700/50 bg-slate-800/40">
              {([
                { v: 'workspace' as const, label: 'مساحة العمل', icon: Network },
                { v: 'list' as const, label: 'قائمة', icon: FolderTree },
              ]).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setViewMode(opt.v)}
                  aria-pressed={viewMode === opt.v}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                    viewMode === opt.v ? 'bg-slate-700/70 text-white' : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  <opt.icon className="size-3" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {canCreate && (
            <div className="flex justify-start">
              <Button size="sm" variant="outline" className="border-slate-700/50 text-slate-300 hover:bg-slate-800 gap-1.5" onClick={() => openCreate(null)} disabled={!canCreate}>
                <Plus className="size-3.5" /> إضافة قسم
              </Button>
            </div>
          )}
          {viewMode === 'workspace' ? (
            <OrgTreeWorkspace
              tree={org.tree}
              employeesByNode={employeesByNode}
              canUpdate={canUpdate}
              canCreate={canCreate}
              onSelectNode={() => {}}
              onNodeAction={(action, node) => {
                switch (action) {
                  case 'details': setDetailsNode(node); break;
                  case 'members': setMemberNode(node); break;
                  case 'move': setMoveNode(node); break;
                  case 'edit': setEditNode(node); break;
                  case 'addChild': openCreate(node); break;
                }
              }}
            />
          ) : (
            <Card className="border-slate-700/30 bg-slate-800/30">
              <CardContent className="pt-4">
                <div className="space-y-1.5">
                  {org.tree.map((root) => renderNode(root, 0))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <NodeCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} parent={createParent} nodes={org.nodes} users={org.users} onDone={onDone} />
      <NodeEditDialog node={editNode} onClose={() => setEditNode(null)} users={org.users} onDone={onDone} canArchive={canUpdate} />
      <NodeMoveDialog node={moveNode} nodes={org.nodes} onClose={() => setMoveNode(null)} onDone={onDone} />
      <NodeMembersDialog node={memberNode} org={org} onClose={() => setMemberNode(null)} onDone={onDone} />
      <NodeDetailsDialog node={detailsNode} org={org} onClose={() => setDetailsNode(null)} />
    </div>
  );
}

// ─── Create node ───
function NodeCreateDialog({ open, onClose, parent, nodes, users, onDone }: {
  open: boolean; onClose: () => void; parent: OrgNode | null; nodes: OrgNode[]; users: OrgUserDto[]; onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<OrgNodeType>('department');
  const [parentId, setParentId] = useState<string>(parent?.id ?? '');
  const [managerUserId, setManagerUserId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset when the target parent changes
  const [lastParent, setLastParent] = useState(parent?.id ?? '');
  if ((parent?.id ?? '') !== lastParent) {
    setLastParent(parent?.id ?? '');
    setParentId(parent?.id ?? '');
    setType(parent ? (parent.type === 'company' ? 'department' : parent.type === 'department' ? 'team' : 'subteam') : 'company');
    setName(''); setManagerUserId(''); setDescription('');
  } else if (open && type === 'department' && !parent && nodes.some((n) => n.type === 'company') && parentId === '' && lastParent === '') {
    // first open on an existing tree: default parent = company node
    const company = nodes.find((n) => n.type === 'company');
    if (company) setParentId(company.id);
  }

  const activeParentChoices = nodes.filter((n) => n.status === 'active');

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/organization', {
        method: 'POST',
        body: JSON.stringify({
          name, type,
          parentId: type === 'company' ? null : (parentId || null),
          managerUserId: managerUserId || null,
          description: description || null,
        }),
      });
      if (res) {
        toast.success('تم إنشاء العقدة');
        setName(''); setDescription(''); setManagerUserId('');
        onDone(); onClose();
      }
    } catch {
      toast.error('تعذر إنشاء العقدة');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">إضافة عقدة تنظيمية</DialogTitle>
          <DialogDescription>
            {parent ? `إضافة فرع تحت "${parent.name}"` : 'إضافة عقدة جديدة للهيكل'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">الاسم</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: فريق المبيعات" className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">النوع</Label>
              <Select value={type} onValueChange={(v) => setType(v as OrgNodeType)}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600/60">
                  {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">العقدة الأصل</Label>
              {type === 'company' ? (
                <div className="h-9 flex items-center text-[11px] text-slate-500">جذر الهيكل (بدون أب)</div>
              ) : (
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue placeholder="اختر الأب" /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                    {activeParentChoices.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name} ({ORG_NODE_TYPE_LABELS_AR[n.type]})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">المدير المسؤول (اختياري)</Label>
            <Select value={managerUserId} onValueChange={setManagerUserId}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue placeholder="بدون مدير" /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-500">المدير هو مستخدم نظام — يُستخدم في توجيه الإشعارات وحل النطاقات، ولا يُنشئ أي حسابات.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">الوصف (اختياري)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={onClose}>إلغاء</Button>
          <Button size="sm" className="bg-brand-600 hover:bg-brand-700 gap-1.5" disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} إنشاء
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit node ───
function NodeEditDialog({ node, onClose, users, onDone, canArchive }: {
  node: OrgNode | null; onClose: () => void; users: OrgUserDto[]; onDone: () => void; canArchive: boolean;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<OrgNodeType>('department');
  const [managerUserId, setManagerUserId] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [order, setOrder] = useState('0');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [lastNode, setLastNode] = useState<string | null>(null);
  if (node && node.id !== lastNode) {
    setLastNode(node.id);
    setName(node.name); setType(node.type); setManagerUserId(node.managerUserId ?? '');
    setStatus(node.status); setOrder(String(node.order ?? 0)); setDescription(node.description ?? '');
  }

  const save = async () => {
    if (!node) return;
    setSaving(true);
    try {
      await apiFetch(`/api/organization/${node.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name, type, status: canArchive ? status : undefined,
          managerUserId: managerUserId || null,
          order: Number(order) || 0,
          description: description || null,
        }),
      });
      toast.success('تم حفظ التعديلات');
      onDone(); onClose();
    } catch {
      toast.error('تعذر حفظ التعديلات');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">تعديل العقدة</DialogTitle>
          <DialogDescription>تغيير الاسم أو النوع أو المدير أو الأرشفة — النقل الهيكلي يتم من زر النقل</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الاسم</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-slate-800/50 border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">النوع</Label>
              <Select value={type} onValueChange={(v) => setType(v as OrgNodeType)}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600/60">
                  {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">المدير</Label>
              <Select value={managerUserId} onValueChange={setManagerUserId}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue placeholder="بدون مدير" /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الترتيب</Label>
              <Input value={order} onChange={(e) => setOrder(e.target.value)} type="number" className="bg-slate-800/50 border-slate-700" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">الحالة</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'archived')} disabled={!canArchive}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600/60">
                <SelectItem value="active">{ORG_NODE_STATUS_LABELS_AR.active}</SelectItem>
                <SelectItem value="archived">{ORG_NODE_STATUS_LABELS_AR.archived}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-500">الأرشفة توقف الإسناد الجديد ولا تحذف أي بيانات تاريخية.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">الوصف</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={onClose}>إلغاء</Button>
          <Button size="sm" className="bg-brand-600 hover:bg-brand-700 gap-1.5" disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Move node (with impact preview) ───
function NodeMoveDialog({ node, nodes, onClose, onDone }: {
  node: OrgNode | null; nodes: OrgNode[]; onClose: () => void; onDone: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [moving, setMoving] = useState(false);

  const [lastNode, setLastNode] = useState<string | null>(null);
  if (node && node.id !== lastNode) {
    setLastNode(node.id); setTargetId(''); setPreview(null);
  }

  // Candidate parents exclude the node itself and its own subtree
  // (cycle prevention mirrors the server-side validateMoveNode).
  const subtreeIds = useMemo(() => {
    if (!node) return new Set<string>();
    const ids = new Set<string>([node.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); changed = true; }
      }
    }
    return ids;
  }, [node, nodes]);
  const candidates = nodes.filter((n) => n.status === 'active' && !subtreeIds.has(n.id));

  const runPreview = async (value: string) => {
    setTargetId(value);
    setPreview(null);
    if (!node || !value) return;
    try {
      const res = await apiFetch<ImpactPreview>('/api/organization/impact', {
        method: 'POST',
        body: JSON.stringify({ nodeId: node.id, newParentId: value }),
      });
      setPreview(res);
    } catch { /* preview failures surface at move time */ }
  };

  const move = async () => {
    if (!node || !targetId) return;
    setMoving(true);
    try {
      await apiFetch('/api/organization/move', {
        method: 'POST',
        body: JSON.stringify({ nodeId: node.id, newParentId: targetId }),
      });
      toast.success('تم نقل العقدة');
      onDone(); onClose();
    } catch {
      toast.error('تعذر نقل العقدة');
    } finally { setMoving(false); }
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">نقل "{node?.name}"</DialogTitle>
          <DialogDescription>معاينة التأثير قبل التنفيذ — لا يتم تعديل أي بيانات تاريخية</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">العقدة الأصل الجديدة</Label>
            <Select value={targetId} onValueChange={(v) => void runPreview(v)}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue placeholder="اختر الوجهة" /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                <SelectItem value="__root__">— جذر الهيكل —</SelectItem>
                {candidates.map((n) => (
                  <SelectItem key={n.id} value={n.id}>{n.name} ({ORG_NODE_TYPE_LABELS_AR[n.type]})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preview && (
            <div className={`rounded-xl border p-3 space-y-1.5 ${preview.moveValidation && !preview.moveValidation.ok ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 text-amber-400" /> معاينة التأثير
              </p>
              {preview.moveValidation && !preview.moveValidation.ok ? (
                <p className="text-[11px] text-red-400">{preview.moveValidation.reason}</p>
              ) : (
                <ul className="text-[11px] text-slate-400 space-y-0.5">
                  <li>• {preview.impact.subtreeNodeCount} عقدة داخل الفرع المنقول</li>
                  <li>• {preview.impact.employeeCount} موظف سيرثون نطاقاً مختلفاً تلقائياً</li>
                  {preview.impact.managerUserIds.length > 0 && (
                    <li>• {preview.impact.managerUserIds.length} مدير سيتم إشعاره بالتغيير</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={onClose}>إلغاء</Button>
          <Button size="sm" className="bg-amber-600 hover:bg-amber-700 gap-1.5" disabled={moving || !targetId || (preview?.moveValidation ? !preview.moveValidation.ok : false)} onClick={() => void move()}>
            {moving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRightLeft className="size-3.5" />} نقل مؤكد
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Node members (employee assignment) ───
// §12 — node details: hierarchy identity at a glance (read-only).
function NodeDetailsDialog({ node, org, onClose }: {
  node: OrgTreeNode | null; org: OrganizationData; onClose: () => void;
}) {
  const directEmployees = useMemo(() => {
    if (!node) return [];
    return org.employees.filter((e) => e.orgNodeId === node.id);
  }, [node, org.employees]);
  const childNodes = node?.children ?? [];

  return (
    <Dialog open={Boolean(node)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">تفاصيل العقدة</DialogTitle>
          <DialogDescription>نظرة شاملة على موضع العقدة في الهيكل التنظيمي</DialogDescription>
        </DialogHeader>
        {node && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-base">{node.name}</span>
              <Badge variant="outline" className={`text-[9px] border ${TYPE_STYLES[node.type]}`}>{ORG_NODE_TYPE_LABELS_AR[node.type]}</Badge>
              {node.status === 'archived' && <Badge variant="outline" className="text-[9px] border-slate-600 text-slate-400">{ORG_NODE_STATUS_LABELS_AR.archived}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-2.5">
                <p className="text-slate-500 text-[10px]">المدير المسؤول</p>
                <p className="text-slate-200 mt-0.5">{node.managerUserName || '—'}</p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-2.5">
                <p className="text-slate-500 text-[10px]">الموظفون</p>
                <p className="text-slate-200 mt-0.5">{directEmployees.length} مباشر · {node.subtreeEmployeeCount} في الفرع</p>
              </div>
            </div>
            <div>
              <p className="text-slate-400 text-xs font-semibold mb-1.5">العقد الفرعية ({childNodes.length})</p>
              {childNodes.length === 0 ? (
                <p className="text-slate-600 text-xs">لا توجد عقد فرعية</p>
              ) : (
                <div className="space-y-1">
                  {childNodes.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/40 bg-slate-800/30 px-2.5 py-1.5">
                      <span className="text-slate-200 text-xs truncate min-w-0 flex-1" title={c.name}>{c.name}</span>
                      <span className="text-slate-500 text-[10px] shrink-0">{ORG_NODE_TYPE_LABELS_AR[c.type]} · {c.subtreeEmployeeCount} موظف</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-slate-400 text-xs font-semibold mb-1.5">الموظفون المباشرون</p>
              {directEmployees.length === 0 ? (
                <p className="text-slate-600 text-xs">لا يوجد موظفون معينون مباشرة لهذه العقدة</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto arm-scroll">
                  {directEmployees.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/40 bg-slate-800/30 px-2.5 py-1.5">
                      <span className="text-slate-200 text-xs truncate min-w-0 flex-1" title={e.name ?? undefined}>{e.name}</span>
                      <span className="text-slate-500 text-[10px] shrink-0" dir="ltr">{e.code || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Node members (employee assignment) ───
// §12 — fixed-height rows, min-width-zero truncation (long names,
// codes, titles and Arabic text can never overlap the action column),
// contained scroll areas inside a viewport-bounded dialog.
// §13 — the picker prioritizes employees WITHOUT an organization
// assignment (default filter); employees already assigned elsewhere
// carry their current node on the row and are moved only through an
// explicit confirmation.
function NodeMembersDialog({ node, org, onClose, onDone }: {
  node: OrgTreeNode | null; org: OrganizationData; onClose: () => void; onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  // §13 — default filter: employees without an org assignment first.
  const [scopeFilter, setScopeFilter] = useState<'unassigned' | 'all'>('unassigned');
  const [movingId, setMovingId] = useState<string | null>(null);
  // §13 — explicit transfer confirmation (never a silent move).
  const [confirmTransfer, setConfirmTransfer] = useState<OrgEmployeeRefDto | null>(null);

  const nodeNameById = useMemo(
    () => new Map(org.nodes.map((n) => [n.id, n.name])),
    [org.nodes],
  );

  // CURRENT members only — archived/inactive employees are history,
  // not today's roster.
  const members = useMemo(() => {
    if (!node) return [];
    return org.employees.filter((e) => e.orgNodeId === node.id && e.status === 'active');
  }, [node, org.employees]);

  const unassignedCount = useMemo(
    () => org.employees.filter((e) => e.status === 'active' && !e.orgNodeId).length,
    [org.employees],
  );

  const assignable = useMemo(() => {
    if (!node) return [];
    const q = search.trim();
    const eligible = org.employees.filter((e) => e.status === 'active' && e.orgNodeId !== node.id);
    const scoped = scopeFilter === 'unassigned'
      ? eligible.filter((e) => !e.orgNodeId)
      : eligible;
    const matched = scoped.filter(
      (e) => !q || (e.name ?? '').includes(q) || (e.code ?? '').includes(q),
    );
    // Unassigned candidates first, then a stable name order.
    return matched
      .sort((a, b) => Number(Boolean(a.orgNodeId)) - Number(Boolean(b.orgNodeId)) || (a.name ?? '').localeCompare(b.name ?? '', 'ar'))
      .slice(0, 50);
  }, [node, org.employees, search, scopeFilter]);

  const moveEmployee = async (employeeId: string, targetNodeId: string | null) => {
    setMovingId(employeeId);
    try {
      await apiFetch('/api/organization/employees/move', {
        method: 'POST',
        body: JSON.stringify({ employeeId, orgNodeId: targetNodeId }),
      });
      toast.success('تم نقل الموظف — نطاق بياناته يتحدث تلقائياً');
      onDone();
    } catch {
      toast.error('تعذر نقل الموظف');
    } finally { setMovingId(null); }
  };

  const requestAssign = (e: OrgEmployeeRefDto) => {
    // Already assigned to another node → explicit confirmation first.
    if (e.orgNodeId) setConfirmTransfer(e);
    else void moveEmployee(e.id, node?.id ?? null);
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">أعضاء "{node?.name}"</DialogTitle>
          <DialogDescription>
            الموظفون بيانات وليسوا مستخدمي نظام — النقل يغير علاقة العقدة فقط ولا يمس أي سجل تاريخي.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400 font-semibold">الأعضاء الحاليون ({members.length})</p>
            <div className="arm-scroll max-h-44 overflow-y-auto rounded-lg border border-slate-700/30 divide-y divide-slate-700/20">
              {members.length === 0 && <p className="text-[11px] text-slate-500 py-3 px-2">لا يوجد أعضاء مباشرون</p>}
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 h-10 px-2 bg-slate-800/40 hover:bg-slate-800/60 transition-colors">
                  <span className="shrink-0 size-6 rounded-full bg-slate-700/80 border border-slate-600/60 grid place-items-center text-[10px] font-bold text-slate-300">
                    {(m.name ?? '؟').trim().charAt(0)}
                  </span>
                  <span className="text-xs text-slate-200 truncate min-w-0 flex-1" title={m.name ?? undefined}>{m.name ?? '—'}</span>
                  {m.code && <span className="text-[10px] font-mono text-slate-500 shrink-0" dir="ltr">{m.code}</span>}
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1 shrink-0" disabled={movingId === m.id} onClick={() => void moveEmployee(m.id, null)}>
                    {movingId === m.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} إزالة
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-700/40">
            <p className="text-xs text-slate-400 font-semibold">إسناد موظف لهذه العقدة</p>
            {/* §13 — filter chips: unassigned (default) vs all eligible */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-700/50 bg-slate-800/40">
                {([
                  { v: 'unassigned' as const, label: `بدون إسناد (${unassignedCount})` },
                  { v: 'all' as const, label: 'الكل' },
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setScopeFilter(opt.v)}
                    aria-pressed={scopeFilter === opt.v}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                      scopeFilter === opt.v ? 'bg-slate-700/70 text-white' : 'text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute right-2.5 top-2.5 size-3.5 text-slate-500" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الكود..." className="pr-8 bg-slate-800/50 border-slate-700 text-xs h-9" />
              </div>
            </div>
            <div className="arm-scroll max-h-44 overflow-y-auto rounded-lg border border-slate-700/30 divide-y divide-slate-700/20">
              {assignable.length === 0 && (
                <p className="text-[11px] text-slate-500 py-3 px-2">
                  {scopeFilter === 'unassigned' ? 'لا يوجد موظفون بدون إسناد — جرّب فلتر "الكل"' : 'لا توجد نتائج'}
                </p>
              )}
              {assignable.map((e) => {
                const currentNodeName = e.orgNodeId ? nodeNameById.get(e.orgNodeId) ?? 'عقدة أخرى' : null;
                return (
                  <div key={e.id} className="flex items-center gap-2 min-h-10 px-2 py-1.5 bg-slate-800/40 hover:bg-slate-800/60 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-200 truncate" title={e.name ?? undefined}>{e.name ?? '—'}</p>
                      <p className="text-[10px] text-slate-500 truncate flex items-center gap-1" title={currentNodeName ?? undefined}>
                        {e.code && <span className="font-mono shrink-0" dir="ltr">{e.code}</span>}
                        {e.position && <span className="shrink-0">· {e.position}</span>}
                        {currentNodeName && (
                          <span className="text-amber-400/80 truncate min-w-0">
                            · ينتمي حالياً إلى: {currentNodeName}
                          </span>
                        )}
                        {!currentNodeName && <span className="text-emerald-400/80">· بدون إسناد تنظيمي</span>}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 gap-1 shrink-0"
                      disabled={movingId === e.id} onClick={() => requestAssign(e)}>
                      {movingId === e.id ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                      {e.orgNodeId ? 'نقل' : 'إسناد'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-700/40">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={onClose}>إغلاق</Button>
        </div>

        {/* §13 — explicit transfer confirmation; never a silent move */}
        <ConfirmDialog
          open={!!confirmTransfer}
          onOpenChange={(o) => { if (!o) setConfirmTransfer(null); }}
          title="نقل موظف من عقدة أخرى"
          description={`هذا الموظف ينتمي حالياً إلى "${
            confirmTransfer?.orgNodeId ? nodeNameById.get(confirmTransfer.orgNodeId) ?? 'عقدة أخرى' : '—'
          }". هل تريد نقله إلى "${node?.name ?? '—'}"؟ نطاق بياناته يتحدث تلقائياً ولا يمس النقل أي سجل تاريخي.`}
          itemName={confirmTransfer?.name ?? undefined}
          confirmLabel="تأكيد النقل"
          loading={!!movingId}
          onConfirm={() => {
            const target = confirmTransfer;
            setConfirmTransfer(null);
            if (target && node) void moveEmployee(target.id, node.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
//  TAB 2 — Positions
// ══════════════════════════════════════════════════════════════

interface PositionsTabProps {
  positions: Position[]; loading: boolean;
  canCreate: boolean; canUpdate: boolean; canDelete: boolean;
  onDone: () => void;
}

function PositionsTab({ positions, loading, canCreate, canUpdate, canDelete, onDone }: PositionsTabProps) {
  const [editing, setEditing] = useState<Position | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-slate-500 text-xs">
          الوظيفة قالب صلاحيات قابل لإعادة الاستخدام — تُطبق كطبقة بين الدور والتجاوزات الفردية عند إسنادها لمستخدم
        </p>
        {canCreate && (
          <Button size="sm" className="bg-brand-600 hover:bg-brand-700 gap-1.5" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" /> وظيفة جديدة
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-40 rounded-2xl bg-slate-800/40" />
      ) : positions.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="py-10 text-center">
            <Briefcase className="size-10 mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400 text-sm">لا توجد وظائف معرّفة بعد</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {positions.map((position) => (
            <Card key={position.id} className="border-slate-700/30 bg-slate-800/40">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{position.title}</p>
                    {position.description && <p className="text-[11px] text-slate-500 truncate">{position.description}</p>}
                  </div>
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${position.status === 'active' ? 'border-emerald-500/30 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>
                    {position.status === 'active' ? 'نشطة' : 'مؤرشفة'}
                  </Badge>
                </div>
                <p className="text-[10px] text-slate-500">
                  {position.permissions ? `${Object.keys(typeof position.permissions === 'string' ? JSON.parse(position.permissions || '{}') : position.permissions).length} صفحة في القالب` : 'بدون قالب صلاحيات'}
                </p>
                <div className="flex items-center gap-1.5">
                  {canUpdate && (
                    <Button variant="outline" size="sm" className="h-7 text-[10px] border-slate-700 text-slate-300 hover:bg-slate-800 gap-1" onClick={() => setEditing(position)}>
                      <Pencil className="size-3" /> تعديل
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1"
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/positions/${position.id}`, { method: 'DELETE' });
                          toast.success('تم حذف الوظيفة'); onDone();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'تعذر الحذف — قد تكون مستخدمة');
                        }
                      }}>
                      <Trash2 className="size-3" /> حذف
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PositionDialog position={editing} onClose={() => setEditing(null)} onDone={onDone} />
    </div>
  );
}

function PositionDialog({ position, onClose, onDone }: {
  position: Position | 'new' | null; onClose: () => void; onDone: () => void;
}) {
  const isNew = position === 'new';
  const existing = position && position !== 'new' ? position : null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  // template: pageKey → level ('' = inherit/not in template)
  const [template, setTemplate] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [lastId, setLastId] = useState<string | null>(null);
  const currentId = existing?.id ?? (isNew ? 'new' : null);
  if (currentId && currentId !== lastId) {
    setLastId(currentId);
    if (existing) {
      setTitle(existing.title); setDescription(existing.description ?? ''); setStatus(existing.status);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof existing.permissions === 'string' ? JSON.parse(existing.permissions || '{}') : (existing.permissions as Record<string, unknown>) ?? {};
      } catch { parsed = {}; }
      const t: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const level = typeof v === 'string' ? v : ((v as Record<string, unknown>)?.level as string);
        if (level === 'none' || level === 'read' || level === 'edit') t[k] = level;
      }
      setTemplate(t);
    } else {
      setTitle(''); setDescription(''); setStatus('active'); setTemplate({});
    }
  }

  const setEntry = (pageKey: string, level: string) => {
    setTemplate((prev) => {
      const next = { ...prev };
      if (!level) delete next[pageKey];
      else next[pageKey] = level;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        title, description: description || null, status,
        permissions: Object.keys(template).length > 0
          ? Object.fromEntries(Object.entries(template).map(([k, v]) => [k, { level: v }]))
          : null,
      };
      if (existing) {
        await apiFetch(`/api/positions/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/positions', { method: 'POST', body: JSON.stringify(body) });
      }
      toast.success('تم حفظ الوظيفة');
      onDone(); onClose();
    } catch {
      toast.error('تعذر حفظ الوظيفة');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={Boolean(position)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col bg-slate-900 border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="text-white">{isNew ? 'وظيفة جديدة' : `تعديل: ${existing?.title}`}</DialogTitle>
          <DialogDescription>
            القالب طبقة وسطى: الدور أولاً ثم هذا القالب ثم تجاوزات المستخدم المخزنة — الفهم دائماً من نفس محلل الصلاحيات
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1 arm-scroll">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">المسمى الوظيفي</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: أخصائي جودة" className="bg-slate-800/50 border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الحالة</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'archived')}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600/60">
                  <SelectItem value="active">نشطة</SelectItem>
                  <SelectItem value="archived">مؤرشفة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">الوصف</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="bg-slate-800/50 border-slate-700" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300 text-xs">قالب الصلاحيات</Label>
              <span className="text-[10px] text-slate-500">اتركه فارغاً ليرث المستخدم صلاحيات دوره فقط</span>
            </div>
            <div className="rounded-xl border border-slate-700/40 divide-y divide-slate-700/20">
              {EDITABLE_PAGES.map((page) => {
                const value = template[page.id] ?? '';
                return (
                  <div key={page.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-[11px] text-slate-300 truncate">{page.title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {[
                        { v: '', label: 'افتراضي', cls: 'text-slate-500' },
                        { v: 'none', label: 'مخفي', cls: 'text-red-400' },
                        { v: 'read', label: 'قراءة', cls: 'text-amber-400' },
                        { v: 'edit', label: 'تعديل', cls: 'text-blue-400' },
                      ].map((opt) => (
                        <button
                          key={opt.v || 'default'}
                          onClick={() => setEntry(page.id, opt.v)}
                          className={`px-2 py-0.5 rounded-md text-[10px] transition-colors ${value === opt.v ? `bg-slate-700/80 font-semibold ${opt.cls}` : 'text-slate-500 hover:bg-slate-800'}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-700/40">
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={onClose}>إلغاء</Button>
          <Button size="sm" className="bg-brand-600 hover:bg-brand-700 gap-1.5" disabled={saving || !title.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
//  TAB 3 — User access (position + employee linkage)
// ══════════════════════════════════════════════════════════════

function UserAccessTab({ org, positions, onDone }: {
  org: OrganizationData; positions: Position[]; onDone: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const users = useMemo(() => {
    const q = search.trim();
    return org.users.filter((u) => !q || u.name.includes(q));
  }, [org.users, search]);

  const employeesById = useMemo(() => new Map(org.employees.map((e) => [e.id, e])), [org.employees]);
  const activePositions = positions.filter((p) => p.status === 'active');

  const updateUser = async (userId: string, patch: Record<string, unknown>) => {
    setSavingId(userId);
    try {
      await apiFetch(`/api/dashboard/users/${userId}`, { method: 'PUT', body: JSON.stringify(patch) });
      toast.success('تم تحديث بيانات الوصول');
      onDone();
    } catch {
      toast.error('تعذر تحديث بيانات الوصول');
    } finally { setSavingId(null); }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-700/30 bg-slate-800/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <UserRound className="size-4 text-brand-400" /> ربط المستخدمين
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            ربط الموظف بالمستخدم علاقة اختيارية يديرها المدير فقط — لا يتم إنشاء حسابات موظفين أبداً.
            الربط يفعّل نطاق "سجله فقط" وتوجيه إشعارات الموظف لصاحب الحساب المرتبط.
          </p>
          <div className="relative max-w-sm">
            <Search className="absolute right-2.5 top-2.5 size-3.5 text-slate-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن مستخدم..." className="pr-8 bg-slate-800/50 border-slate-700 text-xs h-9" />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {users.map((u) => {
          const linked = u.linkedEmployeeId ? employeesById.get(u.linkedEmployeeId) : null;
          return (
            <Card key={u.id} className="border-slate-700/30 bg-slate-800/40">
              <CardContent className="pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{u.name}</p>
                    <Badge variant="outline" className="mt-1 text-[9px] border-slate-600 text-slate-400">{u.role}</Badge>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-400 text-[10px]">الوظيفة (قالب الصلاحيات)</Label>
                    <Select
                      value={u.positionId ?? '__none__'}
                      onValueChange={(v) => void updateUser(u.id, { positionId: v === '__none__' ? null : v })}
                      disabled={savingId === u.id}
                    >
                      <SelectTrigger className="h-8 text-[11px] bg-slate-800/50 border-slate-700 text-slate-200">
                        <SelectValue placeholder="بدون وظيفة" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                        <SelectItem value="__none__">— بدون وظيفة —</SelectItem>
                        {activePositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {u.positionTitle && <p className="text-[9px] text-slate-500">الحالية: {u.positionTitle}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-400 text-[10px]">الموظف المرتبط (اختياري)</Label>
                    <Select
                      value={u.linkedEmployeeId ?? '__none__'}
                      onValueChange={(v) => void updateUser(u.id, { linkedEmployeeId: v === '__none__' ? null : v })}
                      disabled={savingId === u.id}
                    >
                      <SelectTrigger className="h-8 text-[11px] bg-slate-800/50 border-slate-700 text-slate-200">
                        <SelectValue placeholder="بدون ربط" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600/60 max-h-56">
                        <SelectItem value="__none__">— بدون ربط —</SelectItem>
                        {org.employees.slice(0, 500).map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name}{e.code ? ` (${e.code})` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {linked && <p className="text-[9px] text-slate-500">الحالي: {linked.name}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {users.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">لا توجد نتائج</p>
        )}
      </div>
    </div>
  );
}
