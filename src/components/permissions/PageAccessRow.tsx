'use client';

// ══════════════════════════════════════════════════════════════
//  PageAccessRow — ONE page inside the Permission Manager console.
//
//  Renders the full authorization story for a single page:
//
//    collapsed:  title · effective level · DATA scope · source · override dot
//    expanded:   tier chain (Role → Position → Override) · access
//                level · DATA scope (+ source + resolved organization
//                context) · actions (tri-state) · sections
//                (tri-state) · field restrictions · canonical
//                explanation
//
//  EVERY displayed value comes from the canonical resolvers
//  (resolveEffectivePermissions / explainScopeSource /
//  resolveSectionAccess / resolveFieldAccess / canDoAction) applied
//  to the DRAFT override tier — the same functions the server
//  enforcement uses, so the preview can never diverge from what
//  saving will produce. The server remains authoritative.
//
//  §SCOPE-SOURCE (display = enforcement): a page's employee-linked
//  DATA scope is governed by the ONE canonical data-scope entry
//  (DATA_SCOPE_PAGE_KEY — the Employees permission key), exactly as
//  the server resolves it for every API. The scope badge on every
//  row therefore shows THAT scope and its tier source — the UI can
//  never say OWN while the server applies TEAM. The scope EDITOR is
//  offered on the canonical entry only: a scope saved on any other
//  page's entry would be dead configuration the server ignores.
// ══════════════════════════════════════════════════════════════

import { useMemo, type ReactNode } from 'react';
import {
  AlertTriangle, Building2, ChevronDown, Dot, Eye, EyeOff, Layers, ShieldCheck, UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  canDoAction, DATA_SCOPE_PAGE_KEY, explainAuthorization, explainScopeSource,
  getActionLabel, migratePermission, resolveEffectivePermissions,
  resolveFieldAccess, resolveSectionAccess,
  type ActionKey, type DataScope, type PagePermission, type PermissionLevel,
  type PermissionsMap, type ScopeSource,
} from '@/config/permissions';
import { describeDataScope } from '@/lib/scope';
import type { AuthorizationProfile, ProfilePage } from './types';

// ── display vocabularies ────────────────────────────────────────

export const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: 'ممنوع',
  read: 'قراءة',
  edit: 'تحرير',
};

const LEVEL_CHIP: Record<PermissionLevel, string> = {
  none: 'bg-brand-500/15 text-brand-300 border-brand-500/40',
  read: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  edit: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

const SCOPE_OPTIONS: Array<{ value: DataScope; label: string }> = [
  { value: 'all', label: 'الكل (داخل الحد التنظيمي)' },
  { value: 'department', label: 'القسم المحدد' },
  { value: 'team', label: 'الفريق المحدد فقط' },
  { value: 'subtree', label: 'العقدة والفروع التابعة' },
  { value: 'assigned', label: 'المسند إليّ' },
  { value: 'own', label: 'سجلي فقط' },
];

const SOURCE_LABELS: Record<string, string> = {
  admin: 'مالك النظام',
  stored: 'تجاوز مباشر',
  position: 'قالب الوظيفة',
  role: 'الدور الأساسي',
  'default-deny': 'رفض افتراضي',
  'page-level': 'حسب مستوى الصفحة',
};

/** Scope-source vocabulary (§scope must show its source). */
const SCOPE_SOURCE_LABELS: Record<ScopeSource, string> = {
  admin: 'مالك النظام',
  stored: 'تجاوز مباشر',
  position: 'قالب الوظيفة',
  role: 'الدور الأساسي',
  'fail-closed': 'افتراضي مقيّد (بلا نطاق مُهيّأ)',
};

export type TriChoice = 'inherit' | 'allow' | 'deny';
export type LevelChoice = 'inherit' | PermissionLevel;

export interface PageRowHandlers {
  onSetLevel: (pageKey: string, choice: LevelChoice) => void;
  onSetAction: (pageKey: string, action: ActionKey, choice: TriChoice) => void;
  onSetScope: (pageKey: string, scope: DataScope | 'inherit') => void;
  onSetSection: (pageKey: string, sectionId: string, level: LevelChoice) => void;
}

interface PageAccessRowProps {
  page: ProfilePage;
  profile: AuthorizationProfile;
  /** The DRAFT override tier being edited (not yet saved). */
  draft: PermissionsMap;
  handlers: PageRowHandlers;
  expanded: boolean;
  onToggle: () => void;
  editable: boolean;
}

// ── small presentational atoms ──────────────────────────────────

function LevelChip({ level }: { level: PermissionLevel }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] border', LEVEL_CHIP[level])}>
      {LEVEL_LABELS[level]}
    </Badge>
  );
}

function TierCard({ label, level, note }: { label: string; level: PermissionLevel | null; note?: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/40 px-2.5 py-2">
      <p className="text-[10px] text-slate-500 font-medium truncate">{label}</p>
      {level === null ? (
        <p className="text-[11px] text-slate-600 mt-0.5">— لا يوجد إدخال</p>
      ) : (
        <div className="mt-0.5"><LevelChip level={level} /></div>
      )}
      {note && <p className="text-[9px] text-brand-400 mt-1 leading-snug">{note}</p>}
    </div>
  );
}

function TriSelect({
  value, onChange, disabled, allowLabel = 'مسموح',
}: {
  value: TriChoice;
  onChange: (c: TriChoice) => void;
  disabled?: boolean;
  allowLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TriChoice)} disabled={disabled}>
      <SelectTrigger
        title="«تلقائي» = لا تجاوز مباشر — تُطبَّق قيمة الدور الأساسي أو قالب الوظيفة"
        className="h-6 w-[86px] text-[10px] bg-slate-900/60 border-slate-700/60 px-2"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit" className="text-xs">تلقائي</SelectItem>
        <SelectItem value="allow" className="text-xs">{allowLabel}</SelectItem>
        <SelectItem value="deny" className="text-xs">ممنوع</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── the row ─────────────────────────────────────────────────────

export function PageAccessRow({ page, profile, draft, handlers, expanded, onToggle, editable }: PageAccessRowProps) {
  const { roleBaseline, positionTemplate } = profile.authorization;
  const role = profile.identity.role;
  const pageKey = page.pageKey;

  // Canonical preview: the effective result of the DRAFT overrides,
  // through the resolver itself (never re-implemented precedence).
  const preview = useMemo(
    () => resolveEffectivePermissions(role, draft, positionTemplate ?? undefined),
    [role, draft, positionTemplate],
  );
  const effLevel = migratePermission(preview[pageKey]).level;
  // §SCOPE-SOURCE — the DATA scope the SERVER enforces on employee-
  // linked records: always resolved from the ONE canonical data-scope
  // entry (DATA_SCOPE_PAGE_KEY), never from this row's own key, and
  // always WITH its tier source. The draft feeds the preview, so what
  // the administrator sees is exactly what saving will enforce.
  const canonicalScope = useMemo(
    () => explainScopeSource(role, draft, DATA_SCOPE_PAGE_KEY, positionTemplate ?? undefined),
    [role, draft, positionTemplate],
  );
  const effScope = canonicalScope.scope;
  const effScopeSource = canonicalScope.source;
  // What "تلقائي" (no direct scope override) would resolve to — the
  // role/position tiers below the override, for the select's label.
  const inheritScopePreview = useMemo(() => {
    if (!(DATA_SCOPE_PAGE_KEY in draft)) return canonicalScope.scope;
    const withoutPage = { ...draft };
    delete withoutPage[DATA_SCOPE_PAGE_KEY];
    return explainScopeSource(role, withoutPage, DATA_SCOPE_PAGE_KEY, positionTemplate ?? undefined).scope;
  }, [role, draft, positionTemplate, canonicalScope.scope]);
  // Live canonical explanation of the DRAFT — same function the
  // server reports through; identical to page.explanation when the
  // draft is unmodified.
  const liveExplanation = useMemo(
    () => explainAuthorization(role, draft, pageKey, positionTemplate ?? undefined),
    [role, draft, pageKey, positionTemplate],
  );

  // Scope resolution honesty: a people scope without any organization
  // placement resolves restricted — show it, never fake ALL.
  const peopleScope = effScope !== 'all' && effScope !== 'own';
  const scopeUnresolved =
    (peopleScope && !profile.organization.resolvable) ||
    (effScope === 'own' && !profile.identity.linkedEmployeeId);

  const isDataScopeRow = pageKey === DATA_SCOPE_PAGE_KEY;

  // Tier values (raw, for the transparency chain). The override tier
  // reflects the LIVE draft — what saving will actually store.
  const roleLevel = migratePermission(roleBaseline[pageKey]).level;
  const positionLevel = positionTemplate && pageKey in positionTemplate
    ? migratePermission(positionTemplate[pageKey]).level
    : null;
  const draftHasEntry = pageKey in draft;
  const draftEntry: PagePermission | null = draftHasEntry ? migratePermission(draft[pageKey]) : null;
  const draftLevel = draftHasEntry ? draftEntry!.level : null;

  // Conflict: a direct override denies something an inherited tier granted.
  const conflict = draftLevel === 'none' && (roleLevel !== 'none' || positionLevel !== 'none');
  const actionConflict = page.availableActions.some((a) => {
    const deniedInDraft = draftHasEntry && draftEntry!.actions?.[a] === false;
    const grantedAbove =
      (positionLevel === 'edit' && positionTemplate && migratePermission(positionTemplate[pageKey]).actions?.[a] === true) ||
      (roleLevel === 'edit' && migratePermission(roleBaseline[pageKey]).actions?.[a] === true);
    return deniedInDraft && grantedAbove;
  });

  const currentDraftAction = (a: ActionKey): TriChoice => {
    const flag = draftEntry?.actions?.[a];
    return flag === true ? 'allow' : flag === false ? 'deny' : 'inherit';
  };
  const currentDraftSection = (id: string): LevelChoice => {
    const v = draftEntry?.sections?.[id];
    return v === 'none' || v === 'read' || v === 'edit' ? v : 'inherit';
  };

  const scopeContext = buildScopeContext(effScope, profile, scopeUnresolved);

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      expanded ? 'border-brand-600/40 bg-slate-800/50' : 'border-slate-700/40 bg-slate-800/25 hover:border-slate-600/50',
    )}>
      {/* ── collapsed header row ── */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-start"
      >
        <ChevronDown className={cn('size-4 text-slate-500 shrink-0 transition-transform', expanded && 'rotate-180')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-slate-100 truncate">
              {page.title}
              {page.titleEn && <span className="text-[10px] text-slate-500 font-normal ms-1.5">{page.titleEn}</span>}
            </span>
            {page.pageIds.length > 1 && (
              <Badge variant="outline" className="text-[9px] text-slate-500 border-slate-700">{page.pageIds.length} صفحات</Badge>
            )}
            {(conflict || actionConflict) && (
              <Badge variant="outline" className="text-[9px] border-brand-500/50 text-brand-300 bg-brand-500/10 gap-0.5">
                <AlertTriangle className="size-2.5" /> تعارض
              </Badge>
            )}
            {draft[pageKey] !== undefined && (
              <span className="inline-flex items-center text-[9px] text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-full px-1.5">
                <Dot className="size-3" /> تجاوز مباشر
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <LevelChip level={effLevel} />
          <Badge
            variant="outline"
            title="نطاق البيانات المُطبَّق من الخادم على سجلات الموظفين (من إدخال صفحة الموظفين)"
            className="text-[10px] border-slate-700 text-slate-300 bg-slate-900/50 gap-1"
          >
            <Layers className="size-2.5 text-slate-500" />
            {describeDataScope(effScope)}
          </Badge>
          <Badge
            variant="outline"
            title={`مصدر المستوى: ${SOURCE_LABELS[liveExplanation.winner] ?? ''} · مصدر النطاق: ${SCOPE_SOURCE_LABELS[effScopeSource]}`}
            className="text-[9px] border-slate-700/60 text-slate-400 hidden sm:inline-flex"
          >
            {SOURCE_LABELS[liveExplanation.winner] ?? liveExplanation.winner}
          </Badge>
        </div>
      </button>

      {/* ── expanded editor ── */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-700/40 pt-3">
          {/* Tier chain — where the value comes from */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <Layers className="size-3" /> سلسلة المصادر — الدور ← الوظيفة ← التجاوز المباشر
            </p>
            <div className="flex gap-2">
              <TierCard label="الدور الأساسي" level={roleLevel} />
              <TierCard
                label={profile.identity.positionTitle ? `الوظيفة: ${profile.identity.positionTitle}` : 'قالب الوظيفة'}
                level={positionLevel}
              />
              <TierCard
                label="التجاوز المباشر"
                level={draftLevel}
                note={conflict ? 'هذا الرفض المباشر يقيد صلاحية الدور/الوظيفة' : undefined}
              />
              <div className="flex-1 min-w-0 rounded-lg border border-brand-600/40 bg-brand-600/10 px-2.5 py-2">
                <p className="text-[10px] text-brand-300 font-medium">النتيجة الفعلية</p>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <LevelChip level={effLevel} />
                  <span className="text-[9px] text-slate-400">المستوى: {SOURCE_LABELS[liveExplanation.winner] ?? ''}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-300 bg-slate-900/50">
                    {describeDataScope(effScope)}
                  </Badge>
                  <span className="text-[9px] text-slate-400">النطاق: {SCOPE_SOURCE_LABELS[effScopeSource]}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Access level */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Eye className="size-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-400 font-medium">الوصول:</span>
              <Select
                value={draftEntry ? draftEntry.level : 'inherit'}
                onValueChange={(v) => handlers.onSetLevel(pageKey, v as LevelChoice)}
                disabled={!editable}
              >
                <SelectTrigger className="h-7 w-32 text-[11px] bg-slate-900/60 border-slate-700/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit" className="text-xs">
                    تلقائي — من الدور/الوظيفة ({LEVEL_LABELS[positionLevel ?? roleLevel]})
                  </SelectItem>
                  <SelectItem value="none" className="text-xs">ممنوع</SelectItem>
                  <SelectItem value="read" className="text-xs">قراءة</SelectItem>
                  <SelectItem value="edit" className="text-xs">تحرير</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Scope — separate axis from the level. §SCOPE-SOURCE: the
                EDITOR exists only on the canonical data-scope entry
                (Employees) — the one the server reads. Every row
                displays the SAME enforced scope + its tier source. */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Building2 className="size-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-400 font-medium">النطاق:</span>
              {isDataScopeRow ? (
                <Select
                  value={draftEntry?.scope ?? 'inherit'}
                  onValueChange={(v) => handlers.onSetScope(pageKey, v as DataScope | 'inherit')}
                  disabled={!editable}
                >
                  <SelectTrigger className="h-7 w-36 text-[11px] bg-slate-900/60 border-slate-700/60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit" className="text-xs">
                      تلقائي — من الدور/الوظيفة{inheritScopePreview ? ` (${describeDataScope(inheritScopePreview)})` : ''}
                    </SelectItem>
                    {SCOPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-[10px] text-slate-500">
                  يُدار من إدخال صفحة «الموظفين» — يُعدَّل من صفّ الموظفين
                </span>
              )}
              <Badge variant="outline" className={cn(
                'text-[10px] border',
                scopeUnresolved
                  ? 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                  : 'border-slate-700 text-slate-300 bg-slate-900/50',
              )}>
                {describeDataScope(effScope)}{scopeUnresolved ? ' — مقيد' : ''}
              </Badge>
              <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-400">
                مصدر النطاق: {SCOPE_SOURCE_LABELS[effScopeSource]}
              </Badge>
            </div>
            <p className="text-[9px] text-slate-500 leading-snug">
              «تلقائي» تعني: لا يوجد تجاوز مباشر لهذا الإعداد — تُطبَّق القيمة القادمة من الدور الأساسي أو قالب الوظيفة.
              نطاق البيانات الموضح هو نفسه الذي يطبّقه الخادم على سجلات الموظفين في كل الصفحات.
            </p>
          </div>

          {/* Resolved organization context for the scope */}
          <div className="rounded-lg bg-slate-900/50 border border-slate-700/40 px-3 py-2">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">السياق التنظيمي المحلول</p>
            {scopeContext}
          </div>

          {/* Actions — independently controllable; edit level never implies destructive grants */}
          {page.availableActions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                <ShieldCheck className="size-3" /> الإجراءات — كل إجراء يُمنح ويُمنع بشكل مستقل
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                {page.availableActions.map((action) => {
                  const allowed = canDoAction(preview, pageKey, action, role);
                  const choice = currentDraftAction(action);
                  const actionBlocked = effLevel !== 'edit';
                  return (
                    <div
                      key={action}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                        actionBlocked ? 'border-slate-800 bg-slate-900/30 opacity-60' : 'border-slate-700/50 bg-slate-900/40',
                      )}
                    >
                      <span className={cn('size-1.5 rounded-full shrink-0', allowed ? 'bg-emerald-400' : 'bg-brand-500')} />
                      <span className="text-[11px] text-slate-200 flex-1 truncate">{getActionLabel(action)}</span>
                      {choice === 'allow' && <span className="text-[9px] text-emerald-400">✓ ممنوح</span>}
                      {choice === 'deny' && <span className="text-[9px] text-brand-400">✗ ممنوع</span>}
                      <TriSelect
                        value={choice}
                        onChange={(c) => handlers.onSetAction(pageKey, action, c)}
                        disabled={!editable || actionBlocked}
                      />
                    </div>
                  );
                })}
              </div>
              {effLevel !== 'edit' && (
                <p className="text-[9px] text-slate-500 mt-1">
                  الإجراءات تعمل فقط مع مستوى تحرير — مستوى القراءة لا يمنح أي إجراء.
                </p>
              )}
            </div>
          )}

          {/* Sections — page is not a monolith */}
          {page.sections.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                <UserCog className="size-3" /> الأقسام داخل الصفحة
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {page.sections.map((section) => {
                  const level = resolveSectionAccess(preview, pageKey, section.id);
                  const choice = currentDraftSection(section.id);
                  return (
                    <div key={section.id} className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-2.5 py-1.5">
                      <span className={cn('size-1.5 rounded-full shrink-0', level === 'none' ? 'bg-brand-500' : 'bg-emerald-400')} />
                      <span className="text-[11px] text-slate-200 flex-1 truncate">{section.title}</span>
                      <LevelChip level={level} />
                      <Select
                        value={choice}
                        onValueChange={(v) => handlers.onSetSection(pageKey, section.id, v as LevelChoice)}
                        disabled={!editable}
                      >
                        <SelectTrigger className="h-6 w-[86px] text-[10px] bg-slate-900/60 border-slate-700/60 px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit" className="text-xs">تلقائي</SelectItem>
                          <SelectItem value="none" className="text-xs">ممنوع</SelectItem>
                          <SelectItem value="read" className="text-xs">قراءة</SelectItem>
                          <SelectItem value="edit" className="text-xs">تحرير</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Field restrictions — viewer of the canonical rules, never the author */}
          {page.sensitiveFields.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                <EyeOff className="size-3" /> الحقول الحساسة (مشتقة من مستوى الصفحة)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {page.sensitiveFields.map((field) => {
                  const access = resolveFieldAccess(preview, pageKey, field);
                  return (
                    <Badge key={field} variant="outline" className={cn(
                      'text-[10px] border gap-1',
                      access === 'hidden' ? 'border-brand-500/40 text-brand-300 bg-brand-500/10'
                        : access === 'read-only' ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                        : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
                    )}>
                      <code className="text-[9px]">{field}</code>
                      {access === 'hidden' ? 'مخفي' : access === 'read-only' ? 'قراءة فقط' : 'قابل للتحرير'}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Canonical explanation footer (live — recomputed from the draft) */}
          <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-3 py-2">
            <p className="text-[10px] text-slate-400 leading-relaxed">{liveExplanation.reason}</p>
            {conflict && (
              <p className="text-[10px] text-brand-300 mt-1">
                التجاوز المباشر يسبق صلاحيات الدور والوظيفة — الرفض الصريح يعلو أي منح من الدور أو الوظيفة.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── scope context builder (presentation over server-provided facts) ──
//
// Describes the CANONICAL WHERE × HOW-MUCH model (§ORG-BOUNDARY):
// the boundary (server-resolved: override / assignment / admin /
// unresolved) says WHERE; the scope says HOW MUCH inside it. The
// same semantics the engine enforces:
//   team       → DIRECT members of the exact team/subteam boundary
//                node — never the parent team, siblings or subteams
//   department → the department boundary node's full membership
//                (its teams/subteams belong to it per the tree)
//   subtree    → the boundary node + ALL descendants
//   all        → everything inside the boundary — no further
//                narrowing; never "ignore the boundary"

function buildScopeContext(
  scope: DataScope,
  profile: AuthorizationProfile,
  unresolved: boolean,
): ReactNode {
  const org = profile.organization;
  const identity = profile.identity;
  const boundary = org.boundary;
  const boundaryLabel = boundary.nodes.length > 0
    ? boundary.nodes.map((n) => n.name).join('، ')
    : null;

  if (scope === 'all') {
    if (boundary.source === 'unresolved' || boundary.nodes.length === 0) {
      return (
        <p className="text-[11px] text-amber-300">
          «الكل» تعني كل السجلات داخل الحد التنظيمي — لكنه تعذر الحل (لا تعيين تنظيمي ولا تجاوز)،
          فالنطاق يبقى مقيداً بسجله الشخصي ولن يتوسع تلقائياً. حدّد الحد من بطاقة «موقع الوصول التنظيمي».
        </p>
      );
    }
    return (
      <p className="text-[11px] text-slate-300">
        كل السجلات المسموح بها داخل الحد التنظيمي فقط{boundaryLabel ? ` (${boundaryLabel})` : ''} — لا تضييق إضافي، ولا خروج عن الحد أبداً.
      </p>
    );
  }
  if (scope === 'assigned') {
    return <p className="text-[11px] text-slate-300">السجلات المسندة صراحةً إلى هذا المستخدم (المتابعات المسندة وحالات الكابا) + سجله الشخصي.</p>;
  }
  if (scope === 'own') {
    return identity.linkedEmployeeId
      ? <p className="text-[11px] text-slate-300">سجل الموظف المرتبط بهذا الحساب فقط ({identity.linkedEmployeeName ?? identity.linkedEmployeeCode ?? identity.linkedEmployeeId}) — ولا شيء غيره.</p>
      : <p className="text-[11px] text-amber-300">تعذر الحل — لا يوجد موظف مرتبط بهذا الحساب؛ النطاق يبقى فارغاً (مقيد) ولا يتوسع تلقائياً إلى الفريق أو القسم.</p>;
  }

  if (unresolved) {
    return (
      <p className="text-[11px] text-amber-300">
        تعذر حل النطاق التنظيمي — لا يوجد موظف مرتبط ولا فروع مُدارة. الوصول يبقى مقيداً (سجله الشخصي فقط) ولن يتوسع تلقائياً.
      </p>
    );
  }

  if (scope === 'team') {
    return (
      <p className="text-[11px] text-slate-300">
        أعضاء العقدة المحددة في الحد التنظيمي بالضبط{boundaryLabel ? ` (${boundaryLabel})` : ''} — أعضاؤها المباشرون فقط،
        دون الفرق الفرعية التابعة لها أو الفريق الأب أو الفرق الشقيقة (لعرض الفروع التابعة استخدم «العقدة والفروع التابعة»).
      </p>
    );
  }
  if (scope === 'department') {
    return (
      <p className="text-[11px] text-slate-300">
        عضوية القسم المحدد في الحد التنظيمي وفق الشجرة{boundaryLabel ? ` (${boundaryLabel})` : ''} — القسم وأعضاء فرقه وفرقه الفرعية،
        دون الأقسام الشقيقة أو الشركات الأخرى.
      </p>
    );
  }
  // subtree — the boundary node + all descendants
  return (
    <p className="text-[11px] text-slate-300">
      العقدة المحددة في الحد التنظيمي وجميع أبنائها{boundaryLabel ? ` (${boundaryLabel})` : ''}.
    </p>
  );
}
