'use client';

// ══════════════════════════════════════════════════════════════
//  PrintReportHost — the dedicated print/PDF surface (§PRINT)
//
//  Renders the clean A4 report document as a full-screen overlay
//  (acts as a live preview on screen). While it is open:
//    • the app root is hidden in print via body.print-report-open
//      (globals.css) — the sidebar/navigation NEVER reach the paper;
//    • the toolbar (طباعة/إغلاق) is .no-print;
//    • the document itself uses @page A4 rules, repeated table
//      headers, page-break-safe blocks and full RTL Arabic support.
//
//  §I18N-BOUNDARY — the print model is already split at the adapters:
//    UI-OWNED (title, headings, column headers, stat labels, fixed
//    field labels, footer) → claimed with <T> and translated.
//    BUSINESS DATA (identity fields, stat values, table cells,
//    subject, paragraphs) → rendered EXACTLY as provided — never
//    translated, never rewritten.
//
//  This is a REAL report layout — not a screenshot of the dashboard:
//  no sidebar, no navigation, no tabs, no interactive chrome.
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrintReportStore, type PrintReportModel, type PrintSection } from './print-report-store';
import { formatDateTime } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';

const dash = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v);

const fmtGenerated = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateTime(d, undefined, { dateStyle: 'long', timeStyle: 'short' });
};

function StatChips({ stats }: { stats?: PrintReportModel['stats'] }) {
  if (!stats || stats.length === 0) return null;
  return (
    <div className="print-stats-grid">
      {stats.map((s, i) => (
        <div key={i} className="print-stat">
          <span className="print-stat-label"><T>{s.label}</T></span>
          {/* value + hint: hint is adapter-generated system vocabulary;
              the VALUE itself is business data and renders raw. */}
          <span className="print-stat-value">{dash(s.value)}</span>
          {s.hint ? <span className="print-stat-hint"><T>{s.hint}</T></span> : null}
        </div>
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: PrintSection }) {
  return (
    <section className="print-section">
      {section.heading ? <h2 className="print-section-heading"><T>{section.heading}</T></h2> : null}
      {/* paragraphs: system methodology / data-quality notes — rendered
          verbatim, never rewritten by the language switch. */}
      {section.paragraphs?.map((p, i) => (
        <p key={i} className="print-paragraph">{p}</p>
      ))}
      {section.stats && section.stats.length > 0 ? <StatChips stats={section.stats} /> : null}
      {section.table && section.table.rows.length > 0 ? (
        <table className="print-table">
          <thead>
            <tr>
              {/* column headers are application-owned report terminology */}
              {section.table.columns.map((c, i) => (
                <th key={i}><T>{c}</T></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={section.table!.ltrColumns?.includes(c) ? 'print-td-ltr' : undefined}>
                    {dash(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {section.table && section.table.rows.length === 0 ? (
        <p className="print-paragraph print-muted"><T>لا توجد بيانات لهذا القسم في الفترة المحددة.</T></p>
      ) : null}
    </section>
  );
}

export function PrintReportDocument({ model }: { model: PrintReportModel }) {
  const { locale } = useLanguage();
  const generated = fmtGenerated(model.generatedAt) || fmtGenerated(new Date().toISOString());
  // §PRINT-HEADER — RTL professional report header:
  //   RIGHT (first flex child in RTL): report title + the subject's
  //   real identity STACKED on its own lines (employee name, then
  //   department, then position — never joined inline) + metadata
  //   (period, generated date). Identity fields render only when the
  //   model actually carries them.
  //   LEFT: the Qnlys print logo ALONE — /qnlys-print.svg already
  //   contains the full wordmark; no second "Qnlys" text under it.
  //
  //   §I18N-BOUNDARY — identity VALUES (name, code, department, team,
  //   position) are business data: rendered exactly as stored. Only
  //   the fixed field labels around them are claimed UI.
  const identity = model.identity;
  const identitySecondary = [
    identity?.code ? (<><T>كود الموظف: </T>{identity.code}</>) : null,
    identity?.team ? (<><T>الفريق: </T>{identity.team}</>) : null,
  ].filter(Boolean);
  return (
    <div className="print-doc" lang={locale}>
      {/* Header — report identity + period */}
      <header className="print-doc-header">
        <div className="print-doc-header-row">
          {/* RIGHT: title + stacked identity + meta */}
          <div className="print-doc-identity">
            <h1 className="print-doc-title"><T>{model.title}</T></h1>
            {identity?.name ? (
              <div className="print-doc-subject">
                <p className="print-doc-subject-name">{identity.name}</p>
                {identity.department ? (
                  <p className="print-doc-subject-line"><T>القسم: </T>{identity.department}</p>
                ) : null}
                {identity.position ? (
                  <p className="print-doc-subject-line"><T>الوظيفة: </T>{identity.position}</p>
                ) : null}
                {identitySecondary.length > 0 ? (
                  <p className="print-doc-subject-extra">{identitySecondary.map((frag, i) => (
                    <span key={i}>{i > 0 ? ' · ' : ''}{frag}</span>
                  ))}</p>
                ) : null}
              </div>
            ) : model.subject ? (
              <p className="print-doc-subject-meta"><strong><T>النطاق: </T></strong> {model.subject}</p>
            ) : null}
            <div className="print-doc-meta-inline">
              {model.period ? <span><strong><T>الفترة: </T></strong>{model.period}</span> : null}
              <span><strong><T>تاريخ الإنشاء: </T></strong>{generated}</span>
            </div>
          </div>
          {/* LEFT: the Qnlys print logo (dark wordmark for white paper) —
              the asset IS the complete brand mark; nothing under it. */}
          <div className="print-doc-logo" dir="ltr">
            <img src="/qnlys-print.svg" alt="Qnlys" style={{ height: 44, width: 'auto', objectFit: 'contain' }} />
          </div>
        </div>
        <hr className="print-doc-rule" />
      </header>

      {model.stats && model.stats.length > 0 ? <StatChips stats={model.stats} /> : null}

      {model.sections.map((section, i) => (
        <SectionBlock key={i} section={section} />
      ))}

      <footer className="print-doc-footer">
        <hr className="print-doc-rule print-doc-footer-rule" />
        <div className="print-doc-footer-row">
          {/* §I18N-BOUNDARY — footerNote is rendered RAW: static adapter
              footers localize themselves via ui(); dynamic footers embed
              business data (e.g. a user-named KPI scheme) and must never
              re-enter the translation engine. */}
          <span>{model.footerNote ?? <T>تقرير رسمي — يعكس البيانات المعروضة على الشاشة للفترة المحددة.</T>}</span>
          <span className="print-doc-footer-brand" dir="ltr">Qnlys</span>
        </div>
      </footer>
    </div>
  );
}

export function PrintReportHost() {
  const report = usePrintReportStore((s) => s.report);
  const close = usePrintReportStore((s) => s.closePrintReport);
  const { locale } = useLanguage();

  // While the print view is open the app shell hides itself in print
  // (body class) and page scrolling is locked behind the overlay.
  useEffect(() => {
    if (!report) return;
    document.body.classList.add('print-report-open');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('print-report-open');
      document.body.style.overflow = prevOverflow;
    };
  }, [report]);

  // ESC closes the preview (mirrors the modal convention).
  useEffect(() => {
    if (!report) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report, close]);

  if (!report) return null;

  return createPortal(
    <div className="print-overlay" role="dialog" aria-label={translateUIText(`معاينة الطباعة — ${report.title}`, locale)}>
      <div className="print-overlay-toolbar no-print">
        <p className="print-overlay-title"><T>معاينة الطباعة — </T>{report.title}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" />
            <T>طباعة / حفظ PDF</T>
          </Button>
          <Button size="sm" variant="outline" onClick={close} className="gap-1.5">
            <X className="size-4" />
            <T>إغلاق</T>
          </Button>
        </div>
      </div>
      <div className="print-overlay-scroll">
        <PrintReportDocument model={report} />
      </div>
    </div>,
    document.body,
  );
}
