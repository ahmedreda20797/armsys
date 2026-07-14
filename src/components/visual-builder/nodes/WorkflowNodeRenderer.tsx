'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles, Variable,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VBNode } from '../engine/types';

const ICON_MAP: Record<string, React.ElementType> = {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles, Variable, Cpu,
};

const STATUS_RING: Record<string, string> = {
  idle:     'ring-slate-600/40',
  active:   'ring-violet-500/60',
  error:    'ring-red-500/70',
  warning:  'ring-amber-500/60',
  success:  'ring-emerald-500/60',
  disabled: 'ring-slate-700/30',
};

const STATUS_DOT: Record<string, string> = {
  idle:     'bg-slate-500',
  active:   'bg-violet-400 animate-pulse',
  error:    'bg-red-400',
  warning:  'bg-amber-400',
  success:  'bg-emerald-400',
  disabled: 'bg-slate-600',
};

export const WorkflowNodeRenderer = memo(function WorkflowNodeRenderer({ data, selected }: NodeProps<VBNode['data']>) {
  const { definition, label, status, validationErrors, executionCount } = data;
  const Icon = ICON_MAP[definition.icon] ?? Zap;
  const hasError = validationErrors.length > 0 || status === 'error';
  const isStart = definition.type === 'start';
  const isEnd = definition.type === 'end';

  const inputPorts = definition.ports.filter((p) => p.type === 'input');
  const outputPorts = definition.ports.filter((p) => p.type === 'output');

  return (
    <div
      className={cn(
        'relative min-w-[160px] max-w-[200px] rounded-xl border transition-all duration-150',
        'bg-slate-900/95 backdrop-blur-sm shadow-lg',
        selected
          ? 'border-violet-500/80 shadow-violet-500/20 shadow-xl ring-2 ring-violet-500/30'
          : hasError
          ? 'border-red-500/60 shadow-red-500/10'
          : 'border-slate-700/60 hover:border-slate-500/60',
        'ring-1',
        STATUS_RING[status] ?? STATUS_RING.idle
      )}
    >
      {/* Top accent bar */}
      <div className={cn('h-1 rounded-t-xl', definition.color)} />

      {/* Input handles */}
      {inputPorts.map((port, i) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ top: inputPorts.length === 1 ? '50%' : `${((i + 1) / (inputPorts.length + 1)) * 100}%` }}
          className="!w-3 !h-3 !bg-slate-600 !border-2 !border-slate-400 hover:!bg-violet-500 hover:!border-violet-300 transition-colors"
        />
      ))}

      {/* Card body */}
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          {/* Icon */}
          <div className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', definition.color, 'bg-opacity-20 border border-white/10')}>
            <Icon className="w-4 h-4 text-white" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white truncate">{label}</span>
              {/* Status dot */}
              <span className={cn('flex-shrink-0 w-1.5 h-1.5 rounded-full', STATUS_DOT[status] ?? STATUS_DOT.idle)} />
            </div>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{definition.description}</p>
          </div>
        </div>

        {/* Validation errors */}
        {hasError && validationErrors.length > 0 && (
          <div className="mt-2 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20">
            <p className="text-[9px] text-red-400 truncate">{validationErrors[0]}</p>
          </div>
        )}

        {/* Execution badge */}
        {executionCount !== undefined && executionCount > 0 && (
          <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-violet-600 border border-slate-900 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white">{executionCount > 9 ? '9+' : executionCount}</span>
          </div>
        )}
      </div>

      {/* Output handles */}
      {outputPorts.map((port, i) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ top: outputPorts.length === 1 ? '50%' : `${((i + 1) / (outputPorts.length + 1)) * 100}%` }}
          className="!w-3 !h-3 !bg-slate-600 !border-2 !border-slate-400 hover:!bg-violet-500 hover:!border-violet-300 transition-colors"
        />
      ))}

      {/* Selection glow */}
      {selected && (
        <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-violet-400/20 ring-offset-1 ring-offset-transparent" />
      )}
    </div>
  );
});

export const nodeTypes = { workflowNode: WorkflowNodeRenderer };
