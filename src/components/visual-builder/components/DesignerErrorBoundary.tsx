'use client';

/**
 * Phase 14 — Error Recovery
 *
 * Two pieces:
 *   1. DesignerErrorBoundary — catches render-time crashes (white-screen guard).
 *   2. RecoveryDialog       — shown when a saved graph fails to load.
 *
 * The designer must NEVER white-screen. The boundary renders a recovery panel
 * with: error details, "Reload Designer", "Discard & Start New", and
 * "Export diagnostics" (downloads the corrupted state for support).
 */

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, FileX, Download, FilePlus } from 'lucide-react';

interface BoundaryProps {
  children: ReactNode;
  /** Optional label for the recovery diagnostics file. */
  label?: string;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
  info: { componentStack?: string } | null;
}

export class DesignerErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[Workflow Designer] Recovered from crash:', error, info);
    this.setState({ info: { componentStack: info.componentStack ?? undefined } });
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null, info: null });
  };

  handleHardReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleDiscard = (): void => {
    // Clear any persisted designer graph cache that might be the culprit.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('wf_designer_graph_'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    this.handleHardReload();
  };

  handleExportDiagnostics = (): void => {
    if (typeof window === 'undefined') return;
    const diag = {
      label: this.props.label ?? 'workflow-designer',
      timestamp: new Date().toISOString(),
      error: this.state.error
        ? { name: this.state.error.name, message: this.state.error.message, stack: this.state.error.stack }
        : null,
      componentStack: this.state.info?.componentStack ?? null,
      userAgent: navigator.userAgent,
      url: window.location.href,
    };
    const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `designer-crash-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const err = this.state.error;
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 p-6" dir="rtl">
        <div className="max-w-lg w-full bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">حدث خطأ في مصمم المسارات</h2>
              <p className="text-[11px] text-slate-500">تم منع انهيار كامل للواجهة. يمكنك المتابعة بأمان.</p>
            </div>
          </div>

          {err && (
            <div className="mb-4 p-3 rounded-lg bg-slate-950/60 border border-slate-800 overflow-x-auto" dir="ltr">
              <p className="text-[10px] font-mono text-red-400 mb-1">{err.name}: {err.message}</p>
              {err.stack && (
                <pre className="text-[9px] font-mono text-slate-500 whitespace-pre-wrap max-h-32 overflow-y-auto arm-scroll">
                  {err.stack.split('\n').slice(0, 6).join('\n')}
                </pre>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={this.handleReload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs hover:bg-violet-600/40 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
            </button>
            <button
              onClick={this.handleHardReload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs hover:bg-slate-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> تحديث الصفحة
            </button>
            <button
              onClick={this.handleExportDiagnostics}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs hover:bg-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> تصدير التشخيص
            </button>
            <button
              onClick={this.handleDiscard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs hover:bg-red-500/20 transition-colors"
            >
              <FileX className="w-3.5 h-3.5" /> حذف الكاش والبدء من جديد
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* ─── Recovery dialog for corrupted import ───────────────────────────────── */

export interface DeserializeWarning {
  kind: 'unknown_node' | 'broken_edge' | 'duplicate_id' | 'schema_mismatch' | 'corrupted';
  message: string;
  refId?: string;
}

interface RecoveryDialogProps {
  open: boolean;
  warnings: DeserializeWarning[];
  graphName: string;
  onAccept: () => void;
  onCancel: () => void;
}

export function RecoveryDialog({ open, warnings, graphName, onAccept, onCancel }: RecoveryDialogProps) {
  if (!open) return null;
  const corrupted = warnings.some((w) => w.kind === 'corrupted');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" dir="rtl">
      <div className="max-w-lg w-full bg-slate-900 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center">
            {corrupted ? <FileX className="w-4.5 h-4.5 text-red-400" /> : <AlertTriangle className="w-4.5 h-4.5 text-amber-400" />}
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              {corrupted ? 'تعذّر قراءة المسار' : 'تحذيرات أثناء الاستيراد'}
            </h2>
            <p className="text-[11px] text-slate-500">{graphName}</p>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[50vh] overflow-y-auto arm-scroll">
          {corrupted ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              الملف تالف ولا يمكن قراءته. يمكنك المحاولة مرة أخرى بملف آخر أو بدء مسار جديد.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                تم إصلاح المشاكل التالية تلقائياً. يمكنك المتابعة أو الإلغاء.
              </p>
              <ul className="space-y-1.5">
                {warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400 p-2 rounded-lg bg-slate-950/40 border border-slate-800">
                    <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span className="flex-1">{w.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            إلغاء
          </button>
          {!corrupted && (
            <button
              onClick={onAccept}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs hover:bg-violet-600/40 transition-colors"
            >
              متابعة مع الإصلاحات
            </button>
          )}
          <button
            onClick={() => {
              if (corrupted) onCancel();
              else onAccept();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs hover:bg-slate-700 transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5" /> {corrupted ? 'مسار جديد' : 'استيراد رغم ذلك'}
          </button>
        </div>
      </div>
    </div>
  );
}
