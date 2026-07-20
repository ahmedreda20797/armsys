'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  Play, Square, Zap, GitBranch, Shuffle, Merge, Clock, RefreshCw,
  PenLine, Eye, Calculator, Scale, ShieldCheck, ClipboardCheck,
  Bell, UserCheck, RefreshCcw, Users, Award, Plane, FileText,
  AlertTriangle, BarChart3, Globe, Code2, Mail, Sparkles, Variable,
  Cpu, ChevronDown, StickyNote,
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
  const {
    definition, label, status, validationErrors, executionCount,
    description, colorOverride, iconOverride, enabled = true, collapsed = false, notes,
  } = data;

  const Icon = ICON_MAP[iconOverride ?? definition.icon] ?? Zap;
  const colorClass = colorOverride ?? definition.color;
  const isDisabled = enabled === false;
  const hasError = validationErrors.length > 0 || status === 'error';
  const effectiveStatus = isDisabled ? 'disabled' : status;
  const descriptionText = description ?? definition.description;

  const inputPorts = definition.ports.filter((p) => p.type === 'input');
  const outputPorts = definition.ports.filter((p) => p.type === 'output');

  return (
    <div
      title={notes ? `📝 ${notes}` : undefined}
      className={cn(
        'relative min-w-[160px] max-w-[220px] rounded-xl border transition-all duration-150',
        'bg-slate-900/95 backdrop-blur-sm shadow-lg',
        selected
          ? 'border-violet-500/80 shadow-violet-500/20 shadow-xl ring-2 ring-violet-500/30'
          : hasError
          ? 'border-red-500/60 shadow-red-500/10'
          : 'border-slate-700/60 hover:border-slate-500/60',
        'ring-1',
        STATUS_RING[effectiveStatus] ?? STATUS_RING.idle,
        isDisabled && 'opacity-60',
      )}
    >
      {/* Top accent bar */}
      <div className={cn('h-1 rounded-t-xl', colorClass)} />

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
      <div className={cn('px-3 py-2.5', collapsed && 'py-2')}>
        <div className="flex items-start gap-2.5">
          {/* Icon */}
          <div className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', colorClass, 'bg-opacity-20 border border-white/10')}>
            <Icon className="w-4 h-4 text-white" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('text-xs font-semibold text-white truncate', collapsed && 'line-through opacity-70')}>{label}</span>
              {/* Status dot */}
              <span className={cn('flex-shrink-0 w-1.5 h-1.5 rounded-full', STATUS_DOT[effectiveStatus] ?? STATUS_DOT.idle)} />
              {collapsed && <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" />}
              {notes && <StickyNote className="w-3 h-3 text-amber-400 flex-shrink-0" />}
            </div>
            {!collapsed && (
              <p className="text-[10px] text-slate-400 truncate mt-0.5">{descriptionText}</p>
            )}
          </div>
        </div>

        {/* Validation errors (hidden when collapsed) */}
        {!collapsed && hasError && validationErrors.length > 0 && (
          <div className="mt-2 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20">
            <p className="text-[9px] text-red-400 truncate">{validationErrors[0]}</p>
          </div>
        )}

        {/* Disabled badge */}
        {isDisabled && (
          <div className="mt-1.5 px-1.5 py-0.5 rounded bg-slate-700/40 border border-slate-600/30 inline-block">
            <span className="text-[8px] text-slate-400 uppercase tracking-wide">معطّل</span>
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
