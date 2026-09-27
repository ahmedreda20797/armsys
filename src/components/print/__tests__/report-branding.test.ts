// src/components/print/__tests__/report-branding.test.ts
// ══════════════════════════════════════════════════════════════
//  §REPORT-SOURCE / §BRAND — the Qnalys brand rename + approved
//  report source footer, enforced:
//
//    A. UNIT — reportSourceFooter() returns the approved Arabic /
//       English wording per display locale (the footer follows the
//       language selection) and the performance-analysis print
//       adapter falls back to it.
//    B. SOURCE-CONTRACT — the wording stays centralized (no copy in
//       the renderer), the old footer wording and any internal-use
//       disclaimer are gone, application-owned branding displays
//       Qnalys, and the compatibility identifiers that must survive
//       (storage key, runtime stash props, asset paths) are intact.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reportSourceFooter, performanceDatasetToPrintModel } from '../print-adapters';
import { setDisplayLocale } from '@/lib/i18n/format';
import { DICTIONARY } from '@/lib/i18n/dictionary';
import { EN_MAP } from '@/lib/i18n/en-map';

// Byte-exact approved wording (must match the adapter + EN_MAP keys).
const AR_FOOTER = 'المصدر: نظام Qnalys — تم احتساب المؤشرات والبيانات وفقًا للسجلات المعتمدة ضمن الفترة المحددة في التقرير.';
const EN_FOOTER = 'Source: Qnalys System — Metrics and data are calculated from approved records within the reporting period.';

describe('§REPORT-SOURCE centralized footer', () => {
  it('Arabic locale renders the approved Arabic wording', () => {
    setDisplayLocale('ar');
    assert.equal(reportSourceFooter(), AR_FOOTER);
  });

  it('English locale renders the approved English wording — footer follows the language selection', () => {
    setDisplayLocale('en');
    assert.equal(reportSourceFooter(), EN_FOOTER);
  });

  it('the performance-analysis print adapter falls back to the centralized footer', () => {
    setDisplayLocale('ar');
    const model = performanceDatasetToPrintModel({} as Parameters<typeof performanceDatasetToPrintModel>[0]);
    assert.equal(model.footerNote, AR_FOOTER);
  });

  it('EN_MAP carries the exact-match English translation for the Arabic footer', () => {
    assert.equal(EN_MAP[AR_FOOTER], EN_FOOTER);
  });
});

describe('§REPORT-SOURCE source contract', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const adapters = readFileSync(join(here, '../print-adapters.ts'), 'utf8');
  const doc = readFileSync(join(here, '../PrintReportDocument.tsx'), 'utf8');
  const enMap = readFileSync(join(here, '../../../lib/i18n/en-map.ts'), 'utf8');

  it('the approved Arabic footer lives in the ONE centralized adapter', () => {
    assert.ok(adapters.includes(AR_FOOTER), 'adapter must carry the approved wording');
  });

  it('the renderer renders footerNote raw — no duplicated copy of the wording', () => {
    assert.ok(!doc.includes('المصدر: نظام'), 'renderer must not embed a second copy of the footer');
  });

  it('the old footer wording is fully removed (adapter + localization map)', () => {
    assert.ok(!adapters.includes('بيانات الأداء الكنسية'), 'old Arabic footer must be gone');
    assert.ok(!enMap.includes('بيانات الأداء الكنسية'), 'old footer EN_MAP key must be gone');
  });

  it('no internal-use disclaimer is added anywhere in report/print code', () => {
    assert.ok(!adapters.includes('للاستخدام الداخلي'));
    assert.ok(!doc.includes('للاستخدام الداخلي'));
    assert.ok(!enMap.includes('للاستخدام الداخلي'));
  });
});

describe('§BRAND — Qnalys rename contract', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => readFileSync(join(here, rel), 'utf8');

  it('the canonical brand constant is Qnalys in BOTH locales', () => {
    assert.equal(DICTIONARY['app.name'].ar, 'Qnalys');
    assert.equal(DICTIONARY['app.name'].en, 'Qnalys');
  });

  it('application-owned localization strings carry no old visible spelling', () => {
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      assert.ok(!entry.ar.includes('Qnlys'), `dictionary ${key}.ar must not contain the old spelling`);
      assert.ok(!entry.en.includes('Qnlys'), `dictionary ${key}.en must not contain the old spelling`);
    }
    for (const [ar, en] of Object.entries(EN_MAP)) {
      assert.ok(!ar.includes('Qnlys'), `EN_MAP key "${ar}" must not contain the old spelling`);
      assert.ok(!en.includes('Qnlys'), `EN_MAP value "${en}" must not contain the old spelling`);
    }
  });

  it('browser metadata uses Qnalys', () => {
    const layout = read('../../../app/layout.tsx');
    assert.ok(layout.includes('title: "Qnalys —'), 'document title must display Qnalys');
    assert.ok(layout.includes('| Qnalys'), 'metadata description must display Qnalys');
    assert.ok(!layout.includes('Qnlys'), 'layout must not keep the old spelling');
  });

  it('login page displays Qnalys', () => {
    const login = read('../../pages/LoginPage.tsx');
    assert.ok(login.includes('alt="Qnalys"'), 'login logo alt must display Qnalys');
    assert.ok(login.includes('Qnalys ©'), 'login footer must display Qnalys');
    assert.ok(!login.includes('alt="Qnlys"'), 'old login logo alt must be gone');
  });

  it('app shell footer and sidebar brand label display Qnalys', () => {
    const appLayout = read('../../layout/AppLayout.tsx');
    assert.ok(appLayout.includes('© 2026 Qnalys'), 'global footer must display Qnalys');
    assert.ok(!appLayout.includes('Qnlys '), 'old footer spelling must be gone');
    const sidebarLogo = read('../../layout/SidebarLogo.tsx');
    assert.ok(sidebarLogo.includes("label = 'Qnalys'"), 'sidebar brand label must default to Qnalys');
  });

  it('print document (header logo + footer brand) displays Qnalys', () => {
    const doc = read('../PrintReportDocument.tsx');
    assert.ok(doc.includes('alt="Qnalys"'), 'print logo alt must display Qnalys');
    assert.ok(doc.includes('<span className="print-doc-footer-brand" dir="ltr">Qnalys</span>'), 'print footer brand must display Qnalys');
  });

  it('Excel export metadata names Qnalys as creator', () => {
    assert.ok(read('../../../lib/reports/excel.ts').includes("workbook.creator = 'Qnalys';"));
    assert.ok(read('../../../app/api/reports/export/route.ts').includes("workbook.creator = 'Qnalys';"));
    assert.ok(read('../../../app/api/reports/capa-export/route.ts').includes("workbook.creator = 'Qnalys';"));
  });

  it('compatibility identifiers survive unchanged (storage key, stash props, assets)', () => {
    assert.ok(read('../../../lib/i18n/language-context.tsx').includes("'qnlys:language'"),
      'localStorage key must stay for backward compatibility');
    const rt = read('../../../lib/i18n/runtime-translator.ts');
    assert.ok(rt.includes("'__qnlysI18nOrig'") && rt.includes("'__qnlysI18nEn'"),
      'runtime stash props must stay for backward compatibility');
    // Asset FILES keep their names — the SVG wordmark is vector geometry.
    assert.ok(read('../PrintReportDocument.tsx').includes('"/qnlys-print.svg"'),
      'print logo asset path must stay stable');
  });
});
