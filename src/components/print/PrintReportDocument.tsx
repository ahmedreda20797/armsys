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
//  This is a REAL report layout — not a screenshot of the dashboard:
//  no sidebar, no navigation, no tabs, no interactive chrome.
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrintReportStore, type PrintReportModel, type PrintSection } from './print-report-store';

const dash = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v);

const fmtGenerated = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ar-EG', { dateStyle: 'long', timeStyle: 'short' });
};

function StatChips({ stats }: { stats?: PrintReportModel['stats'] }) {
  if (!stats || stats.length === 0) return null;
  return (
    <div className="print-stats-grid">
      {stats.map((s, i) => (
        <div key={i} className="print-stat">
          <span className="print-stat-label">{s.label}</span>
          <span className="print-stat-value">{dash(s.value)}</span>
          {s.hint ? <span className="print-stat-hint">{s.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: PrintSection }) {
  return (
    <section className="print-section">
      {section.heading ? <h2 className="print-section-heading">{section.heading}</h2> : null}
      {section.paragraphs?.map((p, i) => (
        <p key={i} className="print-paragraph">{p}</p>
      ))}
      {section.stats && section.stats.length > 0 ? <StatChips stats={section.stats} /> : null}
      {section.table && section.table.rows.length > 0 ? (
        <table className="print-table">
          <thead>
            <tr>
              {section.table.columns.map((c, i) => (
                <th key={i}>{c}</th>
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
        <p className="print-paragraph print-muted">لا توجد بيانات لهذا القسم في الفترة المحددة.</p>
      ) : null}
    </section>
  );
}

export function PrintReportDocument({ model }: { model: PrintReportModel }) {
  const generated = fmtGenerated(model.generatedAt) || fmtGenerated(new Date().toISOString());
  // §PRINT-HEADER — RTL professional report header:
  //   RIGHT (first flex child in RTL): report title + the subject's
  //   real identity STACKED on its own lines (employee name, then
  //   department, then position — never joined inline) + metadata
  //   (period, generated date). Identity fields render only when the
  //   model actually carries them.
  //   LEFT: the Qnlys print logo ALONE — /qnlys-print.svg already
  //   contains the full wordmark; no second "Qnlys" text under it.
  const identity = model.identity;
  const identitySecondary = [
    identity?.code ? `كود الموظف: ${identity.code}` : null,
    identity?.team ? `الفريق: ${identity.team}` : null,
  ].filter(Boolean);
  return (
    <div className="print-doc" lang="ar">
      {/* Header — report identity + period */}
      <header className="print-doc-header">
        <div className="print-doc-header-row">
          {/* RIGHT: title + stacked identity + meta */}
          <div className="print-doc-identity">
            <h1 className="print-doc-title">{model.title}</h1>
            {identity?.name ? (
              <div className="print-doc-subject">
                <p className="print-doc-subject-name">{identity.name}</p>
                {identity.department ? (
                  <p className="print-doc-subject-line">القسم: {identity.department}</p>
                ) : null}
                {identity.position ? (
                  <p className="print-doc-subject-line">الوظيفة: {identity.position}</p>
                ) : null}
                {identitySecondary.length > 0 ? (
                  <p className="print-doc-subject-extra">{identitySecondary.join(' · ')}</p>
                ) : null}
              </div>
            ) : model.subject ? (
              <p className="print-doc-subject-meta"><strong>النطاق:</strong> {model.subject}</p>
            ) : null}
            <div className="print-doc-meta-inline">
              {model.period ? <span><strong>الفترة:</strong> {model.period}</span> : null}
              <span><strong>تاريخ الإنشاء:</strong> {generated}</span>
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
          <span>{model.footerNote ?? 'تقرير رسمي — يعكس البيانات المعروضة على الشاشة للفترة المحددة.'}</span>
          <span className="print-doc-footer-brand" dir="ltr">Qnlys</span>
        </div>
      </footer>
    </div>
  );
}

export function PrintReportHost() {
  const report = usePrintReportStore((s) => s.report);
  const close = usePrintReportStore((s) => s.closePrintReport);

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
    <div className="print-overlay" role="dialog" aria-label={`معاينة الطباعة — ${report.title}`}>
      <div className="print-overlay-toolbar no-print">
        <p className="print-overlay-title">معاينة الطباعة — {report.title}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" />
            طباعة / حفظ PDF
          </Button>
          <Button size="sm" variant="outline" onClick={close} className="gap-1.5">
            <X className="size-4" />
            إغلاق
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
