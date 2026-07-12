'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — CommandBar
//
//  Global command palette powered by cmdk. Quick-access commands:
//    - Filter by decision type (critical, CAPA, HR, complaints, etc.)
//    - Filter by priority (critical, high, medium, low)
//    - Navigate to modules
//    - Open specific decisions by ID
//    - Toggle views
//    - Keyboard shortcuts display
//
//  Triggered by Ctrl+K / Cmd+K. Integrates with the decision store
//  to apply filters, navigate, and open dialogs.
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useDecisionStore, downloadDecisionsCSV } from '@/lib/aocc/decision-store';
import type { Decision, DecisionType, PriorityLevel } from '@/lib/aocc/decision-types';
import {
  AlertTriangle,
  ShieldAlert,
  Banknote,
  User,
  Crown,
  Clock,
  GraduationCap,
  Bell,
  Search,
  Target,
  Filter,
  Flame,
  Zap,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface CommandBarProps {
  /** Available decisions for search/navigate. */
  decisions: Decision[];
  /** Called when a specific decision should be opened. */
  onOpenDecision?: (decision: Decision) => void;
  /** Called to navigate to a page. */
  onNavigate?: (page: string) => void;
}

// ═══════════════════════════════════════════════════════════════
//  Command definitions
// ═══════════════════════════════════════════════════════════════

interface CommandDef {
  id: string;
  label: string;
  icon: typeof Search;
  shortcut?: string;
  group: string;
}

/** Filter commands — type-based. */
const TYPE_COMMANDS: CommandDef[] = [
  { id: 'filter-critical', label: 'القرارات الحرجة', icon: Flame, shortcut: 'Ctrl+1', group: 'أولوية' },
  { id: 'filter-high', label: 'قرارات عالية الأهمية', icon: AlertTriangle, shortcut: 'Ctrl+2', group: 'أولوية' },
  { id: 'filter-capa', label: 'قرارات كابا', icon: ShieldAlert, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-complaints', label: 'قرارات الشكاوى', icon: Bell, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-hr', label: 'قرارات الموارد البشرية', icon: Banknote, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-attendance', label: 'قرارات الحضور', icon: Clock, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-risk', label: 'قرارات المخاطر', icon: ShieldAlert, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-executive', label: 'قرارات تنفيذية', icon: Crown, shortcut: '', group: 'نوع القرار' },
  { id: 'filter-training', label: 'قرارات التدريب', icon: GraduationCap, shortcut: '', group: 'نوع القرار' },
];

/** Action commands. */
const ACTION_COMMANDS: CommandDef[] = [
  { id: 'clear-filters', label: 'مسح الفلاتر', icon: Filter, shortcut: 'Ctrl+Shift+F', group: 'إجراءات' },
  { id: 'select-all', label: 'تحديد جميع القرارات', icon: Target, shortcut: 'Ctrl+A', group: 'إجراءات' },
  { id: 'export', label: 'تصدير القرارات CSV', icon: Search, shortcut: 'Ctrl+E', group: 'إجراءات' },
];

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const CommandBar = memo(function CommandBar({
  decisions,
  onOpenDecision,
  onNavigate,
}: CommandBarProps) {
  const commandBarOpen = useDecisionStore((s) => s.commandBarOpen);
  const setCommandBarOpen = useDecisionStore((s) => s.setCommandBarOpen);
  const setFilter = useDecisionStore((s) => s.setFilter);
  const resetFilters = useDecisionStore((s) => s.resetFilters);
  const toggleArrayFilter = useDecisionStore((s) => s.toggleArrayFilter);
  const selectAll = useDecisionStore((s) => s.selectAll);

  // ── Keyboard shortcut: Ctrl+K to toggle ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandBarOpen(!commandBarOpen);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandBarOpen, setCommandBarOpen]);

  // ── Command handler ──
  const handleCommand = useCallback((commandId: string) => {
    setCommandBarOpen(false);

    switch (commandId) {
      case 'filter-critical':
        toggleArrayFilter('priorities', 'critical' as PriorityLevel);
        break;
      case 'filter-high':
        toggleArrayFilter('priorities', 'high' as PriorityLevel);
        break;
      case 'filter-capa':
        toggleArrayFilter('types', 'capa_required' as DecisionType);
        break;
      case 'filter-complaints':
        toggleArrayFilter('types', 'complaint_escalation' as DecisionType);
        break;
      case 'filter-hr':
        toggleArrayFilter('types', 'hr_action_required' as DecisionType);
        break;
      case 'filter-attendance':
        toggleArrayFilter('types', 'attendance_review' as DecisionType);
        break;
      case 'filter-risk':
        toggleArrayFilter('types', 'risk_escalation' as DecisionType);
        break;
      case 'filter-executive':
        toggleArrayFilter('types', 'executive_attention' as DecisionType);
        break;
      case 'filter-training':
        toggleArrayFilter('types', 'training_required' as DecisionType);
        break;
      case 'clear-filters':
        resetFilters();
        break;
      case 'select-all':
        selectAll(decisions.map((d) => d.id));
        break;
      case 'export':
        downloadDecisionsCSV(decisions);
        break;
    }
  }, [setCommandBarOpen, toggleArrayFilter, resetFilters, selectAll, decisions]);

  return (
    <CommandDialog open={commandBarOpen} onOpenChange={setCommandBarOpen}>
      <CommandInput
        placeholder="بحث في القرارات... (Ctrl+K)"
        className="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
      />
      <CommandList className="bg-slate-900 border-slate-700">
        <CommandEmpty className="text-slate-500 text-sm py-6 text-center">
          لا توجد نتائج
        </CommandEmpty>

        {/* Decision type filters */}
        <CommandGroup heading="فلاتر القرارات">
          {TYPE_COMMANDS.map((cmd) => {
            const Icon = cmd.icon;
            return (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                onSelect={() => handleCommand(cmd.id)}
                className="flex items-center gap-2 text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                <Icon className="w-4 h-4 text-slate-400" />
                <span className="flex-1 text-sm">{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut className="text-[10px] text-slate-600">
                    {cmd.shortcut}
                  </CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* Action commands */}
        <CommandGroup heading="إجراءات سريعة">
          {ACTION_COMMANDS.map((cmd) => {
            const Icon = cmd.icon;
            return (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                onSelect={() => handleCommand(cmd.id)}
                className="flex items-center gap-2 text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                <Icon className="w-4 h-4 text-slate-400" />
                <span className="flex-1 text-sm">{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut className="text-[10px] text-slate-600">
                    {cmd.shortcut}
                  </CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* Quick-access to recent decisions (top 10) */}
        {decisions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="قرارات حديثة">
              {decisions.slice(0, 10).map((d) => (
                <CommandItem
                  key={d.id}
                  value={`decision-${d.id}`}
                  onSelect={() => {
                    setCommandBarOpen(false);
                    onOpenDecision?.(d);
                  }}
                  className="flex items-center gap-2 text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <AlertTriangle className={cn(
                    'w-4 h-4 shrink-0',
                    d.priority === 'critical' ? 'text-red-400' :
                    d.priority === 'high' ? 'text-amber-400' :
                    'text-slate-500'
                  )} />
                  <span className="flex-1 text-sm truncate">{d.title}</span>
                  <span className="text-[9px] text-slate-500">{Math.round(d.score.overall)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
});