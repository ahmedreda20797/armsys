'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDateTime } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
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
import {
  Settings2, Save, Shield, TrendingUp, Award, Lock, BarChart3,
} from 'lucide-react';
import {
  useKpiSettings, useUpdateKpiSettings,
} from '@/hooks/use-kpi-queries';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';

// ─── Trend options ────────────────────────────────────────────
const TREND_OPTIONS: { value: TrendCalculation; label: string; hint: string }[] = [
  { value: 'rollingAverage', label: 'المتوسط المتحرك', hint: 'يقارن أحدث درجة بمتوسط كل الأشهر' },
  { value: 'movingScore', label: 'الدرجة المتحركة', hint: 'يستخدم آخر درجة مع عتبة صارمة' },
  { value: 'simpleAverage', label: 'المتوسط البسيط', hint: 'يقارن الشهر بالشهر السابق مباشرة' },
];

// ─── Settings form state ──────────────────────────────────────
interface SettingsForm {
  defaultScore: number;
  minimumScore: number;
  allowBonus: boolean;
  maximumBonus: number;
  approvalRequired: boolean;
  leaderboardEnabled: boolean;
  closeMonthLock: boolean;
  trendCalculation: TrendCalculation;
}

function toForm(s: Partial<KpiSettings>): SettingsForm {
  return {
    defaultScore: s.defaultScore ?? 100,
    minimumScore: s.minimumScore ?? 0,
    allowBonus: s.allowBonus ?? true,
    maximumBonus: s.maximumBonus ?? 20,
    approvalRequired: s.approvalRequired ?? true,
    leaderboardEnabled: s.leaderboardEnabled ?? true,
    closeMonthLock: s.closeMonthLock ?? true,
    trendCalculation: s.trendCalculation ?? 'rollingAverage',
  };
}

// ─── Setting row component ────────────────────────────────────
function SettingRow({
  icon: Icon, title, description, children,
}: {
  icon: typeof Shield;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { locale } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-800/60 last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="size-8 rounded-lg bg-slate-800/60 flex items-center justify-center shrink-0">
          <Icon className="size-4 text-blue-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{translateUIText(title, locale)}</p>
          <p className="text-xs text-slate-500">{translateUIText(description, locale)}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function KpiSettingsPage() {
  const { canView, canUpdate } = usePermissions('kpiSettings');
  const { locale } = useLanguage();
  const { data, isLoading } = useKpiSettings();
  const updateMut = useUpdateKpiSettings();

  const settings = (data ?? {}) as Partial<KpiSettings>;
  const [form, setForm] = useState<SettingsForm>(toForm(settings));
  const [initialized, setInitialized] = useState(false);

  // Initialize form once data arrives.
  if (!initialized && data) {
    setForm(toForm(settings));
    setInitialized(true);
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p><T>ليس لديك صلاحية للوصول إلى هذه الصفحة</T></p>
      </div>
    );
  }

  function update<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    // Validate
    if (form.defaultScore < 0) { toast.error(translateUIText('الدرجة الافتراضية غير صحيحة', locale)); return; }
    if (form.minimumScore < 0) { toast.error(translateUIText('الحد الأدنى غير صحيح', locale)); return; }
    if (form.maximumBonus < 0) { toast.error(translateUIText('حد المكافأة غير صحيح', locale)); return; }
    if (form.allowBonus && form.maximumBonus === 0) {
      toast.warning(translateUIText('المكافآت مفعّلة لكن حدّها الأقصى صفر', locale));
    }

    try {
      await updateMut.mutateAsync(form as unknown as Record<string, unknown>);
      toast.success(translateUIText('تم حفظ الإعدادات', locale));
    } catch (e) {
      toast.error(translateUIText('فشل الحفظ', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Settings2 className="size-6 text-blue-400" />
            <T>إعدادات محرك المؤشرات</T>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            <T>تكوين مركزي لكل سلوكيات محرك الأداء — التغييرات تنطبق على الحسابات اللاحقة</T>
          </p>
        </div>
        {canUpdate && (
          <Button onClick={handleSave} disabled={!dirty || updateMut.isPending} className="gap-2">
            <Save className="size-4" />
            <T>{updateMut.isPending ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}</T>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          {/* Scoring config */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 pb-2">
                <BarChart3 className="size-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-200"><T>معادلة الدرجات</T></h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-2">
                <div className="space-y-1">
                  <Label><T>الدرجة الابتدائية</T></Label>
                  <Input
                    type="number" min={0} disabled={!canUpdate}
                    value={form.defaultScore}
                    onChange={(e) => update('defaultScore', parseInt(e.target.value, 10) || 0)}
                    className="bg-slate-800/50 border-slate-700"
                  />
                  <p className="text-[11px] text-slate-500"><T>النقطة التي يبدأ منها كل موظف</T></p>
                </div>
                <div className="space-y-1">
                  <Label><T>الحد الأدنى للدرجة</T></Label>
                  <Input
                    type="number" min={0} disabled={!canUpdate}
                    value={form.minimumScore}
                    onChange={(e) => update('minimumScore', parseInt(e.target.value, 10) || 0)}
                    className="bg-slate-800/50 border-slate-700"
                  />
                  <p className="text-[11px] text-slate-500"><T>لا تنزل الدرجة beneath هذا الحد</T></p>
                </div>
                <div className="space-y-1">
                  <Label><T>حد المكافأة الأقصى</T></Label>
                  <Input
                    type="number" min={0} disabled={!canUpdate || !form.allowBonus}
                    value={form.maximumBonus}
                    onChange={(e) => update('maximumBonus', parseInt(e.target.value, 10) || 0)}
                    className="bg-slate-800/50 border-slate-700"
                  />
                  <p className="text-[11px] text-slate-500"><T>سقف النقاط الإضافية المضافة</T></p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toggles */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 pb-1">
                <Shield className="size-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-200"><T>السلوكيات</T></h3>
              </div>

              <SettingRow
                icon={Award}
                title="تفعيل المكافآت"
                description="السماح بإضافة نقاط إيجابية للدرجات"
              >
                <Switch
                  checked={form.allowBonus}
                  onCheckedChange={(v) => update('allowBonus', v)}
                  disabled={!canUpdate}
                />
              </SettingRow>

              <SettingRow
                icon={Shield}
                title="اعتماد المدير إلزامي"
                description="تتطلب ملاحظات الخصم موافقة قبل احتسابها"
              >
                <Switch
                  checked={form.approvalRequired}
                  onCheckedChange={(v) => update('approvalRequired', v)}
                  disabled={!canUpdate}
                />
              </SettingRow>

              <SettingRow
                icon={BarChart3}
                title="لوحة المتصدرين"
                description="عرض قوائم الأعلى والأدنى أداءً"
              >
                <Switch
                  checked={form.leaderboardEnabled}
                  onCheckedChange={(v) => update('leaderboardEnabled', v)}
                  disabled={!canUpdate}
                />
              </SettingRow>

              <SettingRow
                icon={Lock}
                title="قفل الأشهر المغلقة"
                description="منع تعديل الملاحظات بعد إغلاق الشهر"
              >
                <Switch
                  checked={form.closeMonthLock}
                  onCheckedChange={(v) => update('closeMonthLock', v)}
                  disabled={!canUpdate}
                />
              </SettingRow>
            </CardContent>
          </Card>

          {/* Trend calculation */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-200"><T>طريقة حساب الاتجاه</T></h3>
              </div>
              <Select
                value={form.trendCalculation}
                onValueChange={(v) => update('trendCalculation', v as TrendCalculation)}
                disabled={!canUpdate}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <T>{opt.label}</T>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                <T>{TREND_OPTIONS.find((o) => o.value === form.trendCalculation)?.hint ?? ''}</T>
              </p>
            </CardContent>
          </Card>

          {/* Last updated */}
          {settings.updatedAt && (
            <p className="text-xs text-slate-500 text-center">
              <T>آخر تحديث: </T>{formatDateTime(settings.updatedAt, locale)}
            </p>
          )}

          {!canUpdate && (
            <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
              <Shield className="size-3.5" />
              <span><T>عرض فقط — تعديل الإعدادات يتطلب صلاحية المدير</T></span>
            </div>
          )}

          {/* Status badge */}
          {dirty && canUpdate && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 block text-center py-1.5">
              <T>لديك تغييرات غير محفوظة</T>
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
