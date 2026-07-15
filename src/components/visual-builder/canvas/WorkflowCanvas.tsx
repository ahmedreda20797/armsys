'use client';

import React, { useCallback, useRef, useMemo, useEffect } from 'react';
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
  type ReactFlowInstance,
  type XYPosition,
  useReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useStore,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { VBNode, VBEdge, VBNodeDefinition, VBCanvasConfig, VBViewport } from '../engine/types';
import { nodeTypes } from '../nodes/WorkflowNodeRenderer';
import { NODE_DEF_MAP } from '../nodes/nodeDefinitions';
import { cn } from '@/lib/utils';

/* ─── Connection validation ──────────────────────────────────────────────── */

function isValidConnection(
  source: string,
  target: string,
  sourceHandle: string | null,
  targetHandle: string | null,
  nodes: VBNode[]
): boolean {
  if (source === target) return false;

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return false;

  // Only one Start node
  if (targetNode.type === 'start') return false;
  // Only one End node
  if (sourceNode.type === 'end') return false;
  // Start can only connect out
  if (sourceNode.type === 'start' && targetNode.type === 'start') return false;

  // Singleton ports: check max connections (default 999)
  const sourceDef = NODE_DEF_MAP.get(sourceNode.type);
  const sourcePort = sourceDef?.ports.find((p) => p.id === sourceHandle);
  if (sourcePort?.maxConnections !== undefined) {
    const outgoingCount = /* count edges from this handle — approximate */ 0; // simplified
    // For V1 we allow unlimited
  }

  return true;
}

/* ─── Inner canvas (needs ReactFlowProvider context) ────────────────────── */

interface WorkflowCanvasInnerProps {
  nodes: VBNode[];
  edges: VBEdge[];
  config: VBCanvasConfig;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onDrop: (event: React.DragEvent, position: XYPosition) => void;
  onDragOver: (event: React.DragEvent) => void;
  onSelectionChange: (nodes: VBNode[]) => void;
  onViewportChange?: (viewport: VBViewport) => void;
}

function WorkflowCanvasInner({
  nodes,
  edges,
  config,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDrop,
  onDragOver,
  onSelectionChange,
  onViewportChange,
}: WorkflowCanvasInnerProps) {
  const rfInstance = useReactFlow();
  const viewport = useStore((s) => s.transform);

  // Forward viewport changes
  useEffect(() => {
    onViewportChange?.({ x: viewport[0], y: viewport[1], zoom: viewport[2] });
  }, [viewport, onViewportChange]);

  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={(e) => {
          const position = rfInstance.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          onDrop(e, position);
        }}
        onDragOver={onDragOver}
        onSelectionChange={(evt) => {
          const sel = evt.nodes as unknown as VBNode[];
          onSelectionChange(sel);
        }}
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
        {/* Background */}
        <Background
          variant={config.showBackground === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={config.gridSize}
          size={1}
          color={config.darkMode ? '#1e293b' : '#e2e8f0'}
        />

        {/* Controls */}
        <Controls
          position="bottom-left"
          className="!bg-slate-900/90 !border-slate-700/50 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700/50 [&>button]:!fill-slate-300 [&>button:hover]:!bg-slate-700 [&>button]:!rounded"
        />

        {/* MiniMap */}
        {config.showMinimap && (
          <MiniMap
            position="bottom-right"
            className="!bg-slate-900/90 !border-slate-700/50 !rounded-lg"
            nodeColor={(node) => {
              const data = node.data as VBNode['data'] | undefined;
              if (!data?.definition) return '#475569';
              const colorMap: Record<string, string> = {
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
              };
              return colorMap[data.definition.color] ?? '#6366f1';
            }}
            maskColor={config.darkMode ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.7)'}
          />
        )}
      </ReactFlow>

      {/* Zoom indicator */}
      <ZoomIndicator />
    </div>
  );
}

/* ─── Zoom indicator ────────────────────────────────────────────────────── */

function ZoomIndicator() {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 rounded-md bg-slate-900/80 border border-slate-700/50 text-[10px] text-slate-400 font-mono backdrop-blur-sm">
      {Math.round(zoom * 100)}%
    </div>
  );
}

/* ─── Exported wrapper with ReactFlowProvider ───────────────────────────── */

interface WorkflowCanvasProps extends WorkflowCanvasInnerProps {
  // No extra props — the provider wrapper is transparent
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/* ─── Re-exported helpers ───────────────────────────────────────────────── */

export function isValidNodeConnection(
  source: string,
  target: string,
  sourceHandle: string | null,
  targetHandle: string | null,
  nodes: VBNode[]
): boolean {
  return isValidConnection(source, target, sourceHandle, targetHandle, nodes);
}
