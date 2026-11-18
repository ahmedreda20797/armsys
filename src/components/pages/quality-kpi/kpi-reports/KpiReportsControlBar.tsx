'use client';

// ══════════════════════════════════════════════════════════════
//  KpiReportsControlBar — §8 ONE compact professional control area
//
//  Report Type · Period · Scope · Selection · Filters — the period
//  selector exists HERE and NOWHERE else on the page (spec §2/§8:
//  one canonical period selector; no duplicated date/month controls).
//  The value basis is READ-ONLY context (a status badge), not a mode
//  the user switches — monthly/MTD/historical period tabs are gone.
// ══════════════════════════════════════════════════════════════

import { FileBarChart, Users2, Network, Building2, RotateCcw, CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { MonthOption } from '../kpi-reports-shared';
import { ValueBasisBadge } from '../kpi-reports-shared';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/i18n/format';
import { pick, REPORT_TYPE_HINTS, REPORT_TYPE_LABELS, SCOPE_MODE_LABELS, TERMS } from './insights-labels';
import { KpiEntityMultiSelect, type KpiMultiSelectOption } from './KpiEntityMultiSelect';
import { FlexiblePeriodPicker } from './FlexiblePeriodPicker';
import type { FlexibleComparisonSpec, FlexiblePeriodSpec } from '@/lib/kpi-reporting';

export type KpiReportType = 'employees' | 'teams' | 'comparison' | 'hr';
export type KpiScopeMode = 'company' | 'employees' | 'teams' | 'departments';

export interface KpiReportsFilters {
  search: string;
  status: string;
  includeArchived: boolean;
}

const REPORT_TYPE_ICONS: Record<KpiReportType, React.ReactNode> = {
  employees: <Users2 className="size-3.5" />,
  teams: <Network className="size-3.5" />,
  comparison: <FileBarChart className="size-3.5" />,
  hr: <Building2 className="size-3.5" />,
};

const SCOPE_ICONS: Record<KpiScopeMode, React.ReactNode> = {
  company: <Building2 className="size-3.5" />,
  employees: <Users2 className="size-3.5" />,
  teams: <Network className="size-3.5" />,
  departments: <Network className="size-3.5" />,
};

export function KpiReportsControlBar({
  reportType,
  onReportTypeChange,
  availableReportTypes,
  monthOptions,
  month,
  onMonthChange,
  valueBasis,
  finalized,
  scopeMode,
  onScopeModeChange,
  employeeOptions,
  teamOptions,
  departmentOptions,
  selectedEmployeeIds,
  onSelectedEmployeesChange,
  selectedOrgNodeIds,
  onSelectedOrgNodesChange,
  filters,
  onFiltersChange,
  onClear,
  loading,
  /** Scope selection applies to the insights-powered views only. */
  showScope = true,
  /** §FLEX-PERIODS — flexible period selection (optional; month flow when absent). */
  flexiblePeriod,
  flexibleBasis,
  onEnterFlexible,
  onExitFlexible,
}: {
  reportType: KpiReportType;
  onReportTypeChange: (type: KpiReportType) => void;
  availableReportTypes: ReadonlyArray<KpiReportType>;
  monthOptions: ReadonlyArray<MonthOption>;
  month: string;
  onMonthChange: (month: string) => void;
  valueBasis: 'MTD' | 'LIVE' | 'FINALIZED' | null;
  finalized: boolean;
  scopeMode: KpiScopeMode;
  onScopeModeChange: (mode: KpiScopeMode) => void;
  employeeOptions: ReadonlyArray<KpiMultiSelectOption>;
  teamOptions: ReadonlyArray<KpiMultiSelectOption>;
  departmentOptions: ReadonlyArray<KpiMultiSelectOption>;
  selectedEmployeeIds: ReadonlyArray<string>;
  onSelectedEmployeesChange: (ids: string[]) => void;
  selectedOrgNodeIds: ReadonlyArray<string>;
  onSelectedOrgNodesChange: (ids: string[]) => void;
  filters: KpiReportsFilters;
  onFiltersChange: (filters: KpiReportsFilters) => void;
  onClear: () => void;
  loading: boolean;
  showScope?: boolean;
  /** §FLEX-PERIODS — flexible period selection (optional; month flow when absent). */
  flexiblePeriod?: {
    spec: FlexiblePeriodSpec;
    onSpecChange: (spec: FlexiblePeriodSpec) => void;
    comparison: FlexibleComparisonSpec;
    onComparisonChange: (spec: FlexibleComparisonSpec) => void;
  };
  /** The flexible span's basis (shown on the flexible row while loading too). */
  flexibleBasis?: 'FINALIZED' | 'MTD' | 'LIVE' | 'MIXED' | null;
  /** Enter flexible mode (explicit — the picker never appears silently). */
  onEnterFlexible?: () => void;
  /** Exit flexible mode back to the full monthly workspace. */
  onExitFlexible?: () => void;
}) {
  const { locale } = useLanguage();
  const currentMonthKey = monthOptions[0]?.value ?? month;

  return (
    <div className="no-print space-y-3 rounded-xl border border-slate-700/40 bg-slate-800/30 p-3 backdrop-blur-sm">
      {/* Row 1 — Report type · Period · Scope */}
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <div className="space-y-1.5">
          <Label className="text-[11px] text-slate-500"><T>نوع التقرير</T></Label>
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-950/40 p-1">
            {availableReportTypes.map((type) => (
              <button
                key={type}
                type="button"
                title={translateHint(REPORT_TYPE_HINTS[type], locale)}
                onClick={() => onReportTypeChange(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  reportType === type
                    ? 'bg-brand-500/20 text-brand-200'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
                )}
              >
                {REPORT_TYPE_ICONS[type]}
                {pick(locale, REPORT_TYPE_LABELS[type])}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {flexiblePeriod ? (
            // §FLEX-PERIODS — compact status chip; the FULL picker lives
            // in its own row below (never crammed into this cell).
            <>
              <Label className="text-[11px] text-slate-500"><T>الفترة</T></Label>
              <div className="flex items-center gap-2 h-9">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/15 px-2.5 h-9 text-xs font-medium text-brand-200">
                  <CalendarRange className="size-3.5" />
                  <T>فترة مرنة</T>
                </span>
                {flexibleBasis && <ValueBasisBadge basis={flexibleBasis} />}
              </div>
              <p className="text-[10px] text-slate-500"><T>يُحدَّد النوع والمقارنة في لوحة الفترة المرنة أدناه</T></p>
            </>
          ) : (
            <>
              <Label className="text-[11px] text-slate-500"><T>الفترة</T></Label>
              <div className="flex items-center gap-2">
                <Select value={month} onValueChange={onMonthChange}>
                  <SelectTrigger className="h-9 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {valueBasis && <ValueBasisBadge basis={valueBasis} />}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-500">
                  {finalized
                    ? <T>شهر مغلق — النتائج مجمّدة من إغلاق الشهر</T>
                    : <T>شهر مفتوح — القيم حية وقد تتغير حتى الإغلاق</T>}
                </p>
                {onEnterFlexible && (
                  <button
                    type="button"
                    onClick={onEnterFlexible}
                    className="inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-500/10 px-2 py-1 text-[10px] font-medium text-brand-200 hover:bg-brand-500/20"
                    title={locale === 'en' ? 'Switch to flexible periods (day/week/quarter/custom) with an independent comparison' : 'التحويل إلى فترات مرنة (يوم/أسبوع/ربع/مدى) مع مقارنة مستقلة'}
                  >
                    <CalendarRange className="size-3" />
                    <T>فترة مرنة</T>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className={showScope ? 'space-y-1.5' : 'hidden space-y-1.5'}>
          <Label className="text-[11px] text-slate-500"><T>النطاق</T></Label>
          <Select value={scopeMode} onValueChange={(v) => onScopeModeChange(v as KpiScopeMode)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['company', 'employees', 'teams', 'departments'] as const).map((mode) => (
                <SelectItem key={mode} value={mode} className="text-xs">
                  <span className="flex items-center gap-2">
                    {SCOPE_ICONS[mode]}
                    {pick(locale, SCOPE_MODE_LABELS[mode])}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── §FLEX-PERIODS — full-width flexible period + comparison row ── */}
      {flexiblePeriod && (
        <div className="rounded-xl border border-brand-500/25 bg-slate-950/40 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-brand-400" />
              <span className="text-xs font-semibold text-slate-200"><T>الفترة المرنة والمقارنة المستقلة</T></span>
              {flexibleBasis && <ValueBasisBadge basis={flexibleBasis} />}
            </div>
            {onExitFlexible && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[11px] text-slate-500 hover:text-slate-200"
                onClick={onExitFlexible}
              >
                <RotateCcw className="size-3.5" />
                <T>عودة للعرض الشهري الكامل</T>
              </Button>
            )}
          </div>
          <FlexiblePeriodPicker
            spec={flexiblePeriod.spec}
            onSpecChange={flexiblePeriod.onSpecChange}
            comparison={flexiblePeriod.comparison}
            onComparisonChange={flexiblePeriod.onComparisonChange}
            monthOptions={monthOptions}
            currentMonthKey={currentMonthKey}
          />
        </div>
      )}

      {/* Row 2 — selection (per scope) */}
      {showScope && scopeMode === 'employees' && (
        <KpiEntityMultiSelect
          options={employeeOptions}
          selected={selectedEmployeeIds}
          onChange={onSelectedEmployeesChange}
          placeholder="بحث عن موظف..."
          searchPlaceholder="بحث عن موظف..."
          disabled={loading}
        />
      )}
      {showScope && scopeMode === 'teams' && (
        <KpiEntityMultiSelect
          options={teamOptions}
          selected={selectedOrgNodeIds}
          onChange={onSelectedOrgNodesChange}
          placeholder={selectedOrgNodeIds.length > 1 ? 'اختر الفرق' : 'اختر الفريق'}
          searchPlaceholder="بحث عن فريق..."
          disabled={loading}
        />
      )}
      {showScope && scopeMode === 'departments' && (
        <KpiEntityMultiSelect
          options={departmentOptions}
          selected={selectedOrgNodeIds}
          onChange={onSelectedOrgNodesChange}
          placeholder={selectedOrgNodeIds.length > 1 ? 'اختر الأقسام' : 'اختر القسم'}
          searchPlaceholder="بحث عن قسم..."
          disabled={loading}
        />
      )}
      {showScope && scopeMode === 'company' && (
        <p className="text-[11px] text-slate-500">
          <T>النطاق: كل ما يسمح به نطاق صلاحياتك على مستوى الشركة.</T>
        </p>
      )}

      {/* Row 3 — filters + clear */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-500"><T>بحث</T></Label>
          <Input
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder={locale === 'en' ? 'Employee name or number…' : 'اسم الموظف أو رقمه…'}
            className="h-8 w-44 text-xs bg-slate-900/60 border-slate-700/60"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-500"><T>{TERMS.evaluationStatus[0]}</T></Label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => onFiltersChange({ ...filters, status: v === 'all' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-36 text-xs bg-slate-900/60 border-slate-700/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs"><T>الكل</T></SelectItem>
              <SelectItem value="FINALIZED" className="text-xs"><T>مجمّد</T></SelectItem>
              <SelectItem value="AVAILABLE" className="text-xs"><T>متاح</T></SelectItem>
              <SelectItem value="INCOMPLETE" className="text-xs"><T>التقييم غير مكتمل</T></SelectItem>
              <SelectItem value="PENDING" className="text-xs"><T>معلّق</T></SelectItem>
              <SelectItem value="ZERO" className="text-xs"><T>صفر</T></SelectItem>
              <SelectItem value="NO_SCHEME" className="text-xs"><T>لا يوجد مخطط</T></SelectItem>
              <SelectItem value="NOT_ELIGIBLE" className="text-xs"><T>غير مؤهل للتقييم</T></SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Switch
            checked={filters.includeArchived}
            onCheckedChange={(v) => onFiltersChange({ ...filters, includeArchived: v })}
          />
          <Label className="text-[11px] text-slate-400"><T>تضمين المؤرشفين</T></Label>
        </div>
        <div className="ms-auto flex items-center gap-1.5 pb-0.5">
          {selectedEmployeeIds.length > 0 && (
            <span className="text-[10px] text-slate-500">
              <T>موظفون مختارون:</T> {formatNumber(selectedEmployeeIds.length, { locale })}
            </span>
          )}
          {selectedOrgNodeIds.length > 0 && (
            <span className="text-[10px] text-slate-500">
              <T>وحدات مختارة:</T> {formatNumber(selectedOrgNodeIds.length, { locale })}
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded-md border border-slate-700/60 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700/40 hover:text-slate-200"
          >
            <RotateCcw className="size-3" />
            <T>مسح</T>
          </button>
        </div>
      </div>
    </div>
  );
}

function translateHint(hint: readonly [string, string] | undefined, locale: string): string {
  if (!hint) return '';
  return locale === 'en' ? hint[1] : hint[0];
}
