'use client';

/**
 * PART 12 — Simulation Panel + PART 13 — Execution Preview
 * Step-by-step simulation of the execution path. NEVER executes business logic.
 */

import React, { memo, useState, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, RotateCcw, Activity,
  Clock, GitBranch, Eye, Gauge, Flag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode, VBEdge } from '../engine/types';
import type { VBSimulationState, VBExecutionStep, VBWorkflowMetrics } from '../engine/v2-types';
import {
  buildSimulation, initialSimState, stepForward, stepBack, restartSim, runSim,
} from '../engine/v2-simulation';
import { computeExecutionOrder } from '../engine/v2-validation';

interface SimulationPanelProps {
  nodes: VBNode[];
  edges: VBEdge[];
  onHighlightNode?: (id: string | null) => void;
}

export const SimulationPanel = memo(function SimulationPanel({
  nodes, edges, onHighlightNode,
}: SimulationPanelProps) {
  const [sim, setSim] = useState<VBSimulationState>(initialSimState);
  const [testVars, setTestVars] = useState('{}');
  const [tab, setTab] = useState<'simulate' | 'preview' | 'analytics'>('simulate');

  const startSimulation = useCallback(() => {
    let vars: Record<string, unknown> = {};
    try { vars = JSON.parse(testVars); } catch { /* invalid */ }
    setSim(buildSimulation(nodes, edges, vars));
  }, [nodes, edges, testVars]);

  const currentFrame = sim.currentFrame >= 0 ? sim.frames[sim.currentFrame] : null;

  // Highlight current node on canvas
  React.useEffect(() => {
    if (tab === 'simulate' && currentFrame) {
      onHighlightNode?.(currentFrame.nodeId);
    } else {
      onHighlightNode?.(null);
    }
  }, [currentFrame, tab, onHighlightNode]);

  const previewSteps: VBExecutionStep[] = React.useMemo(
    () => computeExecutionOrder(nodes, edges),
    [nodes, edges]
  );

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {([
          { id: 'simulate' as const, label: 'محاكاة', icon: Play },
          { id: 'preview' as const, label: 'ترتيب التنفيذ', icon: Activity },
          { id: 'analytics' as const, label: 'تحليلات', icon: Gauge },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 transition-colors',
              tab === t.id ? 'border-violet-500 text-violet-300 bg-violet-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* SIMULATE TAB */}
      {tab === 'simulate' && (
        <div className="flex-1 overflow-y-auto arm-scroll p-3 space-y-3">
          {/* Test variables input */}
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">متغيرات الاختبار (JSON)</label>
            <textarea
              value={testVars}
              onChange={(e) => setTestVars(e.target.value)}
              rows={3}
              placeholder='{"employee.name": "أحمد"}'
              dir="ltr"
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-[10px] font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 resize-none"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-1 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <SimBtn icon={RotateCcw} label="إعادة" onClick={() => setSim(restartSim(sim))} disabled={sim.frames.length === 0} />
            <SimBtn icon={SkipBack} label="خطوة للخلف" onClick={() => setSim(stepBack(sim))} disabled={sim.currentFrame <= 0} />
            {sim.status === 'running' ? (
              <SimBtn icon={Pause} label="إيقاف" onClick={() => setSim({ ...sim, status: 'paused' })} primary />
            ) : sim.frames.length === 0 ? (
              <SimBtn icon={Play} label="ابدأ" onClick={startSimulation} primary />
            ) : (
              <SimBtn icon={Play} label="تشغيل" onClick={() => setSim(runSim(sim))} primary />
            )}
            <SimBtn icon={SkipForward} label="خطوة للأمام" onClick={() => setSim(stepForward(sim))} disabled={sim.currentFrame >= sim.frames.length - 1} />
          </div>

          {/* Status */}
          <div className="flex items-center justify-between text-[10px]">
            <span className={cn(
              'px-2 py-0.5 rounded-full border',
              sim.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' :
              sim.status === 'running' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' :
              sim.status === 'idle' ? 'bg-slate-700/30 text-slate-400 border-slate-700/40' :
              'bg-amber-500/10 text-amber-300 border-amber-500/20'
            )}>
              {sim.status === 'idle' ? 'خامل' : sim.status === 'running' ? 'قيد التشغيل' : sim.status === 'completed' ? 'مكتمل' : sim.status === 'paused' ? 'متوقف' : sim.status}
            </span>
            <span className="text-slate-500">{sim.currentFrame + 1} / {sim.frames.length}</span>
          </div>

          {/* Current frame detail */}
          {currentFrame && (
            <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-violet-600/30 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-violet-200">{currentFrame.stepIndex + 1}</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-200">{currentFrame.nodeName}</p>
                  <p className="text-[9px] text-slate-500 font-mono">{currentFrame.nodeType}</p>
                </div>
              </div>
              {currentFrame.decision && (
                <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-300">
                  <GitBranch className="w-3 h-3" /> {currentFrame.decision}
                </div>
              )}
              <p className="text-[10px] text-slate-400">{currentFrame.notes}</p>
            </div>
          )}

          {/* Variables snapshot */}
          {currentFrame && Object.keys(currentFrame.variablesSnapshot).length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">المتغيرات</p>
              <div className="space-y-1">
                {Object.entries(currentFrame.variablesSnapshot).slice(0, 8).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-2 py-1 rounded bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] font-mono text-violet-300 truncate">{k}</span>
                    <span className="text-[10px] text-slate-300 truncate mr-2">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {sim.frames.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">الجدول الزمني</p>
              <div className="space-y-0.5">
                {sim.frames.map((f, i) => (
                  <button
                    key={f.stepIndex}
                    onClick={() => setSim({ ...sim, currentFrame: i, status: 'paused' })}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1 rounded-md text-right transition-colors',
                      i === sim.currentFrame ? 'bg-violet-600/20' : i < sim.currentFrame ? 'opacity-50' : 'hover:bg-slate-800/50'
                    )}
                  >
                    <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[9px] text-slate-400 flex-shrink-0">{f.stepIndex + 1}</span>
                    <span className="text-[11px] text-slate-300 truncate flex-1">{f.nodeName}</span>
                    {f.decision && <GitBranch className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PREVIEW TAB */}
      {tab === 'preview' && (
        <div className="flex-1 overflow-y-auto arm-scroll p-3">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-3.5 h-3.5 text-violet-400" />
            <p className="text-[10px] font-bold text-slate-400 uppercase">ترتيب التنفيذ المتوقع</p>
          </div>
          <div className="space-y-1">
            {previewSteps.map((step) => (
              <div
                key={step.nodeId}
                onClick={() => onHighlightNode?.(step.nodeId)}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-violet-500/40 cursor-pointer transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-violet-300">{step.order}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 truncate">{step.nodeName}</p>
                  <p className="text-[9px] text-slate-500 font-mono">{step.nodeType}</p>
                </div>
                {step.isDecision && (
                  <span className="flex items-center gap-0.5 text-[9px] text-amber-400">
                    <GitBranch className="w-2.5 h-2.5" /> قرار
                  </span>
                )}
                {step.branchLabel && (
                  <span className="text-[9px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full">{step.branchLabel}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ANALYTICS TAB */}
      {tab === 'analytics' && (
        <AnalyticsView nodes={nodes} edges={edges} />
      )}
    </div>
  );
});

/* ─── Analytics (Part 16) ────────────────────────────────────────────────── */

function AnalyticsView({ nodes, edges }: { nodes: VBNode[]; edges: VBEdge[] }) {
  const metrics = React.useMemo(() => {
    const { computeMetrics, computeDepth } = require('../engine/v2-validation') as typeof import('../engine/v2-validation');
    const m = computeMetrics(nodes);
    m.edgeCount = edges.length;
    m.depth = computeDepth(nodes, edges);
    return m;
  }, [nodes, edges]) as VBWorkflowMetrics;

  const stats = [
    { label: 'العقد', value: metrics.nodeCount, icon: Flag, color: 'text-violet-300' },
    { label: 'الاتصالات', value: metrics.edgeCount, icon: GitBranch, color: 'text-emerald-300' },
    { label: 'العمق', value: metrics.depth, icon: Activity, color: 'text-blue-300' },
    { label: 'القرارات', value: metrics.decisionCount, icon: GitBranch, color: 'text-amber-300' },
    { label: 'المتغيرات', value: metrics.variableCount, icon: Eye, color: 'text-cyan-300' },
    { label: 'الإجراءات', value: metrics.actionCount, icon: Activity, color: 'text-pink-300' },
  ];

  return (
    <div className="flex-1 overflow-y-auto arm-scroll p-3 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="w-3.5 h-3.5 text-violet-400" />
        <p className="text-[10px] font-bold text-slate-400 uppercase">تحليلات المسار</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <s.icon className={cn('w-4 h-4 mb-1', s.color)} />
            <p className="text-lg font-bold text-slate-200">{s.value}</p>
            <p className="text-[9px] text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-slate-400">التعقيد المقدّر</span>
          <span className={cn(
            'text-xs font-bold',
            metrics.estimatedComplexity === 'low' ? 'text-emerald-400' :
            metrics.estimatedComplexity === 'medium' ? 'text-blue-400' :
            metrics.estimatedComplexity === 'high' ? 'text-amber-400' : 'text-red-400'
          )}>
            {metrics.estimatedComplexity === 'low' ? 'منخفض' : metrics.estimatedComplexity === 'medium' ? 'متوسط' : metrics.estimatedComplexity === 'high' ? 'عالي' : 'عالي جداً'}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              metrics.estimatedComplexity === 'low' ? 'bg-emerald-500' :
              metrics.estimatedComplexity === 'medium' ? 'bg-blue-500' :
              metrics.estimatedComplexity === 'high' ? 'bg-amber-500' : 'bg-red-500'
            )}
            style={{ width: `${metrics.estimatedComplexity === 'low' ? 25 : metrics.estimatedComplexity === 'medium' ? 50 : metrics.estimatedComplexity === 'high' ? 75 : 100}%` }}
          />
        </div>
      </div>
      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-2">
        <Clock className="w-4 h-4 text-slate-500" />
        <div>
          <p className="text-xs font-bold text-slate-200">{(metrics.estimatedExecutionMs / 1000).toFixed(1)}s</p>
          <p className="text-[9px] text-slate-500">وقت التنفيذ المقدّر</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Simulation button ──────────────────────────────────────────────────── */

function SimBtn({
  icon: Icon, label, onClick, disabled, primary,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
        disabled ? 'opacity-30 cursor-not-allowed' :
        primary ? 'bg-violet-600/30 text-violet-300 hover:bg-violet-600/40 border border-violet-500/30' :
        'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
