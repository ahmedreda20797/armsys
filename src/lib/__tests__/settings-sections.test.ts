// ══════════════════════════════════════════════════════════════
//  §SETTINGS-SECTIONS — Settings Center internal navigation guards.
//
//  Behavioral: the section-state sanitizer's fail-safe rules.
//  Static: the Settings Center keeps ONE internal navigation (no
//  section click may leave Settings), reuses the canonical page
//  components, carries the readiness model, and wires the section
//  into the canonical browser-history layer. Companion to the
//  settings-consolidation guards (which keep the center ONE).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeSettingsSection } from '@/lib/settings/sections';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('§SETTINGS-SECTIONS — section-state sanitizer (fail-safe)', () => {
  const allowed = new Set(['general', 'masterData', 'controlPanel'] as const);

  it('resolves an allowed candidate to itself', () => {
    assert.equal(sanitizeSettingsSection('masterData', allowed, 'general'), 'masterData');
  });

  it('fails safe to the fallback for unknown / stale keys', () => {
    assert.equal(sanitizeSettingsSection('doesNotExist', allowed, 'general'), 'general');
    assert.equal(sanitizeSettingsSection('', allowed, 'general'), 'general');
    assert.equal(sanitizeSettingsSection(null, allowed, 'general'), 'general');
    assert.equal(sanitizeSettingsSection(undefined, allowed, 'general'), 'general');
  });

  it('fails safe when the candidate lost its permission grant', () => {
    assert.equal(sanitizeSettingsSection('controlPanel', allowed, 'general'), 'controlPanel');
    const narrowed = new Set(['general', 'masterData'] as const);
    assert.equal(sanitizeSettingsSection('controlPanel', narrowed, 'general'), 'general',
      'a section the user can no longer see must never render');
  });
});

describe('§SETTINGS-SECTIONS — the Settings Center navigates internally', () => {
  const settingsPage = read('src/components/pages/SettingsPage.tsx');
  const SECTION_IDS = [
    'general', 'masterData', 'controlPanel', 'organization', 'kpiSettings',
    'rulesEngine', 'rules', 'monthClose', 'qualityAuditLog', 'workflowDesigner',
  ] as const;

  it('declares ONE canonical section model with every section id', () => {
    assert.ok(settingsPage.includes('§SETTINGS-SECTIONS'), 'canonical marker');
    for (const id of SECTION_IDS) {
      assert.ok(settingsPage.includes(`'${id}'`), `section id ${id} missing`);
    }
  });

  it('section rows switch sections — they never navigate to another page', () => {
    assert.ok(settingsPage.includes('navigateTo(\'settings\', undefined, { section: id })'),
      'the canonical same-page section switch must be used');
    // §SETTINGS-CENTER v2 — the COMPACT section navigation: the shell
    // delegates to SettingsSectionNav and every selection lands in the
    // same-page selectSection (no global navigation, no remount).
    assert.ok(settingsPage.includes('onSelect={(id) => selectSection(id as SettingsSectionId)}'),
      'the compact nav routes selections through selectSection');
    const sectionNav = read('src/components/pages/settings/SettingsSectionNav.tsx');
    assert.ok(sectionNav.includes('onSelect(id)'), 'nav rows call onSelect only');
    assert.ok(!sectionNav.includes('navigateTo('), 'the section nav never navigates globally');
    assert.ok(settingsPage.includes("canViewPage('settings')"),
      'the legacy-route fallback into the center stays permission-guarded');
  });

  it('page-backed sections reuse the canonical page components (no re-implementation)', () => {
    for (const path of [
      '@/components/pages/ControlPanelPage',
      '@/components/pages/organization/OrganizationPage',
      '@/components/pages/quality-kpi/PerformanceEngineSettingsPage',
      '@/components/pages/RulesEnginePage',
      '@/components/pages/RulesPage',
      '@/components/pages/quality-kpi/MonthClosePage',
      '@/components/pages/quality-kpi/QualityAuditLogPage',
      '@/components/pages/workflow-designer/WorkflowDesignerPage',
    ]) {
      assert.ok(settingsPage.includes(`import('${path}')`), `missing dynamic reuse of ${path}`);
    }
  });

  it('keeps the legacy deep-link props (Master Data domain + compat identity)', () => {
    assert.ok(settingsPage.includes('initialDomain={initialDomain}'), 'domain deep-link preserved');
    assert.ok(settingsPage.includes('routePageId ?? \'settings\''), 'compat page identity preserved');
  });

  it('the section state derives from the canonical navigation surface', () => {
    assert.ok(settingsPage.includes('s.navParams.section'), 'section read from navParams');
    assert.ok(settingsPage.includes('sanitizeSettingsSection(navSection, allowedSections, \'general\')'),
      'unknown / permission-lost sections fail safe');
  });
});

describe('§SETTINGS-READINESS — under-preparation state', () => {
  const settingsPage = read('src/components/pages/SettingsPage.tsx');
  const placeholder = read('src/components/pages/settings/SectionUnderPreparation.tsx');
  const enMap = read('src/lib/i18n/en-map.ts');

  it('every section carries an audited readiness value', () => {
    assert.ok(settingsPage.includes('SECTION_READINESS: Record<SettingsSectionId, \'ready\' | \'underPreparation\'>'),
      'the readiness model must cover the full section id type');
  });

  it('an under-preparation section renders the canonical slot — never a fake screen', () => {
    assert.ok(settingsPage.includes('SECTION_READINESS[section] === \'underPreparation\''));
    assert.ok(settingsPage.includes('<SectionUnderPreparation />'));
  });

  it('the slot ships the exact AR/EN copy from the task (§8)', () => {
    assert.ok(placeholder.includes('هذا القسم قيد التهيئة'));
    assert.ok(placeholder.includes('نعمل حاليًا على تجهيز إعدادات هذا القسم. سيصبح متاحًا عند اكتمال التهيئة.'));
    assert.match(enMap, /'هذا القسم قيد التهيئة': 'This section is under preparation'/);
    assert.match(enMap, /'نعمل حاليًا على تجهيز إعدادات هذا القسم\. سيصبح متاحًا عند اكتمال التهيئة\.': 'This settings section is currently being prepared and will become available when implementation is complete\.'/);
    assert.match(enMap, /'قيد التهيئة': 'Under preparation'/);
  });

  it('planned Master Data domains render the same canonical slot (§10 — never hidden)', () => {
    const masterData = read('src/components/pages/settings/MasterDataSection.tsx');
    assert.ok(masterData.includes('<SectionUnderPreparation />'));
    const registry = read('src/lib/master-data/registry.ts');
    const planned = (registry.match(/status: 'planned'/g) ?? []).length;
    // §AUDITED-RESERVATION — dealStatuses + travelServiceTypes stay
    // reserved: their vocabularies are structurally load-bearing
    // (closure accounting, travel tabs, server-side booking-item
    // validation) and mount together with that engine wiring.
    assert.equal(planned, 2, `exactly the audited reservations stay planned (found ${planned})`);
    for (const plannedId of ['dealStatuses', 'travelServiceTypes']) {
      assert.ok(registry.includes(`id: '${plannedId}'`), `${plannedId} stays reserved`);
    }
    for (const availableId of ['followUpTypes', 'complaintTypes', 'requestTypes']) {
      assert.ok(registry.includes(`id: '${availableId}'`), `${availableId} declared`);
    }
    assert.ok((registry.match(/status: 'available'/g) ?? []).length >= 4,
      'the implemented domains are declared available');
  });
});

describe('§SETTINGS-SECTIONS — canonical history integration (§13)', () => {
  it('a section shift is a history sub-destination, not an in-place replace', () => {
    const controller = read('src/lib/navigation/qnalys-history.ts');
    assert.ok(controller.includes('isSettingsSectionShift'), 'section-shift detection');
    assert.ok(controller.includes('§SETTINGS-SECTIONS'), 'documented exception');
  });

  it('popstate / reload adoption restores the settings section (Test D + §14)', () => {
    const store = read('src/lib/store.ts');
    assert.match(store, /entry\.page === 'settings' \? \(entry\.navParams \?\? \{\}\) : \{\}/,
      'settings-scoped navParams restoration');
    const binding = read('src/components/navigation/NavigationHistoryController.tsx');
    assert.ok(binding.includes('navParams: entry.navParams'), 'binding passes entry navParams');
  });
});

describe('§SETTINGS-CENTER v2 — compact section navigation + permission gating', () => {
  const settingsPage = read('src/components/pages/SettingsPage.tsx');
  const nav = read('src/components/pages/settings/SettingsSectionNav.tsx');

  it('section access resolves from PERMISSIONS, not sidebar visibility', () => {
    // §SETTINGS-CENTER §12 — the section pages are overlayOnly (no
    // sidebar destination) but remain full Settings sections for every
    // grant holder: the center must gate by canViewPage.
    assert.ok(settingsPage.includes('if (canViewPage(id)) allowed.add(id)'),
      'allowedSections gated by canViewPage');
    assert.ok(!settingsPage.includes('visiblePageIds.has(id)'),
      'sidebar visibility must not gate Settings sections');
  });

  it('the compact nav is collapsible on desktop and a drawer on mobile', () => {
    assert.ok(nav.includes('panelOpen'), 'desktop collapsible panel state');
    assert.ok(nav.includes('drawerOpen'), 'mobile drawer state');
    assert.ok(nav.includes('setDrawerOpen(false)'), 'the drawer closes after a selection');
    assert.ok(nav.includes('aria-expanded={panelOpen || drawerOpen}'), 'the trigger exposes its state');
    assert.ok(nav.includes('aria-label=' + JSON.stringify('أقسام الإعدادات')), 'the surfaces are labeled navigation');
  });
});
