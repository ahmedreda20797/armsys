'use client';

// ══════════════════════════════════════════════════════════════
//  OrgAssignmentPicker — employee ↔ Organization Tree selector
//
//  The employee create/edit form's department/team fields. Selects
//  EXISTING Organization Tree nodes only — no arbitrary free-text:
//
//    القسم  [ قسم مراقبة الجودة ▼ ]   ← active department nodes
//    الفريق  [ فريق ضمان الجودة ▼ ]   ← ACTIVE team/subteam nodes
//                                       INSIDE the selected department
//
//  • Searchable (cmdk) — Arabic and English query text.
//  • Node-type badges (قسم / فريق / فريق فرعي) — types are never
//    mixed without a label (live-suggestion contract).
//  • Dependent team list: changing the department keeps the current
//    team ONLY while it remains a descendant of the new department;
//    otherwise it resets to department-only assignment (§5).
//  • Department-only assignment is a first-class outcome: leaving
//    the team on "بدون فريق" stores the department node itself.
//  • The selection VALUE is always the canonical node id — display
//    names are derived from the node (server is authoritative).
//  • Long names truncate at the END with ellipsis (natural for both
//    Arabic RTL and English LTR — plain text-overflow rules, no
//    direction hacks); the full name stays reachable via the
//    trigger title/aria-label.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import {
  ORG_NODE_TYPE_LABELS_AR,
  isTeamInDepartment,
  teamNodeIdsInDepartment,
  type OrgNodeType,
} from '@/lib/organization';
import type { OrgAssignmentNode } from '@/lib/organization/assignment';

interface OrgAssignmentPickerProps {
  nodes: ReadonlyArray<OrgAssignmentNode>;
  departmentId: string | null;
  teamNodeId: string | null;
  /** Fires with the new department id AND the (possibly reset) team id. */
  onDepartmentChange: (departmentId: string | null, teamNodeId: string | null) => void;
  onTeamChange: (teamNodeId: string | null) => void;
  disabled?: boolean;
}

/** Type badge colors — mirrors the organization page vocabulary. */
const PICKER_TYPE_STYLES: Record<OrgNodeType, string> = {
  company: 'bg-brand-500/10 text-brand-300 border-brand-500/20',
  department: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  team: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  subteam: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
};

export function OrgAssignmentPicker({
  nodes,
  departmentId,
  teamNodeId,
  onDepartmentChange,
  onTeamChange,
  disabled = false,
}: OrgAssignmentPickerProps) {
  const [deptOpen, setDeptOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const departments = useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'department' && n.status === 'active')
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ar')),
    [nodes],
  );

  // Dependent team options: ACTIVE team/subteam descendants of the
  // selected department only — the graph helper is the same one the
  // server-side validation derives from (no second hierarchy rule).
  const teamOptions = useMemo(() => {
    if (!departmentId) return [];
    const ids = new Set(teamNodeIdsInDepartment([...nodes], departmentId));
    return nodes
      .filter((n) => ids.has(n.id) && n.status === 'active')
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ar'));
  }, [nodes, departmentId]);

  const department = departmentId ? byId.get(departmentId) ?? null : null;
  const team = teamNodeId ? byId.get(teamNodeId) ?? null : null;

  const handleDepartmentSelect = (nextDepartmentId: string | null) => {
    // Keep the current team only while it is still a descendant of
    // the new department; otherwise reset to department-only.
    const keepTeam =
      teamNodeId !== null &&
      nextDepartmentId !== null &&
      isTeamInDepartment([...nodes], nextDepartmentId, teamNodeId);
    onDepartmentChange(nextDepartmentId, keepTeam ? teamNodeId : null);
    setDeptOpen(false);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:col-span-2">
      {/* ── Department ── */}
      <div className="space-y-2">
        <Label className="text-slate-300">القسم</Label>
        <Popover open={deptOpen} onOpenChange={setDeptOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={deptOpen}
              disabled={disabled}
              className="w-full justify-between bg-slate-800 border-slate-600 text-white font-normal hover:bg-slate-700/60"
            >
              <span className="min-w-0 flex-1 text-right truncate" title={department?.name ?? undefined}>
                {department ? department.name : 'اختر القسم...'}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[240px] p-0 bg-slate-900 border-slate-700" align="start">
            <Command>
              <CommandInput placeholder="ابحث عن قسم..." className="text-white" />
              <CommandList className="max-h-56 arm-scroll">
                <CommandEmpty className="text-slate-500 text-xs py-4 text-center">لا توجد أقسام مطابقة</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="بدون قسم"
                    onSelect={() => handleDepartmentSelect(null)}
                    className="text-slate-400 aria-selected:bg-slate-800 aria-selected:text-white"
                  >
                    <Check className={cn('size-4 me-2', departmentId === null ? 'opacity-100' : 'opacity-0')} />
                    <span>— بدون قسم —</span>
                  </CommandItem>
                  {departments.map((n) => (
                    <CommandItem
                      key={n.id}
                      value={`${n.name} ${n.id}`}
                      onSelect={() => handleDepartmentSelect(n.id)}
                      className="text-slate-200 aria-selected:bg-slate-800 aria-selected:text-white"
                    >
                      <Check className={cn('size-4 me-2 shrink-0', departmentId === n.id ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate" title={n.name}>{n.name}</span>
                      <span className={cn('shrink-0 rounded border px-1.5 text-[9px]', PICKER_TYPE_STYLES[n.type])}>
                        {ORG_NODE_TYPE_LABELS_AR[n.type]}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Team (dependent) ── */}
      <div className="space-y-2">
        <Label className="text-slate-300">الفريق</Label>
        <Popover open={teamOpen} onOpenChange={setTeamOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={teamOpen}
              disabled={disabled || !departmentId}
              className="w-full justify-between bg-slate-800 border-slate-600 text-white font-normal hover:bg-slate-700/60 disabled:opacity-50 disabled:hover:bg-slate-800"
            >
              <span className="min-w-0 flex-1 text-right truncate" title={team?.name ?? undefined}>
                {team
                  ? team.name
                  : departmentId
                    ? '— بدون فريق (قسم فقط) —'
                    : 'اختر القسم أولاً'}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[240px] p-0 bg-slate-900 border-slate-700" align="start">
            <Command>
              <CommandInput placeholder="ابحث عن فريق..." className="text-white" />
              <CommandList className="max-h-56 arm-scroll">
                <CommandEmpty className="text-slate-500 text-xs py-4 text-center">لا توجد فرق مطابقة</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="بدون فريق"
                    onSelect={() => {
                      onTeamChange(null);
                      setTeamOpen(false);
                    }}
                    className="text-slate-400 aria-selected:bg-slate-800 aria-selected:text-white"
                  >
                    <Check className={cn('size-4 me-2', teamNodeId === null ? 'opacity-100' : 'opacity-0')} />
                    <span>— بدون فريق (قسم فقط) —</span>
                  </CommandItem>
                  {teamOptions.map((n) => (
                    <CommandItem
                      key={n.id}
                      value={`${n.name} ${n.id}`}
                      onSelect={() => {
                        onTeamChange(n.id);
                        setTeamOpen(false);
                      }}
                      className="text-slate-200 aria-selected:bg-slate-800 aria-selected:text-white"
                    >
                      <Check className={cn('size-4 me-2 shrink-0', teamNodeId === n.id ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate" title={n.name}>{n.name}</span>
                      <span className={cn('shrink-0 rounded border px-1.5 text-[9px]', PICKER_TYPE_STYLES[n.type])}>
                        {ORG_NODE_TYPE_LABELS_AR[n.type]}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {!departmentId && (
          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            <Network className="size-3" />
            اختر القسم لعرض الفرق التابعة له
          </p>
        )}
      </div>
    </div>
  );
}

export default OrgAssignmentPicker;
