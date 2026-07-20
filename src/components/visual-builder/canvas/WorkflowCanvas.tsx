'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type IsValidConnection,
  useStore,
  SelectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { VBNode, VBEdge, VBCanvasConfig, VBViewport } from '../engine/types';
import { nodeTypes } from '../nodes/WorkflowNodeRenderer';
import { NODE_DEF_MAP } from '../nodes/nodeDefinitions';
import { cn } from '@/lib/utils';

/* ─── Connection validation (Phase 3) ───────────────────────────────────────
   Pure function — used both by isValidConnection (live preview) and onConnect
   (defensive double-check). Lives on the canvas because it needs node lookups.
 */

export function isValidConnection(
  source: string,
  target: string,
  sourceHandle: string | null,
  targetHandle: string | null,
  nodes: VBNode[],
  edges: VBEdge[],
): boolean {
  if (!source || !target || source === target) return false;

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return false;

  const sourceType = sourceNode.data.definition.type;
  const targetType = targetNode.data.definition.type;

  // Disabled nodes cannot be connected to/from.
  if (sourceNode.data.enabled === false || targetNode.data.enabled === false) return false;

  // Cannot connect TO a Start node
  if (targetType === 'start') return false;
  // Cannot connect FROM an End node
  if (sourceType === 'end') return false;

  // Duplicate edge prevention (same source/target/handles)
  const dup = edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      (e.sourceHandle ?? null) === (sourceHandle ?? null) &&
      (e.targetHandle ?? null) === (targetHandle ?? null),
  );
  if (dup) return false;

  // Cycle detection — reject if target can already reach source.
  if (createsCycle(source, target, edges)) return false;

  return true;
}

/** DFS from `target` to see whether `source` is already reachable. */
function createsCycle(source: string, target: string, edges: VBEdge[]): boolean {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    const arr = adj.get(e.source) ?? [];
    arr.push(e.target);
    adj.set(e.source, arr);
  });
  const visited = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    (adj.get(cur) ?? []).forEach((n) => stack.push(n));
  }
  return false;
}

/* ─── Color map for MiniMap ─────────────────────────────────────────────────── */

const MINIMAP_COLOR_MAP: Record<string, string> = {
  'bg-emerald-500': '#10b981',
  'bg-red-500': '#ef4444',
  'bg-violet-500': '#8b5cf6',
  'bg-amber-500': '#f59e0b',
  'bg-cyan-600': '#06b6d4',
  'bg-emerald-600': '#059669',
  'bg-blue-500': '#3b82f6',
  'bg-indigo-500': '#6366f1',
  'bg-slate-500': '#64748b',
  'bg-orange-500': '#f97316',
  'bg-yellow-600': '#ca8a04',
  'bg-teal-600': '#0d9488',
  'bg-sky-600': '#0284c7',
  'bg-blue-600': '#2563eb',
  'bg-pink-600': '#db2777',
  'bg-green-600': '#16a34a',
  'bg-slate-600': '#475569',
  'bg-indigo-600': '#4f46e5',
  'bg-amber-600': '#d97706',
  'bg-red-600': '#dc2626',
};

/* ─── Inner canvas (must be inside a <ReactFlowProvider>) ────────────────── */

interface WorkflowCanvasInnerProps {
  nodes: VBNode[];
  edges: VBEdge[];
  config: VBCanvasConfig;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onDrop: (event: React.DragEvent, position: { x: number; y: number }) => void;
  onDragOver: (event: React.DragEvent) => void;
  onSelectionChange: (nodes: VBNode[], edges: VBEdge[]) => void;
  onEdgeClick?: (edge: VBEdge) => void;
  onViewportChange?: (viewport: VBViewport) => void;
  /** Validation predicate — when supplied, drives live connection feedback. */
  isValid?: IsValidConnection | undefined;
  /** Reflector so the page can call screenToFlowPosition on drop. */
  exposeInstance?: (instance: { screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } }) => void;
}

function WorkflowCanvasInner({
  nodes, edges, config,
  onNodesChange, onEdgesChange, onConnect,
  onDrop, onDragOver, onSelectionChange, onEdgeClick,
  onViewportChange, isValid, exposeInstance,
}: WorkflowCanvasInnerProps) {
  const transform = useStore((s) => s.transform);

  // Expose a tiny reflector so the page (which owns the single ReactFlowProvider)
  // can translate screen→flow coords for drag-drop & template placement.
  // The real instance lives in the page; we get screenToFlowPosition via the
  // page's useReactFlow() there. This reflector is kept for back-compat with
  // callers that used the legacy canvas wrapper.
  const viewportRef = React.useRef<VBViewport>({ x: 0, y: 0, zoom: 1 });
  viewportRef.current = { x: transform[0], y: transform[1], zoom: transform[2] };

  React.useEffect(() => {
    onViewportChange?.(viewportRef.current);
  }, [transform, onViewportChange]);

  React.useEffect(() => {
    if (exposeInstance) {
      // No-op reflector — the page uses its own useReactFlow() instance.
      exposeInstance({
        screenToFlowPosition: (p) => {
          const { x, y, zoom } = viewportRef.current;
          return { x: (p.x - x) / zoom, y: (p.y - y) / zoom };
        },
      });
    }
  }, [exposeInstance]);

  // Stable handlers (React Flow re-renders on identity changes).
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const { x, y, zoom } = viewportRef.current;
    // Convert screen (client) → flow coords using the current transform.
    const position = { x: (e.clientX - x) / zoom, y: (e.clientY - y) / zoom };
    onDrop(e, position);
  }, [onDrop]);

  const handleEdgeClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    const vbEdge = edges.find((e) => e.id === edge.id) ?? (edge as unknown as VBEdge);
    onEdgeClick?.(vbEdge);
  }, [edges, onEdgeClick]);

  const handleSelectionChange = useCallback((evt: { nodes: Node[]; edges: Edge[] }) => {
    const selNodes = (evt.nodes ?? []) as unknown as VBNode[];
    const selEdges = (evt.edges ?? []) as unknown as VBEdge[];
    onSelectionChange(selNodes, selEdges);
  }, [onSelectionChange]);

  // Dev-time guard: warn once per unknown edge type to keep the console clean.
  const edgeTypeWarningFired = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const BUILT_IN = new Set(['default', 'bezier', 'straight', 'smoothstep', 'step']);
      edges.forEach((e) => {
        const t = e.type ?? 'default';
        if (!BUILT_IN.has(t) && !edgeTypeWarningFired.current.has(t)) {
          edgeTypeWarningFired.current.add(t);
          // eslint-disable-next-line no-console
          console.warn(
            `[VB Edge Guard] Edge "${e.id}" uses unsupported type "${t}". ` +
            `Built-in types: ${[...BUILT_IN].join(', ')}.`,
          );
        }
      });
    }
  }, [edges]);

  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={handleEdgeClick}
        onDrop={handleDrop}
        onDragOver={onDragOver}
        onSelectionChange={handleSelectionChange}
        isValidConnection={isValid}
        fitView
        snapToGrid={config.snapToGrid}
        snapGrid={[config.gridSize, config.gridSize]}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        className="bg-slate-950"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#6366f1', strokeWidth: 2 },
        }}
        connectionLineStyle={{ stroke: '#a78bfa', strokeWidth: 2 }}
      >
        <Background
          variant={config.showBackground === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={config.gridSize}
          size={1}
          color={config.darkMode ? '#1e293b' : '#e2e8f0'}
        />
        <Controls
          position="bottom-left"
          className="!bg-slate-900/90 !border-slate-700/50 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700/50 [&>button]:!fill-slate-300 [&>button:hover]:!bg-slate-700 [&>button]:!rounded"
        />
        {config.showMinimap && (
          <MiniMap
            position="bottom-right"
            className="!bg-slate-900/90 !border-slate-700/50 !rounded-lg"
            nodeColor={(node) => {
              const data = node.data as VBNode['data'] | undefined;
              const colorCls = data?.colorOverride ?? data?.definition?.color;
              return MINIMAP_COLOR_MAP[colorCls ?? ''] ?? '#6366f1';
            }}
            maskColor={config.darkMode ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.7)'}
          />
        )}
      </ReactFlow>

      <ZoomIndicator />
    </div>
  );
}

/* ─── Zoom indicator ────────────────────────────────────────────────────── */

function ZoomIndicator() {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 rounded-md bg-slate-900/80 border border-slate-700/50 text-[10px] text-slate-400 font-mono backdrop-blur-sm pointer-events-none">
      {Math.round(zoom * 100)}%
    </div>
  );
}

/* ─── Exported wrapper ────────────────────────────────────────────────────
   NOTE: This wrapper does NOT add its own <ReactFlowProvider>.
   The page must render exactly ONE provider that wraps both the canvas and
   any toolbar/buttons that call useReactFlow(). Multiple nested providers
   silently break zoom/fit/center (they bind to the empty outer instance).
 */

interface WorkflowCanvasProps extends WorkflowCanvasInnerProps {}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <WorkflowCanvasInner {...props} />;
}
