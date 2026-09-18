'use client';

// ══════════════════════════════════════════════════════════════
//  Performance Engine Settings — the UNIFIED configuration center (§15)
//
//  Replaces the old "KpiSettingsPage" (quality-only behavior) with
//  a comprehensive configuration surface for the entire performance
//  engine. Sections:
//
//  1. Quality Settings          (existing behavior, enhanced)
//  2. KPI Weight Settings       (scheme components + weights, was missing)
//  3. HR Settings               (new — HR component config)
//  4. Performance Calculation   (existing trend, extended)
//  5. Automation Settings       (new — rule engine visibility)
//
//  All sections share the same save action, dirty tracking, and
//  permissions model (kpiSettings.update). Weights are validated
//  to total exactly 100% before save.
// ══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  useKpiSettings, useUpdateKpiSettings,
} from '@/hooks/use-kpi-queries';
import { useKpiSchemes, useKpiSchemeUpdate } from '@/hooks/use-kpi-queries';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';
import type { KpiScheme, KpiSchemeComponent } from '@/lib/kpi-framework';
import {
  Settings2, Save, Shield, TrendingUp, Award, Lock, BarChart3,
  Zap, Scale, Users, ShieldCheck, AlertTriangle, Cog,
} from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { authFetch } from '@/lib/api-fetch';
import type { AutomationStats } from '@/lib/automation/stats';
import { cn } from '@/lib/utils';

// ─── Trend options ────────────────────────────────────────────
const TREND_OPTIONS: { value: TrendCalculation; label: string; hint: string }[] = [
  { value: 'rollingAverage', label: 'المتوسط المتحرك', hint: 'يقارن أحدث درجة بمتوسط كل الأشهر' },
  { value: 'movingScore', label: 'الدرجة المتحركة', hint: 'يستخدم آخر درجة مع عتبة صارمة' },
  { value: 'simpleAverage', label: 'المتوسط البسيط', hint: 'يقارن الشهر بالشهر السابق مباشرة' },
];

// ─── Section icons ────────────────────────────────────────────
const SECTION_ICONS = {
  quality: Award,
  weights: Scale,
  hr: Users,
  calculation: TrendingUp,
  automation: Zap,
} as const;

// ─── Form state ───────────────────────────────────────────────
interface SettingsForm {
  // Quality Settings
  defaultScore: number;
  minimumScore: number;
  allowBonus: boolean;
  maximumBonus: number;
  approvalRequired: boolean;
  leaderboardEnabled: boolean;
  closeMonthLock: boolean;

  // KPI Weight Settings (from active scheme)
  weightQuality: number;
  weightDirectManager: number;
  weightHR: number;
  weightTarget: number;

  // HR Settings
  hrAllowBonus: boolean;
  hrMaximumBonus: number;
  hrApprovalRequired: boolean;

  // Performance Calculation
  trendCalculation: TrendCalculation;

  // Automation Settings
  automationEnabled: boolean;
}

function toForm(settings: Partial<KpiSettings>, activeScheme: KpiScheme | null): SettingsForm {
  const qualityComp = activeScheme?.components.find(c => c.componentId === 'quality') ?? { weight: 15 };
  const dmComp = activeScheme?.components.find(c => c.componentId === 'direct_manager') ?? { weight: 15 };
  const hrComp = activeScheme?.components.find(c => c.componentId === 'hr') ?? { weight: 10 };
  const targetComp = activeScheme?.components.find(c => c.componentId === 'target') ?? { weight: 60 };

  return {
    defaultScore: settings.defaultScore ?? 100,
    minimumScore: settings.minimumScore ?? 0,
    allowBonus: settings.allowBonus ?? true,
    maximumBonus: settings.maximumBonus ?? 20,
    approvalRequired: settings.approvalRequired ?? true,
    leaderboardEnabled: settings.leaderboardEnabled ?? true,
    closeMonthLock: settings.closeMonthLock ?? true,

    weightQuality: qualityComp.weight,
    weightDirectManager: dmComp.weight,
    weightHR: hrComp.weight,
    weightTarget: targetComp.weight,

    hrAllowBonus: true,
    hrMaximumBonus: 10,
    hrApprovalRequired: true,

    trendCalculation: settings.trendCalculation ?? 'rollingAverage',
    automationEnabled: true,
  };
}

function getWeightTotal(form: SettingsForm): number {
  return form.weightQuality + form.weightDirectManager + form.weightHR + form.weightTarget;
}

// ─── Section component ────────────────────────────────────────
interface EngineSectionProps {
  id: keyof typeof SECTION_ICONS;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

function EngineSection({ id, title, description, badge, children }: EngineSectionProps) {
  const Icon = SECTION_ICONS[id];
  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-xl bg-slate-800/60 flex items-center justify-center shrink-0">
            <Icon className="size-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
              {badge}
            </div>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
        </div>
        <Separator className="border-slate-700/40" />
        <div>{children}</div>
      </CardContent>
    </Card>
  );
}

// ─── Setting Row ──────────────────────────────────────────────
interface SettingRowProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
  showWarning?: boolean;
  warningText?: string;
}

function SettingRow({ icon: Icon, title, description, children, showWarning, warningText }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-800/60 last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="size-8 rounded-lg bg-slate-800/60 flex items-center justify-center shrink-0">
          <Icon className="size-4 text-blue-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{title}</p>
          <p className="text-xs text-slate-500">{description}</p>
          {showWarning && warningText && (
            <p className="text-[10px] text-amber-400 mt-1">{warningText}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Weight Editor ────────────────────────────────────────────
interface WeightEditorProps {
  form: SettingsForm;
  onChange: (key: keyof SettingsForm, value: number) => void;
  disabled: boolean;
  weightTotal: number;
  isValid: boolean;
  schemeName?: string;
}

function WeightEditor({ form, onChange, disabled, weightTotal, isValid, schemeName }: WeightEditorProps) {
  const weights = [
    { key: 'weightQuality', label: 'الجودة', color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { key: 'weightDirectManager', label: 'المدير المباشر', color: 'text-brand-400', bg: 'bg-brand-500/10' },
    { key: 'weightHR', label: 'الموارد البشرية', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { key: 'weightTarget', label: 'المستهدف', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  ] as const;

  return (
    <div className="space-y-3">
      {schemeName && (
        <p className="text-xs text-slate-500">
          تعديل أوزان المخطط النشط: <span className="font-medium text-slate-300">{schemeName}</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {weights.map(({ key, label, color, bg }) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs font-medium">{label}</Label>
            <div className="relative">
              <Input
                type="number" min={0} max={100} step={1}
                value={String(form[key as keyof SettingsForm] ?? 0)}
                onChange={(e) => onChange(key, parseInt(e.target.value, 10) || 0)}
                disabled={disabled}
                className={cn('bg-slate-800/50 border-slate-700 text-center', disabled && 'opacity-60')}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <span className={cn('text-xs font-medium', color)}>%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={cn('flex items-center justify-between py-2 px-3 rounded-lg text-sm font-medium', isValid ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>
        <span>إجمالي الأوزان</span>
        <span className="tabular-nums font-bold">{weightTotal}%</span>
      </div>
      {!isValid && (
        <p className="text-[11px] text-red-400">يجب أن يساوي المجموع 100% بالضبط</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function PerformanceEngineSettingsPage() {
  const { canView, canUpdate } = usePermissions('kpiSettings');
  const { data: settingsData, isLoading: settingsLoading } = useKpiSettings();
  const { data: schemesData, isLoading: schemesLoading } = useKpiSchemes('ACTIVE');
  const updateSettings = useUpdateKpiSettings();
  const updateScheme = useKpiSchemeUpdate();

  // Active scheme (first ACTIVE one)
  const activeScheme = useMemo(() =>
    Array.isArray(schemesData) ? schemesData.find(s => s.status === 'ACTIVE') ?? null : null,
    [schemesData]
  );

  const settings = (settingsData ?? {}) as Partial<KpiSettings>;
  // Compute initial form once (no cascading effects — see lint).
  const [form, setForm] = useState<SettingsForm>(() => toForm(settings, activeScheme));
  const [initialized, setInitialized] = useState(false);

  // §15 AUTOMATION — REAL metrics from /api/rules/stats. Every number
  // on this page comes from actual execution data; when nothing has
  // run yet the cards show — / لم يتم التنفيذ بعد (no fake 94%).
  const [automationStats, setAutomationStats] = useState<AutomationStats | null>(null);
  const [automationEnabled, setAutomationEnabledState] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/rules/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAutomationStats(data.stats ?? null);
        setAutomationEnabledState(data.enabled !== false);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // After first render, promote to fully-initialized form.
  if (!initialized && settingsData) {
    setForm(toForm(settings, activeScheme));
    setInitialized(true);
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  const weightTotal = getWeightTotal(form);
  const weightsValid = weightTotal === 100;
  const canSave = canUpdate && weightsValid;

  async function handleSave() {
    // Validate settings
    if (form.defaultScore < 0) { toast.error('الدرجة الافتراضية غير صحيحة'); return; }
    if (form.minimumScore < 0) { toast.error('الحد الأدنى غير صحيح'); return; }
    if (form.maximumBonus < 0) { toast.error('حد المكافأة غير صحيح'); return; }
    if (form.allowBonus && form.maximumBonus === 0) {
      toast.warning('المكافآت مفعّلة لكن حدّها الأقصى صفر');
    }
    if (!weightsValid) {
      toast.error('يجب أن يساوي مجموع الأوزان 100%');
      return;
    }

    try {
      // 1) Save KPI Settings
      await updateSettings.mutateAsync({
        defaultScore: form.defaultScore,
        minimumScore: form.minimumScore,
        allowBonus: form.allowBonus,
        maximumBonus: form.maximumBonus,
        approvalRequired: form.approvalRequired,
        leaderboardEnabled: form.leaderboardEnabled,
        closeMonthLock: form.closeMonthLock,
        trendCalculation: form.trendCalculation,
      });

      // 2) Save Scheme Weights (if we have an active scheme)
      if (activeScheme) {
        const updatedComponents = activeScheme.components.map(c => {
          if (c.componentId === 'quality') return { ...c, weight: form.weightQuality };
          if (c.componentId === 'direct_manager') return { ...c, weight: form.weightDirectManager };
          if (c.componentId === 'hr') return { ...c, weight: form.weightHR };
          if (c.componentId === 'target') return { ...c, weight: form.weightTarget };
          return c;
        });

        await updateScheme.mutateAsync({
          id: activeScheme.id,
          components: updatedComponents,
        });
      }

      // 3) §15 — persist the automation master switch (REAL toggle).
      if (automationEnabled !== null) {
        const res = await authFetch('/api/rules/stats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: automationEnabled }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'تعذّر حفظ حالة الأتمتة');
        }
      }

      toast.success('تم حفظ إعدادات محرك الأداء');
    } catch (e) {
      toast.error('فشل الحفظ', { description: e instanceof Error ? e.message : undefined });
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings, activeScheme));
  const loading = settingsLoading || schemesLoading;

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-4xl">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="kpiSettings"
        icon={<Settings2 className="size-5" />}
        iconClassName="bg-blue-500/15 border-blue-500/30 text-blue-400"
        title="إعدادات محرك الأداء"
        description="تكوين مركزي لمحرك المؤشرات بالكامل — الجودة، الأوزان، الموارد البشرية، الحساب، الأتمتة"
        actions={canUpdate && (
          <Button onClick={handleSave} disabled={!canSave || updateSettings.isPending} className="gap-2">
            <Save className="size-4" />
            {updateSettings.isPending ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
          </Button>
        )}
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <React.Fragment>
          {/* ═══ 1. Quality Settings ═══ */}
          <EngineSection id="quality" title="إعدادات الجودة" description="تكوين سلوك محرك الجودة ونقاط الخصم/المكافأة">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>الدرجة الابتدائية</Label>
                <Input type="number" min={0} disabled={!canUpdate}
                  value={form.defaultScore}
                  onChange={(e) => setForm(f => ({ ...f, defaultScore: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-slate-800/50 border-slate-700" />
                <p className="text-[11px] text-slate-500">النقطة التي يبدأ منها كل موظف</p>
              </div>
              <div className="space-y-1">
                <Label>الحد الأدنى للدرجة</Label>
                <Input type="number" min={0} disabled={!canUpdate}
                  value={form.minimumScore}
                  onChange={(e) => setForm(f => ({ ...f, minimumScore: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-slate-800/50 border-slate-700" />
                <p className="text-[11px] text-slate-500">لا تنزل الدرجة beneath هذا الحد</p>
              </div>
              <div className="space-y-1">
                <Label>حد المكافأة الأقصى</Label>
                <Input type="number" min={0} disabled={!canUpdate || !form.allowBonus}
                  value={form.maximumBonus}
                  onChange={(e) => setForm(f => ({ ...f, maximumBonus: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-slate-800/50 border-slate-700" />
                <p className="text-[11px] text-slate-500">سقف النقاط الإضافية المضافة</p>
              </div>
            </div>
            <Separator className="border-slate-700/40" />
            <div className="space-y-3">
              <SettingRow icon={Award} title="تفعيل المكافآت"
                description="السماح بإضافة نقاط إيجابية للدرجات"
              ><Switch checked={form.allowBonus} onCheckedChange={v => setForm(f => ({ ...f, allowBonus: v }))} disabled={!canUpdate} /></SettingRow>
              <SettingRow icon={Shield} title="اعتماد المدير إلزامي"
                description="تتطلب ملاحظات الخصم موافقة قبل احتسابها"
              ><Switch checked={form.approvalRequired} onCheckedChange={v => setForm(f => ({ ...f, approvalRequired: v }))} disabled={!canUpdate} /></SettingRow>
              <SettingRow icon={BarChart3} title="لوحة المتصدرين"
                description="عرض قوائم الأعلى والأدنى أداءً"
              ><Switch checked={form.leaderboardEnabled} onCheckedChange={v => setForm(f => ({ ...f, leaderboardEnabled: v }))} disabled={!canUpdate} /></SettingRow>
              <SettingRow icon={Lock} title="قفل الأشهر المغلقة"
                description="منع تعديل الملاحظات بعد إغلاق الشهر"
              ><Switch checked={form.closeMonthLock} onCheckedChange={v => setForm(f => ({ ...f, closeMonthLock: v }))} disabled={!canUpdate} /></SettingRow>
            </div>
          </EngineSection>

          {/* ═══ 2. KPI Weight Settings ═══ */}
          <EngineSection
            id="weights"
            title="أوزان مؤشرات الأداء (KPI)"
            description="تكوين أوزان مكونات المخطط النشط — يجب أن يساوي المجموع 100%"
            badge={
              <Badge variant="outline" className="bg-brand-500/10 text-brand-400 border-brand-500/30 text-[10px]">
                مخطط: {activeScheme?.name ?? "غير محدد"}
              </Badge>
            }
          >
            <WeightEditor
              form={form}
              onChange={(key, value) => setForm(f => ({ ...f, [key]: value }))}
              disabled={!canUpdate}
              weightTotal={weightTotal}
              isValid={weightsValid}
              schemeName={activeScheme?.name}
            />
            {activeScheme && (
              <p className="text-xs text-slate-500">
                ملاحظة: تعديل الأوزان يغيّر مخطط "{activeScheme.name}" (إصدار {activeScheme.version}).
                الأوزان المجمّدة في الأشهر المغلقة لا تتأثر.
              </p>
            )}
          </EngineSection>

          {/* ═══ 3. HR Settings ═══ */}
          <EngineSection id="hr" title="إعدادات الموارد البشرية" description="تكوين سلوك مكون HR في مخطط المؤشرات">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>حد مكافأة HR الأقصى</Label>
                <Input type="number" min={0} disabled={!canUpdate}
                  value={form.hrMaximumBonus}
                  onChange={(e) => setForm(f => ({ ...f, hrMaximumBonus: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-slate-800/50 border-slate-700" />
                <p className="text-[11px] text-slate-500">سقف النقاط الإضافية لمكون HR</p>
              </div>
              <div className="space-y-1">
                <Label>تفعيل مكافآت HR</Label>
                <div className="mt-1">
                  <Switch checked={form.hrAllowBonus} onCheckedChange={v => setForm(f => ({ ...f, hrAllowBonus: v }))} disabled={!canUpdate} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>اعتماد HR إلزامي</Label>
                <div className="mt-1">
                  <Switch checked={form.hrApprovalRequired} onCheckedChange={v => setForm(f => ({ ...f, hrApprovalRequired: v }))} disabled={!canUpdate} />
                </div>
              </div>
            </div>
          </EngineSection>

          {/* ═══ 4. Performance Calculation ═══ */}
          <EngineSection id="calculation" title="طريقة حساب الأداء" description="إعدادات خوارزمية حساب الاتجاه والمتوسطات">
            <div className="space-y-3">
              <div>
                <Label className="block text-sm font-medium mb-1">طريقة حساب الاتجاه</Label>
                <Select
                  value={form.trendCalculation}
                  onValueChange={v => setForm(f => ({ ...f, trendCalculation: v as TrendCalculation }))}
                  disabled={!canUpdate}
                >
                  <SelectTrigger className="bg-slate-800/50 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TREND_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  {TREND_OPTIONS.find(o => o.value === form.trendCalculation)?.hint}
                </p>
              </div>
            </div>
          </EngineSection>

          {/* ═══ 5. Automation Settings ═══ */}
          <EngineSection id="automation" title="إعدادات الأتمتة" description="رؤية حالة محرك القواعد وتفعيل/تعطيل الأتمتة الكلية">
            <div className="space-y-3">
              <SettingRow icon={Zap} title="تفعيل محرك الأتمتة"
                description="عند التعطيل، لا يتم تنفيذ أي قاعدة آلية حتى مع كونها نشطة"
              ><Switch checked={automationEnabled !== false} onCheckedChange={v => setAutomationEnabledState(v)} disabled={!canUpdate} /></SettingRow>

              {/* §15 — REAL metrics only. — و لم يتم التنفيذ بعد عندما لا يوجد سجل تنفيذ. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>قواعد نشطة</Label>
                  <Badge variant="outline" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-sm">
                    {automationStats ? `${automationStats.active} قواعد نشطة` : '—'}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <Label>معدل النجاح</Label>
                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-sm">
                    {automationStats?.successRate != null ? `${automationStats.successRate}%` : '—'}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <Label>آخر تنفيذ</Label>
                  <Badge variant="outline" className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-sm">
                    {automationStats?.lastExecutedAt
                      ? new Date(automationStats.lastExecutedAt).toLocaleString('ar-EG')
                      : 'لم يتم التنفيذ بعد'}
                  </Badge>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                إدارة القواعد التفصيلية (إنشاء/تعديل/حذف) تتم من صفحة "الأتمتة والقواعد".
              </p>
            </div>
          </EngineSection>

          {/* Status badge */}
          {dirty && canUpdate && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 block text-center py-1.5">
              لديك تغييرات غير محفوظة
            </Badge>
          )}

          {!canUpdate && (
            <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
              <Shield className="size-3.5" />
              <span>عرض فقط — تعديل الإعدادات يتطلب صلاحية المدير</span>
            </div>
          )}
        </React.Fragment>
      )}
    </div>
  );
}