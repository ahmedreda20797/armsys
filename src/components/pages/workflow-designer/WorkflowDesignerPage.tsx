'use client';

/**
 * ARM ERP — Workflow Designer V2
 * Enterprise Workflow Authoring Platform.
 *
 * Integrates: Explorer, Documentation, Node Inspector V2, Dynamic Forms,
 * Variable Picker, Expression Builder, Edge Inspector, Templates,
 * Version Manager, Validation V2, Simulation, Execution Preview,
 * Outline, Search Everywhere, Analytics.
 *
 * Phase 10/11 — Real serialization & import (graphSerializer).
 * Phase 12   — History capturing nodes/edges/viewport/selection.
 * Phase 13   — Right-click context menus (canvas + node).
 * Phase 14   — Error boundary + recovery dialog (never white-screen).
 * Phase 9    — Complete keyboard system (Ctrl+C/V/D/Z/Shift+Z, Del, A, L, S, 0, Esc).
 *
 * STRICT RULES:
 *   - ONLY a visual authoring layer. No execution, no runtime.
 *   - Consumes the existing Workflow Foundation types (@/workflow/types).
 *   - Does NOT modify the Workflow Engine, Registry, Context, or any business logic.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useReactFlow, ReactFlowProvider, type Connection, type IsValidConnection } from 'reactflow';
import { toast } from 'sonner';
import {
  Workflow, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
  CheckCircle2, AlertCircle, Settings, BookOpen, ListTree,
  GitBranch, FileText, Layers, FolderOpen, Download, Upload,
} from 'lucide-react';

// ── Visual Builder Framework ──────────────────────────────────────────────
import { WorkflowCanvas } from '@/components/visual-builder/canvas/WorkflowCanvas';
import { DesignerToolbar } from '@/components/visual-builder/toolbar/DesignerToolbar';
import { NodeLibraryPanel } from '@/components/visual-builder/panels/NodeLibraryPanel';
import { NodeInspectorV2 } from '@/components/visual-builder/panels/NodeInspectorV2';
import { WorkflowExplorer } from '@/components/visual-builder/panels/WorkflowExplorer';
import { WorkflowOutline } from '@/components/visual-builder/panels/WorkflowOutline';
import { SearchEverywhere } from '@/components/visual-builder/panels/SearchEverywhere';
import { VersionManager } from '@/components/visual-builder/panels/VersionManager';
import { TemplateLibrary } from '@/components/visual-builder/panels/TemplateLibrary';
import { NodeTemplateLibrary } from '@/components/visual-builder/panels/NodeTemplateLibrary';
import { DocumentationPanel } from '@/components/visual-builder/panels/DocumentationPanel';
import { SimulationPanel } from '@/components/visual-builder/panels/SimulationPanel';
import { VariablePicker } from '@/components/visual-builder/panels/VariablePicker';

// ── Phase 13 / 14 new components ──────────────────────────────────────────
import {
  CanvasContextMenu, NodeContextMenu, isNodeTarget,
  type ContextMenuPosition,
} from '@/components/visual-builder/components/ContextMenu';
import {
  DesignerErrorBoundary, RecoveryDialog, type DeserializeWarning,
} from '@/components/visual-builder/components/DesignerErrorBoundary';
import { ColorPalette } from '@/components/visual-builder/components/ColorPalette';

// ── Engine ─────────────────────────────────────────────────────────────────
import { validateGraphV2 } from '@/components/visual-builder/engine/v2-validation';
import { autoLayout } from '@/components/visual-builder/engine/layoutEngine';
import { getNodeValidationErrors } from '@/components/visual-builder/engine/validationEngine';
import { NODE_DEF_MAP } from '@/components/visual-builder/nodes/nodeDefinitions';
import {
  serializeGraph, serializeGraphToString, deserializeGraphFromString,
  saveGraphToLocalStorage, loadGraphFromLocalStorage, getRecentGraphId,
  generateGraphId, type VBSerializedGraph,
} from '@/components/visual-builder/engine/serializer';
import {
  copySelection, cutSelection, pasteSelection, hasClipboard,
} from '@/components/visual-builder/engine/clipboard';
import { isValidConnection as isValidCanvasConnection } from '@/components/visual-builder/canvas/WorkflowCanvas';

import type {
  VBNode, VBEdge, VBNodeDefinition, VBCanvasConfig, VBViewport,
} from '@/components/visual-builder/engine/types';
import type {
  VBValidationReport, VBNodeConfig, VBWorkflowDocumentation,
  VBVariableEntry, VBWorkflowRecord, VBNodeTemplate,
} from '@/components/visual-builder/engine/v2-types';
import type { WorkflowVariable } from '@/workflow/types';

import { cn } from '@/lib/utils';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';

/* ════════════════════════════════════════════════════════════════════════
   ID generators
   ════════════════════════════════════════════════════════════════════════ */

let nodeCounter = 0;
function generateNodeId(type: string): string {
  nodeCounter += 1;
  return `${type}_${Date.now().toString(36)}_${nodeCounter}`;
}
function generateEdgeId(source: string, target: string): string {
  return `edge_${source}_${target}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ════════════════════════════════════════════════════════════════════════
   Starter workflow
   ════════════════════════════════════════════════════════════════════════ */

function createStarterWorkflow(): { nodes: VBNode[]; edges: VBEdge[] } {
  const startDef = NODE_DEF_MAP.get('start')!;
  const notifyDef = NODE_DEF_MAP.get('notify')!;
  const conditionDef = NODE_DEF_MAP.get('condition')!;
  const endDef = NODE_DEF_MAP.get('end')!;

  const makeNode = (def: VBNodeDefinition, x: number, y: number): VBNode => ({
    id: generateNodeId(def.type),
    type: 'workflowNode',
    position: { x, y },
    data: {
      definition: def,
      label: def.label,
      description: def.description,
      status: 'idle',
      config: { ...(def.defaultData ?? {}) },
      validationErrors: [],
    },
  });

  const nodes: VBNode[] = [
    makeNode(startDef, 0, 200),
    makeNode(notifyDef, 280, 200),
    makeNode(conditionDef, 560, 200),
    makeNode(endDef, 840, 200),
  ];

  const edges: VBEdge[] = [
    { id: generateEdgeId(nodes[0].id, nodes[1].id), source: nodes[0].id, target: nodes[1].id, sourceHandle: 'out', targetHandle: 'in', type: 'default' },
    { id: generateEdgeId(nodes[1].id, nodes[2].id), source: nodes[1].id, target: nodes[2].id, sourceHandle: 'out', targetHandle: 'in', type: 'default' },
    { id: generateEdgeId(nodes[2].id, nodes[3].id), source: nodes[2].id, target: nodes[3].id, sourceHandle: 'yes', targetHandle: 'in', type: 'smoothstep' },
  ];

  return { nodes, edges };
}

const SAMPLE_VARIABLES: WorkflowVariable[] = [
  { id: 'var1', name: 'requestId', type: 'string', scope: 'input', description: 'معرف الطلب', required: true },
  { id: 'var2', name: 'employeeId', type: 'string', scope: 'input', description: 'معرف الموظف', required: true },
  { id: 'var3', name: 'approvalStatus', type: 'string', scope: 'computed', description: 'حالة الموافقة', required: false },
  { id: 'var4', name: 'system.now', type: 'date', scope: 'system', description: 'الوقت الحالي', required: false },
];

const DEFAULT_DOC: VBWorkflowDocumentation = {
  purpose: '', description: '', ownerId: '', ownerName: '',
  businessUnit: '', department: '', tags: [], versionNotes: '',
  relatedModules: [], businessImpact: 'medium',
  estimatedRuntimeMs: 5000, complexity: 'medium',
};

/* ════════════════════════════════════════════════════════════════════════
   RIGHT PANEL MODES
   ════════════════════════════════════════════════════════════════════════ */

type RightPanelMode =
  | 'inspector' | 'outline' | 'documentation'
  | 'versions' | 'simulation';

const RIGHT_MODES: { id: RightPanelMode; label: string; icon: React.ElementType }[] = [
  { id: 'inspector',     label: 'المفتش',   icon: Settings },
  { id: 'outline',       label: 'المخطط',   icon: ListTree },
  { id: 'documentation', label: 'الوثائق', icon: BookOpen },
  { id: 'simulation',    label: 'محاكاة',   icon: GitBranch },
  { id: 'versions',      label: 'الإصدارات', icon: Layers },
];

/* ════════════════════════════════════════════════════════════════════════
   VARIABLE PICKER TARGET
   ════════════════════════════════════════════════════════════════════════ */

interface VarPickerTarget {
  kind: 'node-config' | 'node-condition' | 'edge-condition';
  fieldKey?: string;
  conditionId?: string;
  edgeId?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   CONTEXT MENU STATE
   ════════════════════════════════════════════════════════════════════════ */

type ContextMenuState =
  | { kind: 'none' }
  | { kind: 'canvas'; position: ContextMenuPosition }
  | { kind: 'node'; position: ContextMenuPosition; nodeId: string };

/* ════════════════════════════════════════════════════════════════════════
   MAIN DESIGNER COMPONENT (inside ReactFlowProvider)
   ════════════════════════════════════════════════════════════════════════ */

function WorkflowDesignerInner() {
  const rf = useReactFlow();

  // ── Graph state ────────────────────────────────────────────────────────
  const initial = useMemo(() => createStarterWorkflow(), []);
  const [nodes, setNodes] = useState<VBNode[]>(initial.nodes);
  const [edges, setEdges] = useState<VBEdge[]>(initial.edges);
  const [documentation, setDocumentation] = useState<VBWorkflowDocumentation>(DEFAULT_DOC);
  const [variables] = useState<WorkflowVariable[]>(SAMPLE_VARIABLES);
  const [graphId] = useState<string>(() => generateGraphId());
  const [graphName, setGraphName] = useState<string>('Untitled Workflow');

  // ── Selection (nodes + edges independently) ────────────────────────────
  const [selectedNodes, setSelectedNodes] = useState<VBNode[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<VBEdge[]>([]);
  const primarySelected = selectedNodes[0] ?? null;
  const selectedEdge = selectedEdges[0] ?? null;
  const [simHighlight, setSimHighlight] = useState<string | null>(null);

  // ── Canvas config ──────────────────────────────────────────────────────
  const [canvasConfig, setCanvasConfig] = useState<VBCanvasConfig>({
    snapToGrid: true, gridSize: 16, showGrid: true, showMinimap: true,
    showBackground: 'dots', darkMode: true,
  });

  // ── Viewport (Phase 11 — restore on import) ────────────────────────────
  const [viewport, setViewport] = useState<VBViewport>({ x: 0, y: 0, zoom: 1 });
  const onViewportChange = useCallback((vp: VBViewport) => setViewport(vp), []);

  // ── Panels ─────────────────────────────────────────────────────────────
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightMode, setRightMode] = useState<RightPanelMode>('inspector');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [nodeTemplatesOpen, setNodeTemplatesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [varPickerOpen, setVarPickerOpen] = useState(false);
  const [varPickerTarget, setVarPickerTarget] = useState<VarPickerTarget | null>(null);

  // ── Favorites & recent ─────────────────────────────────────────────────
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('wf_favorites') ?? '[]'); } catch { return []; }
  });
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('wf_recent') ?? '[]'); } catch { return []; }
  });

  // ── Context menu & color palette (Phase 13 / 4) ────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
  const [colorPalette, setColorPalette] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  // ── Recovery dialog (Phase 14) ─────────────────────────────────────────
  const [recovery, setRecovery] = useState<{ warnings: DeserializeWarning[]; name: string; pending: null | (() => void) } | null>(null);

  // ── Validation V2 ──────────────────────────────────────────────────────
  const validation = useMemo<VBValidationReport>(
    () => validateGraphV2(nodes, edges, variables),
    [nodes, edges, variables],
  );

  // Inject validation into nodes for renderer display.
  const nodesWithValidation = useMemo(() => {
    return nodes.map((n) => {
      const errs = getNodeValidationErrors(n.id, validation);
      const hasErrs = errs.length > 0;
      const currentErrs = n.data.validationErrors ?? [];
      if (hasErrs && currentErrs.join('|') === errs.join('|')) return n;
      return {
        ...n,
        data: {
          ...n.data,
          validationErrors: errs,
          status: hasErrs ? ('error' as const) : n.data.status === 'error' ? ('idle' as const) : n.data.status,
        },
      };
    });
  }, [nodes, validation]);

  // Apply simulation highlight to nodes (renders active node differently).
  const nodesForCanvas = useMemo(() => {
    if (!simHighlight) return nodesWithValidation;
    return nodesWithValidation.map((n) =>
      n.id === simHighlight
        ? { ...n, data: { ...n.data, status: 'active' as const } }
        : n,
    );
  }, [nodesWithValidation, simHighlight]);

  // ── History (Phase 12 — captures nodes/edges/viewport/selection) ───────
  interface HistorySnapshot {
    nodes: VBNode[]; edges: VBEdge[];
    viewport: VBViewport;
    selection: { nodeIds: string[]; edgeIds: string[] };
  }
  const pastRef = useRef<HistorySnapshot[]>([]);
  const futureRef = useRef<HistorySnapshot[]>([]);
  const [, setHistVer] = useState(0);
  const MAX_HISTORY = 100;

  const captureSnapshot = useCallback((): HistorySnapshot => ({
    nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges: edges.map((e) => ({ ...e })),
    viewport: { ...viewport },
    selection: {
      nodeIds: selectedNodes.map((n) => n.id),
      edgeIds: selectedEdges.map((e) => e.id),
    },
  }), [nodes, edges, viewport, selectedNodes, selectedEdges]);

  const pushHistory = useCallback(() => {
    const snap = captureSnapshot();
    pastRef.current = [...pastRef.current.slice(-MAX_HISTORY + 1), snap];
    futureRef.current = [];
    setHistVer((v) => v + 1);
  }, [captureSnapshot]);

  const restoreSnapshot = useCallback((snap: HistorySnapshot) => {
    const selNodeIds = new Set(snap.selection.nodeIds);
    const selEdgeIds = new Set(snap.selection.edgeIds);
    setNodes(snap.nodes.map((n) => ({ ...n, selected: selNodeIds.has(n.id) ? true : undefined, data: { ...n.data } })));
    setEdges(snap.edges.map((e) => ({ ...e, selected: selEdgeIds.has(e.id) ? true : undefined }) as VBEdge));
    setSelectedNodes(snap.nodes.filter((n) => selNodeIds.has(n.id)));
    setSelectedEdges(snap.edges.filter((e) => selEdgeIds.has(e.id)));
    // Restore viewport non-destructively.
    try { rf.setViewport({ x: snap.viewport.x, y: snap.viewport.y, zoom: snap.viewport.zoom }); } catch { /* noop */ }
    setHistVer((v) => v + 1);
  }, [rf]);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [captureSnapshot(), ...futureRef.current];
    restoreSnapshot(prev);
    toast.info('تم التراجع');
  }, [captureSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, captureSnapshot()];
    restoreSnapshot(next);
    toast.info('تمت الإعادة');
  }, [captureSnapshot, restoreSnapshot]);

  // ── Save state ─────────────────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Drag & Drop ────────────────────────────────────────────────────────
  const onDrop = useCallback((event: React.DragEvent, position: { x: number; y: number }) => {
    event.preventDefault();
    const defJson = event.dataTransfer.getData('application/reactflow');
    if (!defJson) return;
    let def: VBNodeDefinition;
    try { def = JSON.parse(defJson); } catch { return; }

    if (def.isSingleton && nodes.some((n) => n.data.definition.type === def.type)) {
      toast.error(`عقدة "${def.label}" موجودة بالفعل`);
      return;
    }
    pushHistory();
    const newNode: VBNode = {
      id: generateNodeId(def.type),
      type: 'workflowNode',
      position: canvasConfig.snapToGrid
        ? {
            x: Math.round(position.x / canvasConfig.gridSize) * canvasConfig.gridSize,
            y: Math.round(position.y / canvasConfig.gridSize) * canvasConfig.gridSize,
          }
        : position,
      data: {
        definition: def, label: def.label, description: def.description,
        status: 'idle', config: { ...(def.defaultData ?? {}) }, validationErrors: [],
      },
    };
    setNodes((nds) => {
      const next = [...nds, newNode];
      // Auto-select & focus the freshly-dropped node (Phase 2).
      setTimeout(() => {
        const node = next.find((n) => n.id === newNode.id);
        if (node) {
          setSelectedNodes([node]);
          setSelectedEdges([]);
          rf.setCenter(node.position.x + 90, node.position.y + 30, { zoom: 1, duration: 200 });
        }
      }, 30);
      return next.map((n) => ({ ...n, selected: n.id === newNode.id ? true : undefined }));
    });
    setIsDirty(true);
    setRecentlyUsed((prev) => {
      const next = [def.type, ...prev.filter((t) => t !== def.type)].slice(0, 10);
      try { localStorage.setItem('wf_recent', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [nodes, canvasConfig, pushHistory, rf]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // ── Node / edge changes ────────────────────────────────────────────────
  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds) => {
      const next = applyNodeChangesLite(changes, nds);
      const hasRemoval = changes.some((c: any) => c.type === 'remove');
      const hasPosEnd = changes.some((c: any) => c.type === 'position' && c.dragging === false);
      if (hasRemoval || hasPosEnd) { pushHistory(); setIsDirty(true); }
      return next;
    });
  }, [pushHistory]);

  const onEdgesChange = useCallback((changes: any) => {
    setEdges((eds) => {
      const next = applyEdgeChangesLite(changes, eds);
      const hasRemoval = changes.some((c: any) => c.type === 'remove');
      if (hasRemoval) { pushHistory(); setIsDirty(true); }
      return next;
    });
  }, [pushHistory]);

  // ── Connect (Phase 3 — uses live validator) ────────────────────────────
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sn = nodes.find((n) => n.id === connection.source);
    const tn = nodes.find((n) => n.id === connection.target);
    if (!sn || !tn) return;
    const ok = isValidCanvasConnection(
      connection.source, connection.target,
      connection.sourceHandle ?? null, connection.targetHandle ?? null,
      nodes, edges,
    );
    if (!ok) {
      // Distinguish cycle from generic rejection for clearer feedback.
      if (connection.source !== connection.target) {
        toast.error('اتصال غير صالح (ممنوع أو مكرر أو يشكل حلقة)');
      }
      return;
    }
    pushHistory();
    const newEdge: VBEdge = {
      id: generateEdgeId(connection.source, connection.target),
      source: connection.source, target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'default', animated: true,
    };
    setEdges((eds) => [...eds, newEdge]);
    setIsDirty(true);
    setTimeout(() => setEdges((eds) => eds.map((e) => (e.id === newEdge.id ? { ...e, animated: false } : e))), 1000);
  }, [nodes, edges, pushHistory]);

  // Live validator passed into React Flow (Phase 3 — invalid feedback at drag).
  const isValidConnectionCb = useCallback<IsValidConnection>((conn) => {
    if (!conn.source || !conn.target) return false;
    return isValidCanvasConnection(
      conn.source, conn.target,
      conn.sourceHandle ?? null, conn.targetHandle ?? null,
      nodes, edges,
    );
  }, [nodes, edges]);

  // ── Selection ──────────────────────────────────────────────────────────
  const onSelectionChange = useCallback((selNodes: VBNode[], selEdges: VBEdge[]) => {
    setSelectedNodes(selNodes);
    setSelectedEdges(selEdges);
    if (selNodes.length > 0 && rightMode !== 'inspector') setRightMode('inspector');
    else if (selEdges.length > 0 && selNodes.length === 0 && rightMode !== 'inspector') setRightMode('inspector');
  }, [rightMode]);

  const onEdgeClick = useCallback((edge: VBEdge) => {
    setSelectedNodes([]);
    setSelectedEdges([edge]);
    if (rightMode !== 'inspector') setRightMode('inspector');
  }, [rightMode]);

  // ── Focus / select node (used by Outline, Search, Validation) ──────────
  const focusNode = useCallback((id: string) => {
    const target = nodes.find((n) => n.id === id);
    if (!target) return;
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id ? true : undefined })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: undefined }) as VBEdge));
    setSelectedNodes([target]);
    setSelectedEdges([]);
    rf.setCenter(target.position.x + 90, target.position.y + 30, { zoom: 1.2, duration: 300 });
    setRightMode('inspector');
  }, [nodes, edges, rf]);

  // ── Phase 8 — Validation click → camera moves → select → inspector ─────
  const focusValidationIssue = useCallback((issueNodeId?: string, issueEdgeId?: string) => {
    if (issueNodeId) {
      focusNode(issueNodeId);
    } else if (issueEdgeId) {
      const edge = edges.find((e) => e.id === issueEdgeId);
      if (!edge) return;
      const srcNode = nodes.find((n) => n.id === edge.source);
      const tgtNode = nodes.find((n) => n.id === edge.target);
      const midX = ((srcNode?.position.x ?? 0) + (tgtNode?.position.x ?? 0)) / 2;
      const midY = ((srcNode?.position.y ?? 0) + (tgtNode?.position.y ?? 0)) / 2;
      setNodes((nds) => nds.map((n) => ({ ...n, selected: undefined })));
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === issueEdgeId ? true : undefined }) as VBEdge));
      setSelectedNodes([]);
      setSelectedEdges([edge]);
      rf.setCenter(midX, midY, { zoom: 1.2, duration: 300 });
      setRightMode('inspector');
    }
  }, [focusNode, edges, nodes, rf]);

  // ── Update node ────────────────────────────────────────────────────────
  const onUpdateNode = useCallback((id: string, data: Partial<VBNode['data']> & { configPatch?: Record<string, unknown> }) => {
    pushHistory();
    setNodes((nds) => nds.map((n) => {
      if (n.id !== id) return n;
      const mergedConfig = data.configPatch
        ? { ...n.data.config, ...data.configPatch }
        : n.data.config;
      return { ...n, data: { ...n.data, ...data, config: mergedConfig } };
    }));
    setIsDirty(true);
  }, [pushHistory]);

  // ── Update edge ────────────────────────────────────────────────────────
  const onUpdateEdge = useCallback((id: string, data: Partial<VBEdge> & { dataPatch?: Record<string, unknown> }) => {
    pushHistory();
    setEdges((eds) => eds.map((e) => {
      if (e.id !== id) return e;
      const mergedData = data.dataPatch ? { ...(e.data ?? {}), ...data.dataPatch } : e.data;
      return { ...e, ...data, data: mergedData };
    }));
    setIsDirty(true);
  }, [pushHistory]);

  // ── Favorites ──────────────────────────────────────────────────────────
  const toggleFavorite = useCallback((type: string) => {
    setFavorites((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type];
      try { localStorage.setItem('wf_favorites', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // ── Delete / Duplicate ─────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    const edgeIds = new Set(selectedEdges.map((e) => e.id));
    if (ids.size === 0 && edgeIds.size === 0) return;
    pushHistory();
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !edgeIds.has(e.id) && !ids.has(e.source) && !ids.has(e.target)));
    setSelectedNodes([]);
    setSelectedEdges([]);
    setIsDirty(true);
    if (ids.size > 0) toast.success(`تم حذف ${ids.size} عقدة`);
    else if (edgeIds.size > 0) toast.success(`تم حذف ${edgeIds.size} اتصال`);
  }, [selectedNodes, selectedEdges, pushHistory]);

  const duplicateSelected = useCallback(() => {
    if (selectedNodes.length === 0) return;
    pushHistory();
    const dupes: VBNode[] = selectedNodes.map((n) => ({
      ...n, id: generateNodeId(n.data.definition.type),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: { ...n.data }, selected: true,
    }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: undefined })), ...dupes]);
    setSelectedNodes(dupes);
    setIsDirty(true);
    toast.success(`تم تكرار ${dupes.length} عقدة`);
  }, [selectedNodes, pushHistory]);

  // ── Copy / Cut / Paste (Phase 9 / 12) ──────────────────────────────────
  const copySelected = useCallback(() => {
    const payload = copySelection(nodes, edges, selectedNodes.map((n) => n.id), false);
    if (payload) toast.success(`تم نسخ ${payload.nodes.length} عقدة`);
  }, [nodes, edges, selectedNodes]);

  const cutSelected = useCallback(() => {
    const payload = cutSelection(nodes, edges, selectedNodes.map((n) => n.id));
    if (!payload) return;
    toast.success(`تم قص ${payload.nodes.length} عقدة`);
    // Remove the cut nodes from the canvas.
    const ids = new Set(selectedNodes.map((n) => n.id));
    pushHistory();
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedNodes([]);
    setIsDirty(true);
  }, [nodes, edges, selectedNodes, pushHistory]);

  const pasteFromClipboard = useCallback(() => {
    const result = pasteSelection();
    if (result.nodes.length === 0) {
      toast.info('الحافظة فارغة');
      return;
    }
    pushHistory();
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: undefined })), ...result.nodes]);
    setEdges((eds) => [...eds, ...result.edges]);
    setSelectedNodes(result.nodes);
    setSelectedEdges([]);
    setIsDirty(true);
    toast.success(`تم لصق ${result.nodes.length} عقدة`);
  }, [pushHistory]);

  // ── Select All (Ctrl+A) ────────────────────────────────────────────────
  const selectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: true }) as VBEdge));
    setSelectedNodes(nodes);
    setSelectedEdges(edges);
  }, [nodes, edges]);

  // ── Zoom / View ────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => { try { rf.zoomIn(); } catch { /* noop */ } }, [rf]);
  const zoomOut = useCallback(() => { try { rf.zoomOut(); } catch { /* noop */ } }, [rf]);
  const fitView = useCallback(() => { try { rf.fitView({ padding: 0.2, duration: 300 }); } catch { /* noop */ } }, [rf]);
  const centerView = useCallback(() => {
    try {
      if (selectedNodes.length > 0) {
        const b = selectedNodes.reduce((a, n) => ({
          minX: Math.min(a.minX, n.position.x), minY: Math.min(a.minY, n.position.y),
          maxX: Math.max(a.maxX, n.position.x + 180), maxY: Math.max(a.maxY, n.position.y + 80),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        rf.setCenter((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, { zoom: 1, duration: 300 });
      } else {
        rf.fitView({ padding: 0.2, duration: 300 });
      }
    } catch { /* noop */ }
  }, [rf, selectedNodes]);

  // ── Auto layout ────────────────────────────────────────────────────────
  const runAutoLayout = useCallback(() => {
    pushHistory();
    setNodes(autoLayout(nodes, edges));
    setTimeout(() => { try { rf.fitView({ padding: 0.2, duration: 400 }); } catch { /* noop */ } }, 50);
    setIsDirty(true);
    toast.success('تم ترتيب العقد تلقائياً');
  }, [nodes, edges, pushHistory, rf]);

  // ── Phase 10 — Save: real serialization ────────────────────────────────
  const handleSave = useCallback(() => {
    setIsSaving(true);
    try {
      const doc = serializeGraph({
        nodes, edges, viewport, variables, documentation, designer: canvasConfig,
        name: graphName, graphId, score: validation.score,
      });
      const ok = saveGraphToLocalStorage(graphId, doc);
      if (!ok) throw new Error('storage quota');
      setIsDirty(false);
      toast.success(`تم حفظ "${doc.name}" (${nodes.length} عقدة، ${edges.length} اتصال)`);
    } catch (err) {
      toast.error('تعذّر الحفظ في الذاكرة المحلية');
      // eslint-disable-next-line no-console
      console.error('[Save]', err);
    } finally {
      setIsSaving(false);
    }
  }, [nodes, edges, viewport, variables, documentation, canvasConfig, graphName, graphId, validation.score]);

  // ── Export / Import (Phase 10/11) ──────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    try {
      const text = serializeGraphToString({
        nodes, edges, viewport, variables, documentation, designer: canvasConfig,
        name: graphName, graphId, score: validation.score,
      });
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${graphName.replace(/[^\w-]+/g, '_')}_${graphId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('تم تصدير المسار (JSON)');
    } catch (err) {
      toast.error('تعذّر التصدير');
      // eslint-disable-next-line no-console
      console.error('[Export]', err);
    }
  }, [nodes, edges, viewport, variables, documentation, canvasConfig, graphName, graphId, validation.score]);

  const applyDeserialized = useCallback((result: ReturnType<typeof deserializeGraphFromString>, acceptWarnings: boolean) => {
    if (result.warnings.length > 0 && !acceptWarnings) {
      setRecovery({
        warnings: result.warnings,
        name: result.name,
        pending: () => applyDeserialized(result, true),
      });
      return;
    }
    pushHistory();
    setNodes(result.nodes);
    setEdges(result.edges);
    setDocumentation(result.documentation);
    setCanvasConfig(result.designer);
    setGraphName(result.name);
    setSelectedNodes([]);
    setSelectedEdges([]);
    setIsDirty(false);
    // Restore viewport after layout settles.
    setTimeout(() => {
      try {
        rf.setViewport({ x: result.viewport.x, y: result.viewport.y, zoom: result.viewport.zoom });
        rf.fitView({ padding: 0.2, duration: 300 });
      } catch { /* noop */ }
    }, 80);
    toast.success(`تم فتح "${result.name}"`);
  }, [pushHistory, rf]);

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const result = deserializeGraphFromString(text);
        applyDeserialized(result, false);
      } catch (err) {
        setRecovery({
          warnings: [{ kind: 'corrupted', message: `Failed to parse file: ${(err as Error).message}` }],
          name: file.name,
          pending: null,
        });
      }
    };
    reader.onerror = () => toast.error('تعذّر قراءة الملف');
    reader.readAsText(file);
  }, [applyDeserialized]);

  const triggerImport = useCallback(() => { fileInputRef.current?.click(); }, []);

  // ── Publish: validate first, then persist ──────────────────────────────
  const handlePublish = useCallback(() => {
    if (!validation.valid) {
      toast.error(`لا يمكن النشر — ${validation.errors.length} خطأ`);
      setRightMode('inspector');
      return;
    }
    setIsPublishing(true);
    // Persist a published snapshot before signalling success.
    try {
      const doc = serializeGraph({
        nodes, edges, viewport, variables, documentation, designer: canvasConfig,
        name: graphName, graphId, score: validation.score,
      });
      saveGraphToLocalStorage(`${graphId}_published`, doc);
    } catch { /* non-fatal */ }
    setTimeout(() => {
      setIsPublishing(false);
      setIsDirty(false);
      toast.success('تم نشر المسار');
    }, 600);
  }, [validation, nodes, edges, viewport, variables, documentation, canvasConfig, graphName, graphId]);

  const handleValidate = useCallback(() => {
    if (validation.valid && validation.warnings.length === 0) {
      toast.success(`التصميم سليم — درجة الصحة ${validation.score}/100`);
    } else if (validation.valid) {
      toast.warning(`درجة الصحة ${validation.score}/100 — ${validation.warnings.length} تحذير`);
    } else {
      toast.error(`درجة الصحة ${validation.score}/100 — ${validation.errors.length} خطأ`);
    }
  }, [validation]);

  // ── Variable picker ────────────────────────────────────────────────────
  const openVarPicker = useCallback((target: VarPickerTarget) => {
    setVarPickerTarget(target);
    setVarPickerOpen(true);
  }, []);

  const handlePickVariable = useCallback((v: VBVariableEntry) => {
    if (!varPickerTarget) { setVarPickerOpen(false); return; }
    const varPath = `{{${v.name}}}`;
    if (varPickerTarget.kind === 'node-config' && primarySelected) {
      const cfg = primarySelected.data.config as Partial<VBNodeConfig> | undefined;
      const configValues = (cfg?.config as Record<string, unknown>) ?? {};
      const fieldKey = varPickerTarget.fieldKey;
      if (fieldKey && fieldKey !== '__output__' && fieldKey !== '__assignee__') {
        onUpdateNode(primarySelected.id, { configPatch: { config: { ...configValues, [fieldKey]: varPath } } });
      } else if (fieldKey === '__output__') {
        onUpdateNode(primarySelected.id, { configPatch: { outputVariable: v.name } });
      } else if (fieldKey === '__assignee__') {
        onUpdateNode(primarySelected.id, { configPatch: { assignment: { type: cfg?.assignment?.type ?? 'user', value: varPath } } });
      } else {
        onUpdateNode(primarySelected.id, { configPatch: { config: { ...configValues, _picked: varPath } } });
      }
    }
    setVarPickerOpen(false);
    setVarPickerTarget(null);
    toast.success(`تم اختيار: ${v.name}`);
  }, [varPickerTarget, primarySelected, onUpdateNode]);

  // ── Apply template ─────────────────────────────────────────────────────
  const applyTemplate = useCallback((tNodes: VBNode[], tEdges: VBEdge[], _vars: WorkflowVariable[]) => {
    pushHistory();
    const idMap = new Map<string, string>();
    const newNodes = tNodes.map((n) => {
      const newId = generateNodeId(n.data.definition.type);
      idMap.set(n.id, newId);
      return { ...n, id: newId, position: { ...n.position }, data: { ...n.data }, selected: undefined };
    });
    const newEdges = tEdges.map((e) => ({
      ...e,
      id: generateEdgeId(idMap.get(e.source) ?? e.source, idMap.get(e.target) ?? e.target),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    setNodes((nds) => [...nds, ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges]);
    setIsDirty(true);
    setTemplatesOpen(false);
    setTimeout(() => { try { rf.fitView({ padding: 0.2, duration: 400 }); } catch { /* noop */ } }, 50);
    toast.success(`تم إضافة قالب بـ ${newNodes.length} عقدة`);
  }, [pushHistory, rf]);

  // ── Apply node template ────────────────────────────────────────────────
  const applyNodeTemplate = useCallback((tpl: VBNodeTemplate) => {
    const def = NODE_DEF_MAP.get(tpl.nodeType);
    if (!def) { toast.error(`نوع عقدة غير معروف: ${tpl.nodeType}`); return; }
    pushHistory();
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const newNode: VBNode = {
      id: generateNodeId(def.type),
      type: 'workflowNode',
      position: canvasConfig.snapToGrid
        ? { x: Math.round(center.x / canvasConfig.gridSize) * canvasConfig.gridSize, y: Math.round(center.y / canvasConfig.gridSize) * canvasConfig.gridSize }
        : { x: center.x, y: center.y },
      data: {
        definition: def,
        label: tpl.config.label || def.label,
        description: tpl.config.description || def.description,
        status: 'idle',
        config: { ...(tpl.config.config ?? {}) },
        validationErrors: [],
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);
    toast.success(`تم إضافة "${tpl.name}"`);
  }, [nodes, edges, canvasConfig, pushHistory, rf]);

  // ── Open workflow from explorer ────────────────────────────────────────
  const openWorkflow = useCallback((w: VBWorkflowRecord) => {
    setExplorerOpen(false);
    // Phase 11 — reopen from local cache if present, else seed a fresh graph.
    const cached = loadGraphFromLocalStorage(w.id);
    if (cached) {
      applyDeserialized(cached, false);
    } else {
      // No cache yet for this record → just adopt the name & doc.
      setGraphName(w.name);
      setDocumentation(w.documentation);
      toast.success(`تم فتح "${w.name}"`);
    }
  }, [applyDeserialized]);

  // ── Phase 13 — Context menu actions ────────────────────────────────────
  const createNodeAtCenter = useCallback((type = 'notify') => {
    const def = NODE_DEF_MAP.get(type);
    if (!def) return;
    if (def.isSingleton && nodes.some((n) => n.data.definition.type === def.type)) {
      toast.error(`عقدة "${def.label}" موجودة بالفعل`);
      return;
    }
    pushHistory();
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const newNode: VBNode = {
      id: generateNodeId(def.type),
      type: 'workflowNode',
      position: canvasConfig.snapToGrid
        ? { x: Math.round(center.x / canvasConfig.gridSize) * canvasConfig.gridSize, y: Math.round(center.y / canvasConfig.gridSize) * canvasConfig.gridSize }
        : center,
      data: {
        definition: def, label: def.label, description: def.description,
        status: 'idle', config: { ...(def.defaultData ?? {}) }, validationErrors: [],
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodes([newNode]);
    setSelectedEdges([]);
    setIsDirty(true);
    setRightMode('inspector');
  }, [nodes, canvasConfig, pushHistory, rf]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ kind: 'canvas', position: { x: e.clientX, y: e.clientY } });
  }, []);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const target = nodes.find((n) => n.id === nodeId);
    if (target) {
      setSelectedNodes([target]);
      setSelectedEdges([]);
    }
    setContextMenu({ kind: 'node', position: { x: e.clientX, y: e.clientY }, nodeId });
  }, [nodes]);

  // ── Phase 4 — Appearance actions (color/enable/collapse/notes) ─────────
  const setNodeColor = useCallback((nodeId: string, color: string) => {
    onUpdateNode(nodeId, { colorOverride: color });
  }, [onUpdateNode]);

  const toggleNodeEnabled = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    onUpdateNode(nodeId, { enabled: !(node.data.enabled ?? true) });
  }, [nodes, onUpdateNode]);

  const toggleNodeCollapsed = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    onUpdateNode(nodeId, { collapsed: !(node.data.collapsed ?? false) });
  }, [nodes, onUpdateNode]);

  // ── Keyboard shortcuts (Phase 9) ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inEditable = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const meta = e.ctrlKey || e.metaKey;

      // Escape is allowed even in fields (to blur / close).
      if (e.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return; }
        if (varPickerOpen) { setVarPickerOpen(false); return; }
        if (contextMenu.kind !== 'none') { setContextMenu({ kind: 'none' }); return; }
        if (colorPalette) { setColorPalette(null); return; }
        if (explorerOpen) { setExplorerOpen(false); return; }
        if (templatesOpen) { setTemplatesOpen(false); return; }
        if (nodeTemplatesOpen) { setNodeTemplatesOpen(false); return; }
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          setNodes((nds) => nds.map((n) => ({ ...n, selected: undefined })));
          setEdges((eds) => eds.map((ed) => ({ ...ed, selected: undefined }) as VBEdge));
          setSelectedNodes([]);
          setSelectedEdges([]);
        }
        return;
      }

      if (inEditable) return;

      if (meta && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (meta && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); handleSave(); return; }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelected(); return; }
      if (meta && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelected(); return; }
      if (meta && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteFromClipboard(); return; }
      if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      if (meta && e.key.toLowerCase() === 'l') { e.preventDefault(); runAutoLayout(); return; }
      if (meta && e.key.toLowerCase() === 'e') { e.preventDefault(); handleExport(); return; }
      if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); triggerImport(); return; }
      if (meta && e.key === '0') { e.preventDefault(); fitView(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodes.length > 0 || selectedEdges.length > 0)) {
        e.preventDefault(); deleteSelected(); return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    undo, redo, handleSave, duplicateSelected, copySelected, cutSelected,
    pasteFromClipboard, selectAll, runAutoLayout, handleExport, triggerImport,
    fitView, deleteSelected, searchOpen, varPickerOpen, contextMenu, colorPalette,
    explorerOpen, templatesOpen, nodeTemplatesOpen, selectedNodes, selectedEdges,
  ]);

  // ── Reopen last graph on first mount (Phase 11). ───────────────────────
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    const recentId = getRecentGraphId();
    if (!recentId) return;
    const cached = loadGraphFromLocalStorage(recentId);
    if (cached && cached.nodes.length > 0) {
      // Silent restore — no recovery dialog for auto-open.
      setNodes(cached.nodes);
      setEdges(cached.edges);
      setDocumentation(cached.documentation);
      setCanvasConfig(cached.designer);
      setGraphName(cached.name);
      setTimeout(() => { try { rf.fitView({ padding: 0.2, duration: 300 }); } catch { /* noop */ } }, 80);
    }
  }, [rf]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const errorCount = validation.errors.length;
  const warningCount = validation.warnings.length;
  const canPaste = hasClipboard();

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 overflow-hidden"
      onContextMenu={handleCanvasContextMenu}
    >
      {/* Hidden import input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = ''; // reset so the same file can be re-imported
        }}
      />

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/20">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">
              مصمم المسارات <span className="text-[9px] text-violet-400 font-mono ml-1">V2</span>
            </h1>
            <p className="text-[10px] text-slate-500">Enterprise Workflow Authoring Platform</p>
          </div>
          <div className="flex items-center gap-2 mr-4">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700/50">
              <span className={cn('w-1.5 h-1.5 rounded-full', validation.valid ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="text-[10px] text-slate-400">{validation.valid ? 'سليم' : `${errorCount} خطأ`}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20">
              <span className="text-[10px] text-violet-300 font-bold">{validation.score}</span>
              <span className="text-[9px] text-slate-500">/100</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={triggerImport} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors" aria-label="فتح">
                <FolderOpen className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">فتح (Ctrl+O)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={handleExport} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors" aria-label="تصدير">
                <Download className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">تصدير (Ctrl+E)</TooltipContent>
          </Tooltip>
          <div className="w-px h-5 bg-slate-700/50 mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => setLeftPanelOpen((v) => !v)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                {leftPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">المكتبة</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => setRightPanelOpen((v) => !v)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">اللوحة الجانبية</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <DesignerToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        isSaving={isSaving}
        isPublishing={isPublishing}
        hasChanges={isDirty}
        validation={validation}
        showMinimap={canvasConfig.showMinimap}
        showGrid={canvasConfig.showGrid}
        snapToGrid={canvasConfig.snapToGrid}
        selectedCount={selectedNodes.length}
        canPaste={canPaste}
        onUndo={undo}
        onRedo={redo}
        onSave={handleSave}
        onPublish={handlePublish}
        onValidate={handleValidate}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitView={fitView}
        onCenterView={centerView}
        onToggleMinimap={() => setCanvasConfig((c) => ({ ...c, showMinimap: !c.showMinimap }))}
        onToggleGrid={() => setCanvasConfig((c) => ({
          ...c,
          showGrid: !c.showGrid,
          showBackground: !c.showGrid ? 'dots' : 'none',
        }))}
        onToggleSnap={() => setCanvasConfig((c) => ({ ...c, snapToGrid: !c.snapToGrid }))}
        onDeleteSelected={deleteSelected}
        onDuplicateSelected={duplicateSelected}
        onCopySelected={copySelected}
        onPaste={pasteFromClipboard}
        onAutoLayout={runAutoLayout}
        onToggleExplorer={() => setExplorerOpen(true)}
        onToggleTemplates={() => setTemplatesOpen(true)}
        onToggleNodeTemplates={() => setNodeTemplatesOpen(true)}
        onToggleSearch={() => setSearchOpen(true)}
        onToggleSimulation={() => { setRightPanelOpen(true); setRightMode('simulation'); }}
        onToggleAnalytics={() => { setRightPanelOpen(true); setRightMode('simulation'); }}
      />

      {/* ── Main split ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left — Node Library */}
        {leftPanelOpen && (
          <aside className="w-64 flex-shrink-0">
            <NodeLibraryPanel
              onDragStart={(e, def) => {
                e.dataTransfer.setData('application/reactflow', JSON.stringify(def));
                e.dataTransfer.effectAllowed = 'move';
              }}
              favorites={favorites}
              recentlyUsed={recentlyUsed}
              onToggleFavorite={toggleFavorite}
            />
          </aside>
        )}

        {/* Center — Canvas */}
        <main
          className="flex-1 min-w-0 relative"
          onContextMenu={(e) => {
            const nodeId = isNodeTarget(e);
            if (nodeId) handleNodeContextMenu(e, nodeId);
            else handleCanvasContextMenu(e);
          }}
        >
          <WorkflowCanvas
            nodes={nodesForCanvas}
            edges={edges}
            config={canvasConfig}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onSelectionChange={onSelectionChange}
            onEdgeClick={onEdgeClick}
            onViewportChange={onViewportChange}
            isValid={isValidConnectionCb}
          />
        </main>

        {/* Right — Mode-switching panel */}
        {rightPanelOpen && (
          <aside className="w-80 flex-shrink-0 flex flex-col bg-slate-950/80 border-l border-slate-800/60">
            <div className="flex border-b border-slate-800/60 overflow-x-auto arm-scroll">
              {RIGHT_MODES.map(({ id, label, icon: Icon }) => {
                const badge = id === 'inspector' ? errorCount + warningCount : 0;
                return (
                  <button
                    key={id}
                    onClick={() => setRightMode(id)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap',
                      rightMode === id ? 'border-violet-500 text-violet-300 bg-violet-500/5' : 'border-transparent text-slate-500 hover:text-slate-300',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {badge > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold',
                        errorCount > 0 ? 'bg-red-500 text-white' : 'bg-amber-500 text-white',
                      )}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {rightMode === 'inspector' && (
                <NodeInspectorV2
                  node={primarySelected}
                  edge={selectedEdge}
                  validation={validation}
                  onUpdateNode={onUpdateNode}
                  onUpdateEdge={onUpdateEdge}
                  onClose={() => { setSelectedNodes([]); setSelectedEdges([]); }}
                  onPickVariable={openVarPicker}
                  onFocusIssue={focusValidationIssue}
                />
              )}
              {rightMode === 'outline' && (
                <WorkflowOutline
                  nodes={nodes}
                  edges={edges}
                  validation={validation}
                  selectedId={primarySelected?.id ?? null}
                  onSelectNode={focusNode}
                />
              )}
              {rightMode === 'documentation' && (
                <DocumentationPanel
                  documentation={documentation}
                  onChange={setDocumentation}
                />
              )}
              {rightMode === 'simulation' && (
                <SimulationPanel nodes={nodes} edges={edges} onHighlightNode={setSimHighlight} />
              )}
              {rightMode === 'versions' && (
                <VersionManager onClose={() => setRightMode('inspector')} />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Overlays / Modals ────────────────────────────────────────────── */}

      {explorerOpen && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setExplorerOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-96 max-w-[90vw] h-full bg-slate-950 border-l border-slate-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <WorkflowExplorer
              onOpen={openWorkflow}
              onCreateNew={() => {
                setExplorerOpen(false);
                pushHistory();
                const fresh = createStarterWorkflow();
                setNodes(fresh.nodes);
                setEdges(fresh.edges);
                setGraphName('مسار جديد');
                setSelectedNodes([]);
                setSelectedEdges([]);
                setIsDirty(false);
                toast.success('تم إنشاء مسار جديد');
              }}
              onClose={() => setExplorerOpen(false)}
            />
          </div>
        </div>
      )}

      {templatesOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTemplatesOpen(false)}>
          <div className="w-full max-w-2xl h-[80vh] bg-slate-950 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
            <TemplateLibrary onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} />
          </div>
        </div>
      )}

      <NodeTemplateLibrary
        open={nodeTemplatesOpen}
        onClose={() => setNodeTemplatesOpen(false)}
        onApply={applyNodeTemplate}
      />

      <SearchEverywhere
        open={searchOpen}
        nodes={nodes}
        onClose={() => setSearchOpen(false)}
        onJumpToNode={(id) => focusNode(id)}
        onOpenWorkflow={(_id) => setExplorerOpen(true)}
      />

      <VariablePicker
        open={varPickerOpen}
        onSelect={handlePickVariable}
        onClose={() => { setVarPickerOpen(false); setVarPickerTarget(null); }}
      />

      {/* Phase 13 — Context menu */}
      {contextMenu.kind === 'canvas' && (
        <CanvasContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu({ kind: 'none' })}
          onCreateNode={() => createNodeAtCenter('notify')}
          onPaste={pasteFromClipboard}
          canPaste={canPaste}
          onFitView={fitView}
          onAutoLayout={runAutoLayout}
          onToggleGrid={() => setCanvasConfig((c) => ({ ...c, showGrid: !c.showGrid, showBackground: !c.showGrid ? 'dots' : 'none' }))}
          onToggleSnap={() => setCanvasConfig((c) => ({ ...c, snapToGrid: !c.snapToGrid }))}
          onToggleMinimap={() => setCanvasConfig((c) => ({ ...c, showMinimap: !c.showMinimap }))}
          showGrid={canvasConfig.showGrid}
          snapToGrid={canvasConfig.snapToGrid}
          showMinimap={canvasConfig.showMinimap}
        />
      )}

      {contextMenu.kind === 'node' && (() => {
        const target = nodes.find((n) => n.id === contextMenu.nodeId);
        if (!target) return null;
        return (
          <NodeContextMenu
            position={contextMenu.position}
            nodeId={target.id}
            nodeLabel={target.data.label}
            onClose={() => setContextMenu({ kind: 'none' })}
            onRename={() => { setSelectedNodes([target]); setRightMode('inspector'); }}
            onDuplicate={() => { setSelectedNodes([target]); duplicateSelected(); }}
            onDelete={() => { setSelectedNodes([target]); deleteSelected(); }}
            onDisable={() => toggleNodeEnabled(target.id)}
            onCopy={() => { setSelectedNodes([target]); copySelected(); }}
            onCut={() => { setSelectedNodes([target]); cutSelected(); }}
            onColor={() => {
              setColorPalette({ x: contextMenu.position.x + 20, y: contextMenu.position.y + 20, nodeId: target.id });
            }}
            onCollapse={() => toggleNodeCollapsed(target.id)}
            isCollapsed={target.data.collapsed ?? false}
            isDisabled={target.data.enabled === false}
            onCenterView={() => { setSelectedNodes([target]); centerView(); }}
          />
        );
      })()}

      {/* Phase 4 — Color palette */}
      {colorPalette && (
        <ColorPalette
          x={colorPalette.x}
          y={colorPalette.y}
          current={nodes.find((n) => n.id === colorPalette.nodeId)?.data.colorOverride}
          onSelect={(color) => setNodeColor(colorPalette.nodeId, color)}
          onClose={() => setColorPalette(null)}
        />
      )}

      {/* Phase 14 — Recovery dialog */}
      <RecoveryDialog
        open={!!recovery}
        warnings={recovery?.warnings ?? []}
        graphName={recovery?.name ?? ''}
        onAccept={() => {
          recovery?.pending?.();
          setRecovery(null);
        }}
        onCancel={() => setRecovery(null)}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Lightweight apply-changes (decoupled from reactflow internals)
   ════════════════════════════════════════════════════════════════════════ */

function applyNodeChangesLite(changes: any[], nodes: VBNode[]): VBNode[] {
  return nodes.map((node) => {
    let next = node;
    let removed = false;
    for (const change of changes) {
      if (change.id !== node.id && change.type !== 'add') continue;
      switch (change.type) {
        case 'select': next = { ...next, selected: change.selected }; break;
        case 'remove': removed = true; break;
        case 'position':
          next = { ...next, position: change.position ?? next.position };
          break;
        default: break;
      }
    }
    return removed ? (null as unknown as VBNode) : next;
  }).filter(Boolean) as VBNode[];
}

function applyEdgeChangesLite(changes: any[], edges: VBEdge[]): VBEdge[] {
  const toRemove = new Set(changes.filter((c: any) => c.type === 'remove').map((c: any) => c.id));
  return edges
    .filter((e) => !toRemove.has(e.id))
    .map((e) => {
      let next = e;
      for (const change of changes) {
        if (change.id !== e.id) continue;
        if (change.type === 'select') next = { ...next, selected: change.selected } as VBEdge;
      }
      return next;
    });
}

/* ════════════════════════════════════════════════════════════════════════
   EXPORTED PAGE — single ReactFlowProvider + error boundary
   ════════════════════════════════════════════════════════════════════════ */

export default function WorkflowDesignerPage() {
  return (
    <DesignerErrorBoundary label="workflow-designer-page">
      <ReactFlowProvider>
        <WorkflowDesignerInner />
      </ReactFlowProvider>
    </DesignerErrorBoundary>
  );
}
