'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — ExecutivePriorities
//
//  Executive-level widget surfacing the top priorities, risks,
//  employees needing attention, departments, alerts, and bottlenecks.
//
//  Sections (tabbed):
//    1. أولويات اليوم (Today's Top Priorities)
//    2. أعلى المخاطر (Top Risks)
//    3. موظفون يحتاجون اهتماماً (Employees Needing Attention)
//    4. الأقسام (Top Departments)
//    5. تنبيهات تنفيذية (Executive Alerts)
//    6. الاختناقات (Business Bottlenecks)
// ═══════════════════════════════════════════════════════════════

import { memo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/lib/store';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type {
  ExecutivePriorities as ExecutivePrioritiesData,
  ExecutivePriorityItem,
  ExecutiveAlert,
  BusinessBottleneck,
} from '@/lib/aocc/decision-types';
import {
  PriorityBadge,
  ScoreBadge,
  getModuleLabel,
} from './shared';
import {
  Crown,
  Target,
  AlertTriangle,
  Users,
  Building,
  Flame,
  AlertOctagon,
  ExternalLink,
  ChevronLeft,
  TrendingDown,
  CheckCircle2,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface ExecutivePrioritiesProps {
  data: ExecutivePrioritiesData;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

// ═══════════════════════════════════════════════════════════════
//  Tab config
// ═══════════════════════════════════════════════════════════════

type TabKey = 'priorities' | 'risks' | 'employees' | 'departments' | 'alerts' | 'bottlenecks';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: typeof Target;
  count: number;
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const ExecutivePriorities = memo(function ExecutivePriorities({
  data,
  loading = false,
  error = false,
  onRetry,
}: ExecutivePrioritiesProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('priorities');
  const navigateTo = useAppStore((s) => s.navigateTo);

  // ── Determine alert badge count ──
  const alertCount = data.alerts.length;

  // ── Build tabs ──
  const tabs: TabConfig[] = [
    { key: 'priorities', label: 'الأولويات', icon: Target, count: data.topPriorities.length },
    { key: 'risks', label: 'المخاطر', icon: Flame, count: data.topRisks.length },
    { key: 'employees', label: 'موظفون', icon: Users, count: data.topEmployeesNeedingAttention.length },
    { key: 'departments', label: 'أقسام', icon: Building, count: data.topDepartments.length },
    { key: 'alerts', label: 'تنبيهات', icon: AlertOctagon, count: data.alerts.length },
    { key: 'bottlenecks', label: 'اختناقات', icon: TrendingDown, count: data.bottlenecks.length },
  ];

  const handleNavigate = useCallback((targetPage: string, recordId?: string | null) => {
    navigateTo(targetPage, recordId || undefined);
  }, [navigateTo]);

  return (
    <DashboardCard
      title="الأولويات التنفيذية"
      icon={<Crown className="w-4 h-4" />}
      iconBg="bg-indigo-500/15"
      iconColor="text-indigo-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      error={error}
      onRetry={onRetry}
      badge={alertCount > 0 ? alertCount : undefined}
      empty={
        data.topPriorities.length === 0 &&
        data.alerts.length === 0 &&
        data.bottlenecks.length === 0
      }
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
      emptyMessage="لا توجد أولويات تنفيذية"
      emptyDescription="العمليات تعمل ضمن المعدلات الطبيعية"
    >
      <div className="flex flex-col h-full">
        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto shrink-0 pb-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/60 border border-transparent'
                )}
              >
                <Icon className="w-3 h-3" />
                {tab.label}
                {tab.count > 0 && (
                  <span className={cn(
                    'text-[9px] px-1 rounded',
                    isActive ? 'bg-indigo-500/30' : 'bg-slate-700/50'
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Separator className="bg-slate-700/40 mb-2" />

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'priorities' && (
            <PriorityList
              items={data.topPriorities}
              onNavigate={handleNavigate}
              showScore
            />
          )}
          {activeTab === 'risks' && (
            <PriorityList
              items={data.topRisks}
              onNavigate={handleNavigate}
              showScore
            />
          )}
          {activeTab === 'employees' && (
            <PriorityList
              items={data.topEmployeesNeedingAttention}
              onNavigate={handleNavigate}
            />
          )}
          {activeTab === 'departments' && (
            <PriorityList
              items={data.topDepartments}
              onNavigate={handleNavigate}
            />
          )}
          {activeTab === 'alerts' && (
            <AlertsList alerts={data.alerts} onNavigate={handleNavigate} />
          )}
          {activeTab === 'bottlenecks' && (
            <BottlenecksList bottlenecks={data.bottlenecks} />
          )}
        </div>
      </div>
    </DashboardCard>
  );
});

// Required import for empty state icon

// ═══════════════════════════════════════════════════════════════
//  Priority list (shared by priorities / risks / employees / departments)
// ═══════════════════════════════════════════════════════════════

const PriorityList = memo(function PriorityList({
  items,
  onNavigate,
  showScore = false,
}: {
  items: ExecutivePriorityItem[];
  onNavigate: (page: string, recordId?: string | null) => void;
  showScore?: boolean;
}) {
  if (items.length === 0) {
    return <EmptySection message="لا توجد عناصر" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const visual = getPriorityVisual(item.priority);
        return (
          <div
            key={item.id}
            onClick={() => onNavigate(item.targetPage, item.sourceRecordId)}
            role="button"
            tabIndex={0}
            className={cn(
              'group flex items-center gap-2 p-2 rounded-md border cursor-pointer',
              'hover:border-slate-600 hover:bg-slate-800/60 transition-all',
              visual.bgTint,
              visual.border
            )}
          >
            {/* Rank */}
            <div className={cn(
              'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
              item.rank === 1 ? 'bg-amber-500/20 text-amber-400' :
              item.rank === 2 ? 'bg-slate-500/20 text-slate-300' :
              item.rank === 3 ? 'bg-orange-700/20 text-orange-500' :
              'bg-slate-700/40 text-slate-500'
            )}>
              {item.rank}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">
                {item.title}
              </div>
              {item.affectedName && (
                <div className="text-[9px] text-slate-500 truncate">
                  {item.affectedName}
                </div>
              )}
            </div>

            <PriorityBadge level={item.priority} />

            {showScore && (
              <ScoreBadge score={item.score} size="sm" />
            )}

            <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  Alerts list
// ═══════════════════════════════════════════════════════════════

const AlertsList = memo(function AlertsList({
  alerts,
  onNavigate,
}: {
  alerts: ExecutiveAlert[];
  onNavigate: (page: string) => void;
}) {
  if (alerts.length === 0) {
    return <EmptySection message="لا توجد تنبيهات تنفيذية" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {alerts.map((alert) => {
        const visual = getPriorityVisual(alert.severity);
        const scopeIcon = alert.scope === 'operation' ? AlertOctagon :
                         alert.scope === 'department' ? Building : Users;
        const ScopeIcon = scopeIcon;
        return (
          <div
            key={alert.id}
            onClick={() => onNavigate(alert.targetPage)}
            role="button"
            tabIndex={0}
            className={cn(
              'group rounded-lg border p-2.5 cursor-pointer transition-all',
              'hover:border-slate-600',
              visual.bgTint,
              visual.border
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <ScopeIcon className={cn('w-3.5 h-3.5', visual.accent)} />
              <span className="text-xs font-medium text-slate-200 flex-1 truncate">
                {alert.title}
              </span>
              <PriorityBadge level={alert.severity} />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {alert.description}
            </p>
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  Bottlenecks list
// ═══════════════════════════════════════════════════════════════

const BottlenecksList = memo(function BottlenecksList({
  bottlenecks,
}: {
  bottlenecks: BusinessBottleneck[];
}) {
  if (bottlenecks.length === 0) {
    return <EmptySection message="لا توجد اختناقات" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {bottlenecks.map((b) => (
        <div
          key={b.id}
          className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5"
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-slate-200 flex-1">
              {b.title}
            </span>
            <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
              {b.affectedDecisionCount} قرار
            </Badge>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed mb-1.5">
            {b.description}
          </p>
          <div className="text-[10px] text-amber-300/70">
            {b.recommendedAction}
          </div>
        </div>
      ))}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  Empty section
// ═══════════════════════════════════════════════════════════════

function EmptySection({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-400/30 mx-auto mb-2" />
        <p className="text-[11px] text-slate-500">{message}</p>
      </div>
    </div>
  );
}