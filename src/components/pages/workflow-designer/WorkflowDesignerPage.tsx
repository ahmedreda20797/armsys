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
 * STRICT RULES:
 *   - ONLY a visual authoring layer. No execution, no runtime.
 *   - Consumes the existing Workflow Foundation types (@/workflow/types).
 *   - Does NOT modify the Workflow Engine, Registry, Context, or any business logic.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useReactFlow, ReactFlowProvider, type XYPosition } from 'reactflow';
import { toast } from 'sonner';
import {
  Workflow, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
  CheckCircle2, AlertCircle, AlertTriangle, Settings, BookOpen, ListTree,
  GitBranch, FileText, Layers, Variable as VariableIcon,
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

import { validateGraphV2 } from '@/components/visual-builder/engine/v2-validation';
import { autoLayout } from '@/components/visual-builder/engine/layoutEngine';
import { getNodeValidationErrors } from '@/components/visual-builder/engine/validationEngine';
import { NODE_DEF_MAP } from '@/components/visual-builder/nodes/nodeDefinitions';

import type {
  VBNode, VBEdge, VBNodeDefinition, VBCanvasConfig,
} from '@/components/visual-builder/engine/types';
import type {
  VBValidationReport, VBNodeConfig, VBWorkflowDocumentation,
  VBVariableEntry, VBWorkflowRecord, VBNodeTemplate,
} from '@/components/visual-builder/engine/v2-types';
import type { WorkflowVariable } from '@/workflow/types';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
  purpose: '',
  description: '',
  ownerId: '',
  ownerName: '',
  businessUnit: '',
  department: '',
  tags: [],
  versionNotes: '',
  relatedModules: [],
  businessImpact: 'medium',
  estimatedRuntimeMs: 5000,
  complexity: 'medium',
};

/* ════════════════════════════════════════════════════════════════════════
   RIGHT PANEL MODES
   ════════════════════════════════════════════════════════════════════════ */

type RightPanelMode =
  | 'inspector'    | 'outline'     | 'documentation'
  | 'versions'     | 'simulation'  | 'explorer'
  | 'templates';

const RIGHT_MODES: { id: RightPanelMode; label: string; icon: React.ElementType }[] = [
  { id: 'inspector',   label: 'المفتش',   icon: Settings },
  { id: 'outline',     label: 'المخطط',   icon: ListTree },
  { id: 'documentation', label: 'الوثائق', icon: BookOpen },
  { id: 'simulation',  label: 'محاكاة',   icon: GitBranch },
  { id: 'versions',    label: 'الإصدارات', icon: Layers },
];

/* ════════════════════════════════════════════════════════════════════════
   VARIABLE PICKER TARGET (tracks where the picked variable goes)
   ════════════════════════════════════════════════════════════════════════ */

interface VarPickerTarget {
  kind: 'node-config' | 'node-condition' | 'edge-condition';
  fieldKey?: string;
  conditionId?: string;
  edgeId?: string;
}

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

  // ── Selection ──────────────────────────────────────────────────────────
  const [selectedNodes, setSelectedNodes] = useState<VBNode[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<VBEdge | null>(null);
  const primarySelected = selectedNodes[0] ?? null;
  const [simHighlight, setSimHighlight] = useState<string | null>(null);

  // ── Canvas config ──────────────────────────────────────────────────────
  const [canvasConfig, setCanvasConfig] = useState<VBCanvasConfig>({
    snapToGrid: true,
    gridSize: 16,
    showGrid: true,
    showMinimap: true,
    showBackground: 'dots',
    darkMode: true,
  });

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

  // ── Validation V2 ──────────────────────────────────────────────────────
  const validation = useMemo<VBValidationReport>(
    () => validateGraphV2(nodes, edges, SAMPLE_VARIABLES),
    [nodes, edges]
  );

  // Inject validation into nodes for renderer display
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

  // Apply simulation highlight to nodes (renders active node differently)
  const nodesForCanvas = useMemo(() => {
    if (!simHighlight) return nodesWithValidation;
    return nodesWithValidation.map((n) =>
      n.id === simHighlight
        ? { ...n, data: { ...n.data, status: 'active' as const } }
        : n
    );
  }, [nodesWithValidation, simHighlight]);

  // ── History ────────────────────────────────────────────────────────────
  const pastRef = useRef<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);
  const futureRef = useRef<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);
  const [, setHistVer] = useState(0);
  const MAX_HISTORY = 50;

  const pushHistory = useCallback((pn: VBNode[], pe: VBEdge[]) => {
    pastRef.current = [...pastRef.current.slice(-MAX_HISTORY + 1), { nodes: pn, edges: pe }];
    futureRef.current = [];
    setHistVer((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [{ nodes, edges }, ...futureRef.current];
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistVer((v) => v + 1);
    toast.info('تم التراجع');
  }, [nodes, edges]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, { nodes, edges }];
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistVer((v) => v + 1);
    toast.info('تمت الإعادة');
  }, [nodes, edges]);

  // ── Save state ─────────────────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Drag & Drop ────────────────────────────────────────────────────────
  const onDrop = useCallback((event: React.DragEvent, position: XYPosition) => {
    event.preventDefault();
    const defJson = event.dataTransfer.getData('application/reactflow');
    if (!defJson) return;
    let def: VBNodeDefinition;
    try { def = JSON.parse(defJson); } catch { return; }

    if (def.isSingleton && nodes.some((n) => n.data.definition.type === def.type)) {
      toast.error(`عقدة "${def.label}" موجودة بالفعل`);
      return;
    }
    pushHistory(nodes, edges);
    const newNode: VBNode = {
      id: generateNodeId(def.type),
      type: 'workflowNode',
      position: canvasConfig.snapToGrid
        ? { x: Math.round(position.x / canvasConfig.gridSize) * canvasConfig.gridSize, y: Math.round(position.y / canvasConfig.gridSize) * canvasConfig.gridSize }
        : position,
      data: {
        definition: def, label: def.label, description: def.description,
        status: 'idle', config: { ...(def.defaultData ?? {}) }, validationErrors: [],
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);
    setRecentlyUsed((prev) => {
      const next = [def.type, ...prev.filter((t) => t !== def.type)].slice(0, 10);
      try { localStorage.setItem('wf_recent', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [nodes, edges, canvasConfig, pushHistory]);

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
      if (hasRemoval || hasPosEnd) { pushHistory(nds, edges); setIsDirty(true); }
      return next;
    });
  }, [edges, pushHistory]);

  const onEdgesChange = useCallback((changes: any) => {
    setEdges((eds) => {
      const next = applyEdgeChangesLite(changes, eds);
      const hasRemoval = changes.some((c: any) => c.type === 'remove');
      if (hasRemoval) { pushHistory(nodes, eds); setIsDirty(true); }
      return next;
    });
  }, [nodes, pushHistory]);

  // ── Connect ────────────────────────────────────────────────────────────
  const onConnect = useCallback((connection: any) => {
    const sn = nodes.find((n) => n.id === connection.source);
    const tn = nodes.find((n) => n.id === connection.target);
    if (!sn || !tn) return;
    if (connection.source === connection.target) return;
    if (tn.data.definition.type === 'start') { toast.error('لا يمكن الاتصال بعقدة البداية'); return; }
    if (sn.data.definition.type === 'end') { toast.error('لا يمكن الاتصال من عقدة النهاية'); return; }
    const exists = edges.some((e) => e.source === connection.source && e.target === connection.target && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle);
    if (exists) return;
    pushHistory(nodes, edges);
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

  // ── Selection ──────────────────────────────────────────────────────────
  const onSelectionChange = useCallback((sel: VBNode[]) => {
    setSelectedNodes(sel);
    setSelectedEdge(null);
    if (sel.length > 0 && rightMode !== 'inspector') setRightMode('inspector');
  }, [rightMode]);

  const onEdgeClick = useCallback((edge: VBEdge) => {
    setSelectedNodes([]);
    setSelectedEdge(edge);
    if (rightMode !== 'inspector') setRightMode('inspector');
  }, [rightMode]);

  const focusNode = useCallback((id: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
    setSelectedNodes(nodes.filter((n) => n.id === id));
    const target = nodes.find((n) => n.id === id);
    if (target) rf.setCenter(target.position.x, target.position.y, { zoom: 1.2, duration: 300 });
    setRightMode('inspector');
  }, [nodes, rf]);

  // ── Update node ────────────────────────────────────────────────────────
  const onUpdateNode = useCallback((id: string, data: Partial<VBNode['data']> & { configPatch?: Record<string, unknown> }) => {
    pushHistory(nodes, edges);
    setNodes((nds) => nds.map((n) => {
      if (n.id !== id) return n;
      const mergedConfig = data.configPatch
        ? { ...n.data.config, ...data.configPatch }
        : n.data.config;
      return { ...n, data: { ...n.data, ...data, config: mergedConfig } };
    }));
    setIsDirty(true);
  }, [nodes, edges, pushHistory]);

  // ── Update edge ────────────────────────────────────────────────────────
  const onUpdateEdge = useCallback((id: string, data: Partial<VBEdge> & { dataPatch?: Record<string, unknown> }) => {
    pushHistory(nodes, edges);
    setEdges((eds) => eds.map((e) => {
      if (e.id !== id) return e;
      const mergedData = data.dataPatch ? { ...(e.data ?? {}), ...data.dataPatch } : e.data;
      return { ...e, ...data, data: mergedData };
    }));
    setIsDirty(true);
  }, [nodes, edges, pushHistory]);

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
    if (selectedNodes.length === 0) return;
    pushHistory(nodes, edges);
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedNodes([]);
    setIsDirty(true);
  }, [selectedNodes, nodes, edges, pushHistory]);

  const duplicateSelected = useCallback(() => {
    if (selectedNodes.length === 0) return;
    pushHistory(nodes, edges);
    const dupes: VBNode[] = selectedNodes.map((n) => ({
      ...n, id: generateNodeId(n.data.definition.type),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: { ...n.data }, selected: false,
    }));
    setNodes((nds) => [...nds, ...dupes]);
    setIsDirty(true);
    toast.success(`تم تكرار ${dupes.length} عقدة`);
  }, [selectedNodes, nodes, edges, pushHistory]);

  // ── Zoom / View ────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => rf.zoomIn(), [rf]);
  const zoomOut = useCallback(() => rf.zoomOut(), [rf]);
  const fitView = useCallback(() => rf.fitView({ padding: 0.2, duration: 300 }), [rf]);
  const centerView = useCallback(() => {
    if (selectedNodes.length > 0) {
      const b = selectedNodes.reduce((a, n) => ({
        minX: Math.min(a.minX, n.position.x), minY: Math.min(a.minY, n.position.y),
        maxX: Math.max(a.maxX, n.position.x + 180), maxY: Math.max(a.maxY, n.position.y + 80),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      rf.setCenter((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, { zoom: 1, duration: 300 });
    } else {
      rf.fitView({ padding: 0.2, duration: 300 });
    }
  }, [rf, selectedNodes]);

  // ── Auto layout ────────────────────────────────────────────────────────
  const runAutoLayout = useCallback(() => {
    pushHistory(nodes, edges);
    setNodes(autoLayout(nodes, edges));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 50);
    setIsDirty(true);
    toast.success('تم ترتيب العقد تلقائياً');
  }, [nodes, edges, pushHistory, rf]);

  // ── Save / Publish / Validate ──────────────────────────────────────────
  const handleSave = useCallback(() => {
    setIsSaving(true);
    setTimeout(() => { setIsSaving(false); setIsDirty(false); toast.success('تم حفظ التصميم'); }, 600);
  }, []);

  const handlePublish = useCallback(() => {
    if (!validation.valid) { toast.error('لا يمكن النشر — يوجد أخطاء'); setRightMode('inspector'); return; }
    setIsPublishing(true);
    setTimeout(() => { setIsPublishing(false); setIsDirty(false); toast.success('تم نشر المسار'); }, 800);
  }, [validation.valid]);

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
    pushHistory(nodes, edges);
    // Regenerate IDs to avoid collisions
    const idMap = new Map<string, string>();
    const newNodes = tNodes.map((n) => {
      const newId = generateNodeId(n.data.definition.type);
      idMap.set(n.id, newId);
      return { ...n, id: newId, position: { ...n.position }, data: { ...n.data } };
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
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 50);
    toast.success(`تم إضافة قالب بـ ${newNodes.length} عقدة`);
  }, [nodes, edges, pushHistory, rf]);

  // ── Apply node template (PART 8) ───────────────────────────────────────
  const applyNodeTemplate = useCallback((tpl: VBNodeTemplate) => {
    const def = NODE_DEF_MAP.get(tpl.nodeType);
    if (!def) { toast.error(`نوع عقدة غير معروف: ${tpl.nodeType}`); return; }
    pushHistory(nodes, edges);
    // Drop the new node near the center of the current viewport
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
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
  const openWorkflow = useCallback((_w: VBWorkflowRecord) => {
    setExplorerOpen(false);
    toast.success('تم فتح المسار (تجريبي)');
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      if (meta && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); redo(); return; }
      if (meta && e.key === 's') { e.preventDefault(); handleSave(); return; }
      if (meta && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (meta && e.key === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      if (meta && e.key === 'l') { e.preventDefault(); runAutoLayout(); return; }
      if (meta && e.key === '0') { e.preventDefault(); fitView(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.length > 0) { e.preventDefault(); deleteSelected(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, handleSave, duplicateSelected, runAutoLayout, fitView, deleteSelected, selectedNodes]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const errorCount = validation.errors.length;
  const warningCount = validation.warnings.length;

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/20">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">مصمم المسارات <span className="text-[9px] text-violet-400 font-mono ml-1">V2</span></h1>
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

        <div className="flex items-center gap-2">
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
        onToggleGrid={() => setCanvasConfig((c) => ({ ...c, showGrid: !c.showGrid, showBackground: !c.showGrid ? 'dots' : 'none' }))}
        onToggleSnap={() => setCanvasConfig((c) => ({ ...c, snapToGrid: !c.snapToGrid }))}
        onDeleteSelected={deleteSelected}
        onDuplicateSelected={duplicateSelected}
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
        <main className="flex-1 min-w-0 relative">
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
          />
        </main>

        {/* Right — Mode-switching panel */}
        {rightPanelOpen && (
          <aside className="w-80 flex-shrink-0 flex flex-col bg-slate-950/80 border-l border-slate-800/60">
            {/* Mode selector */}
            <div className="flex border-b border-slate-800/60 overflow-x-auto arm-scroll">
              {RIGHT_MODES.map(({ id, label, icon: Icon }) => {
                const badge = id === 'inspector' ? errorCount + warningCount : 0;
                return (
                  <button
                    key={id}
                    onClick={() => setRightMode(id)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap',
                      rightMode === id ? 'border-violet-500 text-violet-300 bg-violet-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {badge > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold',
                        errorCount > 0 ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                      )}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Mode content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {rightMode === 'inspector' && (
                <NodeInspectorV2
                  node={primarySelected}
                  edge={selectedEdge}
                  validation={validation}
                  onUpdateNode={onUpdateNode}
                  onUpdateEdge={onUpdateEdge}
                  onClose={() => { setSelectedNodes([]); setSelectedEdge(null); }}
                  onPickVariable={openVarPicker}
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
                <DocumentationPanel documentation={documentation} onChange={setDocumentation} />
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

      {/* Explorer (full-screen drawer from left) */}
      {explorerOpen && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setExplorerOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-96 max-w-[90vw] h-full bg-slate-950 border-l border-slate-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <WorkflowExplorer
              onOpen={openWorkflow}
              onCreateNew={() => { setExplorerOpen(false); toast.info('إنشاء مسار جديد (تجريبي)'); }}
              onClose={() => setExplorerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Templates */}
      {templatesOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTemplatesOpen(false)}>
          <div className="w-full max-w-2xl h-[80vh] bg-slate-950 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
            <TemplateLibrary onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} />
          </div>
        </div>
      )}

      {/* Node Templates (PART 8) */}
      <NodeTemplateLibrary
        open={nodeTemplatesOpen}
        onClose={() => setNodeTemplatesOpen(false)}
        onApply={applyNodeTemplate}
      />

      {/* Search Everywhere */}
      <SearchEverywhere
        open={searchOpen}
        nodes={nodes}
        onClose={() => setSearchOpen(false)}
        onJumpToNode={(id) => { focusNode(id); }}
        onOpenWorkflow={(_id) => { setExplorerOpen(true); }}
      />

      {/* Variable Picker */}
      <VariablePicker
        open={varPickerOpen}
        onSelect={handlePickVariable}
        onClose={() => { setVarPickerOpen(false); setVarPickerTarget(null); }}
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
        case 'position': next = { ...next, position: change.position ?? next.position }; break;
      }
    }
    return removed ? (null as any) : next;
  }).filter(Boolean) as VBNode[];
}

function applyEdgeChangesLite(changes: any[], edges: VBEdge[]): VBEdge[] {
  const toRemove = new Set(changes.filter((c: any) => c.type === 'remove').map((c: any) => c.id));
  return edges.filter((e) => !toRemove.has(e.id));
}

/* ════════════════════════════════════════════════════════════════════════
   EXPORTED PAGE — wrapped in ReactFlowProvider
   ════════════════════════════════════════════════════════════════════════ */

export default function WorkflowDesignerPage() {
  return (
    <ReactFlowProvider>
      <WorkflowDesignerInner />
    </ReactFlowProvider>
  );
}
