// ══════════════════════════════════════════════════════════════
//  Settings consolidation — STATIC consolidation guards.
//
//  §53/§54 acceptance as regression tests: ONE settings center, ONE
//  Master Data registry, ONE canonical category source, and consumer
//  surfaces that go through the canonical presentation pipeline.
//  These guards fail if a parallel settings/category architecture
//  reappears.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function filesContaining(needle: string, roots: string[]): string[] {
  // Deliberately minimal recursive walk (no glob dependency).
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!/node_modules|\.next|__tests__/.test(full)) walk(full);
        continue;
      }
      if (!/\.(tsx?|mts)$/.test(entry)) continue;
      let content = '';
      try { content = readFileSync(full, 'utf8'); } catch { continue; }
      if (content.includes(needle)) hits.push(full.split(process.cwd()).pop()!.replace(/\\/g, '/').replace(/^\//, ''));
    }
  };
  for (const root of roots) walk(join(process.cwd(), root));
  return hits;
}

describe('§ONE-SOURCE — the category vocabulary has exactly one canonical definition', () => {
  it('the stable seed keys are defined ONLY in the master-data provider', () => {
    const hits = filesContaining("key: 'late_followup'", ['src']);
    assert.deepEqual(hits, ['src/lib/observation-categories/index.ts'],
      `category vocabulary leaked to: ${hits.join(', ')}`);
  });

  it('no consumer component holds a hard-coded category list', () => {
    for (const consumer of [
      'src/components/pages/quality-kpi/ObservationsPage.tsx',
      'src/components/pages/quality-kpi/ObservationTemplatesPage.tsx',
      'src/components/pages/settings/ObservationCategoriesWorkspace.tsx',
      'src/components/shared/HomeQuickActionHost.tsx',
    ]) {
      const source = read(consumer);
      for (const legacyName of ['مخالفة أمان', 'أداء ممتاز', 'تأخر متابعة']) {
        assert.ok(!source.includes(legacyName), `${consumer} hard-codes "${legacyName}"`);
      }
    }
  });

  it('the legacy standalone categories page is gone (routes into the Settings Center)', () => {
    assert.equal(existsSync(join(process.cwd(), 'src/components/pages/quality-kpi/ObservationCategoriesPage.tsx')), false);
    const router = read('src/app/page.tsx');
    assert.ok(router.includes("case 'observationCategories':"));
    assert.ok(router.includes('initialSection="masterData"'), 'legacy route must deep-link into the Settings Center');
    assert.ok(!router.includes('quality-kpi/ObservationCategoriesPage'), 'no dangling import of the deleted page');
  });
});

describe('§ONE-CENTER — the Settings Center is the single settings hub', () => {
  it('exactly one settings center component exists with the internal nav', () => {
    const settingsPage = read('src/components/pages/SettingsPage.tsx');
    assert.ok(settingsPage.includes('§SETTINGS-CENTER'));
    assert.ok(settingsPage.includes("EMBEDDED_SECTIONS.includes"), 'embedded section registry missing');
    // The center links the canonical config pages — not re-implementations.
    for (const canonical of ['controlPanel', 'organization', 'kpiSettings', 'rulesEngine', 'monthClose']) {
      assert.ok(settingsPage.includes(`'${canonical}'`), `center must consolidate navigation to ${canonical}`);
    }
  });

  it('exactly one Master Data registry exists', () => {
    const hits = filesContaining('MASTER_DATA_DOMAINS', ['src']);
    const defining = hits.filter((f) => f.endsWith('registry.ts'));
    assert.equal(defining.length, 1, `registry defined in: ${defining.join(', ')}`);
    const registry = read('src/lib/master-data/registry.ts');
    assert.ok(registry.includes("id: 'observationCategories'"));
    assert.ok(registry.includes("status: 'planned'"), 'future domains reserved as planned slots');
  });
});

describe('§MASTER-DATA-ACCEPTANCE — consumer + i18n wiring', () => {
  it('observation form and quick action use the canonical selector pipeline', () => {
    assert.ok(read('src/components/pages/quality-kpi/ObservationsPage.tsx').includes('selectorCategories('));
    assert.ok(read('src/components/shared/HomeQuickActionHost.tsx').includes('selectorCategories('));
    assert.ok(read('src/components/pages/quality-kpi/ObservationTemplatesPage.tsx').includes('selectorCategories('));
  });

  it('selector helpers enforce activation and sortOrder (behavioral contract in source)', () => {
    const presentation = read('src/lib/observation-categories/presentation.ts');
    assert.ok(presentation.includes('cat.isActive !== false'), 'activation rule');
    assert.ok(presentation.includes('sortOrder'), 'sort rule');
  });

  it('every new category label has an English mapping (AR/EN coverage)', () => {
    const enMap = read('src/lib/i18n/en-map.ts');
    for (const [ar, en] of [
      ['متابعة', 'Follow-up'],
      ['أداء', 'Performance'],
      ['تأخير تجهيز الباكدج', 'Package Preparation Delay'],
      ['تأخير الرد على العميل', 'Delayed Customer Response'],
      ['إهمال الديلات', 'Deal Neglect'],
      ['عدم التركيز', 'Lack of Focus'],
      ['عدم تنفيذ التاسكات والتنبيهات', 'Tasks and Alerts Not Completed'],
      ['عدم مساعدة الفريق', 'Failure to Support the Team'],
      ['أخطاء في التعامل مع الموردين', 'Supplier Handling Errors'],
      ['تجاهل العميل', 'Ignoring the Customer'],
    ] as const) {
      const re = new RegExp(`'${ar}': '${en.replaceAll("'", "\\'")}'`);
      assert.match(enMap, re, `missing EN mapping for ${ar}`);
    }
  });

  it('observation create route enforces the inactive-category guard server-side', () => {
    const route = read('src/app/api/quality-observations/route.ts');
    assert.ok(route.includes('ensureObservationCategoryMasterData'));
    assert.ok(route.includes('isActive === false'));
  });
});
