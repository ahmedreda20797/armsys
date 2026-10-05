'use client';

// ═══════════════════════════════════════════════════════════════
//  SettingsPage — §SETTINGS-CENTER the ONE centralized Settings
//  Center for Qnalys.
//
//  §SETTINGS-SECTIONS — ONE workspace, ONE internal navigation.
//  Every right-side section is an INTERNAL section of this center;
//  clicking one NEVER leaves Settings — only the content area swaps:
//    • عام (General)                — personal preferences (embedded)
//    • البيانات المرجعية            — Master Data & System Lists
//      (Master Data)                  (embedded — new framework)
//    • The CANONICAL system-config sections — their EXISTING page
//      components render inside the content area (zero duplication:
//      same components, registered page ids, permission keys, APIs
//      and sources of truth — consolidation, not re-creation):
//        مركز التحكم، الهيكل التنظيمي، إعدادات محرك الأداء،
//        الأتمتة والقواعد، قواعد الخصم، إغلاق الشهر،
//        سجل مراجعة الجودة، مصمم المسارات.
//
//  SECTION STATE is the canonical navigation surface: the active
//  section lives in store.navParams.section on the 'settings' route,
//  so the shell stays mounted while sections swap, and §NAVIGATION-
//  HISTORY records every section shift as a real sub-destination
//  entry (Browser Back/Forward move between sections while staying
//  inside Settings; reload adoption restores the section — §14).
//
//  §SETTINGS-READINESS — sections/domains whose implementation is
//  not finished render the canonical SectionUnderPreparation slot
//  (never a fake screen, never a navigation elsewhere) and stay
//  visible in the navigation with a 'قيد التهيئة' state.
//
//  The legacy `observationCategories` page id routes INTO this center
//  (deep-linked to its Master Data domain) so existing permission
//  grants keep working with exactly ONE settings UI. On that compat
//  route the embedded sections switch in place; a page-backed section
//  navigates into the canonical center when the user holds the
//  settings grant, else keeps the historical direct-page navigation
//  (the PageRouter still gates every target — §15/§16).
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import {
  Languages, Moon, Sun, Monitor, Settings2, Database, Shield, Network,
  Gauge, Zap, Scale, CalendarCog, ScrollText, Workflow,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePermissions } from '@/hooks/usePermissions';
import { localizedPageDescription, localizedPageLabel } from '@/config/permissions';
import { cn } from '@/lib/utils';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { sanitizeSettingsSection } from '@/lib/settings/sections';
import { SectionUnderPreparation } from '@/components/pages/settings/SectionUnderPreparation';
import { SettingsSectionNav } from '@/components/pages/settings/SettingsSectionNav';
import type { Locale } from '@/lib/i18n/dictionary';

const MasterDataSection = dynamic(
  () => import('@/components/pages/settings/MasterDataSection'),
  { ssr: false },
);

// §SETTINGS-SECTIONS — page-backed sections reuse their CANONICAL
// page components (the same lazy chunks the page router mounts);
// they simply render inside the Settings content area now.
function SectionLoading() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true">
      <div className="h-9 w-56 rounded-lg bg-slate-800/50" />
      <div className="h-44 rounded-2xl bg-slate-800/30" />
    </div>
  );
}

const ControlPanelSection = dynamic(
  () => import('@/components/pages/ControlPanelPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const OrganizationSection = dynamic(
  () => import('@/components/pages/organization/OrganizationPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const KpiSettingsSection = dynamic(
  () => import('@/components/pages/quality-kpi/PerformanceEngineSettingsPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const RulesEngineSection = dynamic(
  () => import('@/components/pages/RulesEnginePage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const DeductionRulesSection = dynamic(
  () => import('@/components/pages/RulesPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const MonthCloseSection = dynamic(
  () => import('@/components/pages/quality-kpi/MonthClosePage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const QualityAuditLogSection = dynamic(
  () => import('@/components/pages/quality-kpi/QualityAuditLogPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);
const WorkflowDesignerSection = dynamic(
  () => import('@/components/pages/workflow-designer/WorkflowDesignerPage'),
  { ssr: false, loading: () => <SectionLoading /> },
);

type SettingsSectionId =
  | 'general' | 'masterData'
  | 'controlPanel' | 'organization' | 'kpiSettings' | 'rulesEngine'
  | 'rules' | 'monthClose' | 'qualityAuditLog' | 'workflowDesigner';

/** Sections rendered INSIDE the center as first-class workspaces. */
const EMBEDDED_SECTIONS: SettingsSectionId[] = ['general', 'masterData'];

/**
 * §SETTINGS-SECTIONS — sections backed by their canonical registered
 * pages. They render INSIDE the center (the shell never navigates
 * away); the registry page id remains their permission + API identity.
 */
const PAGE_SECTIONS: Array<{ id: SettingsSectionId; icon: React.ReactNode }> = [
  { id: 'controlPanel', icon: <Shield className="size-4" /> },
  { id: 'organization', icon: <Network className="size-4" /> },
  { id: 'kpiSettings', icon: <Gauge className="size-4" /> },
  { id: 'rulesEngine', icon: <Zap className="size-4" /> },
  { id: 'rules', icon: <Scale className="size-4" /> },
  { id: 'monthClose', icon: <CalendarCog className="size-4" /> },
  { id: 'qualityAuditLog', icon: <ScrollText className="size-4" /> },
  { id: 'workflowDesigner', icon: <Workflow className="size-4" /> },
];

/**
 * §SETTINGS-READINESS — the audited implementation state per section
 * (renderer, data source, API, permissions, localization verified).
 * An 'underPreparation' section renders the canonical SectionUnder-
 * Preparation slot; it is NEVER hidden or removed (§10) and NEVER
 * behaves like a finished section (§8). Every top-level section is
 * implemented today — the not-ready slots live at the Master Data
 * domain level (registry status 'planned').
 */
const SECTION_READINESS: Record<SettingsSectionId, 'ready' | 'underPreparation'> = {
  general: 'ready',
  masterData: 'ready',
  controlPanel: 'ready',
  organization: 'ready',
  kpiSettings: 'ready',
  rulesEngine: 'ready',
  rules: 'ready',
  monthClose: 'ready',
  qualityAuditLog: 'ready',
  workflowDesigner: 'ready',
};

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
  const navSection = useAppStore((s) => s.navParams.section);
  const { locale } = useLanguage();
  const { canViewPage } = usePermissions();

  // ── §SETTINGS-SECTIONS — the ONE canonical active section ──
  //  • Canonical 'settings' route: derived FROM navParams.section
  //    (the navigation surface IS the state) — popstate restoration
  //    and reload adoption restore it; unknown or permission-lost
  //    values fail safe to the default section (§16).
  //  • Legacy compat route: local state seeded from the deep-link —
  //    the compat page keeps its registry identity, and its embedded
  //    sections switch in place without any navigation.
  const isLegacyRoute = Boolean(routePageId);
  const [legacySection, setLegacySection] = useState<SettingsSectionId>(() => {
    const requested = (initialSection ?? navSection) as SettingsSectionId | undefined;
    return requested && (EMBEDDED_SECTIONS.includes(requested) || PAGE_SECTIONS.some((s) => s.id === requested))
      ? requested
      : 'general';
  });

  // §SETTINGS-SECTIONS §12 — section access resolves from the CANONICAL
  // PERMISSION (canViewPage), never from global-sidebar visibility:
  // the section pages are overlayOnly (no sidebar destination) but
  // remain full Settings sections for everyone who holds their grant.
  const allowedSections = useMemo(() => {
    const allowed = new Set<SettingsSectionId>(EMBEDDED_SECTIONS);
    for (const { id } of PAGE_SECTIONS) {
      if (canViewPage(id)) allowed.add(id);
    }
    return allowed;
  }, [canViewPage]);

  const section = isLegacyRoute
    ? legacySection
    : sanitizeSettingsSection(navSection, allowedSections, 'general');

  const selectSection = (id: SettingsSectionId): void => {
    if (id === section) return; // identical destination — no-op (§20)
    if (routePageId) {
      // §LEGACY-ROUTE — the compat deep-link keeps its registry page
      // identity. Embedded sections switch in place; page-backed
      // sections move into the canonical center when the user holds
      // the settings grant.
      if (EMBEDDED_SECTIONS.includes(id)) {
        setLegacySection(id);
        return;
      }
      if (canViewPage('settings')) {
        navigateTo('settings', undefined, { section: id });
        return;
      }
      navigateTo(id); // historical direct-page navigation — PageRouter gates it
      return;
    }
    // §SETTINGS-SECTIONS — same-page sub-destination update: the
    // shell stays mounted and the history controller records the
    // section as a real Back/Forward-able entry.
    navigateTo('settings', undefined, { section: id });
  };

  const titleFor = (id: SettingsSectionId): string =>
    EMBEDDED_SECTIONS.includes(id)
      ? embeddedSectionTitle(id, locale)
      : localizedPageLabel(id, locale);
  const descriptionFor = (id: SettingsSectionId): string | undefined =>
    EMBEDDED_SECTIONS.includes(id)
      ? embeddedSectionDescription(id, locale)
      : (localizedPageDescription(id, locale) ?? localizedPageDescription(id, 'ar'));

  const sectionRows = [
    { id: 'general' as const, icon: <Settings2 className="size-3.5" /> },
    { id: 'masterData' as const, icon: <Database className="size-3.5" /> },
    ...PAGE_SECTIONS.filter(({ id }) => canViewPage(id)),
  ].map(({ id, icon }) => ({
    id,
    icon,
    title: titleFor(id),
    description: descriptionFor(id),
    underPreparation: SECTION_READINESS[id] === 'underPreparation',
  }));

  return (
    <div className="space-y-5">
      <PageIdentity
        pageId={routePageId ?? 'settings'}
        icon={<Settings2 className="size-5" />}
        iconClassName="bg-slate-500/15 border-slate-500/30 text-slate-300"
        description={routePageId
          ? localizedPageDescription(routePageId, locale)
          : titleFor(section)}
      />

      {/* §SETTINGS-CENTER — ONE compact section navigation (collapsible
          panel on desktop, drawer on mobile) above the workspace; the
          oversized always-visible section rail is gone and the content
          area reclaims its space. */}
      <SettingsSectionNav
        sections={sectionRows}
        activeId={section}
        onSelect={(id) => selectSection(id as SettingsSectionId)}
      />

      {/* Focused workspace — the ONLY thing that changes when a
            section is selected; the Settings shell never unmounts. */}
      <div className="min-w-0">
          {SECTION_READINESS[section] === 'underPreparation' ? (
            <SectionUnderPreparation />
          ) : (
            <>
              {section === 'general' && <GeneralSection />}
              {section === 'masterData' && <MasterDataSection initialDomain={initialDomain} />}
              {section === 'controlPanel' && <ControlPanelSection />}
              {section === 'organization' && <OrganizationSection />}
              {section === 'kpiSettings' && <KpiSettingsSection />}
              {section === 'rulesEngine' && <RulesEngineSection />}
              {section === 'rules' && <DeductionRulesSection />}
              {section === 'monthClose' && <MonthCloseSection />}
              {section === 'qualityAuditLog' && <QualityAuditLogSection />}
              {section === 'workflowDesigner' && (
                // The designer is a full-viewport authoring tool — it
                // keeps that ergonomics inside the workspace via a
                // height-constrained host (its own layout is untouched).
                <div className="h-[calc(100vh-14rem)] min-h-[560px] overflow-hidden rounded-2xl border border-slate-800/60 [&>div]:h-full">
                  <WorkflowDesignerSection />
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
