'use client';

/**
 * ARM ERP — Workflow Designer V1
 * The first consumer of the Universal Visual Builder Framework.
 *
 * STRICT RULES:
 *   - This is ONLY a visual layer. No execution, no runtime.
 *   - It consumes the existing Workflow Foundation types (@/workflow/types).
 *   - It does NOT modify the Workflow Engine, Registry, Context, or any business logic.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useReactFlow, ReactFlowProvider, type XYPosition } from 'reactflow';
import { toast } from 'sonner';
import {
  Workflow, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
  ChevronRight, CheckCircle2, AlertCircle, AlertTriangle, Variable as VariableIcon,
  Eye, Activity,
} from 'lucide-react';

// Visual Builder Framework
import { WorkflowCanvas } from '@/components/visual-builder/canvas/WorkflowCanvas';
import { DesignerToolbar } from '@/components/visual-builder/toolbar/DesignerToolbar';
import { NodeLibraryPanel } from '@/components/visual-builder/panels/NodeLibraryPanel';
import { PropertiesPanel } from '@/components/visual-builder/panels/PropertiesPanel';
import { validateGraph, autoLayout, getNodeValidationErrors } from '@/components/visual-builder/engine';
import { WORKFLOW_NODE_DEFINITIONS, NODE_DEF_MAP } from '@/components/visual-builder/nodes/nodeDefinitions';
import type {
  VBNode,
  VBEdge,
  VBNodeDefinition,
  VBCanvasConfig,
  VBValidationResult,
  VBViewport,
} from '@/components/visual-builder/engine';

// Workflow Foundation — types ONLY (no engine mutation)
import type { WorkflowVariable } from '@/workflow/types';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ════════════════════════════════════════════════════════════════════════
   ID generator (lightweight, no engine import)
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
   Sample workflow — a default starter template so the canvas isn't empty
   ════════════════════════════════════════════════════════════════════════ */

function createStarterWorkflow(): { nodes: VBNode[]; edges: VBEdge[] } {
  const startDef = NODE_DEF_MAP.get('start')!;
  const notifyDef = NODE_DEF_MAP.get('notify')!;
  const conditionDef = NODE_DEF_MAP.get('condition')!;
  const endDef = NODE_DEF_MAP.get('end')!;

  const startId = 'start_demo';
  const notifyId = 'notify_demo';
  const condId = 'cond_demo';
  const endId = 'end_demo';

  const makeNode = (id: string, type: string, def: VBNodeDefinition, x: number, y: number): VBNode => ({
    id,
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
    makeNode(startId, 'start', startDef, 0, 200),
    makeNode(notifyId, 'notify', notifyDef, 280, 200),
    makeNode(condId, 'condition', conditionDef, 560, 200),
    makeNode(endId, 'end', endDef, 840, 200),
  ];

  const edges: VBEdge[] = [
    { id: generateEdgeId(startId, notifyId), source: startId, target: notifyId, sourceHandle: 'out', targetHandle: 'in', type: 'default' },
    { id: generateEdgeId(notifyId, condId), source: notifyId, target: condId, sourceHandle: 'out', targetHandle: 'in', type: 'default' },
    { id: generateEdgeId(condId, endId), source: condId, target: endId, sourceHandle: 'yes', targetHandle: 'in', type: 'success' },
  ];

  return { nodes, edges };
}

/* ════════════════════════════════════════════════════════════════════════
   Sample variables — read-only display from Workflow Foundation types
   ════════════════════════════════════════════════════════════════════════ */

const SAMPLE_VARIABLES: WorkflowVariable[] = [
  { id: 'var1', name: 'requestId', type: 'string', scope: 'input', description: 'معرف الطلب الحالي', required: true },
  { id: 'var2', name: 'employeeId', type: 'string', scope: 'input', description: 'معرف الموظف', required: true },
  { id: 'var3', name: 'approvalStatus', type: 'string', scope: 'computed', description: 'حالة الموافقة', required: false },
  { id: 'var4', name: 'currentUser', type: 'object', scope: 'system', description: 'المستخدم الحالي', required: false },
  { id: 'var5', name: 'tempResult', type: 'string', scope: 'temp', description: 'نتيجة مؤقتة', required: false },
];

/* ════════════════════════════════════════════════════════════════════════
   RIGHT PANEL TABS (Properties | Variables | Validation)
   ════════════════════════════════════════════════════════════════════════ */

type RightTab = 'properties' | 'variables' | 'validation';

const RIGHT_TABS: { id: RightTab; label: string; icon: React.ElementType }[] = [
  { id: 'properties', label: 'الخصائص', icon: PanelRightOpen },
  { id: 'variables', label: 'المتغيرات', icon: VariableIcon },
  { id: 'validation', label: 'التحقق', icon: CheckCircle2 },
];

/* ════════════════════════════════════════════════════════════════════════
   MAIN DESIGNER COMPONENT (inside ReactFlowProvider)
   ════════════════════════════════════════════════════════════════════════ */

function WorkflowDesignerInner() {
  const rf = useReactFlow();

  // ── Graph state ────────────────────────────────────────────────────────
  const initial = useMemo(() => createStarterWorkflow(), []);
  const [nodes, setNodes] = useState<VBNode[]>(initial.nodes);
  const [edges, setEdges] = useState<VBEdge[]>(initial.edges);

  // ── Selection ──────────────────────────────────────────────────────────
  const [selectedNodes, setSelectedNodes] = useState<VBNode[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<VBEdge | null>(null);
  const primarySelected = selectedNodes[0] ?? null;

  // ── Canvas config ──────────────────────────────────────────────────────
  const [canvasConfig, setCanvasConfig] = useState<VBCanvasConfig>({
    snapToGrid: true,
    gridSize: 16,
    showGrid: true,
    showMinimap: true,
    showBackground: 'dots',
    darkMode: true,
  });

  // ── Panel visibility ───────────────────────────────────────────────────
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('properties');

  // ── Favorites & recently used (persisted to localStorage) ──────────────
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('wf_favorites') ?? '[]'); } catch { return []; }
  });
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('wf_recent') ?? '[]'); } catch { return []; }
  });

  // ── Validation ─────────────────────────────────────────────────────────
  const validation = useMemo<VBValidationResult>(
    () => validateGraph(nodes, edges),
    [nodes, edges]
  );

  // Inject validation errors into nodes for the renderer to display
  const nodesWithValidation = useMemo(() => {
    return nodes.map((n) => {
      const errs = getNodeValidationErrors(n.id, validation);
      const hasErrs = errs.length > 0;
      const currentErrs = n.data.validationErrors ?? [];
      if (hasErrs && currentErrs.join('|') === errs.join('|')) return n; // no change
      return {
        ...n,
        data: { ...n.data, validationErrors: errs, status: hasErrs ? ('error' as const) : n.data.status === 'error' ? ('idle' as const) : n.data.status },
      };
    });
  }, [nodes, validation]);

  // ── History (Undo / Redo) ──────────────────────────────────────────────
  const pastRef = useRef<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);
  const futureRef = useRef<Array<{ nodes: VBNode[]; edges: VBEdge[] }>>([]);
  const [historyVersion, setHistoryVersion] = useState(0); // force re-render for canUndo/canRedo
  const MAX_HISTORY = 50;

  const pushHistory = useCallback((prevNodes: VBNode[], prevEdges: VBEdge[]) => {
    pastRef.current = [...pastRef.current.slice(-MAX_HISTORY + 1), { nodes: prevNodes, edges: prevEdges }];
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [{ nodes, edges }, ...futureRef.current];
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistoryVersion((v) => v + 1);
    toast.info('تم التراجع');
  }, [nodes, edges]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, { nodes, edges }];
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryVersion((v) => v + 1);
    toast.info('تمت الإعادة');
  }, [nodes, edges]);

  // ── Dirty / save state ─────────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Drag & Drop from node library ──────────────────────────────────────
  const onDrop = useCallback((event: React.DragEvent, position: XYPosition) => {
    event.preventDefault();
    const defJson = event.dataTransfer.getData('application/reactflow');
    if (!defJson) return;

    let def: VBNodeDefinition;
    try { def = JSON.parse(defJson); } catch { return; }

    // Singleton check (e.g. only one Start node)
    if (def.isSingleton && nodes.some((n) => n.type === 'workflowNode' && n.data.definition.type === def.type)) {
      toast.error(`عقدة "${def.label}" موجودة بالفعل ولا يمكن تكرارها`);
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
        definition: def,
        label: def.label,
        description: def.description,
        status: 'idle',
        config: { ...(def.defaultData ?? {}) },
        validationErrors: [],
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);

    // Track recently used
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

  // ── Node changes (drag, select, remove) ────────────────────────────────
  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds) => {
      const next = applyNodeChangesLite(changes, nds);
      // Detect removals or position changes for history
      const hasRemoval = changes.some((c: any) => c.type === 'remove');
      const hasPositionEnd = changes.some((c: any) => c.type === 'position' && c.dragging === false);
      if (hasRemoval || hasPositionEnd) {
        pushHistory(nds, edges);
        setIsDirty(true);
      }
      return next;
    });
  }, [edges, pushHistory]);

  const onEdgesChange = useCallback((changes: any) => {
    setEdges((eds) => {
      const next = applyEdgeChangesLite(changes, eds);
      const hasRemoval = changes.some((c: any) => c.type === 'remove');
      if (hasRemoval) {
        pushHistory(nodes, eds);
        setIsDirty(true);
      }
      return next;
    });
  }, [nodes, pushHistory]);

  // ── Connect nodes ──────────────────────────────────────────────────────
  const onConnect = useCallback((connection: any) => {
    // Validate the connection
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    if (connection.source === connection.target) return;
    if (targetNode.data.definition.type === 'start') {
      toast.error('لا يمكن الاتصال بعقدة البداية');
      return;
    }
    if (sourceNode.data.definition.type === 'end') {
      toast.error('لا يمكن الاتصال من عقدة النهاية');
      return;
    }
    // Prevent duplicate edges between same handles
    const exists = edges.some(
      (e) => e.source === connection.source && e.target === connection.target &&
             e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle
    );
    if (exists) return;

    pushHistory(nodes, edges);
    const newEdge: VBEdge = {
      id: generateEdgeId(connection.source, connection.target),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'default',
      animated: true,
    };
    setEdges((eds) => [...eds, newEdge]);
    setIsDirty(true);

    // Remove animation after 1s
    setTimeout(() => {
      setEdges((eds) => eds.map((e) => (e.id === newEdge.id ? { ...e, animated: false } : e)));
    }, 1000);
  }, [nodes, edges, pushHistory]);

  // ── Selection handler ──────────────────────────────────────────────────
  const onSelectionChange = useCallback((sel: VBNode[]) => {
    setSelectedNodes(sel);
    if (sel.length > 0) setRightTab('properties');
  }, []);

  // ── Update node data (from properties panel) ───────────────────────────
  const onUpdateNode = useCallback((id: string, data: Partial<VBNode['data']>) => {
    pushHistory(nodes, edges);
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
    );
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
      ...n,
      id: generateNodeId(n.data.definition.type),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: { ...n.data },
      selected: false,
    }));
    setNodes((nds) => [...nds, ...dupes]);
    setIsDirty(true);
    toast.success(`تم تكرار ${dupes.length} عقدة`);
  }, [selectedNodes, nodes, edges, pushHistory]);

  // ── Zoom / View actions ────────────────────────────────────────────────
  const zoomIn = useCallback(() => rf.zoomIn(), [rf]);
  const zoomOut = useCallback(() => rf.zoomOut(), [rf]);
  const fitView = useCallback(() => rf.fitView({ padding: 0.2, duration: 300 }), [rf]);
  const centerView = useCallback(() => {
    if (selectedNodes.length > 0) {
      const bbox = selectedNodes.reduce(
        (acc, n) => ({
          minX: Math.min(acc.minX, n.position.x),
          minY: Math.min(acc.minY, n.position.y),
          maxX: Math.max(acc.maxX, n.position.x + 180),
          maxY: Math.max(acc.maxY, n.position.y + 80),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      );
      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      rf.setCenter(cx, cy, { zoom: 1, duration: 300 });
    } else {
      rf.fitView({ padding: 0.2, duration: 300 });
    }
  }, [rf, selectedNodes]);

  // ── Auto layout ────────────────────────────────────────────────────────
  const runAutoLayout = useCallback(() => {
    pushHistory(nodes, edges);
    const laidOut = autoLayout(nodes, edges);
    setNodes(laidOut);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 400 }), 50);
    setIsDirty(true);
    toast.success('تم ترتيب العقد تلقائياً');
  }, [nodes, edges, pushHistory, rf]);

  // ── Save / Publish / Validate ──────────────────────────────────────────
  const handleSave = useCallback(() => {
    setIsSaving(true);
    // Simulate save (no Firebase write — designer-only)
    setTimeout(() => {
      setIsSaving(false);
      setIsDirty(false);
      toast.success('تم حفظ التصميم');
    }, 600);
  }, []);

  const handlePublish = useCallback(() => {
    if (!validation.valid) {
      toast.error('لا يمكن النشر — يوجد أخطاء في التحقق');
      setRightTab('validation');
      return;
    }
    setIsPublishing(true);
    setTimeout(() => {
      setIsPublishing(false);
      setIsDirty(false);
      toast.success('تم نشر المسار بنجاح');
    }, 800);
  }, [validation.valid]);

  const handleValidate = useCallback(() => {
    if (validation.valid && validation.warnings.length === 0) {
      toast.success('التصميم سليم — لا توجد أخطاء أو تحذيرات');
    } else if (validation.valid) {
      toast.warning(`يوجد ${validation.warnings.length} تحذير`);
    } else {
      toast.error(`يوجد ${validation.errors.length} خطأ يحتاج إصلاح`);
    }
    setRightTab('validation');
  }, [validation]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;

      const meta = e.ctrlKey || e.metaKey;

      // Ctrl+Z — Undo
      if (meta && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      // Ctrl+Shift+Z or Ctrl+Y — Redo
      if (meta && (e.key === 'y' || (e.shiftKey && e.key === 'z' || e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }
      // Ctrl+S — Save
      if (meta && e.key === 's') { e.preventDefault(); handleSave(); return; }
      // Ctrl+D — Duplicate
      if (meta && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      // Ctrl+A — Select all
      if (meta && e.key === 'a') {
        e.preventDefault();
        const all = nodes.map((n) => ({ ...n, selected: true }));
        setNodes(all);
        setSelectedNodes(all);
        return;
      }
      // Ctrl+C / Ctrl+V — copy/paste (basic clipboard)
      if (meta && e.key === 'c' && selectedNodes.length > 0) {
        try { localStorage.setItem('wf_clipboard', JSON.stringify(selectedNodes)); } catch { /* noop */ }
        return;
      }
      if (meta && e.key === 'v') {
        try {
          const clip = localStorage.getItem('wf_clipboard');
          if (clip) {
            const clipNodes: VBNode[] = JSON.parse(clip);
            pushHistory(nodes, edges);
            const pasted = clipNodes.map((n) => ({
              ...n,
              id: generateNodeId(n.data.definition.type),
              position: { x: n.position.x + 60, y: n.position.y + 60 },
              selected: false,
            }));
            setNodes((nds) => [...nds, ...pasted]);
            setIsDirty(true);
          }
        } catch { /* noop */ }
        return;
      }
      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.length > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      // Ctrl+L — Auto layout
      if (meta && e.key === 'l') { e.preventDefault(); runAutoLayout(); return; }
      // Ctrl+F — Fit view
      if (meta && e.key === '0') { e.preventDefault(); fitView(); return; }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, handleSave, duplicateSelected, deleteSelected, runAutoLayout, fitView, nodes, edges, selectedNodes, pushHistory]);

  // historyVersion is read to force re-render of canUndo/canRedo
  void historyVersion;
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* ── Header / Title bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/20">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">مصمم المسارات</h1>
            <p className="text-[10px] text-slate-500">ARM ERP Workflow Designer V1</p>
          </div>
          <div className="flex items-center gap-1.5 mr-4 px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700/50">
            <span className={cn('w-1.5 h-1.5 rounded-full', validation.valid ? 'bg-emerald-400' : 'bg-red-400')} />
            <span className="text-[10px] text-slate-400">
              {validation.valid ? 'سليم' : `${validation.errors.length} خطأ`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Panel toggles */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setLeftPanelOpen((v) => !v)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {leftPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">إظهار/إخفاء المكتبة</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setRightPanelOpen((v) => !v)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">إظهار/إخفاء الخصائص</TooltipContent>
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
      />

      {/* ── Main split layout ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel — Node Library */}
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
            nodes={nodesWithValidation}
            edges={edges}
            config={canvasConfig}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onSelectionChange={onSelectionChange}
          />
        </main>

        {/* Right Panel — Properties / Variables / Validation */}
        {rightPanelOpen && (
          <aside className="w-80 flex-shrink-0 flex flex-col bg-slate-950/80 border-l border-slate-800/60">
            {/* Tab selector */}
            <div className="flex border-b border-slate-800/60">
              {RIGHT_TABS.map(({ id, label, icon: Icon }) => {
                const badge = id === 'validation' ? validation.errors.length + validation.warnings.length : 0;
                return (
                  <button
                    key={id}
                    onClick={() => setRightTab(id)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors border-b-2',
                      rightTab === id
                        ? 'border-violet-500 text-violet-300 bg-violet-500/5'
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {badge > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold',
                        validation.errors.length > 0 ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                      )}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0">
              {rightTab === 'properties' && (
                <PropertiesPanel
                  selectedNode={primarySelected}
                  selectedEdge={selectedEdge}
                  variables={SAMPLE_VARIABLES}
                  validation={validation}
                  onUpdateNode={onUpdateNode}
                  onClose={() => setSelectedNodes([])}
                />
              )}
              {rightTab === 'variables' && (
                <VariablesPanel variables={SAMPLE_VARIABLES} />
              )}
              {rightTab === 'validation' && (
                <ValidationOverview validation={validation} nodes={nodes} onSelectNode={(id) => {
                  setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
                  const target = nodes.find((n) => n.id === id);
                  if (target) rf.setCenter(target.position.x, target.position.y, { zoom: 1.2, duration: 300 });
                }} />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   VARIABLES PANEL (full panel mode)
   ════════════════════════════════════════════════════════════════════════ */

function VariablesPanel({ variables }: { variables: WorkflowVariable[] }) {
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return variables.filter((v) => {
      if (scopeFilter !== 'all' && v.scope !== scopeFilter) return false;
      return !q || v.name.toLowerCase().includes(q) || v.description.toLowerCase().includes(q);
    });
  }, [variables, search, scopeFilter]);

  const scopes = ['all', 'input', 'output', 'computed', 'system', 'temp'];
  const scopeLabels: Record<string, string> = {
    all: 'الكل', input: 'مدخل', output: 'مخرج', computed: 'محسوب', system: 'نظام', temp: 'مؤقت',
  };
  const scopeColors: Record<string, string> = {
    input: 'bg-blue-500/20 text-blue-400 border-blue-500/20',
    output: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
    computed: 'bg-violet-500/20 text-violet-400 border-violet-500/20',
    system: 'bg-amber-500/20 text-amber-400 border-amber-500/20',
    temp: 'bg-slate-500/20 text-slate-400 border-slate-500/20',
  };

  return (
    <div className="flex flex-col h-full" dir="rtl">
      <div className="p-3 space-y-2 border-b border-slate-800/60">
        <div className="relative">
          <VariableIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في المتغيرات..."
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {scopes.map((s) => (
            <button
              key={s}
              onClick={() => setScopeFilter(s)}
              className={cn(
                'px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors border',
                scopeFilter === s
                  ? 'bg-violet-600/30 text-violet-300 border-violet-500/30'
                  : 'text-slate-500 border-slate-700/40 hover:text-slate-300'
              )}
            >
              {scopeLabels[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 arm-scroll">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-600">
            <VariableIcon className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">لا توجد متغيرات</p>
          </div>
        )}
        {filtered.map((v) => (
          <div key={v.id} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/40 transition-colors">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono font-medium text-slate-200">{v.name}</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', scopeColors[v.scope] ?? scopeColors.temp)}>
                {scopeLabels[v.scope] ?? v.scope}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] text-slate-500 bg-slate-900/60 px-1.5 py-0.5 rounded font-mono">{v.type}</span>
              {v.required && <span className="text-[9px] text-red-400 font-medium">مطلوب</span>}
            </div>
            {v.description && <p className="text-[10px] text-slate-500">{v.description}</p>}
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-slate-800/60 bg-slate-900/40">
        <p className="text-[9px] text-slate-600 text-center">
          <Eye className="w-3 h-3 inline ml-1" />
          عرض فقط — تحرير المتغيرات متاح في الإصدار القادم
        </p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   VALIDATION OVERVIEW PANEL
   ════════════════════════════════════════════════════════════════════════ */

function ValidationOverview({
  validation,
  nodes,
  onSelectNode,
}: {
  validation: VBValidationResult;
  nodes: VBNode[];
  onSelectNode: (id: string) => void;
}) {
  const { errors, warnings } = validation;

  const findNodeLabel = (id?: string) => {
    if (!id) return null;
    return nodes.find((n) => n.id === id)?.data.label ?? null;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto arm-scroll" dir="rtl">
      {/* Summary */}
      <div className="p-3 border-b border-slate-800/60">
        <div className="grid grid-cols-2 gap-2">
          <div className={cn(
            'rounded-lg p-2.5 border text-center',
            errors.length === 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
          )}>
            <p className={cn('text-lg font-bold', errors.length === 0 ? 'text-emerald-400' : 'text-red-400')}>
              {errors.length}
            </p>
            <p className="text-[9px] text-slate-500">أخطاء</p>
          </div>
          <div className={cn(
            'rounded-lg p-2.5 border text-center',
            warnings.length === 0 ? 'bg-slate-700/20 border-slate-700/30' : 'bg-amber-500/10 border-amber-500/20'
          )}>
            <p className={cn('text-lg font-bold', warnings.length === 0 ? 'text-slate-400' : 'text-amber-400')}>
              {warnings.length}
            </p>
            <p className="text-[9px] text-slate-500">تحذيرات</p>
          </div>
        </div>
        {validation.valid && warnings.length === 0 && (
          <div className="mt-2 flex items-center justify-center gap-1.5 py-2 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-medium">التصميم سليم تماماً</span>
          </div>
        )}
      </div>

      {/* Errors list */}
      {errors.length > 0 && (
        <div className="p-3 space-y-2">
          <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-wider">الأخطاء</h3>
          {errors.map((err, i) => {
            const nodeLabel = findNodeLabel(err.nodeId);
            return (
              <button
                key={`err-${i}`}
                onClick={() => err.nodeId && onSelectNode(err.nodeId)}
                className="w-full flex gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors text-right"
              >
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-red-300">{err.message}</p>
                  {nodeLabel && <p className="text-[9px] text-red-500/70 mt-0.5">العقدة: {nodeLabel}</p>}
                  <p className="text-[8px] text-red-500/50 mt-0.5 font-mono">{err.code}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Warnings list */}
      {warnings.length > 0 && (
        <div className="p-3 space-y-2">
          <h3 className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">التحذيرات</h3>
          {warnings.map((warn, i) => {
            const nodeLabel = findNodeLabel(warn.nodeId);
            return (
              <button
                key={`warn-${i}`}
                onClick={() => warn.nodeId && onSelectNode(warn.nodeId)}
                className="w-full flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-colors text-right"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-amber-300">{warn.message}</p>
                  {nodeLabel && <p className="text-[9px] text-amber-500/70 mt-0.5">العقدة: {nodeLabel}</p>}
                  <p className="text-[8px] text-amber-500/50 mt-0.5 font-mono">{warn.code}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="mt-auto p-3 border-t border-slate-800/60 bg-slate-900/40">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {nodes.length} عقدة
          </span>
          <span>التحقق المباشر مُفعّل</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   LIGHTWEIGHT APPLY CHANGES (avoid importing reactflow utils in page scope)
   These mirror reactflow's applyNodeChanges / applyEdgeChanges so we keep
   the page decoupled from reactflow internals.
   ════════════════════════════════════════════════════════════════════════ */

function applyNodeChangesLite(changes: any[], nodes: VBNode[]): VBNode[] {
  return nodes.map((node) => {
    let next = node;
    for (const change of changes) {
      if (change.id !== node.id && change.type !== 'add') continue;
      switch (change.type) {
        case 'select':
          next = { ...next, selected: change.selected };
          break;
        case 'remove':
          return null as any;
        case 'position':
          next = { ...next, position: change.position ?? next.position };
          break;
        case 'dimensions':
          break; // ignore for V1
      }
    }
    return next;
  }).filter(Boolean) as VBNode[];
}

function applyEdgeChangesLite(changes: any[], edges: VBEdge[]): VBEdge[] {
  return edges.filter((edge) => {
    for (const change of changes) {
      if (change.id !== edge.id) continue;
      if (change.type === 'remove') return false;
    }
    return true;
  }).map((edge) => {
    let next = edge;
    for (const change of changes) {
      if (change.id !== edge.id) continue;
      if (change.type === 'select') next = { ...next };
    }
    return next;
  });
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
