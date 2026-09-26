'use client';

// ══════════════════════════════════════════════════════════════
//  PermissionManagerConsole — the enterprise Permission Manager.
//
//  Administration surface over the EXISTING authorization core:
//
//    USER → role baseline / position template / direct override
//              ↓ (canonical resolveEffectivePermissions)
//           EFFECTIVE  →  page → section → action → field → scope
//
//  • The user list carries search + persisted filters and a direct-
//    override indicator; opening a user never resets the filters.
//  • The profile loads from the focused Permission Manager API in ONE
//    request (identity + tiers + canonical per-page explanations +
//    organization context) — no per-checkbox reads, no N+1.
//  • Editing writes ONLY the direct-override tier (Allow / Deny /
//    Inherit). The effective preview re-runs the CANONICAL resolver
//    on the draft; the server re-validates and re-resolves on save
//    and stays authoritative.
//  • Saving goes through the existing audited PUT (configAuditLog,
//    exact diff); nothing is written while merely viewing.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BadgeCheck, Building2, Filter, GitCompare, Landmark, Loader2,
  Lock, MapPin, RotateCcw, Save, Search, ShieldBan, User as UserIcon, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/api-fetch';
import { usePageState } from '@/hooks/use-page-state';
import { useAuth } from '@/contexts/AuthContext';
import { orgNodeTypeLabel, type OrgNodeType } from '@/lib/organization';
import { describeBoundarySource } from '@/lib/scope/boundary';
import {
  APP_PAGES, SIDEBAR_GROUPS, localizedGroupLabel, migratePermission,
  resolveEffectivePermissions,
  type ActionKey, type DataScope, type PagePermission, type PermissionLevel,
  type PermissionsMap,
} from '@/config/permissions';
import { PageAccessRow, LEVEL_LABELS, type LevelChoice, type TriChoice } from './PageAccessRow';
import type { AuthorizationProfile, ConsoleUser } from './types';

/** Same avatar palette convention as EmployeeLink (brand-consistent gradients). */
function avatarGradientFor(seed: string): string {
  const gradients = [
    'from-emerald-500 to-cyan-600',
    'from-brand-500 to-brand-600',
    'from-blue-500 to-brand-700',
    'from-orange-500 to-amber-600',
    'from-pink-500 to-rose-600',
    'from-teal-500 to-emerald-600',
  ];
  const ch = seed.trim().charAt(0) || '?';
  return gradients[(ch.charCodeAt(0) || 0) % gradients.length];
}

// ── persisted filter shape ──────────────────────────────────────

interface ConsoleFilters {
  search: string;
  role: string;         // 'all' | role
  position: string;     // 'all' | position title
  department: string;   // 'all' | department label
  team: string;         // 'all' | team label
  status: string;       // 'all' | 'active' | 'suspended'
  overrides: string;    // 'all' | 'with' | 'without'
}

const FILTERS_DEFAULT: ConsoleFilters = {
  search: '', role: 'all', position: 'all', department: 'all',
  team: 'all', status: 'all', overrides: 'all',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'مالك النظام',
  hr: 'موارد بشرية',
  manager: 'مدير',
  quality: 'جودة',
  user: 'مستخدم',
};

const ROLE_CHIP: Record<string, string> = {
  admin: 'bg-brand-500/15 text-brand-300 border-brand-500/40',
  hr: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  manager: 'bg-teal-500/15 text-teal-300 border-teal-500/40',
  quality: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  user: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

interface PermissionManagerConsoleProps {
  users: ConsoleUser[];
  selectedUserId: string | null;
  onSelectUser: (user: ConsoleUser | null) => void;
  /** Parent refresh after a successful save (override indicators). */
  onSaved: () => void;
}

export function PermissionManagerConsole({ users, selectedUserId, onSelectUser, onSaved }: PermissionManagerConsoleProps) {
  const { user: currentUser } = useAuth();

  // ── filters (persisted — surviving user switches and reloads) ──
  const [filters, setFilters, resetFilters] = usePageState<ConsoleFilters>({
    page: 'controlPanel',
    slot: 'permissionManager',
    version: 1,
    initial: FILTERS_DEFAULT,
  });
  const setFilter = <K extends keyof ConsoleFilters>(key: K, value: ConsoleFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // ── profile + draft ───────────────────────────────────────────
  const [profile, setProfile] = useState<AuthorizationProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionsMap>({});
  const [savedOverrides, setSavedOverrides] = useState<PermissionsMap>({});
  // §ORG-BOUNDARY — the boundary override draft (null = تلقائي/
  // inherit). Kept SEPARATE from the per-page permission entries:
  // WHERE and HOW MUCH are different axes with different editors.
  const [boundaryDraft, setBoundaryDraft] = useState<string[] | null>(null);
  const [savedBoundary, setSavedBoundary] = useState<string[] | null>(null);
  const [boundaryPickerOpen, setBoundaryPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const res = await authFetch(`/api/dashboard/users/${userId}/permissions`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'فشل تحميل ملف الصلاحيات');
      }
      const data = (await res.json()) as AuthorizationProfile;
      setProfile(data);
      const stored: PermissionsMap = data.authorization.storedOverrides ?? {};
      setSavedOverrides(stored);
      setDraft(structuredClone(stored));
      const overrideIds = data.identity.orgBoundaryNodeIds ?? null;
      setSavedBoundary(overrideIds);
      setBoundaryDraft(overrideIds);
      setProfileError(null);
    } catch (err) {
      setProfile(null);
      setProfileError(err instanceof Error ? err.message : 'فشل تحميل ملف الصلاحيات');
    }
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      // Async boundary (codebase convention): state updates happen after
      // the first await, never synchronously within the effect body.
      void (async () => { await loadProfile(selectedUserId); })();
    }
  }, [selectedUserId, loadProfile]);

  /** The loaded profile belongs to the CURRENTLY selected user (guards a stale profile while switching). */
  const profileReady = profile !== null && profile.identity.id === selectedUserId;

  // ── filtered user list (selecting a user NEVER resets filters) ──
  const positions = useMemo(
    () => [...new Set(users.map((u) => u.positionTitle).filter(Boolean))] as string[],
    [users],
  );
  const departments = useMemo(
    () => [...new Set(users.map((u) => u.department).filter(Boolean))] as string[],
    [users],
  );
  const teams = useMemo(
    () => [...new Set(users.map((u) => u.team).filter(Boolean))] as string[],
    [users],
  );

  const filteredUsers = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const blob = `${u.name ?? ''} ${u.email ?? ''} ${u.linkedEmployeeCode ?? ''} ${u.positionTitle ?? ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (filters.role !== 'all' && u.role !== filters.role) return false;
      if (filters.position !== 'all' && u.positionTitle !== filters.position) return false;
      if (filters.department !== 'all' && u.department !== filters.department) return false;
      if (filters.team !== 'all' && u.team !== filters.team) return false;
      if (filters.status === 'active' && u.isSuspended) return false;
      if (filters.status === 'suspended' && !u.isSuspended) return false;
      if (filters.overrides === 'with' && !u.hasOverrides) return false;
      if (filters.overrides === 'without' && u.hasOverrides) return false;
      return true;
    });
  }, [users, filters]);

  const filtersActive = useMemo(
    () => JSON.stringify({ ...filters, search: '' }) !== JSON.stringify(FILTERS_DEFAULT) || filters.search !== '',
    [filters],
  );

  // ── draft mutation (direct-override tier ONLY) ────────────────
  const roleBaseline = profile?.authorization.roleBaseline ?? null;
  const positionTemplate = profile?.authorization.positionTemplate ?? null;
  const targetRole = profile?.identity.role ?? null;
  const targetIsSelf = Boolean(profile && currentUser?.id === profile.identity.id);
  const editable = Boolean(profileReady) && !targetIsSelf && !saving;

  /** The level this page resolves to from the tiers BELOW the override. */
  const inheritedLevel = (pageKey: string): PermissionLevel => {
    if (positionTemplate && pageKey in positionTemplate) {
      return migratePermission(positionTemplate[pageKey]).level;
    }
    return migratePermission(roleBaseline?.[pageKey]).level;
  };

  const mutateEntry = (pageKey: string, mutate: (entry: PagePermission) => void) => {
    setDraft((prev) => {
      const next: PermissionsMap = { ...prev };
      const existing = next[pageKey] !== undefined ? migratePermission(next[pageKey]) : null;
      const entry: PagePermission = existing ?? { level: inheritedLevel(pageKey), actions: {} };
      mutate(entry);
      const hasActions = entry.actions && Object.keys(entry.actions).length > 0;
      const hasSections = entry.sections && Object.keys(entry.sections).length > 0;
      const hasScope = entry.scope !== undefined;
      // Minimal-override cleanup: an entry that only restates the
      // inherited level with no facet of its own IS pure inherit.
      if (entry.level === inheritedLevel(pageKey) && !hasActions && !hasSections && !hasScope) {
        delete next[pageKey];
      } else {
        // Normalized shape — no empty facet objects, so the structural
        // change preview never sees phantom differences.
        const clean: PagePermission = { level: entry.level };
        if (hasActions) clean.actions = entry.actions;
        if (hasSections) clean.sections = entry.sections;
        if (hasScope) clean.scope = entry.scope;
        next[pageKey] = clean;
      }
      return next;
    });
  };

  const onSetLevel = (pageKey: string, choice: LevelChoice) =>
    mutateEntry(pageKey, (entry) => { entry.level = choice === 'inherit' ? inheritedLevel(pageKey) : choice; });

  const onSetAction = (pageKey: string, action: ActionKey, choice: TriChoice) =>
    mutateEntry(pageKey, (entry) => {
      const actions = { ...(entry.actions ?? {}) };
      if (choice === 'inherit') delete actions[action];
      else actions[action] = choice === 'allow';
      entry.actions = actions;
    });

  const onSetScope = (pageKey: string, scope: DataScope | 'inherit') =>
    mutateEntry(pageKey, (entry) => {
      if (scope === 'inherit') delete entry.scope;
      else entry.scope = scope;
    });

  const onSetSection = (pageKey: string, sectionId: string, level: LevelChoice) =>
    mutateEntry(pageKey, (entry) => {
      const sections = { ...(entry.sections ?? {}) };
      if (level === 'inherit') delete sections[sectionId];
      else sections[sectionId] = level;
      entry.sections = sections;
    });

  // ── change preview: STRUCTURAL diff (level AND scope/action/section facets) ──
  interface PendingChange { pageKey: string; label: string }
  const pendingChanges = useMemo<PendingChange[]>(() => {
    const keys = new Set([...Object.keys(savedOverrides ?? {}), ...Object.keys(draft)]);
    const out: PendingChange[] = [];
    for (const k of keys) {
      const before = savedOverrides[k];
      const after = draft[k];
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
      const title = pageTitle(k);
      const beforeLevel = before !== undefined ? migratePermission(before).level : null;
      const afterLevel = after !== undefined ? migratePermission(after).level : null;
      if (before === undefined) {
        out.push({ pageKey: k, label: `${title}: تجاوز جديد (${afterLevel ? LEVEL_LABELS[afterLevel] : '—'})` });
      } else if (after === undefined) {
        out.push({ pageKey: k, label: `${title}: إزالة التجاوز (عودة لقيمة الدور/الوظيفة)` });
      } else if (beforeLevel !== afterLevel && beforeLevel && afterLevel) {
        out.push({ pageKey: k, label: `${title}: ${LEVEL_LABELS[beforeLevel]} → ${LEVEL_LABELS[afterLevel]}` });
      } else {
        out.push({ pageKey: k, label: `${title}: تعديل تفاصيل النطاق/الإجراءات` });
      }
    }
    return out.sort((x, y) => x.label.localeCompare(y.label, 'ar'));
  }, [savedOverrides, draft]);
  const dirty = pendingChanges.length > 0;
  // §ORG-BOUNDARY dirty tracking — independent of the page-override diff.
  const boundaryDirty = useMemo(
    () => JSON.stringify(boundaryDraft ?? null) !== JSON.stringify(savedBoundary ?? null),
    [boundaryDraft, savedBoundary],
  );

  const toggleBoundaryNode = (nodeId: string) =>
    setBoundaryDraft((prev) => {
      const cur = prev ?? [];
      return cur.includes(nodeId) ? cur.filter((id) => id !== nodeId) : [...cur, nodeId];
    });

  const save = async () => {
    if (!profile || (!dirty && !boundaryDirty)) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { permissions: draft };
      // undefined = untouched (the server keeps the stored value).
      if (boundaryDirty) body.orgBoundaryNodeIds = boundaryDraft;
      const res = await authFetch(`/api/dashboard/users/${profile.identity.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || 'فشل حفظ الصلاحيات');
      toast.success('تم الحفظ (مسجّل في سجل التدقيق)');
      setSavedOverrides(structuredClone(draft));
      setSavedBoundary(boundaryDraft);
      onSaved();
      await loadProfile(profile.identity.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشل حفظ الصلاحيات');
    } finally {
      setSaving(false);
    }
  };

  // ── grouped pages for the accordion ───────────────────────────
  const groupedPages = useMemo(() => {
    if (!profile) return [];
    const byGroup = new Map<string, typeof profile.authorization.pages>();
    for (const page of profile.authorization.pages) {
      const bucket = byGroup.get(page.groupId) ?? [];
      bucket.push(page);
      byGroup.set(page.groupId, bucket);
    }
    // Registry order for groups, then page order.
    return SIDEBAR_GROUPS
      .filter((g) => byGroup.has(g.id))
      .map((g) => ({ group: g, pages: byGroup.get(g.id)! }))
      .concat(
        [...byGroup.keys()]
          .filter((id) => !SIDEBAR_GROUPS.some((g) => g.id === id))
          .map((id) => ({ group: { id, label: id, labelEn: id, emoji: '•' }, pages: byGroup.get(id)! })),
      );
  }, [profile]);

  // ── render ────────────────────────────────────────────────────
  // §UX-STRUCTURE PART 7 — the console is a BOUNDED workspace: the
  // user-list column is pinned BELOW the sticky app header (h-12 +
  // hairline ≈ top-16) and both columns keep the page itself short.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4 items-start">
      {/* ═══ USER LIST ═══ */}
      <div className="space-y-3 xl:sticky xl:top-16">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="بحث بالاسم، البريد، الكود…"
            className="bg-slate-800/60 border-slate-700/50 text-white ps-10 h-10"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => setFilter('search', '')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filters — persisted; collapse behind a toggle to keep the console calm */}
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
              <Filter className="size-3" /> فلاتر
            </span>
            {filtersActive && (
              <button type="button" onClick={() => resetFilters()} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
                <RotateCcw className="size-3" /> مسح
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect value={filters.role} onChange={(v) => setFilter('role', v)} placeholder="نوع الحساب"
              options={[['all', 'كل الأنواع'], ['admin', 'مالك النظام'], ['hr', 'موارد بشرية'], ['manager', 'مدير'], ['quality', 'جودة'], ['user', 'مستخدم']]} />
            <FilterSelect value={filters.status} onChange={(v) => setFilter('status', v)} placeholder="الحالة"
              options={[['all', 'كل الحالات'], ['active', 'نشط'], ['suspended', 'معلّق']]} />
            <FilterSelect value={filters.position} onChange={(v) => setFilter('position', v)} placeholder="الوظيفة"
              options={[['all', 'كل الوظائف'], ...positions.map((p) => [p, p] as [string, string])]} />
            <FilterSelect value={filters.overrides} onChange={(v) => setFilter('overrides', v)} placeholder="التجاوزات"
              options={[['all', 'كل المستخدمين'], ['with', 'لديه تجاوزات'], ['without', 'بدون تجاوزات']]} />
            <FilterSelect value={filters.department} onChange={(v) => setFilter('department', v)} placeholder="القسم"
              options={[['all', 'كل الأقسام'], ...departments.map((d) => [d, d] as [string, string])]} />
            <FilterSelect value={filters.team} onChange={(v) => setFilter('team', v)} placeholder="الفريق"
              options={[['all', 'كل الفرق'], ...teams.map((t) => [t, t] as [string, string])]} />
          </div>
        </div>

        <ScrollArea className="max-h-[58vh] rounded-xl border border-slate-700/40 bg-slate-800/30">
          <div className="p-1.5 space-y-1">
            {filteredUsers.length === 0 && (
              <p className="text-center text-xs text-slate-500 py-8">لا يوجد مستخدمون مطابقون للفلاتر</p>
            )}
            {filteredUsers.map((u) => {
              const selected = u.id === selectedUserId;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelectUser(u)}
                  className={cn(
                    'w-full text-start rounded-lg px-2.5 py-2 transition-colors border',
                    selected
                      ? 'bg-brand-600/15 border-brand-600/50'
                      : 'bg-slate-900/30 border-transparent hover:bg-slate-900/60 hover:border-slate-700/50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'size-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white bg-gradient-to-br',
                      avatarGradientFor(u.name || u.email || u.id),
                    )}>
                      {(u.name || u.email || '?').trim().charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-slate-100 truncate">{u.name || u.email}</span>
                        {u.hasOverrides && (
                          <span className="size-1.5 rounded-full bg-amber-400 shrink-0" title="لديه تجاوزات مباشرة" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="outline" className={cn('text-[9px] border px-1', ROLE_CHIP[u.role] ?? ROLE_CHIP.user)}>
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                        {u.linkedEmployeeCode && <span className="text-[9px] text-slate-500">#{u.linkedEmployeeCode}</span>}
                        {u.isSuspended && (
                          <Badge variant="outline" className="text-[9px] border-brand-500/50 text-brand-300 px-1">معلّق</Badge>
                        )}
                      </div>
                      {(u.positionTitle || u.department) && (
                        <p className="text-[9px] text-slate-500 mt-0.5 truncate">
                          {[u.positionTitle, u.department, u.team].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ═══ AUTHORIZATION PROFILE ═══
          §PART 7 — the details/edit column is ITS OWN bounded scroll
          region on xl (the workspace must not stretch the page); the
          sticky change bar rides the column's scrollport. */}
      <div className="space-y-3 min-w-0 arm-scroll xl:max-h-[calc(100vh-5.5rem)] xl:pe-1">
        {!selectedUserId ? (
          <EmptyState
            icon={<UserIcon className="size-12 text-slate-600" />}
            title="اختر مستخدماً لعرض صلاحياته الفعلية"
            subtitle="سلسلة المصادر، النطاق، الأقسام، والإجراءات — كلها من المحلّم القانوني للصلاحيات"
          />
        ) : !profileReady ? (
          profileError ? (
            <EmptyState icon={<ShieldBan className="size-12 text-brand-500/60" />} title={profileError} subtitle="تأكد من صلاحياتك ثم أعد المحاولة" />
          ) : (
            <div className="flex items-center justify-center gap-2 py-24 text-slate-400">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">جاري تحميل ملف الصلاحيات…</span>
            </div>
          )
        ) : profile ? (
          <>
            {/* ── identity header (clearly separated from authorization) ── */}
            <div className="rounded-xl border border-slate-700/40 bg-slate-800/40 p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <span className={cn(
                  'size-12 rounded-full flex items-center justify-center text-base font-bold text-white bg-gradient-to-br shrink-0',
                  avatarGradientFor(profile.identity.name || profile.identity.email || profile.identity.id),
                )}>
                  {(profile.identity.name || profile.identity.email || '?').trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-white">{profile.identity.name || profile.identity.email}</h3>
                    <Badge variant="outline" className={cn('text-[10px] border', ROLE_CHIP[profile.identity.role] ?? ROLE_CHIP.user)}>
                      {ROLE_LABELS[profile.identity.role] ?? profile.identity.role}
                    </Badge>
                    {profile.identity.isSuspended ? (
                      <Badge variant="outline" className="text-[10px] border-brand-500/50 text-brand-300 bg-brand-500/10">الحساب معلّق</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10">الحساب نشط</Badge>
                    )}
                  </div>
                  {/* IDENTITY data */}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    {profile.identity.email && <span>{profile.identity.email}</span>}
                    {profile.identity.linkedEmployeeCode && <span>كود الموظف: #{profile.identity.linkedEmployeeCode}</span>}
                    {profile.identity.positionTitle && <span className="flex items-center gap-1"><BadgeCheck className="size-3 text-slate-500" />{profile.identity.positionTitle}</span>}
                  </div>
                  {/* ORGANIZATION assignment (canonical tree data) */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {profile.organization.department && (
                      <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-300 gap-1">
                        <Building2 className="size-2.5 text-slate-500" /> {profile.organization.department}
                      </Badge>
                    )}
                    {profile.organization.team && (
                      <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-300">{profile.organization.team}</Badge>
                    )}
                    {profile.organization.managedBranches.map((b) => (
                      <Badge key={b.id} variant="outline" className="text-[10px] border-brand-600/40 text-brand-300 bg-brand-600/10 gap-1">
                        <GitCompare className="size-2.5" /> يدير: {b.name}
                      </Badge>
                    ))}
                    {!profile.organization.resolvable && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-300 bg-amber-500/10">
                        لا يوجد توطين تنظيمي — النطاقات تنحصر في سجله الشخصي
                      </Badge>
                    )}
                  </div>
                </div>
                {targetIsSelf && (
                  <Badge variant="outline" className="text-[10px] border-brand-500/50 text-brand-300 bg-brand-500/10 gap-1">
                    <Lock className="size-3" /> حسابك — التعديل على نفسك غير متاح
                  </Badge>
                )}
              </div>
            </div>

            {/* ── §ORG-BOUNDARY — Access Location card (WHERE), kept
                    deliberately SEPARATE from the scope axis (HOW MUCH)
                    and from page access (WHAT) below ── */}
            <div className="rounded-xl border border-slate-700/40 bg-slate-800/40 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-brand-400" />
                    موقع الوصول التنظيمي (الحد) — أين تُطبَّق الصلاحيات
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(() => {
                      const source = boundaryDraft && boundaryDraft.length > 0
                        ? 'override' as const
                        : profile.organization.boundary.source;
                      const nodes = boundaryDraft && boundaryDraft.length > 0
                        ? boundaryDraft
                            .map((id) => profile.organization.availableNodes.find((n) => n.id === id))
                            .filter((n): n is NonNullable<typeof n> => Boolean(n))
                            .map((n) => ({ id: n.id, name: n.name, label: orgNodeTypeLabel(n.type as OrgNodeType, 'ar') }))
                        : profile.organization.boundary.nodes.map((n) => ({
                            id: n.id, name: n.name,
                            label: n.level === 'general_administration' ? 'الإدارة العامة'
                              : n.level === 'company' ? 'شركة' : n.level === 'department' ? 'قسم'
                              : n.level === 'team' ? 'فريق' : 'فريق فرعي',
                          }));
                      if (nodes.length === 0) {
                        return (
                          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-300 bg-amber-500/10">
                            لا حد تنظيمي محلول — الوصول مقيد (سجله الشخصي فقط)
                          </Badge>
                        );
                      }
                      return nodes.map((n) => (
                        <Badge key={n.id} variant="outline" className="text-[10px] border-brand-600/40 text-brand-200 bg-brand-600/10 gap-1">
                          <Landmark className="size-2.5" />
                          {n.name}
                          <span className="text-[8px] text-slate-400">({n.label})</span>
                        </Badge>
                      ));
                    })()}
                    <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-400">
                      المصدر: {boundaryDraft && boundaryDraft.length > 0
                        ? describeBoundarySource('override')
                        : describeBoundarySource(profile.organization.boundary.source)}
                    </Badge>
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1.5 leading-snug max-w-xl">
                    «تلقائي — من التعيين التنظيمي» يشتق الحد من الفروع المُدارة و/أو عقدة الموظف المرتبط في الشجرة.
                    تحديد عقدة/عقد صراحةً (شركة، أو الإدارة العامة) يثبّت الحد عليها — ويجوز اختيار أكثر من شركة لحساب واحد.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {boundaryDirty && (
                    <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-300 bg-amber-500/10">
                      تغيير غير محفوظ
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!editable}
                    onClick={() => setBoundaryPickerOpen((v) => !v)}
                    className="text-xs h-8 border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <MapPin className="size-3.5" /> تعديل الحد
                  </Button>
                </div>
              </div>
              {boundaryPickerOpen && editable && (
                <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-slate-400 font-medium">حدد عقدة أو أكثر (من الشجرة التنظيمية الرسمية فقط)</p>
                    <button
                      type="button"
                      onClick={() => setBoundaryDraft(null)}
                      className="text-[10px] text-brand-400 hover:text-brand-300"
                    >
                      تلقائي — من التعيين التنظيمي
                    </button>
                  </div>
                  <div className="arm-scroll max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1">
                    {profile.organization.availableNodes.map((n) => {
                      const checked = boundaryDraft?.includes(n.id) ?? false;
                      return (
                        <label
                          key={n.id}
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer text-[11px]',
                            checked ? 'border-brand-600/50 bg-brand-600/10 text-brand-200' : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBoundaryNode(n.id)}
                            className="accent-brand-500"
                          />
                          <span className="truncate" title={n.name}>{n.name}</span>
                          <span className="text-[8px] text-slate-500 shrink-0">{orgNodeTypeLabel(n.type as OrgNodeType, 'ar')}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── derivation legend — how the effective result is composed ── */}
            <div className="rounded-xl border border-slate-700/40 bg-slate-800/25 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span className="font-semibold text-slate-400">كيف تُشتق الصلاحية:</span>
              <span>الدور الأساسي ← قالب الوظيفة ← التجاوز المباشر ← <span className="text-slate-300">النتيجة الفعلية</span></span>
              <span className="text-slate-600">|</span>
              <span>«تلقائي» = لا تجاوز مباشر — تُطبَّق قيمة الدور أو الوظيفة</span>
              <span className="text-slate-600">|</span>
              <span className="flex items-center gap-1"><MapPin className="size-2.5 text-brand-400" /> الحد التنظيمي (أين) ونطاق البيانات (كم) محوران منفصلان — الحد يقيّد كل النطاقات</span>
              <span className="text-slate-600">|</span>
              <span>«الكل» يعني: كل السجلات المسموح بها داخل الحد التنظيمي — لا أكثر</span>
              <span className="text-slate-600">|</span>
              <span>الرفض الصريح المتجاوز يعلو أي منح من الدور أو الوظيفة</span>
              {profile.authorization.hasOverrides && (
                <>
                  <span className="text-slate-600">|</span>
                  <span className="text-amber-400/90">هذا المستخدم لديه تجاوزات مباشرة محفوظة</span>
                </>
              )}
            </div>

            {/* ── pages accordion, grouped by sidebar section ── */}
            <div className="space-y-4">
              {groupedPages.map(({ group, pages }) => (
                <div key={group.id}>
                  <p className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
                    <span aria-hidden>{group.emoji}</span>
                    {localizedGroupLabel(group.id, 'ar')}
                  </p>
                  <div className="space-y-1.5">
                    {pages.map((page) => (
                      <PageAccessRow
                        key={page.pageKey}
                        page={page}
                        profile={profile}
                        draft={draft}
                        handlers={{ onSetLevel, onSetAction, onSetScope, onSetSection }}
                        expanded={expandedPage === page.pageKey}
                        onToggle={() => setExpandedPage((cur) => (cur === page.pageKey ? null : page.pageKey))}
                        editable={editable}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── change bar: exact diff + save/reset ── */}
            <div className={cn(
              'sticky bottom-3 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 backdrop-blur-md transition-colors',
              dirty ? 'border-amber-500/40 bg-slate-900/90' : 'border-slate-700/40 bg-slate-900/70',
            )}>
              <div className="flex-1 min-w-0">
                {dirty || boundaryDirty ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                      <GitCompare className="size-3" /> {pendingChanges.length + (boundaryDirty ? 1 : 0)} تغيير جاهز للحفظ:
                    </span>
                    {boundaryDirty && (
                      <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-300">
                        الحد التنظيمي: {(boundaryDraft?.length ?? 0) > 0 ? `${boundaryDraft!.length} عقدة محددة` : 'تلقائي — من التعيين التنظيمي'}
                      </Badge>
                    )}
                    {pendingChanges.slice(0, 6).map((c) => (
                      <Badge key={c.pageKey} variant="outline" className="text-[9px] border-slate-700 text-slate-300">
                        {c.label}
                      </Badge>
                    ))}
                    {pendingChanges.length > 6 && (
                      <span className="text-[9px] text-slate-500">+{pendingChanges.length - 6} …</span>
                    )}
                    <span className="text-[9px] text-slate-500 w-full">
                      يُحفظ كتجاوز مباشر فقط — تُسجّل كل تغييرات في سجل تدقيق الإعدادات مع القيم قبل/بعد.
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500">لا توجد تغييرات — ما تعرضه هو الصلاحيات الفعلية المحفوظة.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(structuredClone(savedOverrides));
                    setBoundaryDraft(savedBoundary);
                  }}
                  disabled={(!dirty && !boundaryDirty) || saving}
                  className="text-xs h-8 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <RotateCcw className="size-3.5" /> تراجع
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={(!dirty && !boundaryDirty) || saving || !editable}
                  className="bg-brand-600 hover:bg-brand-700 text-white text-xs h-8 gap-1.5"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  حفظ التجاوزات
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── small shared pieces ─────────────────────────────────────────

function FilterSelect({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<[string, string]>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-[10px] bg-slate-900/50 border-slate-700/50">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v} className="text-xs">{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 flex flex-col items-center justify-center py-24 px-6 text-center">
      {icon}
      <p className="text-slate-300 font-medium mt-3 text-sm">{title}</p>
      <p className="text-slate-500 text-xs mt-1 max-w-md leading-relaxed">{subtitle}</p>
    </div>
  );
}

function pageTitle(pageKey: string): string {
  const page = APP_PAGES.find((p) => p.permissionKey === pageKey);
  return page?.title ?? pageKey;
}
