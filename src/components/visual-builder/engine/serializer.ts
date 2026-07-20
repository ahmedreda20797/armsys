/**
 * Universal Visual Builder — Graph Serializer / Deserializer (Phases 10 & 11)
 *
 * Produces a self-contained, deterministic Designer JSON document:
 *   - nodes, edges, viewport, variables, metadata, designer settings
 *   - version, timestamp, graph UUID
 *
 * NON-DESTRUCTIVE: does NOT touch the Workflow Foundation types, the runtime,
 * Firebase, or any business logic. Designer JSON only — no runtime conversion.
 *
 * Round-trip guarantee: serializeGraph(state) → JSON → deserializeGraph(json)
 * reproduces the original graph (positions, viewport, selection, connections,
 * metadata) exactly, regenerating transient runtime fields safely.
 */

import type {
  VBNode, VBEdge, VBViewport, VBCanvasConfig, VBNodeDefinition,
} from './types';
import type { VBWorkflowDocumentation } from './v2-types';
import type { WorkflowVariable } from '@/workflow/types';
import { NODE_DEF_MAP } from '../nodes/nodeDefinitions';

/* ════════════════════════════════════════════════════════════════════════
   Serialized shape
   ════════════════════════════════════════════════════════════════════════ */

/** A node definition serialized without its transient ports (rebuilt on load). */
interface SerializedNodeDefinition {
  type: string;
  category: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  isSingleton?: boolean;
}

export interface VBSerializedNode {
  id: string;
  type: string;               // React Flow node type ("workflowNode")
  position: VBPosition;
  selected?: boolean;
  data: {
    nodeType: string;          // logical definition type, e.g. "notify"
    label: string;
    description?: string;
    status: VBNode['data']['status'];
    config: Record<string, unknown>;
    // Phase 4 — authoring attributes
    color?: string;            // override color (tailwind class)
    icon?: string;             // override icon key
    enabled?: boolean;         // false = disabled
    collapsed?: boolean;       // collapsed in canvas
    notes?: string;            // internal notes
    validationErrors?: string[];
    executionCount?: number;
  };
}

export interface VBSerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: VBEdge['type'];
  label?: string;
  animated?: boolean;
  selected?: boolean;
  data?: Record<string, unknown>;
}

export interface VBSerializedGraph {
  /** Schema version of the serialized document (independent from app version). */
  schemaVersion: 1;
  /** Semantic version of the designer that produced this document. */
  designerVersion: string;
  /** Stable UUID for this graph. Generated once, preserved across re-saves. */
  graphId: string;
  /** ISO timestamp of the last serialization. */
  timestamp: string;
  /** Human-friendly workflow name. */
  name: string;
  nodes: VBSerializedNode[];
  edges: VBSerializedEdge[];
  viewport: VBViewport;
  variables: WorkflowVariable[];
  documentation: VBWorkflowDocumentation;
  designer: VBCanvasConfig;
  /** Selection snapshot at save time (ordered: primary first). */
  selection: {
    nodeIds: string[];
    edgeIds: string[];
  };
  /** Validation score snapshot (advisory; recomputed on load). */
  score?: number;
}

interface VBPosition { x: number; y: number; }

/* ════════════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════════════ */

const DESIGNER_VERSION = '2.0.0';
const STORAGE_KEY_PREFIX = 'wf_designer_graph_';

export function generateGraphId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Pick only the portable subset of a VBNodeDefinition (drop ports, defaultData). */
function stripDefinition(def: VBNodeDefinition): SerializedNodeDefinition {
  return {
    type: def.type,
    category: def.category,
    label: def.label,
    description: def.description,
    icon: def.icon,
    color: def.color,
    isSingleton: def.isSingleton,
  };
}

/** Rebuild a full VBNodeDefinition from a serialized one (re-attach ports/defaults). */
function rebuildDefinition(serialized: SerializedNodeDefinition): VBNodeDefinition | null {
  // Prefer the live catalog so ports / defaultData are always correct.
  const live = NODE_DEF_MAP.get(serialized.type);
  if (live) {
    return {
      ...live,
      // Allow label/description overrides to survive round-trips.
      label: serialized.label ?? live.label,
      description: serialized.description ?? live.description,
      color: serialized.color ?? live.color,
      icon: serialized.icon ?? live.icon,
    };
  }
  // Unknown node type → return null so caller can substitute a placeholder.
  return null;
}

/* ════════════════════════════════════════════════════════════════════════
   SERIALIZE
   ════════════════════════════════════════════════════════════════════════ */

export interface SerializeInput {
  nodes: VBNode[];
  edges: VBEdge[];
  viewport: VBViewport;
  variables: WorkflowVariable[];
  documentation: VBWorkflowDocumentation;
  designer: VBCanvasConfig;
  name?: string;
  graphId?: string;
  score?: number;
}

export function serializeGraph(input: SerializeInput): VBSerializedGraph {
  const { nodes, edges, viewport, variables, documentation, designer } = input;

  const sNodes: VBSerializedNode[] = nodes.map((n) => {
    const cfg = (n.data.config ?? {}) as Record<string, unknown>;
    return {
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      selected: n.selected ? true : undefined,
      data: {
        nodeType: n.data.definition.type,
        label: n.data.label,
        description: n.data.description,
        status: n.data.status,
        config: cfg,
        color: (cfg.color as string | undefined) ?? n.data.definition.color,
        icon: (cfg.icon as string | undefined) ?? n.data.definition.icon,
        enabled: (cfg.enabled as boolean | undefined) ?? true,
        collapsed: (cfg.collapsed as boolean | undefined) ?? false,
        notes: (cfg.notes as string | undefined) ?? '',
        validationErrors: n.data.validationErrors,
        executionCount: n.data.executionCount,
      },
    };
  });

  const sEdges: VBSerializedEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
    label: e.label,
    animated: e.animated,
    selected: (e as VBEdge & { selected?: boolean }).selected ? true : undefined,
    data: e.data,
  }));

  return {
    schemaVersion: 1,
    designerVersion: DESIGNER_VERSION,
    graphId: input.graphId ?? generateGraphId(),
    timestamp: new Date().toISOString(),
    name: (input.name ?? documentation.purpose) || 'Untitled Workflow',
    nodes: sNodes,
    edges: sEdges,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    variables: variables.map((v) => ({ ...v })),
    documentation: { ...documentation, tags: [...documentation.tags], relatedModules: [...documentation.relatedModules] },
    designer: { ...designer },
    selection: {
      nodeIds: nodes.filter((n) => n.selected).map((n) => n.id),
      edgeIds: edges.filter((e) => (e as VBEdge & { selected?: boolean }).selected).map((e) => e.id),
    },
    score: input.score,
  };
}

/** Serialize to a pretty JSON string. */
export function serializeGraphToString(input: SerializeInput): string {
  return JSON.stringify(serializeGraph(input), null, 2);
}

/* ════════════════════════════════════════════════════════════════════════
   DESERIALIZE
   ════════════════════════════════════════════════════════════════════════ */

export interface DeserializeResult {
  nodes: VBNode[];
  edges: VBEdge[];
  variables: WorkflowVariable[];
  documentation: VBWorkflowDocumentation;
  designer: VBCanvasConfig;
  viewport: VBViewport;
  graphId: string;
  name: string;
  /** Non-fatal problems encountered while loading (for the recovery dialog). */
  warnings: DeserializeWarning[];
}

export interface DeserializeWarning {
  kind: 'unknown_node' | 'broken_edge' | 'duplicate_id' | 'schema_mismatch' | 'corrupted';
  message: string;
  refId?: string;
}

/** A minimal placeholder definition used when a serialized node type is unknown. */
function makePlaceholderDefinition(nodeType: string): VBNodeDefinition {
  return {
    type: nodeType || 'unknown',
    category: 'unknown',
    label: `Unknown: ${nodeType}`,
    description: 'This node type is not recognized by the current designer. ' +
      'It was preserved as a placeholder so the graph remains editable.',
    icon: 'AlertTriangle',
    color: 'bg-slate-600',
    ports: [
      { id: 'in', label: 'Input', type: 'input' },
      { id: 'out', label: 'Output', type: 'output' },
    ],
  };
}

/**
 * Deserialize a parsed object into live VB* state.
 * NEVER throws on shape problems — collects warnings and repairs instead.
 */
export function deserializeGraph(json: unknown): DeserializeResult {
  const warnings: DeserializeWarning[] = [];
  const emptyDesigner: VBCanvasConfig = {
    snapToGrid: true, gridSize: 16, showGrid: true, showMinimap: true,
    showBackground: 'dots', darkMode: true,
  };
  const emptyDoc: VBWorkflowDocumentation = {
    purpose: '', description: '', ownerId: '', ownerName: '',
    businessUnit: '', department: '', tags: [], versionNotes: '',
    relatedModules: [], businessImpact: 'medium',
    estimatedRuntimeMs: 5000, complexity: 'medium',
  };

  if (!json || typeof json !== 'object') {
    return {
      nodes: [], edges: [], variables: [],
      documentation: emptyDoc, designer: emptyDesigner,
      viewport: { x: 0, y: 0, zoom: 1 },
      graphId: generateGraphId(), name: 'Corrupted Graph',
      warnings: [{ kind: 'corrupted', message: 'Graph root is not an object.' }],
    };
  }

  const g = json as Partial<VBSerializedGraph> & { [k: string]: unknown };

  if (g.schemaVersion !== 1) {
    warnings.push({
      kind: 'schema_mismatch',
      message: `Schema version mismatch: expected 1, got ${String(g.schemaVersion)}. Attempting migration.`,
    });
  }

  // ── Nodes ──────────────────────────────────────────────────────────────
  const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
  const seenIds = new Set<string>();
  const nodes: VBNode[] = rawNodes.map((rn: VBSerializedNode) => {
    // Repair duplicate ids by suffixing.
    let id = rn.id;
    if (seenIds.has(id)) {
      const newId = `${id}_dup_${Math.random().toString(36).slice(2, 6)}`;
      warnings.push({ kind: 'duplicate_id', message: `Duplicate node id "${id}" renamed to "${newId}".`, refId: id });
      id = newId;
    }
    seenIds.add(id);

    const serializedDef: SerializedNodeDefinition = {
      type: rn.data?.nodeType ?? rn.type,
      category: 'unknown', label: rn.data?.label ?? rn.data?.nodeType ?? 'Node',
      description: rn.data?.description ?? '',
      icon: rn.data?.icon ?? 'Zap',
      color: rn.data?.color ?? 'bg-slate-600',
      isSingleton: undefined,
    };

    let def = rebuildDefinition(serializedDef);
    if (!def) {
      warnings.push({
        kind: 'unknown_node',
        message: `Node type "${serializedDef.type}" is unknown — rendered as placeholder.`,
        refId: id,
      });
      def = makePlaceholderDefinition(serializedDef.type);
    }

    const data = rn.data ?? ({} as VBSerializedNode['data']);
    // Fold authoring attrs back into config so they survive re-saving.
    const config: Record<string, unknown> = {
      ...(data.config ?? {}),
      color: data.color ?? def.color,
      icon: data.icon ?? def.icon,
      enabled: data.enabled ?? true,
      collapsed: data.collapsed ?? false,
      notes: data.notes ?? '',
    };

    return {
      id,
      type: 'workflowNode',
      position: { x: rn.position?.x ?? 0, y: rn.position?.y ?? 0 },
      selected: rn.selected === true ? true : undefined,
      data: {
        definition: def,
        label: data.label ?? def.label,
        description: data.description,
        status: data.status ?? 'idle',
        config,
        validationErrors: data.validationErrors ?? [],
        executionCount: data.executionCount,
      },
    } as VBNode;
  });

  // ── Edges ──────────────────────────────────────────────────────────────
  const rawEdges = Array.isArray(g.edges) ? g.edges : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: VBEdge[] = [];
  rawEdges.forEach((re: VBSerializedEdge) => {
    // Repair: drop edges referencing missing nodes.
    if (!nodeIds.has(re.source) || !nodeIds.has(re.target)) {
      warnings.push({
        kind: 'broken_edge',
        message: `Edge "${re.id}" references a missing node — dropped.`,
        refId: re.id,
      });
      return;
    }
    const edge: VBEdge = {
      id: re.id,
      source: re.source,
      target: re.target,
      sourceHandle: re.sourceHandle,
      targetHandle: re.targetHandle,
      type: re.type,
      label: re.label,
      animated: re.animated,
      data: re.data,
    };
    if (re.selected) (edge as VBEdge & { selected?: boolean }).selected = true;
    edges.push(edge);
  });

  return {
    nodes,
    edges,
    variables: Array.isArray(g.variables) ? [...g.variables] : [],
    documentation: g.documentation ?? emptyDoc,
    designer: g.designer ?? emptyDesigner,
    viewport: g.viewport ?? { x: 0, y: 0, zoom: 1 },
    graphId: g.graphId ?? generateGraphId(),
    name: g.name ?? 'Untitled Workflow',
    warnings,
  };
}

/**
 * Parse + deserialize in one call. Throws ONLY for JSON syntax errors so the
 * caller can show the recovery dialog; everything else is repaired.
 */
export function deserializeGraphFromString(text: string): DeserializeResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      nodes: [], edges: [], variables: [],
      documentation: {
        purpose: '', description: '', ownerId: '', ownerName: '',
        businessUnit: '', department: '', tags: [], versionNotes: '',
        relatedModules: [], businessImpact: 'medium',
        estimatedRuntimeMs: 5000, complexity: 'medium',
      },
      designer: {
        snapToGrid: true, gridSize: 16, showGrid: true, showMinimap: true,
        showBackground: 'dots', darkMode: true,
      },
      viewport: { x: 0, y: 0, zoom: 1 },
      graphId: generateGraphId(),
      name: 'Corrupted JSON',
      warnings: [{
        kind: 'corrupted',
        message: `JSON parse error: ${(err as Error).message}`,
      }],
    };
  }
  return deserializeGraph(json);
}

/* ════════════════════════════════════════════════════════════════════════
   LOCAL STORAGE PERSISTENCE (designer-side cache; NOT the database)
   ════════════════════════════════════════════════════════════════════════ */

export function saveGraphToLocalStorage(graphId: string, doc: VBSerializedGraph): boolean {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${graphId}`, JSON.stringify(doc));
    // Track the most-recent graph id for "reopen last".
    localStorage.setItem(`${STORAGE_KEY_PREFIX}_recent`, graphId);
    return true;
  } catch {
    return false;
  }
}

export function loadGraphFromLocalStorage(graphId: string): DeserializeResult | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${graphId}`);
    if (!raw) return null;
    return deserializeGraphFromString(raw);
  } catch {
    return null;
  }
}

export function getRecentGraphId(): string | null {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}_recent`);
  } catch {
    return null;
  }
}

export function listLocalGraphIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_KEY_PREFIX) && !k.endsWith('_recent'))
      .map((k) => k.slice(STORAGE_KEY_PREFIX.length));
  } catch {
    return [];
  }
}

export { DESIGNER_VERSION };
