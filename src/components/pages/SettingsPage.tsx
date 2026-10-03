'use client';

// ═══════════════════════════════════════════════════════════════
//  SettingsPage — §SETTINGS-CENTER the ONE centralized Settings
//  Center for Qnalys.
//
//  INTERNAL NAVIGATION over the existing settings architecture:
//    • عام (General)                — personal preferences (embedded)
//    • البيانات المرجعية            — Master Data & System Lists
//      (Master Data)                  (embedded — new framework)
//    • Links to the CANONICAL system-config pages, which keep their
//      own registered pages, permission keys, APIs and sources of
//      truth (zero duplication — consolidation, not re-creation):
//        مركز التحكم (users/permissions/sessions/logs)
//        الهيكل التنظيمي، إعدادات محرك الأداء، الأتمتة والقواعد،
//        قواعد الخصم، إغلاق الشهر، سجل مراجعة الجودة، مصمم المسارات.
//
//  The legacy `observationCategories` page id routes INTO this center
//  (deep-linked to its Master Data domain) so existing permission
//  grants keep working with exactly ONE settings UI.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import {
  Languages, Moon, Sun, Monitor, Settings2, Database, Shield, Network,
  Gauge, Zap, Scale, CalendarCog, ScrollText, Workflow, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePermissions } from '@/hooks/usePermissions';
import { localizedPageDescription, localizedPageLabel } from '@/config/permissions';
import { cn } from '@/lib/utils';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';

const MasterDataSection = dynamic(
  () => import('@/components/pages/settings/MasterDataSection'),
  { ssr: false },
);

type SettingsSectionId =
  | 'general' | 'masterData'
  | 'controlPanel' | 'organization' | 'kpiSettings' | 'rulesEngine'
  | 'rules' | 'monthClose' | 'qualityAuditLog' | 'workflowDesigner';

/** Sections rendered INSIDE the center. */
const EMBEDDED_SECTIONS: SettingsSectionId[] = ['general', 'masterData'];

/** Sections that deep-link to their canonical registered page. */
const LINKED_SECTIONS: Array<{ id: SettingsSectionId; icon: React.ReactNode }> = [
  { id: 'controlPanel', icon: <Shield className="size-4" /> },
  { id: 'organization', icon: <Network className="size-4" /> },
  { id: 'kpiSettings', icon: <Gauge className="size-4" /> },
  { id: 'rulesEngine', icon: <Zap className="size-4" /> },
  { id: 'rules', icon: <Scale className="size-4" /> },
  { id: 'monthClose', icon: <CalendarCog className="size-4" /> },
  { id: 'qualityAuditLog', icon: <ScrollText className="size-4" /> },
  { id: 'workflowDesigner', icon: <Workflow className="size-4" /> },
];

function embeddedSectionTitle(id: SettingsSectionId, locale: Locale): string {
  if (id === 'general') return translateUIText('عام', locale);
  return translateUIText('البيانات المرجعية والقوائم النظامية', locale);
}

function embeddedSectionDescription(id: SettingsSectionId, locale: Locale): string {
  if (id === 'general') return translateUIText('لغتك ومظهر النظام — تفضيلات شخصية لكل مستخدم', locale);
  return translateUIText('قوائم الأعمال القابلة للتكوين — مصدر واحد لكل قائمة', locale);
}

// ─── General section (personal preferences — unchanged behavior) ──
function GeneralSection() {
  const { locale, setLocale, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One-time hydration flag — state must flip after SSR completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard
    setMounted(true);
  }, []);

  const localeOptions: Array<{ value: Locale; native: string }> = [
    { value: 'ar', native: 'العربية' },
    { value: 'en', native: 'English' },
  ];

  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <Monitor className="size-4 text-cyan-400" />
          {t('settings.appearance')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Language */}
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Languages className="size-3.5 text-slate-400" />
            {t('settings.language')}
          </p>
          <div className="flex items-center gap-2">
            {localeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLocale(opt.value)}
                aria-pressed={mounted && locale === opt.value}
                className={cn(
                  'px-4 py-2 rounded-xl border text-xs font-semibold transition-all',
                  mounted && locale === opt.value
                    ? 'bg-brand-500/20 border-brand-500/50 text-brand-200 ring-1 ring-brand-500/40'
                    : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200',
                )}
              >
                {opt.native}
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            {mounted && theme === 'light' ? <Sun className="size-3.5 text-amber-400" /> : <Moon className="size-3.5 text-slate-400" />}
            {t('settings.theme')}
          </p>
          <div className="flex items-center gap-2">
            {([
              { v: 'dark', label: t('settings.theme.dark'), icon: Moon },
              { v: 'light', label: t('settings.theme.light'), icon: Sun },
              { v: 'system', label: t('settings.theme.system'), icon: Monitor },
            ]).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setTheme(opt.v)}
                aria-pressed={mounted && theme === opt.v}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all',
                  mounted && theme === opt.v
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 ring-1 ring-cyan-500/30'
                    : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200',
                )}
              >
                <opt.icon className="size-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── The Settings Center ──────────────────────────────────────
export default function SettingsPage({
  initialSection,
  initialDomain,
  routePageId,
}: {
  /** Deep-link: section shown on mount (e.g. from the legacy categories route). */
  initialSection?: string;
  /** Deep-link: Master Data domain preselected on mount. */
  initialDomain?: string;
  /** Registry page id to register identity under when mounted for a
   *  legacy route (defaults to 'settings'). */
  routePageId?: string;
}) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const navParams = useAppStore((s) => s.navParams);
  const { locale } = useLanguage();
  const { visiblePages } = usePermissions();
  const visiblePageIds = useMemo(() => new Set(visiblePages.map((p) => p.id)), [visiblePages]);

  const requested = (initialSection ?? (navParams?.section as string | undefined)) as SettingsSectionId | undefined;
  const [section, setSection] = useState<SettingsSectionId>(
    requested && (EMBEDDED_SECTIONS.includes(requested) || LINKED_SECTIONS.some((s) => s.id === requested))
      ? requested
      : 'general',
  );

  const titleFor = (id: SettingsSectionId): string =>
    EMBEDDED_SECTIONS.includes(id)
      ? embeddedSectionTitle(id, locale)
      : localizedPageLabel(id, locale);
  const descriptionFor = (id: SettingsSectionId): string | undefined =>
    EMBEDDED_SECTIONS.includes(id)
      ? embeddedSectionDescription(id, locale)
      : (localizedPageDescription(id, locale) ?? localizedPageDescription(id, 'ar'));

  const isEmbedded = EMBEDDED_SECTIONS.includes(section);
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-5">
      <PageIdentity
        pageId={routePageId ?? 'settings'}
        icon={<Settings2 className="size-5" />}
        iconClassName="bg-slate-500/15 border-slate-500/30 text-slate-300"
        description={routePageId
          ? localizedPageDescription(routePageId, locale)
          : localizedPageDescription('settings', locale)}
      />

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Section navigation — RTL/LTR aware (start border flips) */}
        <aside className="lg:w-64 shrink-0 space-y-1">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <T>أقسام الإعدادات</T>
          </p>
          {/* Embedded sections first */}
          {EMBEDDED_SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? 'true' : undefined}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-all',
                section === id
                  ? 'bg-brand-500/10 border-brand-500/40 text-brand-200'
                  : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200',
              )}
            >
              <span className={cn(
                'flex items-center justify-center size-7 rounded-lg border shrink-0',
                section === id ? 'bg-brand-500/15 border-brand-500/30 text-brand-300' : 'bg-slate-800/50 border-slate-700/50',
              )}>
                {id === 'general' ? <Settings2 className="size-3.5" /> : <Database className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold truncate">{titleFor(id)}</span>
                <span className="block text-[10px] text-slate-500 truncate">{descriptionFor(id)}</span>
              </span>
            </button>
          ))}

          {/* Canonical config pages — consolidated navigation */}
          {LINKED_SECTIONS.filter(({ id }) => visiblePageIds.has(id)).map(({ id, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => navigateTo(id)}
              className="w-full flex items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 text-start transition-all text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            >
              <span className="flex items-center justify-center size-7 rounded-lg border shrink-0 bg-slate-800/50 border-slate-700/50">
                {icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold truncate">{titleFor(id)}</span>
                <span className="block text-[10px] text-slate-500 truncate">{descriptionFor(id)}</span>
              </span>
              <Chevron className="size-3.5 text-slate-600 shrink-0" />
            </button>
          ))}
        </aside>

        {/* Focused workspace */}
        <div className="flex-1 min-w-0">
          {section === 'general' && <GeneralSection />}
          {section === 'masterData' && <MasterDataSection initialDomain={initialDomain} />}
        </div>
      </div>
    </div>
  );
}
