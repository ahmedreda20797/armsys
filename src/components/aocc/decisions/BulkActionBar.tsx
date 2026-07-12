'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — BulkActionBar
//
//  Floating action bar that appears when decisions are selected.
//  Offers 9 bulk actions:
//    1. تعيين (Assign)
//    2. مراجعة (Review / Acknowledge)
//    3. إغلاق (Close / Resolve)
//    4. إشعار (Notify)
//    5. تصعيد (Escalate)
//    6. فتح كابا (Open CAPA)
//    7. متابعة جديدة (Create Follow-Up)
//    8. تصدير (Export CSV)
//    9. أرشفة (Archive)
//
//  Each action delegates to the Zustand store's bulkAction method.
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useDecisionStore, downloadDecisionsCSV } from '@/lib/aocc/decision-store';
import type { Decision, BulkActionType, NextBestAction } from '@/lib/aocc/decision-types';
import {
  UserCheck,
  Eye,
  CheckCircle2,
  Bell,
  ArrowUpRight,
  ShieldAlert,
  Plus,
  Download,
  Archive,
  X,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface BulkActionBarProps {
  decisions: Decision[];
  selectedCount: number;
  onNavigate?: (page: string, recordId?: string | null) => void;
  onAction?: (action: NextBestAction, decision: Decision) => void;
}

// ═══════════════════════════════════════════════════════════════
//  Action config
// ═══════════════════════════════════════════════════════════════

interface BulkActionConfig {
  type: BulkActionType;
  label: string;
  icon: typeof CheckCircle2;
  colorClass: string;
  /** Whether this action needs to be handled specially. */
  special?: 'export';
}

const BULK_ACTIONS: BulkActionConfig[] = [
  { type: 'review', label: 'مراجعة', icon: Eye, colorClass: 'text-cyan-400' },
  { type: 'assign', label: 'تعيين', icon: UserCheck, colorClass: 'text-violet-400' },
  { type: 'escalate', label: 'تصعيد', icon: ArrowUpRight, colorClass: 'text-red-400' },
  { type: 'close', label: 'إغلاق', icon: CheckCircle2, colorClass: 'text-emerald-400' },
  { type: 'notify', label: 'إشعار', icon: Bell, colorClass: 'text-amber-400' },
  { type: 'open_capa', label: 'كابا', icon: ShieldAlert, colorClass: 'text-purple-400' },
  { type: 'create_followup', label: 'متابعة', icon: Plus, colorClass: 'text-sky-400' },
  { type: 'export', label: 'تصدير', icon: Download, colorClass: 'text-slate-400', special: 'export' },
  { type: 'archive', label: 'أرشفة', icon: Archive, colorClass: 'text-slate-500' },
];

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const BulkActionBar = memo(function BulkActionBar({
  decisions,
  selectedCount,
  onNavigate,
  onAction,
}: BulkActionBarProps) {
  const user = useAuth().user;
  const bulkAction = useDecisionStore((s) => s.bulkAction);
  const clearSelection = useDecisionStore((s) => s.clearSelection);

  const userName = user?.name || user?.email || 'المستخدم';

  const handleBulkAction = useCallback((cfg: BulkActionConfig) => {
    // Export is handled client-side, not through the store lifecycle
    if (cfg.special === 'export') {
      const states = useDecisionStore.getState().selectedIds;
      const selected = decisions.filter((d) => states.has(d.id));
      downloadDecisionsCSV(selected);
      return;
    }

    const result = bulkAction(cfg.type, decisions, userName);

    if (result.count > 0) {
      // Toast feedback could be added here — for now the state change
      // is sufficient. The cards will re-render with updated statuses.
    }
  }, [decisions, bulkAction, userName]);

  return (
    <div className="shrink-0 px-3 py-2 bg-slate-800/80 border-b border-slate-700/50 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Selection count */}
        <Badge className="text-[10px] px-2 py-0.5 bg-sky-500/20 text-sky-400 border-sky-500/30">
          {selectedCount} محدد
        </Badge>

        <Separator className="h-4 w-px bg-slate-600/50" />

        {/* Action buttons */}
        {BULK_ACTIONS.map((cfg) => {
          const Icon = cfg.icon;
          return (
            <Button
              key={cfg.type}
              variant="ghost"
              size="sm"
              onClick={() => handleBulkAction(cfg)}
              className={cn(
                'h-7 text-[10px] px-2 gap-1 hover:bg-slate-700',
                cfg.colorClass
              )}
            >
              <Icon className="w-3 h-3" />
              {cfg.label}
            </Button>
          );
        })}

        {/* Clear selection */}
        <Button
          variant="ghost"
          size="sm"
          onClick={clearSelection}
          className="h-7 text-[10px] px-2 gap-1 text-slate-500 hover:text-slate-300 hover:bg-slate-700 mr-auto"
        >
          <X className="w-3 h-3" />
          إلغاء
        </Button>
      </div>
    </div>
  );
});