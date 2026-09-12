'use client';

// ══════════════════════════════════════════════════════════════
//  Print report store — the dedicated print/PDF architecture
//
//  §PRINT (Requirement 7): browser-printing the app shell produces a
//  broken report (sidebar, clipped tabs, floating UI). Instead, any
//  report section can call `openPrintReport(model)` with a clean
//  DATA-ONLY report model; <PrintReportHost/> (mounted once in the
//  app shell) renders it as a dedicated A4 document overlay. While
//  the overlay is open, `window.print()` prints THE DOCUMENT — the
//  app shell is hidden via a body class (see globals.css).
//
//  The model is intentionally generic (stats + sections + tables) so
//  every report maps into it WITHOUT new print layouts per module.
// ══════════════════════════════════════════════════════════════

import { create } from 'zustand';

/** One KPI stat chip in the printed header area. */
export interface PrintStat {
  label: string;
  value: string | number;
  hint?: string;
}

/** One printed table. `rows` cells are pre-formatted strings/numbers. */
export interface PrintTable {
  columns: string[];
  rows: Array<Array<string | number>>;
  /** Optional per-column alignment override (LTR numbers etc.). */
  ltrColumns?: number[];
}

export interface PrintSection {
  heading?: string;
  stats?: PrintStat[];
  table?: PrintTable;
  /** Free paragraphs (explanations, notes) — rendered above the table. */
  paragraphs?: string[];
}

/** The complete, clean report document model. */
export interface PrintReportModel {
  /** Report title (e.g. ملخص الجودة). */
  title: string;
  /** Subject line — employee name, scope, etc. */
  subject?: string;
  /** Report period label (e.g. سبتمبر 2026). */
  period?: string;
  /** When the underlying data was generated (ISO). */
  generatedAt?: string;
  /** Headline stats under the title. */
  stats?: PrintStat[];
  sections: PrintSection[];
  /** Footer note (e.g. audit/explainability line). */
  footerNote?: string;
}

interface PrintReportState {
  report: PrintReportModel | null;
  openPrintReport: (report: PrintReportModel) => void;
  closePrintReport: () => void;
}

export const usePrintReportStore = create<PrintReportState>((set) => ({
  report: null,
  openPrintReport: (report) => set({ report }),
  closePrintReport: () => set({ report: null }),
}));
